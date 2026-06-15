import { NextRequest, NextResponse } from 'next/server'
import { repairStage4Resume } from '@/lib/llm/repair-stage4-resume'
import { applyDeterministicRepairs, validateStage4ResumeOutput } from '@/lib/stage4/resume-generation-contract'
import type {
  ContractViolation,
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeReadinessContract,
  UserProfile,
  BridgeQuestion,
} from '@/contracts'

export function validationToUnfixedViolations(violations: ContractViolation[]): string[] {
  return violations
    .filter(v => v.severity === 'error')
    .map(v => `[${v.rule}] ${v.section}: ${v.detail}`)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      resumeText: string
      violations: ContractViolation[]
      contract: ResumeGenerationContract
      readinessContract?: ResumeReadinessContract
      profile: UserProfile
      jdMap: JDRequirementMap
      bridgeAnswers?: BridgeQuestion[]
    }

    if (!body.resumeText?.trim()) {
      return NextResponse.json(
        { error: 'No resume text to repair.', code: 'NO_TEXT' },
        { status: 422 }
      )
    }
    if (!body.violations?.length) {
      return NextResponse.json(
        { error: 'No violations provided.', code: 'NO_VIOLATIONS' },
        { status: 422 }
      )
    }
    if (!body.contract) {
      return NextResponse.json(
        { error: 'No contract provided.', code: 'NO_CONTRACT' },
        { status: 422 }
      )
    }

    // Step 1: deterministic repairs first (idempotent — safe to re-run)
    const { repairedText: afterDeterministic, repairsApplied: deterministicRepairs } =
      applyDeterministicRepairs(body.resumeText, body.contract, 'fullText')

    // Step 2: check if semantic violations remain after deterministic pass
    const knownTools = [
      ...body.profile.skills,
      ...body.profile.skillGroups.flatMap(g => g.skills),
    ]
    const postDeterministicValidation = validateStage4ResumeOutput(
      afterDeterministic,
      body.contract,
      {
        knownTools,
        readinessContract: body.readinessContract,
      },
    )

    const semanticViolations = postDeterministicValidation.violations.filter(
      v => !v.canAutoRepair && v.severity === 'error'
    )

    if (semanticViolations.length === 0) {
      const unfixedViolations = postDeterministicValidation.pass
        ? []
        : validationToUnfixedViolations(postDeterministicValidation.violations)
      return NextResponse.json({
        repairedText: afterDeterministic,
        repairsApplied: deterministicRepairs,
        unfixedViolations,
        repairStatus: postDeterministicValidation.pass ? 'repaired' : 'partial',
        remainingValidation: postDeterministicValidation,
      })
    }

    // Step 3: one bounded LLM repair pass for semantic violations
    const llmResult = await repairStage4Resume({
      resumeText: afterDeterministic,
      violations: semanticViolations,
      contract: body.contract,
      profile: body.profile,
      jdMap: body.jdMap,
      bridgeAnswers: body.bridgeAnswers ?? [],
    })

    // Step 4: run deterministic repairs on LLM output (LLM may have reintroduced banned phrases)
    const { repairedText: finalText, repairsApplied: postLLMRepairs } =
      applyDeterministicRepairs(llmResult.repairedText, body.contract, 'fullText')

    // Step 5: final validation
    const finalValidation = validateStage4ResumeOutput(finalText, body.contract, {
      knownTools,
      readinessContract: body.readinessContract,
    })

    const unfixedViolations = finalValidation.pass
      ? []
      : [
          ...new Set([
            ...llmResult.unfixedViolations,
            ...validationToUnfixedViolations(finalValidation.violations),
          ]),
        ]

    return NextResponse.json({
      repairedText: finalText,
      repairsApplied: finalValidation.pass
        ? [...deterministicRepairs, ...llmResult.repairsApplied, ...postLLMRepairs]
        : [
            ...deterministicRepairs,
            'LLM repair attempted; remaining violations are listed separately.',
            ...postLLMRepairs,
          ],
      unfixedViolations,
      repairStatus: finalValidation.pass ? 'repaired' : 'partial',
      remainingValidation: finalValidation,
    })
  } catch (err) {
    console.error('stage4-repair route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Repair failed.' },
      { status: 500 }
    )
  }
}
