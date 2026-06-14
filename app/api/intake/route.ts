import { NextRequest, NextResponse } from 'next/server'
import { parseJobDescription } from '@/lib/llm/parse-jd'
import { parseDomainIQ } from '@/lib/llm/parse-domainiq'
import { generateIntakeSynthesis, type IntakeSynthesis } from '@/lib/llm/generate-intake'
import { validateJDContent } from '@/lib/validators/jd-content'
import type { UserProfile, JDSourceType, JDRequirementMap, FitAnalysis, FitRequirement } from '@/contracts'

function buildFitAnalysis(jdMap: JDRequirementMap, synthesis: IntakeSynthesis): FitAnalysis {
  const requirements: FitRequirement[] = jdMap.required.map((r, i) => ({
    requirementId: `req-${i}`,
    requirementText: r.text,
    category: r.category,
    coverageStatus: r.userCoverageStatus,
    gapClassification: r.gapClassification,
    supportingEvidence: r.profileEvidence ? [r.profileEvidence] : [],
  }))

  const gapSummary = {
    trueGaps: requirements
      .filter(r => r.gapClassification === 'true_gap')
      .map(r => r.requirementText),
    missingFromProfile: requirements
      .filter(r => r.gapClassification === 'profile_missing')
      .map(r => r.requirementText),
    needsConfirmation: requirements
      .filter(r => r.gapClassification === 'needs_confirmation')
      .map(r => r.requirementText),
    wordingOrMapping: requirements
      .filter(r => r.gapClassification === 'wording_gap' || r.gapClassification === 'mapping_gap')
      .map(r => r.requirementText),
  }

  return {
    fitHypothesis: synthesis.fitHypothesis,
    realJobFunction: jdMap.realJobFunction,
    evaluatorLens: synthesis.evaluatorLens ?? '',
    riskNotes: synthesis.riskGaps,
    requirements,
    gapSummary,
    recommendedBridgeTargets: jdMap.needsEvidenceItems,
    generatedAt: new Date().toISOString(),
  }
}

export async function POST(req: NextRequest) {
  try {
    const { jdText, domainIQText, profile, jdSourceType, roleTitle, company } =
      await req.json() as {
        jdText: string
        domainIQText: string
        profile: UserProfile
        jdSourceType?: JDSourceType
        roleTitle?: string
        company?: string
      }

    if (!jdText?.trim()) {
      return NextResponse.json({ error: 'jdText is required' }, { status: 400 })
    }

    // Server-side JD content validation — defense in depth.
    // The client already validates, but this ensures the LLM is never called on bad content
    // regardless of how the request was constructed.
    const validation = validateJDContent(jdText, { roleTitle, company })
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'The job description content is not valid for analysis.',
          reason: validation.reason,
          message: validation.message,
        },
        { status: 422 }
      )
    }

    const skillsSummary = profile.skills.join(', ')

    const [parsed, domainIQ] = await Promise.all([
      parseJobDescription(jdText, skillsSummary, jdSourceType ?? 'pasted_jd'),
      parseDomainIQ(domainIQText ?? ''),
    ])

    const synthesis = await generateIntakeSynthesis(parsed.requirementMap, domainIQ, profile)
    const fitAnalysis = buildFitAnalysis(parsed.requirementMap, synthesis)

    return NextResponse.json({
      rawJD: parsed.rawJD,
      requirementMap: parsed.requirementMap,
      domainIQ,
      synthesis,
      fitAnalysis,
    })
  } catch (err) {
    console.error('intake route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
