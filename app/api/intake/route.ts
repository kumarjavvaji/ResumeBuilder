import { NextRequest, NextResponse } from 'next/server'
import { parseJobDescription } from '@/lib/llm/parse-jd'
import { parseDomainIQ } from '@/lib/llm/parse-domainiq'
import { generateIntakeSynthesis, type IntakeSynthesis } from '@/lib/llm/generate-intake'
import { validateJDContent } from '@/lib/validators/jd-content'
import { deriveStage1Findings } from '@/lib/stage1/source-trace'
import { extractCompanyIndustryBasisFromDomainIQText, buildCalibrationBrief } from '@/lib/stage1/calibration-brief'
import { matchRequirementsToEvidence } from '@/lib/stage1/evidence-match'
import { summarizeEvidenceIndex } from '@/lib/profile/profileProjectionService'
import type { UserProfile, JDSourceType, JDRequirementMap, DomainIQImport, FitAnalysis, FitRequirement, Stage1CalibrationBrief, ProfileEvidenceIndexItem } from '@/contracts'

function buildFitAnalysis(
  jdMap: JDRequirementMap,
  synthesis: IntakeSynthesis,
  domainIQ?: DomainIQImport,
  calibrationBrief?: Stage1CalibrationBrief
): FitAnalysis {
  const requirements: FitRequirement[] = jdMap.required.map((r, i) => ({
    requirementId: `req-${i}`,
    requirementText: r.text,
    category: r.category,
    coverageStatus: r.userCoverageStatus,
    gapClassification: r.gapClassification,
    supportingEvidence: r.profileEvidence ? [r.profileEvidence] : [],
    diqCalibration: r.diqCalibration,
    resumeImplication: r.resumeImplication,
    rowLabel: r.rowLabel,
    jdSignal: r.jdSignal,
    quickDiqGrounding: r.quickDiqGrounding,
    profileGrounding: r.profileGrounding,
    calibratedFitInterpretation: r.calibratedFitInterpretation,
    classification: r.classification,
    evidenceNeeded: r.evidenceNeeded,
    stage2Implication: r.stage2Implication,
    matchedClaimIds: r.matchedClaimIds,
    profileEvidenceStrength: r.profileEvidenceStrength,
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
    findings: deriveStage1Findings(jdMap, domainIQ),
    calibrationBrief,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { jdText, domainIQText, profile, jdSourceType, roleTitle, company, profileEvidenceIndex } =
      await req.json() as {
        jdText: string
        domainIQText: string
        profile: UserProfile
        jdSourceType?: JDSourceType
        roleTitle?: string
        company?: string
        /** Compact, bounded projection of the active ProfileSnapshot — built client-side, not stored. */
        profileEvidenceIndex?: ProfileEvidenceIndexItem[]
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

    const evidenceIndex = profileEvidenceIndex ?? []
    // Compact, bounded evidence context — supplements the flat skill list with
    // reusable, source-tracked profile claims (resume uploads, prior sessions, bridge answers).
    const evidenceSummary = summarizeEvidenceIndex(evidenceIndex)
    const skillsSummary = evidenceSummary
      ? `${profile.skills.join(', ')}\n\nAdditional profile evidence:\n${evidenceSummary}`
      : profile.skills.join(', ')

    const companyIndustryBasis = extractCompanyIndustryBasisFromDomainIQText(domainIQText ?? '')
    const calibrationBrief = companyIndustryBasis ? buildCalibrationBrief(companyIndustryBasis) : undefined

    const [parsed, domainIQ] = await Promise.all([
      parseJobDescription(jdText, skillsSummary, jdSourceType ?? 'pasted_jd', calibrationBrief),
      parseDomainIQ(domainIQText ?? ''),
    ])

    // Deterministic post-pass: match parsed requirements against the evidence index.
    // No LLM involved — same token-overlap approach used for claim dedup.
    parsed.requirementMap.required = matchRequirementsToEvidence(parsed.requirementMap.required, evidenceIndex)
    parsed.requirementMap.niceToHave = matchRequirementsToEvidence(parsed.requirementMap.niceToHave, evidenceIndex)

    const synthesis = await generateIntakeSynthesis(parsed.requirementMap, domainIQ, profile, calibrationBrief)
    const fitAnalysis = buildFitAnalysis(parsed.requirementMap, synthesis, domainIQ, calibrationBrief)

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
