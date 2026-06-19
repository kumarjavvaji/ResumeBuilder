import type {
  DomainIQImport,
  JDRequirement,
  JDRequirementMap,
  Stage1DownstreamPermission,
  Stage1Finding,
  Stage1SourceTrace,
  Stage1SourceType,
  Stage1SourceUsage,
} from '@/contracts'

/**
 * Ground-truth sources are primary: JD text, profile evidence, and profile absence.
 * DIQ/QuickStart context, calibration refs, and inference are always secondary framing
 * — even when they repeat or reframe a claim that originated in the JD.
 */
const GROUND_TRUTH_SOURCE_TYPES: Stage1SourceType[] = [
  'jd_company_description',
  'jd_department_overview',
  'jd_duties',
  'jd_qualifications',
  'profile_evidence',
  'profile_absence',
]

export function isPrimarySourceType(sourceType: Stage1SourceType): boolean {
  return GROUND_TRUTH_SOURCE_TYPES.includes(sourceType)
}

export function buildSourceTrace(input: {
  sourceType: Stage1SourceType
  sourceLabel: string
  supportingText: string
  usage: Stage1SourceUsage
  primary?: boolean
}): Stage1SourceTrace {
  return {
    sourceType: input.sourceType,
    sourceLabel: input.sourceLabel,
    supportingText: input.supportingText,
    usage: input.usage,
    primary: input.primary ?? isPrimarySourceType(input.sourceType),
  }
}

export function computeDownstreamPermission(
  coverageStatus: Stage1Finding['coverageStatus'],
  sourceTrace: Stage1SourceTrace[],
): Stage1DownstreamPermission {
  const hasProfileEvidence = sourceTrace.some(t => t.sourceType === 'profile_evidence')
  const hasProfileAbsence = sourceTrace.some(t => t.sourceType === 'profile_absence')
  const groundedTypes: Stage1SourceType[] = ['jd_company_description', 'jd_department_overview', 'jd_duties', 'jd_qualifications', 'profile_evidence', 'profile_absence']
  const hasAnyGroundedSource = sourceTrace.some(t => groundedTypes.includes(t.sourceType))
  const onlyContextSources = sourceTrace.length > 0 && !hasAnyGroundedSource
    && sourceTrace.every(t => t.sourceType === 'diq_context' || t.sourceType === 'quickstart_company_context')
  const onlyInference = sourceTrace.length > 0 && sourceTrace.every(t => t.sourceType === 'inference')

  if (onlyContextSources || coverageStatus === 'context_only') return 'context_only_do_not_claim'
  if (coverageStatus === 'covered' && hasProfileEvidence) return 'can_support_resume_claim'
  // retrieval_gap: deterministic match suggests evidence exists — treat as needs_user_evidence,
  // not gap_to_bridge, so downstream stages don't over-weight it as a hard gap.
  if (coverageStatus === 'retrieval_gap') return 'needs_user_evidence'
  if (coverageStatus === 'partial' || coverageStatus === 'weakly_supported') return 'needs_user_evidence'
  if (coverageStatus === 'gap' || coverageStatus === 'needs_evidence' || hasProfileAbsence) return 'gap_to_bridge'
  if (onlyInference) return 'inference_only'
  return 'needs_user_evidence'
}

/** Maps a requirement's existing JDSourceType-ish category to a finding-level JD source subtype. */
function inferJdSourceType(req: JDRequirement): Stage1SourceType {
  if (req.category === 'domain') return 'jd_department_overview'
  if (req.category === 'tool' || req.category === 'process') return 'jd_duties'
  return 'jd_qualifications'
}

export function buildJDRequirementFinding(req: JDRequirement, index: number): Stage1Finding {
  const coverageStatus: Stage1Finding['coverageStatus'] =
    req.classification === 'retrieval_gap' ? 'retrieval_gap' as Stage1Finding['coverageStatus']
      : req.userCoverageStatus === 'covered' ? 'covered'
      : req.userCoverageStatus === 'partial' ? 'partial'
      : req.userCoverageStatus === 'gap' ? 'gap'
      : 'needs_evidence'

  const sourceTrace: Stage1SourceTrace[] = [
    buildSourceTrace({
      sourceType: inferJdSourceType(req),
      sourceLabel: 'JD requirement',
      supportingText: req.sourceExcerpt || req.text,
      usage: 'role_requirement',
    }),
  ]

  if (req.profileEvidence) {
    sourceTrace.push(buildSourceTrace({
      sourceType: 'profile_evidence',
      sourceLabel: 'Profile evidence',
      supportingText: req.profileEvidence,
      usage: 'candidate_evidence',
    }))
  } else if (coverageStatus === 'gap' || coverageStatus === 'needs_evidence') {
    sourceTrace.push(buildSourceTrace({
      sourceType: 'profile_absence',
      sourceLabel: 'Profile gap',
      supportingText: `No profile evidence found for: ${req.text}`,
      usage: 'candidate_gap',
    }))
  }

  return {
    id: `req-${index}`,
    topic: req.text,
    findingText: req.text,
    coverageStatus,
    sourceTrace,
    downstreamPermission: computeDownstreamPermission(coverageStatus, sourceTrace),
  }
}

/**
 * Builds a context-only finding (company context / DIQ / QuickStart framing).
 * If the same claim also appears verbatim-ish in the JD, pass jdSupportingText so the
 * JD source is cited as primary — per the rule that JD-origin claims stay JD-primary
 * even when DIQ/QuickStart repeats or reframes them.
 */
export function buildCompanyContextFinding(input: {
  id: string
  topic: string
  findingText: string
  contextSourceType: 'diq_context' | 'quickstart_company_context'
  contextSourceLabel: string
  contextSupportingText: string
  jdSupportingText?: string
  jdSourceLabel?: string
}): Stage1Finding {
  const sourceTrace: Stage1SourceTrace[] = []

  if (input.jdSupportingText) {
    sourceTrace.push(buildSourceTrace({
      sourceType: 'jd_company_description',
      sourceLabel: input.jdSourceLabel ?? 'JD company description',
      supportingText: input.jdSupportingText,
      usage: 'role_requirement',
    }))
  }

  sourceTrace.push(buildSourceTrace({
    sourceType: input.contextSourceType,
    sourceLabel: input.contextSourceLabel,
    supportingText: input.contextSupportingText,
    usage: 'context_for_positioning',
  }))

  const coverageStatus: Stage1Finding['coverageStatus'] = 'context_only'

  return {
    id: input.id,
    topic: input.topic,
    findingText: input.findingText,
    coverageStatus,
    sourceTrace,
    downstreamPermission: computeDownstreamPermission(coverageStatus, sourceTrace),
  }
}

export function deriveStage1Findings(jdMap: JDRequirementMap, domainIQ?: DomainIQImport): Stage1Finding[] {
  const findings: Stage1Finding[] = [
    ...jdMap.required.map((req, i) => buildJDRequirementFinding(req, i)),
    ...jdMap.niceToHave.map((req, i) => buildJDRequirementFinding(req, jdMap.required.length + i)),
  ]

  if (domainIQ?.companyProfile) {
    findings.push(buildCompanyContextFinding({
      id: 'company-context-diq',
      topic: 'company_context',
      findingText: domainIQ.companyProfile,
      contextSourceType: 'diq_context',
      contextSourceLabel: 'DomainIQ company profile',
      contextSupportingText: domainIQ.companyProfile,
    }))
  }

  return findings
}
