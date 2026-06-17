import { NextRequest, NextResponse } from 'next/server'
import { refineResumeArtifact } from '@/lib/llm/refine-artifact-section'
import { refineFullResumeExport } from '@/lib/llm/refine-stage4-resume'
import type {
  ResumeGenerationContract,
  ResumeStrategyBrief,
  SectionType, JDRequirementMap, UserProfile, BridgeQuestion,
  LearningSignal, EmphasisCategory, CalibrationSummary,
} from '@/contracts'
import { applyDeterministicRepairs } from '@/lib/stage4/resume-generation-contract'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      mode: 'full' | 'section'
      sessionId: string
      // full mode
      fullResumeText?: string
      // section mode
      sectionType?: string
      sectionText?: string
      // common
      userInstruction: string
      jdMap: JDRequirementMap
      profile: UserProfile
      answeredQuestions: BridgeQuestion[]
      emphasis: EmphasisCategory
      companySummary?: string
      fitHypothesis?: string
      riskGaps?: string[]
      acceptedSignals?: LearningSignal[]
      globalSignals?: LearningSignal[]
      rejectedPhrases?: string[]
      calibrationSummary?: CalibrationSummary
      roleTitle?: string
      company?: string
      contract?: ResumeGenerationContract
      strategyBrief?: ResumeStrategyBrief
    }

    if (!body.userInstruction?.trim()) {
      return NextResponse.json(
        { error: 'A refinement instruction is required.', code: 'NO_INSTRUCTION' },
        { status: 422 }
      )
    }
    if (!body.jdMap?.required?.length) {
      return NextResponse.json(
        { error: 'Stage 1 Target Intake must be completed before refining.', code: 'STAGE1_REQUIRED' },
        { status: 422 }
      )
    }

    const common = {
      jdMap: body.jdMap,
      profile: body.profile,
      answeredQuestions: body.answeredQuestions ?? [],
      emphasis: body.emphasis,
      companySummary: body.companySummary,
      fitHypothesis: body.fitHypothesis,
      riskGaps: body.riskGaps,
      acceptedSignals: body.acceptedSignals ?? [],
      globalSignals: body.globalSignals,
      rejectedPhrases: body.rejectedPhrases ?? [],
      calibrationSummary: body.calibrationSummary,
      roleTitle: body.roleTitle,
      company: body.company,
      strategyBrief: body.strategyBrief,
    }

    if (body.mode === 'full') {
      if (!body.fullResumeText?.trim()) {
        return NextResponse.json(
          { error: 'No resume text to refine.', code: 'NO_TEXT' },
          { status: 422 }
        )
      }
      const result = await refineFullResumeExport({
        fullResumeText: body.fullResumeText,
        userInstruction: body.userInstruction,
        contract: body.contract,
        ...common,
      })
      // Apply deterministic repairs to LLM output before returning
      const repaired = body.contract
        ? applyDeterministicRepairs(result.revisedText, body.contract, 'fullText')
        : { repairedText: result.revisedText, repairsApplied: [] }
      return NextResponse.json({
        ...result,
        revisedText: repaired.repairedText,
        warnings: [
          ...result.warnings,
          ...repaired.repairsApplied.map(r => `[auto-repair] ${r}`),
        ],
      })
    }

    // Section mode — reuse the existing section refinement LLM function
    if (!body.sectionText?.trim()) {
      return NextResponse.json(
        { error: 'No section text to refine.', code: 'NO_TEXT' },
        { status: 422 }
      )
    }
    // Education is not a SectionType; fall back to 'summary' for evidence scoping
    const sectionType: SectionType =
      (body.sectionType as SectionType) ?? 'summary'

    const result = await refineResumeArtifact({
      sessionId: body.sessionId,
      sectionType,
      artifactText: body.sectionText,
      userInstruction: body.userInstruction,
      ...common,
    })

    // Apply deterministic repairs to section output
    const repaired = body.contract
      ? applyDeterministicRepairs(result.revisedText, body.contract, 'section')
      : { repairedText: result.revisedText, repairsApplied: [] }

    return NextResponse.json({
      revisedText: repaired.repairedText,
      changeSummary: result.changeSummary,
      warnings: [
        ...(result.evidenceBoundary?.unsupportedRequests ?? []),
        ...repaired.repairsApplied.map(r => `[auto-repair] ${r}`),
      ],
    })
  } catch (err) {
    console.error('stage4-refine route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Refinement failed.' },
      { status: 500 }
    )
  }
}
