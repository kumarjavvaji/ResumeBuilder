import type {
  CalibrationArtifactDecision,
  CalibrationInfluence,
  CalibrationInfluenceUseLevel,
  ResumeBullet,
  SectionType
} from '@/contracts'

const DECISION_TYPES: CalibrationArtifactDecision['decisionType'][] = [
  'wording',
  'emphasis',
  'inclusion',
  'exclusion',
  'ordering',
  'gap_handling'
]

const MATERIAL_DECISION_TYPES = new Set<CalibrationArtifactDecision['decisionType']>([
  'inclusion',
  'exclusion',
  'ordering',
  'gap_handling'
])

const GENERIC_CLAIMS = [
  'used calibration',
  'make this stronger',
  'stronger',
  'better aligned',
  'more relevant',
  'market aligned',
  'calibration references support',
  'similar roles',
  'similar profiles'
]

const CALIBRATION_EVIDENCE_TERMS = [
  'calibration',
  'market pattern',
  'market calibration',
  'target ref',
  'comparable ref',
  'matchreason',
  'covergo',
  'questrade'
]

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isConcreteDecision(decision: CalibrationArtifactDecision): boolean {
  const text = `${decision.pattern} ${decision.decision}`.toLowerCase()
  if (!decision.pattern || !decision.decision) return false
  if (decision.decision.length < 24) return false
  return !GENERIC_CLAIMS.some(claim => text.includes(claim))
}

function cleanDecision(raw: unknown, sectionType: SectionType): CalibrationArtifactDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<CalibrationArtifactDecision>
  const decisionType = value.decisionType
  if (!decisionType || !DECISION_TYPES.includes(decisionType)) return null

  const decision: CalibrationArtifactDecision = {
    pattern: cleanText(value.pattern),
    decisionType,
    decision: cleanText(value.decision),
    affectedClaimIds: Array.isArray(value.affectedClaimIds)
      ? value.affectedClaimIds.map(cleanText).filter(Boolean)
      : undefined,
    affectedSection: cleanText(value.affectedSection) || sectionType
  }

  return isConcreteDecision(decision) ? decision : null
}

function deriveUseLevel(decisions: CalibrationArtifactDecision[]): CalibrationInfluenceUseLevel {
  if (decisions.length === 0) return 'none'
  return decisions.some(d => MATERIAL_DECISION_TYPES.has(d.decisionType)) ? 'material' : 'light'
}

function fallbackSummary(level: CalibrationInfluenceUseLevel): string {
  if (level === 'material') {
    return 'Calibration materially influenced artifact inclusion, ordering, exclusion, or gap handling.'
  }
  if (level === 'light') {
    return 'Calibration lightly influenced wording or emphasis.'
  }
  return 'Calibration available but no material influence recorded.'
}

export function normalizeCalibrationInfluence(
  raw: Partial<CalibrationInfluence> | undefined,
  opts: { calibrationAvailable: boolean; sectionType: SectionType }
): CalibrationInfluence {
  const rawDecisions = Array.isArray(raw?.artifactDecisions) ? raw!.artifactDecisions : []
  const decisions = rawDecisions
    .map(d => cleanDecision(d, opts.sectionType))
    .filter((d): d is CalibrationArtifactDecision => d !== null)

  const influencedPatterns = Array.from(new Set([
    ...(Array.isArray(raw?.influencedPatterns) ? raw!.influencedPatterns.map(cleanText) : []),
    ...decisions.map(d => d.pattern)
  ].filter(Boolean)))

  const ignoredPatterns = Array.isArray(raw?.ignoredPatterns)
    ? raw!.ignoredPatterns.map(cleanText).filter(Boolean)
    : undefined

  const useLevel = deriveUseLevel(decisions)
  const calibrationUsed = opts.calibrationAvailable && decisions.length > 0
  const summary = calibrationUsed
    ? cleanText(raw?.influenceSummary) || fallbackSummary(useLevel)
    : opts.calibrationAvailable
      ? 'Calibration available but no material influence recorded.'
      : 'No calibration was available for this generation.'

  return {
    calibrationAvailable: opts.calibrationAvailable,
    calibrationUsed,
    useLevel,
    influenceSummary: summary,
    influencedPatterns,
    artifactDecisions: decisions,
    ignoredPatterns
  }
}

export function containsCalibrationEvidenceReference(value: string | undefined): boolean {
  const text = value?.toLowerCase() ?? ''
  return CALIBRATION_EVIDENCE_TERMS.some(term => text.includes(term))
}

export function sanitizeCalibrationEvidenceRefs<T extends Pick<ResumeBullet, 'evidenceRef'>>(
  bullets: T[]
): T[] {
  return bullets.map(b => containsCalibrationEvidenceReference(b.evidenceRef)
    ? { ...b, evidenceRef: undefined }
    : b
  )
}

export function sanitizeSourceMappings(sourceMappings: string[]): string[] {
  return sourceMappings.filter(mapping => !containsCalibrationEvidenceReference(mapping))
}

export function formatCalibrationInfluenceLine(influence: CalibrationInfluence | undefined): string | null {
  if (!influence?.calibrationAvailable) return null
  const levelLabel = influence.useLevel === 'material'
    ? 'Material'
    : influence.useLevel === 'light'
      ? 'Light'
      : 'None recorded'
  return `Calibration influence: ${levelLabel} - ${influence.influenceSummary}`
}
