'use client'
/**
 * Assembles the additional context that Stage 3B generation and refinement
 * need beyond what is already carried by the session's JD map + profile.
 *
 * Called client-side before each fetch to /api/artifact-section or
 * /api/artifact-refine. All reads are from already-loaded state or IndexedDB.
 *
 * Sources added here (not duplicated from existing fetch body):
 *   1. Per-requirement fit analysis from fitAnalysis.requirements
 *      (classification, profileEvidenceStrength, quickDiqGrounding,
 *       calibratedFitInterpretation — adds value beyond jdMap coverage status)
 *   2. Quick-DIQ calibration brief from fitAnalysis.calibrationBrief
 *      (structured domain/delivery/stakeholder signals from Stage 1)
 *   3. Individual CalibrationReference records for applied references
 *      (title, company, matchType=target/comparable, confidence, limitations)
 */
import { getSessionCalibrationRefs } from '@/lib/storage/calibration'
import type { TargetIntake, AppliedCalibrationState } from '@/contracts'

// ─── Slim types sent across the API boundary ──────────────────────────────────

export interface FitRequirementSlim {
  requirementText: string
  classification?: string
  profileEvidenceStrength?: 'strong' | 'moderate' | 'weak' | 'none'
  quickDiqGrounding?: string
  calibratedFitInterpretation?: string
}

export interface FitAnalysisContext {
  evaluatorLens?: string
  gapSummary?: {
    trueGaps: string[]
    needsConfirmation: string[]
    wordingOrMapping: string[]
  }
  calibrationBrief?: {
    companyContext?: string
    domainContext?: string
    roleProblemSpace?: string
    likelyHiringPriorities?: string[]
    deliverySignals?: string[]
    stakeholderSignals?: string[]
    analyticsReportingSignals?: string[]
    resumeCalibrationImplications?: string[]
  }
  /** Only requirements that add value beyond jdMap (have classification or grounding). */
  requirements: FitRequirementSlim[]
}

export interface CalibrationRefSlim {
  id: string
  matchType: string
  title: string
  company: string
  confidence: 'high' | 'medium' | 'low'
  matchReason: string
  limitations?: string
  /** User-pasted public profile context — calibration/market reference only, not user evidence. */
  manualContext?: string
  /** JD-alignment group — rejected refs must not enter the LLM prompt. */
  calibrationGroup?: 'primary' | 'supporting' | 'context_only' | 'rejected'
}

export interface ArtifactRefinementContext {
  fitAnalysisContext?: FitAnalysisContext
  calibrationRefs: CalibrationRefSlim[]
}

// ─── Assembler ────────────────────────────────────────────────────────────────

export async function buildArtifactRefinementContext(
  session: TargetIntake,
  appliedCalibrationState?: AppliedCalibrationState
): Promise<ArtifactRefinementContext> {
  // ── 1. Fit analysis context (from session — no extra DB read needed) ─────────
  const fitAnalysisContext = session.fitAnalysis
    ? extractFitAnalysisContext(session.fitAnalysis)
    : undefined

  // ── 2. Individual calibration refs (from IndexedDB) ──────────────────────────
  let calibrationRefs: CalibrationRefSlim[] = []
  try {
    const appliedIds = new Set(appliedCalibrationState?.referencedCalibrationIds ?? [])
    if (appliedIds.size > 0) {
      const allRefs = await getSessionCalibrationRefs(session.id)
      calibrationRefs = allRefs
        .filter(r => appliedIds.has(r.id) && r.calibrationGroup !== 'rejected')
        .slice(0, 12)  // cap to keep prompt size bounded
        .map(r => ({
          id: r.id,
          matchType: r.matchType,
          title: r.title,
          company: r.company,
          confidence: r.confidence,
          matchReason: r.matchReason,
          limitations: r.limitations,
          manualContext: r.manualContext,
          calibrationGroup: r.calibrationGroup,
        }))
    }
  } catch {
    // Non-fatal — calibration refs are enrichment only
  }

  return { fitAnalysisContext, calibrationRefs }
}

function extractFitAnalysisContext(
  fitAnalysis: NonNullable<TargetIntake['fitAnalysis']>
): FitAnalysisContext {
  // Only pass requirements that add info beyond jdMap coverage status
  const requirements: FitRequirementSlim[] = (fitAnalysis.requirements ?? [])
    .filter(r => r.classification || r.quickDiqGrounding || r.calibratedFitInterpretation)
    .map(r => ({
      requirementText: r.requirementText,
      classification: r.classification,
      profileEvidenceStrength: r.profileEvidenceStrength,
      quickDiqGrounding: r.quickDiqGrounding,
      calibratedFitInterpretation: r.calibratedFitInterpretation,
    }))

  const cb = fitAnalysis.calibrationBrief
  const calibrationBrief = cb
    ? {
        companyContext: cb.companyContext,
        domainContext: cb.domainContext,
        roleProblemSpace: cb.roleProblemSpace,
        likelyHiringPriorities: cb.likelyHiringPriorities,
        deliverySignals: cb.deliverySignals,
        stakeholderSignals: cb.stakeholderSignals,
        analyticsReportingSignals: cb.analyticsReportingSignals,
        resumeCalibrationImplications: cb.resumeCalibrationImplications,
      }
    : undefined

  return {
    evaluatorLens: fitAnalysis.evaluatorLens,
    gapSummary: fitAnalysis.gapSummary
      ? {
          trueGaps: fitAnalysis.gapSummary.trueGaps,
          needsConfirmation: fitAnalysis.gapSummary.needsConfirmation,
          wordingOrMapping: fitAnalysis.gapSummary.wordingOrMapping,
        }
      : undefined,
    calibrationBrief,
    requirements,
  }
}
