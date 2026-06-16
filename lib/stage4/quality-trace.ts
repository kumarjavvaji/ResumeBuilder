/**
 * Stage 4 Quality Trace
 *
 * Records which guidance components were active during Stage 4 assembly.
 * Not user-facing by default — shown in debug panels and logged for dev inspection.
 *
 * Design rules:
 *   - Never log full resume text or private profile content.
 *   - Record presence/absence, counts, and rule IDs only.
 *   - All fields default to safe "not run" values when guidance is absent.
 */

import type {
  ContractValidationResult,
  CriticalResumeReview,
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeStrategyBrief,
  Stage4BlueprintTrace,
  Stage4GenerationTrace,
  Stage4QualityTrace,
  Stage4RepairTrace,
  Stage4ReviewTrace,
  Stage4RulesetTrace,
  Stage4StrategyBriefTrace,
  Stage4ValidationTrace,
} from '@/contracts'

// ─── Prompt metadata (no private content) ────────────────────────────────────

export interface PromptMetadata {
  strategyBriefIncluded: boolean
  blueprintIncluded: boolean
  evidenceMapIncluded: boolean
  userDirectionIncluded: boolean
  bannedPhrasesIncluded: boolean
  antiPatternsIncluded: boolean
  rewritePreferencesIncluded: boolean
}

export function buildPromptMetadata(opts: {
  strategyBrief?: ResumeStrategyBrief
  contract?: ResumeGenerationContract
  jdMap?: JDRequirementMap
  hasUserDirection?: boolean
}): PromptMetadata {
  return {
    strategyBriefIncluded: !!opts.strategyBrief,
    blueprintIncluded: !!opts.contract,
    evidenceMapIncluded: !!opts.jdMap,
    userDirectionIncluded: !!opts.hasUserDirection,
    bannedPhrasesIncluded: (opts.contract?.bannedPhrases?.length ?? 0) > 0,
    antiPatternsIncluded: (opts.strategyBrief?.antiPatternsToAvoid?.length ?? 0) > 0,
    rewritePreferencesIncluded: (opts.strategyBrief?.rewritePreferences?.length ?? 0) > 0,
  }
}

// ─── Sub-trace builders ───────────────────────────────────────────────────────

function buildRulesetTrace(strategyBrief?: ResumeStrategyBrief): Stage4RulesetTrace {
  if (!strategyBrief) {
    return { rulesetLoaded: false, activeRuleIds: [], antiPatternIds: [], rewriteStrategyIds: [] }
  }
  return {
    rulesetLoaded: true,
    activeRuleIds: strategyBrief.activeRuleIds.length > 0
      ? strategyBrief.activeRuleIds
      : strategyBrief.bulletConstructionRules.map((_, i) => `rule-bc-${i + 1}`),
    antiPatternIds: strategyBrief.antiPatternsToAvoid.map((_, i) => `anti-${i + 1}`),
    rewriteStrategyIds: strategyBrief.rewritePreferences.map((_, i) => `rewrite-${i + 1}`),
  }
}

function buildStrategyBriefTrace(strategyBrief?: ResumeStrategyBrief): Stage4StrategyBriefTrace {
  if (!strategyBrief) {
    return {
      built: false,
      jdCriticalThemes: [],
      bulletConstructionRules: [],
      metricUseRules: [],
      executivePresenceRules: [],
      antiPatternsToAvoid: [],
    }
  }
  return {
    built: true,
    targetRoleStrategy: strategyBrief.targetRoleStrategy,
    jdCriticalThemes: strategyBrief.jdCriticalThemes.map(t => t.theme),
    bulletConstructionRules: strategyBrief.bulletConstructionRules,
    metricUseRules: strategyBrief.metricUseRules,
    executivePresenceRules: strategyBrief.executivePresenceRules,
    antiPatternsToAvoid: strategyBrief.antiPatternsToAvoid,
  }
}

function buildBlueprintTrace(contract?: ResumeGenerationContract): Stage4BlueprintTrace {
  if (!contract) {
    return {
      built: false,
      sectionKeys: [],
      primaryProofSections: [],
      secondaryProofSections: [],
      supportingSections: [],
      bulletIntentCount: 0,
      evidenceRoutingCount: 0,
    }
  }
  const sp = contract.sectionPlan
  return {
    built: true,
    sectionKeys: ['summary', 'skills', 'experience-po', 'experience-ba', 'experience-qa', 'education'],
    primaryProofSections: ['experience-po'],
    secondaryProofSections: ['experience-ba', 'experience-qa'],
    supportingSections: ['summary', 'skills', 'education'],
    bulletIntentCount:
      sp.productOwner.minBullets + sp.productAnalyst.minBullets + sp.qa.minBullets,
    evidenceRoutingCount: Object.keys(contract.evidenceRouting).length,
  }
}

function buildGenerationTrace(opts: {
  strategyBrief?: ResumeStrategyBrief
  contract?: ResumeGenerationContract
  hasUserDirection?: boolean
}): Stage4GenerationTrace {
  return {
    promptIncludesStrategyBrief: !!opts.strategyBrief,
    promptIncludesBlueprint: !!opts.contract,
    // Evidence map is built at refinement time, not assembly
    promptIncludesEvidenceMap: false,
    promptIncludesUserDirection: !!opts.hasUserDirection,
    promptIncludesBannedPhrases: (opts.contract?.bannedPhrases?.length ?? 0) > 0,
    // Model call is in refine/repair, not assembly
    modelCallCompleted: false,
  }
}

function buildValidationTrace(
  contract: ResumeGenerationContract | undefined,
  validation: ContractValidationResult | null,
): Stage4ValidationTrace {
  if (!contract || !validation) {
    return { ranDeterministicValidation: false, violationCount: 0, violationRules: [] }
  }
  return {
    ranDeterministicValidation: true,
    violationCount: validation.violations.length,
    violationRules: Array.from(new Set(validation.violations.map(v => v.rule))),
  }
}

function buildReviewTrace(review: CriticalResumeReview | null): Stage4ReviewTrace {
  if (!review) {
    return { ranCriticalReview: false, findingTypes: [], rewriteDirectiveCount: 0 }
  }
  return {
    ranCriticalReview: true,
    artifactStatus: review.artifactStatus,
    findingTypes: Array.from(
      new Set(review.sectionFindings.flatMap(s => s.findings.map(f => f.issueType))),
    ),
    rewriteDirectiveCount: review.rewriteDirectives.length,
    rewriteDirectives: review.rewriteDirectives.length > 0 ? review.rewriteDirectives : undefined,
  }
}

export function buildEmptyRepairTrace(): Stage4RepairTrace {
  return {
    repairAttempted: false,
    deterministicRepairApplied: false,
    llmRepairApplied: false,
    finalValidationPassed: false,
  }
}

export function buildRepairTrace(opts: {
  repairAttempted: boolean
  deterministicRepairsApplied: number
  llmRepairApplied: boolean
  finalValidationPassed: boolean
}): Stage4RepairTrace {
  return {
    repairAttempted: opts.repairAttempted,
    deterministicRepairApplied: opts.deterministicRepairsApplied > 0,
    llmRepairApplied: opts.llmRepairApplied,
    finalValidationPassed: opts.finalValidationPassed,
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildStage4QualityTrace(opts: {
  sessionId: string
  strategyBrief?: ResumeStrategyBrief
  contract?: ResumeGenerationContract
  hasUserDirection?: boolean
  validation: ContractValidationResult | null
  review: CriticalResumeReview | null
  deterministicRepairsApplied: number
}): Stage4QualityTrace {
  return {
    sessionId: opts.sessionId,
    generatedAt: new Date().toISOString(),
    rulesetTrace: buildRulesetTrace(opts.strategyBrief),
    strategyBriefTrace: buildStrategyBriefTrace(opts.strategyBrief),
    blueprintTrace: buildBlueprintTrace(opts.contract),
    generationTrace: buildGenerationTrace({
      strategyBrief: opts.strategyBrief,
      contract: opts.contract,
      hasUserDirection: opts.hasUserDirection,
    }),
    validationTrace: buildValidationTrace(opts.contract, opts.validation),
    reviewTrace: buildReviewTrace(opts.review),
    repairTrace: buildRepairTrace({
      repairAttempted: opts.deterministicRepairsApplied > 0,
      deterministicRepairsApplied: opts.deterministicRepairsApplied,
      llmRepairApplied: false,
      finalValidationPassed: opts.validation?.pass ?? false,
    }),
  }
}
