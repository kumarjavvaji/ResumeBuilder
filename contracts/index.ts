// ─────────────────────────────────────────────
// Stage 1 — Target Intake
// ─────────────────────────────────────────────

/**
 * Fine-grained state for Stage 1 session initialization.
 * Prevents analysis from running on invalid or missing JD content.
 */
export type Stage1Status =
  | 'draft'                  // session started, no valid JD yet
  | 'jd_fetch_failed'        // URL was fetched but returned invalid content (login wall, nav dump, etc.)
  | 'jd_needs_paste'         // user is manually entering JD after a failed fetch
  | 'ready_to_analyze'       // valid JD text present, analysis not yet run
  | 'analyzed_needs_review'  // analysis complete, user reviewing before save
  | 'complete'               // saved with valid JD analysis

/** Where each piece of analysis content originated. */
export type JDSourceType =
  | 'fetched_jd'       // extracted from a URL fetch
  | 'pasted_jd'        // manually pasted by the user
  | 'structured_fields'// assembled from per-field form inputs
  | 'domainiq'         // from DomainIQ / company research notes
  | 'company_notes'    // from company notes
  | 'inference'        // inferred from company name alone — not JD evidence

export interface RawJD {
  fullText: string
  summary: string
  responsibilities: string[]
  requiredSkills: string[]
  niceToHaves: string[]
  domainSignals: string[]
}

export interface JDRequirement {
  text: string
  category: 'technical' | 'domain' | 'soft' | 'tool' | 'process'
  userCoverageStatus: 'covered' | 'partial' | 'gap' | 'unknown'
  /** Where this requirement came from. */
  sourceType?: JDSourceType
  /** Brief quote from the source text that supports this requirement. */
  sourceExcerpt?: string
  /** Which part of the user profile covers or doesn't cover this requirement. */
  profileEvidence?: string
}

export interface JDRequirementMap {
  required: JDRequirement[]
  niceToHave: JDRequirement[]
  realJobFunction: string
  /**
   * Requirements not found in the user profile — bridge-question targets,
   * not hard disqualifiers. Renamed from unsupportedRequirements.
   */
  needsEvidenceItems: string[]
  /** @deprecated Use needsEvidenceItems. Kept for existing sessions in storage. */
  unsupportedRequirements: string[]
  weaklySupportedRequirements: string[]
}

export interface DomainIQImport {
  rawText: string
  companyProfile: string
  industrySignals: string[]
  techStack: string[]
  cultureSignals: string[]
}

export type EmphasisCategory = 'PO' | 'BA' | 'QA' | 'AI' | 'data' | 'operations' | 'blended'

export type StageKey = 'intake' | 'bridge' | 'artifacts' | 'export' | 'signals'
export type StageStatus = 'pending' | 'active' | 'complete'

export interface SessionStageStatuses {
  intake: StageStatus
  bridge: StageStatus
  artifacts: StageStatus
  export: StageStatus
  signals: StageStatus
}

export interface TargetIntake {
  id: string
  createdAt: string
  updatedAt: string
  roleTitle: string
  company: string
  /** URL the JD was fetched from, if applicable. */
  postingUrl?: string
  /** How the JD content was provided. */
  jdSourceType?: JDSourceType
  /** Fine-grained Stage 1 initialization state. */
  stage1Status?: Stage1Status
  domainIQInsights: DomainIQImport
  jobDescription: RawJD
  jdRequirementMap: JDRequirementMap
  companySummary: string
  fitHypothesis: string
  riskGaps: string[]
  emphasisRecommendation: EmphasisCategory
  // Legacy single-stage flag kept for existing sessions
  status: 'intake' | 'bridge' | 'artifact' | 'export'
  // Per-stage status for sidebar nav
  stageStatuses: SessionStageStatuses
}

/** Returns true only when Stage 1 has a valid, analyzed JD. */
export function canCompleteStage1(stage1Status: Stage1Status | undefined): boolean {
  return stage1Status === 'analyzed_needs_review' || stage1Status === 'complete'
}

// ─────────────────────────────────────────────
// Stage 2A — Outreach Targets
// ─────────────────────────────────────────────

export interface OutreachTarget {
  id: string
  sessionId: string
  name: string
  title: string
  company: string
  connectionDegree: '1st' | '2nd' | '3rd' | 'unknown'
  relevance: string
  referralAngle: string
  suggestedMessage: string
  source: 'manual' | 'user-pasted-profile' | 'user-confirmed'
  notes: string
  createdAt: string
}

// ─────────────────────────────────────────────
// Stage 2B — Market Calibration
// ─────────────────────────────────────────────

export interface CredibilityBoundary {
  skill: string
  status: 'can-claim' | 'can-claim-with-reframing' | 'cannot-claim' | 'needs-user-evidence'
  rationale: string
}

export interface MarketProfile {
  id: string
  sessionId: string
  source: 'manual' | 'user-pasted'
  rawText: string
  backgroundPattern: string
  repeatedSkills: string[]
  typicalTitlePath: string[]
  domainPatterns: string[]
  keywordOpportunities: string[]
  credibilityBoundaries: CredibilityBoundary[]
  createdAt: string
}

// ─────────────────────────────────────────────
// Stage 2C — Bridge Questions
// ─────────────────────────────────────────────

export type BridgeQuestionType =
  | 'gap'
  | 'evidence'
  | 'metric'
  | 'domain-translation'
  | 'emphasis'
  | 'underused-experience'

export interface BridgeQuestion {
  id: string
  sessionId: string
  question: string
  type: BridgeQuestionType
  priority: 'high' | 'medium' | 'low'
  affectedArtifactSection: string
  status: 'pending' | 'answered' | 'skipped'
  userAnswer?: string
  createdAt: string
}

// ─────────────────────────────────────────────
// Stage 3A — Calibration References
// ─────────────────────────────────────────────

export type CalibrationSourceType =
  | 'search_result'
  | 'public_profile'
  | 'company_page'
  | 'professional_bio'
  | 'user_added_url'
  | 'user_pasted_text'

export type CalibrationMatchType = 'target_company' | 'competitor' | 'adjacent_employer'

export interface CalibrationReference {
  id: string
  sessionId: string
  sourceType: CalibrationSourceType
  personName?: string
  title: string
  company: string
  profileUrl?: string
  sourceUrl?: string
  snippetOrSummary: string
  matchReason: string
  matchType: CalibrationMatchType
  relevanceScore: number  // 0–1
  confidence: 'high' | 'medium' | 'low'
  limitations?: string
  collectedAt: string
}

export interface CalibrationSummary {
  targetCompanyPatterns: string[]
  competitorPatterns: string[]
  repeatedTitles: string[]
  repeatedSkillsTools: string[]
  domainExpectations: string[]
  credibilityBoundaries: string[]
  artifactGuidance: string[]
  outreachGuidance: string[]
  gapsToHandleCarefully: string[]
  calibrationUsed: boolean
  calibrationPatterns: string[]
  generatedAt: string
}

export interface CalibrationDiagnostic {
  query: string
  outcome: 'success' | 'skipped' | 'failed' | 'limited'
  message: string
}

// ─── Persisted synthesis output (before apply) ────────────────────────────────
export interface CalibrationSynthesisRecord {
  id: string
  sessionId: string
  summary: CalibrationSummary
  targetRefCount: number
  comparableRefCount: number
  generatedAt: string
}

// ─── Persisted applied calibration state (post-apply) ────────────────────────
export type CalibrationApplyStatus =
  | 'not_started'
  | 'collecting'
  | 'ready_partial'
  | 'ready_full'
  | 'applied_partial'
  | 'applied_full'
  | 'skipped'
  | 'stale_after_refresh'

export interface AppliedCalibrationState {
  id: string
  sessionId: string
  summary: CalibrationSummary
  applyStatus: CalibrationApplyStatus
  isPartial: boolean
  targetReferenceCount: number
  comparableReferenceCount: number
  appliedCalibrationPatterns: string[]
  referencedCalibrationIds: string[]
  appliedAt: string
  /** True after a Refresh run produces new refs that supersede this applied state. */
  calibrationUpdatedAfterApply: boolean
}

// ─── Artifact generation provenance ──────────────────────────────────────────
export type CalibrationStatusAtGeneration =
  | 'none'
  | 'skipped'
  | 'applied_partial'
  | 'applied_full'

export interface ArtifactGenerationProvenance {
  generatedAt: string
  operation: 'generate' | 'refine' | 'regenerate'
  calibrationUsed: boolean
  calibrationAppliedAt?: string
  calibrationStateId?: string
  calibrationStatusAtGeneration: CalibrationStatusAtGeneration
  targetReferenceCount?: number
  comparableReferenceCount?: number
  /** Short normalized thematic labels used for compact provenance display. Never raw matchReason text. */
  appliedCalibrationPatterns?: string[]
  /** IDs of CalibrationReference records that were applied — for audit only, not for display. */
  referencedCalibrationIds?: string[]
}

export type CandidateStatus =
  | 'queued'
  | 'enriching'
  | 'enriched'
  | 'skipped'
  | 'failed'
  | 'duplicate'
  | 'low_relevance'

export interface CalibrationCandidate {
  id: string
  sessionId: string
  status: CandidateStatus
  // From discovery
  candidateMatchType: CalibrationMatchType
  title: string
  company: string
  sourceUrl?: string
  discoverySnippet: string
  roughMatchReason: string
  initialConfidence: 'high' | 'medium' | 'low'
  // From enrichment (set when status = 'enriched')
  enrichedRef?: CalibrationReference
  // Pipeline diagnostics
  failureReason?: string
  limitationsNote?: string
  retryCount: number
  discoveredAt: string
  enrichedAt?: string
}

// ─────────────────────────────────────────────
// Stage 3B — Artifact Review
// ─────────────────────────────────────────────

export type ClaimStatus =
  | 'supported'
  | 'supported-with-reframing'
  | 'needs-user-confirmation'
  | 'unsupported'

export type SourceSignal = 'user-history' | 'jd-alignment' | 'approved-learning-signal'

/**
 * Controls which UI area a bullet appears in after post-generation validation.
 *
 * - 'display'            → primary section content; the only bullets that are exported or accepted.
 * - 'needs-confirmation' → user must review before the claim becomes display content.
 * - 'excluded'           → blocked from this section (wrong role, unsupported, or disallowed pattern).
 * - 'suggested-other'    → claim belongs in a different section; see suggestedSection.
 *
 * Old bullets without this field default to 'display' for backward compatibility.
 */
export type BulletPartition =
  | 'display'
  | 'needs-confirmation'
  | 'excluded'
  | 'suggested-other'

export interface ResumeBullet {
  id: string
  text: string
  claimStatus: ClaimStatus
  sourceSignal: SourceSignal
  evidenceRef?: string
  approved: boolean | null
  /** Controls which UI area renders this bullet. Defaults to 'display' for older records. */
  partition?: BulletPartition
  /** Set when partition='suggested-other'. Identifies the correct target section. */
  suggestedSection?: SectionType
  /** Human-readable reason for the partition assignment (scope mismatch, pattern block, etc.). */
  partitionReason?: string
}

export type SectionType =
  | 'summary'
  | 'skills'
  | 'experience-po'
  | 'experience-ba'
  | 'experience-qa'
  | 'cover-letter'
  | 'referral-message'
  | 'recruiter-message'
  | 'linkedin-dm'
  | 'talking-points'

/**
 * Preserved diagnostic for a claim blocked during post-generation validation.
 * Stored with the section so the user can inspect why a bullet was downgraded.
 */
export interface BlockedClaimDiagnostic {
  /** Section where generation was attempted. */
  attemptedSection: SectionType
  /** The full text of the blocked/downgraded bullet. */
  blockedClaimText: string
  /** Work entry title + company identified as the source, if resolved. */
  detectedSourceEntry: string | null
  /** Role category of the detected source entry, if resolved. */
  detectedSourceRole: string | null
  /** Human-readable reason why the claim was blocked or downgraded. */
  reason: string
  /** Section where this claim would be correctly sourced, if determinable. */
  suggestedSection: SectionType | null
  /** What happened to the claim. */
  disposition: 'excluded' | 'downgraded' | 'requires-framing'
}

export interface ArtifactSection {
  id: string
  sessionId: string
  type: SectionType
  content: string
  bullets: ResumeBullet[]
  /**
   * Generation lifecycle status.
   * 'draft' kept for backwards-compat with existing sessions — treated as 'generated'.
   */
  status:
    | 'draft'             // legacy alias for 'generated'
    | 'generated'         // LLM output available, awaiting review
    | 'needs_review'      // same as generated, surfaced after refine
    | 'accepted'          // user accepted — do not overwrite without explicit instruction
    | 'rejected'          // user rejected — do not export
    | 'needs-refinement'  // legacy alias for 'refinement_requested'
    | 'refinement_requested'
    | 'error'
  generationRationale: string
  /** User note attached to this version (manual edit note or refinement instruction). */
  userNote?: string
  /** Warnings about weak or unsupported evidence for specific claims. */
  evidenceWarnings?: string[]
  /** Human-readable source mappings: "claim → source work entry". */
  sourceMappings?: string[]
  signalInfluence?: string
  jdTraceability: string[]
  /** Diagnostics for claims that were blocked or downgraded during post-generation validation. */
  blockedClaimDiagnostics?: BlockedClaimDiagnostic[]
  /** Provenance of this generation — calibration state used, operation, timestamps. */
  generationProvenance?: ArtifactGenerationProvenance
  version: number
  createdAt: string
  updatedAt: string
  /** Set when the user explicitly accepts. */
  acceptedAt?: string
}

export interface ResumeArtifact {
  id: string
  sessionId: string
  version: number
  lastModified: string
  sectionIds: string[]
  withinTwoPageConstraint: boolean
  estimatedWordCount: number
}

// ─────────────────────────────────────────────
// Stage 4 — Export
// ─────────────────────────────────────────────

export interface AdjacentJob {
  title: string
  company: string
  fitRationale: string
  retargetingEffort: 'low' | 'medium' | 'high'
  referralAccess: boolean
  sourceSignals: string[]
}

export interface ExportPackage {
  id: string
  sessionId: string
  artifactId: string
  exportedAt: string
  submissionChecklist: string[]
  additionalJobs: AdjacentJob[]
}

// ─────────────────────────────────────────────
// Stage 5 — Learning Signals
// ─────────────────────────────────────────────

export type SignalScope = 'personal' | 'global' | 'both'

export type ProductArea =
  | 'jd-parsing'
  | 'bridge-questions'
  | 'claim-validation'
  | 'artifact-strategy'
  | 'cover-letter'
  | 'outreach'
  | 'formatting'

export type LearningSignalType =
  | 'accepted-bullet'
  | 'rejected-bullet'
  | 'approved-metric'
  | 'rejected-phrase'
  | 'role-preference'
  | 'jd-pattern'
  | 'style-constraint'
  | 'artifact-strategy'
  | 'bridge-question-pattern'
  | 'evidence-classification'
  | 'domain-translation'
  | 'generation-drift'

export interface LearningSignal {
  id: string
  scope: SignalScope
  type: LearningSignalType
  content: string
  context: string
  globalContent?: string
  productArea?: ProductArea
  roleCategory?: EmphasisCategory
  companyDomain?: string
  sectionType?: SectionType
  bridgeQuestionId?: string
  promotedToGlobal?: boolean
  createdAt: string
}

// ─────────────────────────────────────────────
// User Profile — Skills
// ─────────────────────────────────────────────

// Single-word ATS-aligned skill group heading.
// Default headings: Analysis | Product | Delivery | Data | Testing | Security | Tools
export interface SkillGroup {
  id: string
  heading: string
  skills: string[]
}

export const DEFAULT_SKILL_HEADINGS = [
  'Analysis', 'Product', 'Delivery', 'Data', 'Testing', 'Security', 'Tools'
] as const

// ─────────────────────────────────────────────
// User Profile
// ─────────────────────────────────────────────

export interface WorkEntry {
  id: string
  company: string
  title: string
  startDate: string
  endDate: string | 'present'
  bullets: string[]
  approvedMetrics: string[]
  domain: string
  skills: string[]
}

export interface UserProfile {
  id: string
  fullName: string
  email: string
  phone: string
  location: string
  linkedIn: string
  summary: string
  workHistory: WorkEntry[]
  education: EducationEntry[]
  // Grouped skills — primary source of truth. Flat skills[] is derived from this.
  skillGroups: SkillGroup[]
  // Flat derived list — kept for backward compat and LLM injection.
  // Auto-populated from skillGroups on every save.
  skills: string[]
  certifications: string[]
  constraints: string[]
  rejectedPhrases: string[]
  updatedAt: string
}

export interface EducationEntry {
  id: string
  institution: string
  degree: string
  field: string
  graduationYear: string
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

// Derive stage statuses from the legacy status field.
// Used for migration and for sessions created before stageStatuses existed.
export function deriveStageStatuses(status: TargetIntake['status']): SessionStageStatuses {
  const map: Record<TargetIntake['status'], SessionStageStatuses> = {
    intake: { intake: 'active', bridge: 'pending', artifacts: 'pending', export: 'pending', signals: 'pending' },
    bridge: { intake: 'complete', bridge: 'active', artifacts: 'pending', export: 'pending', signals: 'pending' },
    artifact: { intake: 'complete', bridge: 'complete', artifacts: 'active', export: 'pending', signals: 'pending' },
    export: { intake: 'complete', bridge: 'complete', artifacts: 'complete', export: 'active', signals: 'pending' }
  }
  return map[status]
}

// Flatten all skillGroups into a single deduplicated array.
export function flattenSkillGroups(groups: SkillGroup[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const g of groups) {
    for (const s of g.skills) {
      const key = s.toLowerCase().trim()
      if (key && !seen.has(key)) { seen.add(key); result.push(s.trim()) }
    }
  }
  return result
}
