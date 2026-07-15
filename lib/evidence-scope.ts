import type {
  WorkEntry, BridgeQuestion, SectionType, UserProfile,
  BridgeQuestionType, ClaimStatus, EmphasisCategory
} from '@/contracts'

// ── Evidence type vocabulary ──────────────────────────────────────────────────

export type EvidenceType =
  | 'work-history-bullet'
  | 'approved-metric'
  | 'skill'
  | 'bridge-answer'
  | 'jd-requirement-coverage'

export type BridgeEvidenceType =
  | 'confirms-skill'
  | 'confirms-metric'
  | 'confirms-domain'
  | 'confirms-tool'
  | 'clarification'
  | 'negative-evidence'
  | 'uncertainty'

/** How cross-role evidence is treated in a section. */
export type CrossRolePolicy =
  | 'none'                       // no cross-role evidence
  | 'explicit-framing-required'  // allowed only when bullet explicitly frames it as prior background
  | 'full'                       // all evidence allowed (summary, skills, communications)

// ── Section evidence scope declaration ───────────────────────────────────────
// One static declaration per SectionType. Controls what evidence may enter
// the LLM prompt and how generated claims are validated after generation.

export interface SectionEvidenceScope {
  sectionType: SectionType
  /** Substrings matched case-insensitively against WorkEntry.title to find primary entries. Empty = all entries. */
  roleTitleKeywords: string[]
  allowedEvidenceTypes: EvidenceType[]
  allowedBridgeQuestionTypes: BridgeQuestionType[]
  /** Claim statuses permitted for display in this section. Unsupported is blocked for skills. */
  allowedClaimStatuses: ClaimStatus[]
  crossRolePolicy: CrossRolePolicy
  /** Human-readable framing requirements for cross-role evidence — injected into system prompt. */
  requiredFramingRules: string[]
  /** Hard-blocked claim patterns — downgraded post-generation regardless of LLM output. */
  disallowedClaimPatterns: string[]
  /** Framing note injected into the system prompt for role-specific sections. */
  framingNote: string | null
}

// ── Static scope declarations ─────────────────────────────────────────────────

export const SECTION_EVIDENCE_SCOPES: Record<SectionType, SectionEvidenceScope> = {
  summary: {
    sectionType: 'summary',
    roleTitleKeywords: [],
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'skill', 'bridge-answer', 'jd-requirement-coverage'],
    allowedBridgeQuestionTypes: ['gap', 'evidence', 'metric', 'domain-translation', 'emphasis', 'underused-experience'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported'],
    crossRolePolicy: 'full',
    requiredFramingRules: [],
    disallowedClaimPatterns: [],
    framingNote: null,
  },
  skills: {
    sectionType: 'skills',
    roleTitleKeywords: [],
    allowedEvidenceTypes: ['skill', 'work-history-bullet', 'bridge-answer'],
    allowedBridgeQuestionTypes: ['evidence', 'metric', 'domain-translation', 'emphasis', 'underused-experience'],
    // 'unsupported' is intentionally absent — skills must be evidenced
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation'],
    crossRolePolicy: 'full',
    requiredFramingRules: [],
    disallowedClaimPatterns: [],
    framingNote: null,
  },
  'experience-primary': {
    sectionType: 'experience-primary',
    roleTitleKeywords: [],  // populated dynamically from the target role title at session start
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'bridge-answer'],
    allowedBridgeQuestionTypes: ['evidence', 'metric', 'emphasis', 'underused-experience'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported'],
    crossRolePolicy: 'explicit-framing-required',
    requiredFramingRules: [
      'Evidence from other roles must be explicitly framed as prior background, earlier experience, or cross-functional context.',
      'Prior-role metrics must not appear as primary-role accomplishments — cite only evidence from the matching work entry.',
    ],
    disallowedClaimPatterns: [],
    framingNote: `Role scope: Work entries under "Prior background" belong to other roles. If referenced, MUST frame as prior experience or earlier-career context — never as primary-role work. Prior-role metrics must not be presented as primary-role accomplishments.`,
  },
  'experience-secondary': {
    sectionType: 'experience-secondary',
    roleTitleKeywords: [],  // populated dynamically
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'bridge-answer'],
    allowedBridgeQuestionTypes: ['gap', 'evidence', 'metric', 'domain-translation', 'underused-experience'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported'],
    crossRolePolicy: 'explicit-framing-required',
    requiredFramingRules: [
      'Primary-role evidence must be framed as later-career progression or cross-functional context.',
      'Do not claim responsibilities that belong to the primary or senior role unless directly evidenced.',
    ],
    disallowedClaimPatterns: [
      'end-to-end roadmap ownership',
      'owned the product roadmap',
      'product roadmap ownership',
    ],
    framingNote: `Role scope: Work entries under "Prior background" belong to other roles. They may only be referenced as earlier-career context — never as the secondary role's own history. Do not claim responsibilities that belong to a more senior role.`,
  },
  'experience-supporting': {
    sectionType: 'experience-supporting',
    roleTitleKeywords: [],  // populated dynamically
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'bridge-answer'],
    allowedBridgeQuestionTypes: ['gap', 'evidence', 'metric', 'domain-translation', 'underused-experience'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported'],
    crossRolePolicy: 'explicit-framing-required',
    requiredFramingRules: [
      'Non-supporting-role evidence must be tied to the supporting competency being demonstrated.',
      'Primary-role responsibilities must not appear as supporting-role accomplishments.',
    ],
    disallowedClaimPatterns: [
      'product roadmap ownership',
      'roadmap ownership',
    ],
    framingNote: `Role scope: Work entries under "Prior background" belong to other roles. Only reference them if directly demonstrating the supporting competency. Primary-role responsibilities are not supporting-role accomplishments.`,
  },
  'cover-letter': {
    sectionType: 'cover-letter',
    roleTitleKeywords: [],
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'skill', 'bridge-answer', 'jd-requirement-coverage'],
    allowedBridgeQuestionTypes: ['gap', 'evidence', 'metric', 'domain-translation', 'emphasis', 'underused-experience'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported'],
    crossRolePolicy: 'full',
    requiredFramingRules: [],
    disallowedClaimPatterns: [],
    framingNote: null,
  },
  'referral-message': {
    sectionType: 'referral-message',
    roleTitleKeywords: [],
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'skill', 'bridge-answer'],
    allowedBridgeQuestionTypes: ['evidence', 'metric', 'emphasis'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation'],
    crossRolePolicy: 'full',
    requiredFramingRules: [],
    disallowedClaimPatterns: [],
    framingNote: null,
  },
  'recruiter-message': {
    sectionType: 'recruiter-message',
    roleTitleKeywords: [],
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'skill', 'bridge-answer'],
    allowedBridgeQuestionTypes: ['evidence', 'metric', 'emphasis'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation'],
    crossRolePolicy: 'full',
    requiredFramingRules: [],
    disallowedClaimPatterns: [],
    framingNote: null,
  },
  'linkedin-dm': {
    sectionType: 'linkedin-dm',
    roleTitleKeywords: [],
    allowedEvidenceTypes: ['work-history-bullet', 'skill', 'bridge-answer'],
    allowedBridgeQuestionTypes: ['evidence', 'emphasis'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation'],
    crossRolePolicy: 'full',
    requiredFramingRules: [],
    disallowedClaimPatterns: [],
    framingNote: null,
  },
  'talking-points': {
    sectionType: 'talking-points',
    roleTitleKeywords: [],
    allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'skill', 'bridge-answer', 'jd-requirement-coverage'],
    allowedBridgeQuestionTypes: ['gap', 'evidence', 'metric', 'domain-translation', 'emphasis', 'underused-experience'],
    allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported'],
    crossRolePolicy: 'full',
    requiredFramingRules: [],
    disallowedClaimPatterns: [],
    framingNote: null,
  },
}

// ── Normalized bridge evidence ────────────────────────────────────────────────

export interface NormalizedBridgeEvidence {
  answerId: string
  questionId: string
  /** The original question text — included in the prompt so the LLM knows what gap the answer closed. */
  originalQuestion: string
  /** Bridge question type (gap / evidence / metric / domain-translation / emphasis / underused-experience). */
  questionType: string
  applicableSections: SectionType[]
  applicableRoles: EmphasisCategory[]
  evidenceType: BridgeEvidenceType
  normalizedEvidenceStatement: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  limitations: string[]
  forbiddenOverclaim: string[]
  exactUserAnswer: string
}

// ── Scoped evidence bundle ────────────────────────────────────────────────────

export interface ScopedEvidenceBundle {
  sectionType: SectionType
  scope: SectionEvidenceScope
  /** Role-matched work entries — full evidence use allowed. */
  primaryWorkEntries: WorkEntry[]
  /** Other-role entries — may only be cited as prior background when policy permits. */
  supportingWorkEntries: WorkEntry[]
  /** Bridge answers with usable confidence (high/medium/low). */
  normalizedBridgeEvidence: NormalizedBridgeEvidence[]
  /** Bridge answers expressing uncertainty — must not generate positive claims. */
  uncertainBridgeEvidence: NormalizedBridgeEvidence[]
  /** Approved metrics from primary work entries only. */
  allowedMetrics: string[]
  /** Domain-gap warnings to show at session level (insurance, coverages, etc.). Not section-specific. */
  globalGapWarnings: string[]
}

// ── Bundle builder ────────────────────────────────────────────────────────────

/**
 * Builds a scoped evidence bundle for a specific artifact section.
 * Role-specific sections (experience-primary, -ba, -qa) split work history into
 * primary vs supporting. Cross-role sections receive full evidence.
 */
export function buildScopedEvidenceBundle(
  profile: UserProfile,
  bridgeQuestions: BridgeQuestion[],
  sectionType: SectionType
): ScopedEvidenceBundle {
  const scope = SECTION_EVIDENCE_SCOPES[sectionType]

  // For experience sections: use position-based work history splitting.
  // Work history entry 0 = primary role, 1 = secondary role, 2+ = supporting.
  // User controls which job goes where by ordering their work history.
  let usePrimary: typeof profile.workHistory
  let useSupporting: typeof profile.workHistory

  if (sectionType === 'experience-primary') {
    usePrimary = profile.workHistory.slice(0, 1)
    useSupporting = profile.workHistory.slice(1)
  } else if (sectionType === 'experience-secondary') {
    usePrimary = profile.workHistory.slice(1, 2)
    useSupporting = [...profile.workHistory.slice(0, 1), ...profile.workHistory.slice(2)]
  } else if (sectionType === 'experience-supporting') {
    usePrimary = profile.workHistory.slice(2)
    useSupporting = profile.workHistory.slice(0, 2)
  } else {
    // Non-experience sections: all work history available
    usePrimary = profile.workHistory
    useSupporting = []
  }

  // Fallback: if position-based split yielded nothing, use all entries
  if (usePrimary.length === 0) {
    usePrimary = profile.workHistory
    useSupporting = []
  }

  // Normalize and scope bridge questions
  const allAnswered = bridgeQuestions.filter(q => q.status === 'answered')
  const scopedAnswered = allAnswered.filter(q => isBridgeQuestionInScope(q, scope, sectionType))
  const normalizedAll = scopedAnswered.map(normalizeBridgeAnswer)

  const normalizedBridgeEvidence = normalizedAll.filter(n => n.confidence !== 'none')
  const uncertainBridgeEvidence = normalizedAll.filter(n => n.confidence === 'none')

  // Allowed metrics: only from primary entries
  const allowedMetrics = usePrimary.flatMap(w => w.approvedMetrics)

  // Merge static disallowed patterns with patterns derived from the active profile.
  // This restores cross-role metric contamination detection without hardcoding personal values.
  const dynamicDisallowed = buildDynamicDisallowedPatterns(profile, sectionType)
  const mergedScope: SectionEvidenceScope = dynamicDisallowed.length > 0
    ? { ...scope, disallowedClaimPatterns: [...scope.disallowedClaimPatterns, ...dynamicDisallowed] }
    : scope

  return {
    sectionType,
    scope: mergedScope,
    primaryWorkEntries: usePrimary,
    supportingWorkEntries: useSupporting,
    normalizedBridgeEvidence,
    uncertainBridgeEvidence,
    allowedMetrics,
    globalGapWarnings: [],  // populated separately from JD map when needed
  }
}

/**
 * Derives disallowed claim patterns for a section from the active user profile.
 *
 * For role-specific sections (experience-primary, -secondary, -supporting) the approved metrics from
 * NON-primary roles must not bleed into that section's bullets. This replaces
 * the previous approach of hardcoding personal metric strings in SECTION_EVIDENCE_SCOPES.
 *
 * Different users with different metric text will automatically get the correct
 * disallowed patterns without any source changes.
 */
export function buildDynamicDisallowedPatterns(profile: UserProfile, sectionType: SectionType): string[] {
  // Only apply cross-role metric contamination detection for role-scoped sections
  if (!sectionType.startsWith('experience-')) return []

  // Determine which work entries are NOT the primary for this section
  // (mirrors the position-based logic in buildScopedEvidenceBundle)
  let nonPrimaryEntries: typeof profile.workHistory
  if (sectionType === 'experience-primary') {
    nonPrimaryEntries = profile.workHistory.slice(1)
  } else if (sectionType === 'experience-secondary') {
    nonPrimaryEntries = [...profile.workHistory.slice(0, 1), ...profile.workHistory.slice(2)]
  } else if (sectionType === 'experience-supporting') {
    nonPrimaryEntries = profile.workHistory.slice(0, 2)
  } else {
    return []
  }

  const patterns: string[] = []
  for (const entry of nonPrimaryEntries) {
    for (const metric of entry.approvedMetrics ?? []) {
      // Normalize: lowercase, strip operators and punctuation, collapse whitespace
      const normalized = metric.toLowerCase().replace(/[~$+%,]/g, '').replace(/\s+/g, ' ').trim()
      if (normalized.length > 4) patterns.push(normalized)
    }
  }
  return patterns
}

function isBridgeQuestionInScope(
  q: BridgeQuestion,
  scope: SectionEvidenceScope,
  sectionType: SectionType
): boolean {
  // Question type must be in the section's allowed types
  if (!scope.allowedBridgeQuestionTypes.includes(q.type)) return false

  const declared = (q.affectedArtifactSection ?? '').toLowerCase()

  // Full-evidence sections accept all bridge questions of allowed types
  if (scope.crossRolePolicy === 'full') return true

  // Role-specific sections: only questions targeting this section or high-priority global context
  if (declared === sectionType) return true
  if (declared === 'summary' && q.priority === 'high') return true
  return false
}

// ── Bridge answer normalization ───────────────────────────────────────────────

/** Normalizes a bridge answer into structured evidence metadata. */
export function normalizeBridgeAnswer(q: BridgeQuestion): NormalizedBridgeEvidence {
  const answer = q.userAnswer ?? ''
  const confidence = classifyBridgeAnswerConfidence(answer)
  const evidenceType = inferBridgeEvidenceType(q, answer, confidence)
  const applicableSections = inferApplicableSections(q)
  const applicableRoles = inferApplicableRoles(q)
  const forbiddenOverclaim = buildForbiddenOverclaim(answer)
  const limitations = buildLimitations(q, answer, evidenceType)
  const normalizedEvidenceStatement = buildNormalizedStatement(q, answer, confidence)

  return {
    answerId: q.id,
    questionId: q.id,
    originalQuestion: q.question,
    questionType: q.type,
    applicableSections,
    applicableRoles,
    evidenceType,
    normalizedEvidenceStatement,
    confidence,
    limitations,
    forbiddenOverclaim,
    exactUserAnswer: answer,
  }
}

function inferBridgeEvidenceType(
  q: BridgeQuestion,
  answer: string,
  confidence: NormalizedBridgeEvidence['confidence']
): BridgeEvidenceType {
  if (confidence === 'none') return 'uncertainty'
  if (q.type === 'metric') return 'confirms-metric'
  if (q.type === 'domain-translation') return 'confirms-domain'
  const lower = answer.toLowerCase()
  if (lower.includes('postman') || lower.includes('swagger') || lower.includes('tool') ||
      lower.includes('jira') || lower.includes('confluence') || lower.includes('aha')) {
    return 'confirms-tool'
  }
  if (q.type === 'gap') return 'confirms-skill'
  if (lower.includes('experience') || lower.includes('worked') || lower.includes('managed') ||
      lower.includes('led') || lower.includes('owned')) {
    return 'confirms-skill'
  }
  return 'clarification'
}

function inferApplicableSections(q: BridgeQuestion): SectionType[] {
  const declared = q.affectedArtifactSection as SectionType
  const base: SectionType[] = declared ? [declared] : []

  // Some question types naturally extend to multiple sections
  switch (q.type) {
    case 'emphasis':
      return [...new Set([...base, 'summary' as SectionType, 'cover-letter' as SectionType, 'talking-points' as SectionType])]
    case 'metric':
      return [...new Set([...base, 'summary' as SectionType])]
    case 'domain-translation':
      return [...new Set([...base, 'summary' as SectionType, 'skills' as SectionType])]
    default:
      return base.length > 0 ? base : ['summary' as SectionType]
  }
}

function inferApplicableRoles(q: BridgeQuestion): EmphasisCategory[] {
  const section = q.affectedArtifactSection
  // Return a single-item array matching the section, or empty meaning "all sections"
  if (section && section.startsWith('experience-')) return [section]
  return []
}

function buildForbiddenOverclaim(answer: string): string[] {
  const lower = answer.toLowerCase()
  const forbidden: string[] = []
  if (lower.includes('postman')) {
    forbidden.push('API specification authorship or design')
    forbidden.push('API architecture ownership')
  }
  if (lower.includes('docusign')) {
    forbidden.push('DocuSign platform administration or configuration')
  }
  if (lower.includes('i-9') || lower.includes('identity verification')) {
    forbidden.push('Comprehensive identity management system ownership')
  }
  return forbidden
}

function buildLimitations(
  q: BridgeQuestion,
  answer: string,
  evidenceType: BridgeEvidenceType
): string[] {
  const limitations: string[] = []
  if (evidenceType === 'confirms-tool') {
    limitations.push('Confirms tool exposure/usage only — not authorship, design, or ownership')
  }
  if (evidenceType === 'uncertainty') {
    limitations.push('User expressed uncertainty — this answer does not confirm any skill or experience')
  }
  const lower = answer.toLowerCase()
  if (lower.includes('once') || lower.includes('briefly') || lower.includes('a few times')) {
    limitations.push('Limited exposure — not sustained practice')
  }
  return limitations
}

function buildNormalizedStatement(
  q: BridgeQuestion,
  answer: string,
  confidence: NormalizedBridgeEvidence['confidence']
): string {
  if (confidence === 'none') {
    return `[Uncertainty] User could not confirm: "${q.question.slice(0, 100)}"`
  }
  // Trim to 200 chars as a clean summary
  return answer.length > 200 ? answer.slice(0, 200) + '…' : answer
}

// ── Confidence classifier ─────────────────────────────────────────────────────

/**
 * Returns 'none' when a bridge answer expresses uncertainty.
 * 'none' confidence must not generate positive claims.
 */
export function classifyBridgeAnswerConfidence(
  answer: string
): 'high' | 'medium' | 'low' | 'none' {
  const lower = (answer ?? '').toLowerCase().trim()
  if (!lower) return 'none'
  const uncertaintyPhrases = [
    "i'm not sure", "im not sure", "not sure", "i don't know", "i do not know",
    "unsure", "unclear", "maybe", "probably not", "i think not",
    "haven't done", "have not done", "no experience", "don't have experience",
    "not familiar", "not really", "not applicable", "n/a",
  ]
  if (uncertaintyPhrases.some(p => lower.includes(p))) return 'none'
  if (lower.length < 10) return 'low'
  return lower.length >= 80 ? 'high' : 'medium'
}

// ── Global warning classifier ─────────────────────────────────────────────────

/**
 * Returns true for domain-gap warnings that represent session-level gaps
 * (insurance, coverages, etc.) — shown once globally, not per-section.
 */
export function isGlobalEvidenceWarning(warning: string): boolean {
  const lower = warning.toLowerCase()
  const globalPatterns = [
    'insurance', 'lines of business', 'claims', 'coverages',
    'p&c', 'property and casualty', 'programs/lines',
  ]
  return globalPatterns.some(p => lower.includes(p))
}

// ── Disallowed claim pattern checker ─────────────────────────────────────────

/**
 * Checks whether a bullet text contains a disallowed claim pattern for its section.
 * Returns the matched pattern or null if clean.
 */
export function findDisallowedClaimPattern(
  bulletText: string,
  disallowedPatterns: string[]
): string | null {
  const lower = bulletText.toLowerCase()
  for (const pattern of disallowedPatterns) {
    if (lower.includes(pattern.toLowerCase())) return pattern
  }
  return null
}

// ── Backward-compat alias ─────────────────────────────────────────────────────
// Kept so existing callers don't break; prefer buildScopedEvidenceBundle for new code.
export { buildScopedEvidenceBundle as buildSectionEvidenceScope }
