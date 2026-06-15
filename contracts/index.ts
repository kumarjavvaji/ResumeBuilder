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

/**
 * 7-type gap taxonomy for Stage 1 requirement coverage.
 * true_gap / profile_missing / parser_missing are meaningfully different action signals.
 */
export type GapClassification =
  | 'true_gap'           // user genuinely lacks this; no adjacent evidence
  | 'profile_missing'    // user may have it but profile text doesn't mention it — bridge target
  | 'parser_missing'     // requirement may be over-detected from weak JD signal
  | 'mapping_gap'        // user has it under a different name or framing
  | 'wording_gap'        // user has the substance but needs JD vocabulary
  | 'needs_confirmation' // bridge question can clarify coverage
  | 'not_required'       // nice-to-have — deprioritize in bridge questions

export interface JDRequirement {
  text: string
  category: 'technical' | 'domain' | 'soft' | 'tool' | 'process'
  userCoverageStatus: 'covered' | 'partial' | 'gap' | 'unknown'
  /** Fine-grained gap classification. Populated for required requirements with gap/partial coverage. */
  gapClassification?: GapClassification
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
  /** Structured fit analysis — persisted after Stage 1 analysis so bridge + generation can consume it. */
  fitAnalysis?: FitAnalysis
  /** Session-wide refinement direction — applied as background strategy to all Stage 3B refine calls. */
  overallRefinementPrompt?: string
  // Legacy single-stage flag kept for existing sessions
  status: 'intake' | 'bridge' | 'artifact' | 'export'
  // Per-stage status for sidebar nav
  stageStatuses: SessionStageStatuses
}

/** Per-requirement fit record — preserves coverage status + gap type in one place. */
export interface FitRequirement {
  requirementId: string
  requirementText: string
  category: JDRequirement['category']
  coverageStatus: JDRequirement['userCoverageStatus']
  gapClassification?: GapClassification
  supportingEvidence: string[]
}

/**
 * Structured fit analysis derived at Stage 1 from the parsed JD + synthesis.
 * Persisted on the session so downstream stages (bridge, generation) can consume
 * the full structured basis without re-running the LLM.
 */
export interface FitAnalysis {
  fitHypothesis: string
  realJobFunction: string
  /** 1-2 sentences on who evaluates this role and what they care about most. */
  evaluatorLens: string
  riskNotes: string[]
  requirements: FitRequirement[]
  gapSummary: {
    trueGaps: string[]
    missingFromProfile: string[]
    needsConfirmation: string[]
    wordingOrMapping: string[]
  }
  /** Requirement texts that should become bridge question targets. */
  recommendedBridgeTargets: string[]
  generatedAt: string
}

/** Per-session audit of how completely Stage 1→5 data is populated. */
export interface SessionPersistenceAudit {
  sessionId: string
  checkedAt: string
  profileEvidenceBulletsCount: number
  profileSkillsCount: number
  jdRequiredCount: number
  jdNiceToHaveCount: number
  fitRequirementsCount: number
  fitAnalysisAvailable: boolean
  gapsCount: number
  gapBreakdown: Partial<Record<GapClassification, number>>
  bridgeQuestionsCount: number
  bridgeAnsweredCount: number
  artifactSectionsGeneratedCount: number
  artifactSectionsAcceptedCount: number
  stage5SignalCount: number
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

export type CalibrationInfluenceUseLevel = 'none' | 'light' | 'material'

export interface CalibrationArtifactDecision {
  pattern: string
  decisionType: 'wording' | 'emphasis' | 'inclusion' | 'exclusion' | 'ordering' | 'gap_handling'
  decision: string
  affectedClaimIds?: string[]
  affectedSection?: string
}

export interface CalibrationInfluence {
  calibrationAvailable: boolean
  calibrationUsed: boolean
  useLevel: CalibrationInfluenceUseLevel
  influenceSummary: string
  influencedPatterns: string[]
  artifactDecisions: CalibrationArtifactDecision[]
  ignoredPatterns?: string[]
}

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

/** Learning signal emitted by the LLM during a refinement operation. */
export interface RefinementLearningSignal {
  type: 'jd_alignment_strategy' | 'evidence_boundary' | 'artifact_strategy' | 'calibration_pattern' | 'reusable_prompt_heuristic'
  scope: 'user_specific' | 'global_product'
  signal: string
  appliesTo: SectionType[]
}

export interface RefinementEvidenceBoundary {
  preservedClaims: string[]
  removedOrSoftenedClaims: string[]
  /** User instructions the LLM declined to apply because they lacked evidence support. */
  unsupportedRequests: string[]
}

/** Immutable record of one revision. Appended to versions[] on every LLM refinement. */
export interface ArtifactVersion {
  versionId: string
  versionNumber: number
  createdAt: string
  source: 'initial_generation' | 'llm_refinement' | 'manual_edit'
  userInstruction?: string
  previousText: string
  revisedText: string
  changeSummary: string[]
  evidenceBoundary: RefinementEvidenceBoundary
  confidence: 'high' | 'medium' | 'low'
  learningSignals: RefinementLearningSignal[]
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
  /** Structured audit of how market calibration shaped this section. Not evidence. */
  calibrationInfluence?: CalibrationInfluence
  /** Provenance of this generation — calibration state used, operation, timestamps. */
  generationProvenance?: ArtifactGenerationProvenance
  version: number
  createdAt: string
  updatedAt: string
  /** Set when the user explicitly accepts. */
  acceptedAt?: string
  /**
   * Immutable history of every LLM refinement applied to this section.
   * Appended on each refine; old artifacts without this field are treated as version 1.
   */
  versions?: ArtifactVersion[]
  /** Change summary from the most recent LLM refinement. Cleared on accept/reject. */
  refinementChangeSummary?: string[]
  /** Evidence boundary from the most recent LLM refinement. */
  refinementEvidenceBoundary?: RefinementEvidenceBoundary
  /** Confidence rating from the most recent LLM refinement. */
  refinementConfidence?: 'high' | 'medium' | 'low'
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

export type Stage4RawResumeStatus =
  | 'not_generated'
  | 'generated'
  | 'needs_review'
  | 'accepted'
  | 'stale'

/** A single section's Stage 4 refinement state — instruction, LLM output, acceptance. */
export interface Stage4SectionRefinement {
  instruction: string
  /** The LLM-revised section text. Not yet in use until accepted. */
  output: string
  accepted: boolean
  generatedAt: string
}

export type Stage4StructureSource = 'uploaded_resume' | 'manual_profile' | 'default'

export interface Stage4SourceArtifactSnapshot {
  id: string
  type: SectionType
  version: number
  updatedAt: string
}

export interface Stage4ExperienceBlock {
  roleId: string
  title: string
  company: string
  dates: string
  location?: string
  headingText: string
  bullets: string[]
  sourceArtifactSectionId: string
}

export interface Stage4RawResumeSections {
  summary: string
  skills: string
  experiences: Stage4ExperienceBlock[]
  education: string
  fullText: string
}

export interface Stage4RawResumeText {
  id: string
  sessionId: string
  status: Stage4RawResumeStatus
  sourceArtifactSectionIds: string[]
  sourceArtifactSnapshots: Stage4SourceArtifactSnapshot[]
  generatedAt: string
  updatedAt: string
  structureSource: Stage4StructureSource
  sections: Stage4RawResumeSections
  warnings: string[]
  staleReasons: string[]
  /** Full-resume LLM refinement — single instruction applied to the entire resume. */
  refinementInstruction?: string
  /** LLM output for the full-resume refinement (pending or accepted). */
  refinementOutput?: string
  /** True after the user accepts the full-resume refinement. */
  refinementAccepted?: boolean
  /** When the full-resume refinement was produced. */
  refinementRefinedAt?: string
  /**
   * Per-section LLM refinements. Keys are section identifiers:
   * 'summary' | 'skills' | 'experience-po' | 'experience-ba' | 'experience-qa' | 'education'
   */
  sectionRefinements?: Record<string, Stage4SectionRefinement>
  /** Deterministic generation contract derived from session + profile at assembly time. */
  contract?: ResumeGenerationContract
  /** Pre-generation readiness contract produced by Stage 3 validation gate. */
  readinessContract?: ResumeReadinessContract
}

// ─────────────────────────────────────────────
// Resume Generation Contract — deterministic assembly rules
// ─────────────────────────────────────────────

export type Stage4RoleFamily =
  | 'product_owner'
  | 'associate_pm'
  | 'product_analyst'
  | 'business_analyst'
  | 'qa'
  | 'other'

export interface Stage4SectionPlan {
  summary: { maxLines: number }
  skills: { maxRows: number }
  productOwner: { minBullets: number; maxBullets: number }
  productAnalyst: { minBullets: number; maxBullets: number }
  qa: { minBullets: number; maxBullets: number }
  education: { maxLines: number }
}

export interface Stage4SessionDirection {
  representPOFrom2021: boolean
  avoidFormalTitleHedging: boolean
  targetPosture: string
  roadmapBoundary: string
  azureDevOpsAllowed: boolean
  travelResumeAllowed: boolean
  salesforcePreferredPhrase: string
}

export interface ResumeGenerationContract {
  targetRoleFamily: Stage4RoleFamily
  targetPosture: string
  sectionPlan: Stage4SectionPlan
  sessionDirection: Stage4SessionDirection
  bannedPhrases: string[]
  preferredReplacements: Record<string, string>
  evidenceRouting: Record<string, string[]>
  requiredBulletThemes: string[]
}

export interface ContractViolation {
  rule: string
  section: string
  detail: string
  canAutoRepair: boolean
  /** 'error' = blocks export / must repair; 'warning' = advisory, user can dismiss */
  severity: 'error' | 'warning'
}

export interface ContractValidationResult {
  pass: boolean
  violations: ContractViolation[]
  suggestedRepairs: string[]
}

// ─────────────────────────────────────────────
// Evidence Atoms (Stage 1 classifier output)
// ─────────────────────────────────────────────

export type EvidenceAtomType =
  | 'title' | 'role' | 'responsibility' | 'metric' | 'tool'
  | 'certification' | 'education' | 'domain' | 'method' | 'outcome'

export type EvidenceAllowedUse =
  | 'summary' | 'skills' | 'po_bullet' | 'pa_bullet' | 'qa_bullet'
  | 'education' | 'cover_letter' | 'screening_only' | 'exclude'

export type EvidenceAtomWarning =
  | 'unsupported' | 'vague' | 'stale' | 'duplicate' | 'conflicting'
  | 'too_volume_led' | 'not_resume_worthy'

export type MetricClass = 'impact' | 'volume' | 'process' | 'unclassified'

export interface EvidenceAtom {
  id: string
  text: string
  atomType: EvidenceAtomType
  sourceSection: 'work_history' | 'education' | 'certification' | 'skill' | 'bridge_answer'
  sourceEntryId?: string
  confidence: 'high' | 'medium' | 'low'
  allowedUses: EvidenceAllowedUse[]
  isImpactEvidence: boolean
  isVolumeEvidence: boolean
  metricClass?: MetricClass
  isCandidateSpecificFact: boolean
  warnings: EvidenceAtomWarning[]
}

// ─────────────────────────────────────────────
// Resolved Bridge Decisions (Stage 2)
// ─────────────────────────────────────────────

export type BridgeDispositionType =
  | 'use_directly'
  | 'use_after_rewrite'
  | 'use_as_constraint'
  | 'screening_only'
  | 'needs_clarification'
  | 'do_not_use'

export interface ResolvedBridgeDecision {
  questionId: string
  questionText: string
  userAnswer: string
  dispositionType: BridgeDispositionType
  normalizedStatement: string
  clearsWarnings: string[]
  constraint?: string
  screeningNote?: string
  routeToResume: boolean
}

// ─────────────────────────────────────────────
// Resume Readiness Contract (Stage 3 gate)
// ─────────────────────────────────────────────

export interface MetricPolicy {
  preferImpactOverVolume: boolean
  volumeMetricsRequireImpactTie: boolean
}

export interface SummaryPolicy {
  noProofLevelDuplication: boolean
  noTeamSizeIfInExperience: boolean
  noCadenceIfInExperience: boolean
  noMetricsIfInExperience: boolean
  noToolDetailsIfInExperience: boolean
}

export interface ResumeReadinessSectionPlan {
  summary: { purpose: 'positioning'; maxSentences: number; maxApproxLines: number }
  skills: { purpose: 'ats_support'; maxRows: number }
  primaryExperience: { minBullets: number; maxBullets: number }
  secondaryExperience: { minBullets: number; maxBullets: number }
  earlierExperience: { maxBullets: number }
  education: { maxLines: number }
}

export interface ResumeReadinessContract {
  targetRoleFamily: string
  targetPosture: string
  sectionPlan: ResumeReadinessSectionPlan
  evidenceRouting: Record<string, string[]>
  resolvedDecisions: Record<string, unknown>
  bannedPhrases: string[]
  preferredReplacements: Record<string, string>
  allowedTools: string[]
  disallowedTools: string[]
  requiredExperienceThemes: string[]
  metricPolicy: MetricPolicy
  summaryPolicy: SummaryPolicy
}

export interface ReadinessCheckResult {
  ready: boolean
  warnings: string[]
  blockers: string[]
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

// ─────────────────────────────────────────────
// Artifact History — accepted/rejected resume content (NOT learning signals)
// ─────────────────────────────────────────────

export type ArtifactHistoryKind =
  | 'accepted-bullet'   // bullet text that appeared on the final resume
  | 'rejected-bullet'   // bullet the user removed from the section
  | 'approved-metric'   // quantified fact confirmed by the user

export interface ArtifactHistoryRecord {
  id: string
  sessionId: string
  kind: ArtifactHistoryKind
  content: string
  sectionType: string
  roleCategory?: string
  context: string
  createdAt: string
}

// Learning signal types: ONLY reusable generation intelligence.
// Raw resume content (bullets, metrics) belongs in ArtifactHistoryRecord.
export type LearningSignalType =
  | 'rejected-phrase'
  | 'role-preference'
  | 'jd-pattern'
  | 'style-constraint'
  | 'artifact-strategy'
  | 'bridge-question-pattern'
  | 'evidence-classification'
  | 'domain-translation'
  | 'generation-drift'
  | 'jd_alignment_strategy'
  | 'bridge_question_effectiveness'
  | 'calibration_pattern'
  | 'evidence_boundary'
  | 'role_scope_rule'
  | 'naturalization_rule'
  | 'export_assembly_rule'
  | 'rejected_overclaim'
  | 'reusable_prompt_heuristic'
  | 'global_product_improvement'
  | 'personal_positioning_rule'
  | 'artifact_strategy'

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
// Profile Snapshot — layered profile compiler
// ─────────────────────────────────────────────

export type ProfileSourceType =
  | 'resume_upload'
  | 'manual_intake'
  | 'accepted_artifact'
  | 'rejected_artifact'
  | 'refinement_instruction'
  | 'learning_signal'
  | 'prior_session'

export interface ProfileSource {
  sourceId: string
  sourceType: ProfileSourceType
  sessionId?: string
  artifactId?: string
  filename?: string
  /** SHA-256 hex digest of uploaded file content. Used to detect duplicate uploads. */
  contentHash?: string
  extractedAt: string
}

export type ClaimCategory =
  | 'role'
  | 'responsibility'
  | 'achievement'
  | 'metric'
  | 'domain'
  | 'tool'
  | 'method'
  | 'constraint'
  | 'preference'

export interface ArtifactLink {
  artifactId: string
  sectionType: SectionType
  claimId: string
  linkType: 'source' | 'supported_by' | 'conflicts_with' | 'supersedes'
}

export interface ProfileClaim {
  claimId: string
  /** Lowercase, punctuation-stripped stable key for deduplication. */
  normalizedKey: string
  text: string
  category: ClaimCategory
  evidenceStrength: 'strong' | 'medium' | 'weak'
  sourceIds: string[]
  artifactLinks: ArtifactLink[]
  firstSeenAt: string
  lastSeenAt: string
  status: 'active' | 'superseded' | 'conflicting' | 'archived'
}

export type ClaimOverlapType =
  | 'duplicate'
  | 'near_duplicate'
  | 'same_evidence_different_wording'
  | 'conflict'

export type ClaimResolution = 'merged' | 'linked' | 'kept_separate' | 'needs_review'

export interface ClaimOverlap {
  overlapId: string
  canonicalClaimId: string
  overlappingClaimIds: string[]
  overlapType: ClaimOverlapType
  resolution: ClaimResolution
}

export interface ProfileConflict {
  conflictId: string
  claimIds: string[]
  description: string
  detectedAt: string
}

export interface ProfileIdentity {
  fullName: string
  email: string
  phone: string
  location: string
  linkedIn: string
}

export interface ProfileSkill {
  skillId: string
  name: string
  normalizedKey: string
  /** ATS skill group heading (e.g. "Analysis", "Tools"). */
  grouping?: string
  sourceIds: string[]
  evidenceStrength: 'strong' | 'medium' | 'weak'
}

export interface ProfileDomain {
  domainId: string
  name: string
  normalizedKey: string
  sourceIds: string[]
}

export interface ProfileRoleSignal {
  roleId: string
  title: string
  normalizedKey: string
  company: string
  startDate: string
  endDate: string
  sourceIds: string[]
}

export interface ProfileMetric {
  metricId: string
  text: string
  normalizedKey: string
  context?: string
  sourceIds: string[]
}

export interface ProfileTool {
  toolId: string
  name: string
  normalizedKey: string
  category?: string
  sourceIds: string[]
}

export interface ProfileConstraint {
  constraintId: string
  text: string
  sourceIds: string[]
}

/** Tracks refinement instructions that survive uploads and session resets. */
export interface SnapshotRefinementDirection {
  directionId: string
  text: string
  /** Section type this direction applies to, or 'global' for all sections. */
  appliesTo: SectionType | 'global'
  sourceId: string
  accepted: boolean
  createdAt: string
}

/** Learning signal stored within a ProfileSnapshot for durability. */
export interface SnapshotLearningSignal {
  signalId: string
  type: LearningSignalType
  scope: 'user_specific' | 'global_product'
  text: string
  sourceIds: string[]
  /** Which section types this signal applies to. */
  appliesTo: string[]
  confidence: 'high' | 'medium' | 'low'
  createdAt: string
}

export interface ProfileSnapshotDimensions {
  identity: ProfileIdentity
  experienceClaims: ProfileClaim[]
  skills: ProfileSkill[]
  domains: ProfileDomain[]
  roles: ProfileRoleSignal[]
  metrics: ProfileMetric[]
  tools: ProfileTool[]
  constraints: ProfileConstraint[]
  artifactHistory: ArtifactLink[]
  refinementDirections: SnapshotRefinementDirection[]
  learningSignals: SnapshotLearningSignal[]
}

/**
 * Versioned aggregate of all profile evidence accumulated across sessions and uploads.
 * Never mutated in place — each intake produces a new version.
 */
export interface ProfileSnapshot {
  profileId: string
  version: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  dimensions: ProfileSnapshotDimensions
  sourceIndex: ProfileSource[]
  overlapIndex: ClaimOverlap[]
  unresolvedConflicts: ProfileConflict[]
}

export interface ProfileDelta {
  addedClaims: ProfileClaim[]
  addedSkills: ProfileSkill[]
  addedTools: ProfileTool[]
  addedMetrics: ProfileMetric[]
  mergedClaims: ClaimOverlap[]
  linkedArtifacts: ArtifactLink[]
  preservedDirections: SnapshotRefinementDirection[]
  preservedLearningSignals: SnapshotLearningSignal[]
  unresolvedConflicts: ProfileConflict[]
  profileVersionBefore: number
  profileVersionAfter: number
}

/**
 * Focused slice of the ProfileSnapshot returned to artifact generators.
 * Only contains evidence relevant to the target role and artifact type.
 */
export interface ProfileProjection {
  relevantClaims: ProfileClaim[]
  relevantMetrics: ProfileMetric[]
  relevantSkills: ProfileSkill[]
  relevantTools: ProfileTool[]
  roleTranslationHints: SnapshotLearningSignal[]
  refinementDirections: SnapshotRefinementDirection[]
  evidenceBoundaries: SnapshotLearningSignal[]
  constraints: ProfileConstraint[]
  unresolvedConflicts: ProfileConflict[]
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
