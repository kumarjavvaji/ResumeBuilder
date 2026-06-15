/**
 * Stage 3 readiness gate.
 *
 * Produces a ResumeReadinessContract from the current session context before
 * Stage 4 generation begins. This is a deterministic pre-flight check:
 *   - Evidence routing: which evidence goes to which section
 *   - Metric policy: require impact tie for volume metrics
 *   - Summary policy: no proof-level duplication from experience
 *   - Section plan: bullet budgets aligned to target role family
 *   - Allowed / disallowed tools: only tools evidenced in profile
 *   - Required experience themes: JD requirements that must appear in bullets
 *
 * All logic is generic — no hardcoded candidate values.
 */

import type {
  EvidenceAtom,
  EmphasisCategory,
  JDRequirementMap,
  MetricPolicy,
  ReadinessCheckResult,
  ResolvedBridgeDecision,
  ResumeReadinessContract,
  ResumeReadinessSectionPlan,
  SummaryPolicy,
  UserProfile,
} from '@/contracts'
import { classifyMetric } from '@/lib/validators/metric-quality'

export interface ReadinessContractInput {
  emphasisRecommendation: EmphasisCategory
  roleTitle?: string
  jdMap: JDRequirementMap
  profile: UserProfile
  evidenceAtoms: EvidenceAtom[]
  resolvedDecisions: ResolvedBridgeDecision[]
}

export function buildResumeReadinessContract(
  input: ReadinessContractInput,
): ResumeReadinessContract {
  const { emphasisRecommendation, roleTitle = '', jdMap, profile, evidenceAtoms, resolvedDecisions } = input
  const roleTitleLower = roleTitle.toLowerCase()

  const targetRoleFamily = deriveRoleFamily(emphasisRecommendation, roleTitleLower)
  const targetPosture = derivePosture(targetRoleFamily, roleTitleLower)
  const sectionPlan = buildSectionPlan(targetRoleFamily)

  const allProfileTools = collectProfileTools(profile)
  const jdRequiredTools = jdMap.required
    .filter(r => r.category === 'tool')
    .map(r => r.text)

  const allowedTools = Array.from(new Set([...allProfileTools, ...jdRequiredTools]))
  const disallowedTools = detectDisallowedTools(profile, jdMap)

  const evidenceRouting = buildEvidenceRouting(evidenceAtoms, jdMap, targetRoleFamily)

  const resolvedDecisionsMap: Record<string, unknown> = {}
  for (const d of resolvedDecisions) {
    resolvedDecisionsMap[d.questionId] = {
      disposition: d.dispositionType,
      statement: d.normalizedStatement,
      routeToResume: d.routeToResume,
    }
  }

  const bannedPhrases = deriveBannedPhrases(profile, jdMap)
  const preferredReplacements = derivePreferredReplacements(profile, jdMap)
  const requiredExperienceThemes = deriveRequiredExperienceThemes(jdMap)

  const metricPolicy: MetricPolicy = {
    preferImpactOverVolume: true,
    volumeMetricsRequireImpactTie: true,
  }

  const summaryPolicy: SummaryPolicy = {
    noProofLevelDuplication: true,
    noTeamSizeIfInExperience: true,
    noCadenceIfInExperience: true,
    noMetricsIfInExperience: true,
    noToolDetailsIfInExperience: true,
  }

  return {
    targetRoleFamily,
    targetPosture,
    sectionPlan,
    evidenceRouting,
    resolvedDecisions: resolvedDecisionsMap,
    bannedPhrases,
    preferredReplacements,
    allowedTools,
    disallowedTools,
    requiredExperienceThemes,
    metricPolicy,
    summaryPolicy,
  }
}

export function validateResumeReadiness(
  contract: ResumeReadinessContract,
  jdMap: JDRequirementMap,
  evidenceAtoms: EvidenceAtom[],
): ReadinessCheckResult {
  const blockers: string[] = []
  const warnings: string[] = []

  // Blocker: required JD themes have no evidence route
  const routedThemes = new Set(Object.keys(contract.evidenceRouting))
  for (const theme of contract.requiredExperienceThemes) {
    const themeWords = theme.toLowerCase().split(/[/\s]+/).filter(w => w.length > 3)
    const hasRoute = themeWords.some(w =>
      Array.from(routedThemes).some(t => t.toLowerCase().includes(w)),
    )
    if (!hasRoute) {
      blockers.push(`Required JD theme "${theme}" has no evidence route from profile.`)
    }
  }

  // Blocker: disallowed tools present in allowed list (profile/JD conflict)
  const disallowedInAllowed = contract.disallowedTools.filter(t =>
    contract.allowedTools.some(a => a.toLowerCase() === t.toLowerCase()),
  )
  for (const tool of disallowedInAllowed) {
    blockers.push(`Tool "${tool}" is both allowed and disallowed — resolve profile conflict before generating.`)
  }

  // Warning: volume-led evidence atoms with no impact tie
  const volumeOnlyAtoms = evidenceAtoms.filter(
    a => a.isVolumeEvidence && !a.isImpactEvidence,
  )
  if (volumeOnlyAtoms.length > 0 && contract.metricPolicy.volumeMetricsRequireImpactTie) {
    warnings.push(
      `${volumeOnlyAtoms.length} evidence atom(s) are volume-led without an impact tie. These will be flagged during Stage 4 validation.`,
    )
  }

  // Warning: resolved decisions routed to resume with only 'needs_clarification' disposition
  const unclearDecisions = Object.values(contract.resolvedDecisions).filter(
    (d: unknown) => (d as { disposition: string }).disposition === 'needs_clarification',
  )
  if (unclearDecisions.length > 0) {
    warnings.push(
      `${unclearDecisions.length} bridge answer(s) need clarification. They will not be routed to resume bullets.`,
    )
  }

  // Warning: required experience themes outnumber supported evidence atoms
  const impactAtomCount = evidenceAtoms.filter(a => a.isImpactEvidence).length
  if (
    contract.requiredExperienceThemes.length > 0 &&
    impactAtomCount < contract.requiredExperienceThemes.length
  ) {
    warnings.push(
      `Only ${impactAtomCount} impact evidence atom(s) available for ${contract.requiredExperienceThemes.length} required theme(s). Some themes may not be provable.`,
    )
  }

  return {
    ready: blockers.length === 0,
    warnings,
    blockers,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RoleFamily = string

function deriveRoleFamily(emphasis: EmphasisCategory, roleTitleLower: string): RoleFamily {
  if (emphasis === 'QA') return 'qa'
  if (emphasis === 'data') return 'product_analyst'
  if (emphasis === 'BA') return 'business_analyst'
  if (emphasis === 'PO') {
    return roleTitleLower.includes('associate') ? 'associate_pm' : 'product_owner'
  }
  if (roleTitleLower.includes('product owner')) return 'product_owner'
  if (roleTitleLower.includes('business analyst') || / ba /.test(roleTitleLower)) return 'business_analyst'
  if (roleTitleLower.includes('product analyst')) return 'product_analyst'
  if (/\bqa\b|quality|test engineer/.test(roleTitleLower)) return 'qa'
  return 'product_owner'
}

function derivePosture(roleFamily: RoleFamily, roleTitleLower: string): string {
  switch (roleFamily) {
    case 'associate_pm':
      return 'tactical product delivery / business-to-IT execution / associate product management'
    case 'product_owner':
      return 'tactical product delivery / backlog execution / sprint delivery / stakeholder alignment'
    case 'product_analyst':
      return 'product analytics / data-backed decisions / KPI measurement / stakeholder recommendations'
    case 'business_analyst':
      return 'requirements elicitation / gap analysis / acceptance criteria / UAT / release readiness'
    case 'qa':
      return 'test automation / quality frameworks / release readiness / defect prevention'
    default:
      return roleTitleLower
        ? `product delivery targeting: ${roleTitleLower}`
        : 'product delivery / stakeholder alignment / cross-functional execution'
  }
}

function buildSectionPlan(roleFamily: RoleFamily): ResumeReadinessSectionPlan {
  const isQA = roleFamily === 'qa'
  return {
    summary: { purpose: 'positioning', maxSentences: 4, maxApproxLines: 4 },
    skills: { purpose: 'ats_support', maxRows: 5 },
    primaryExperience: { minBullets: 5, maxBullets: 6 },
    secondaryExperience: { minBullets: isQA ? 5 : 4, maxBullets: isQA ? 6 : 5 },
    earlierExperience: { maxBullets: 3 },
    education: { maxLines: 3 },
  }
}

function collectProfileTools(profile: UserProfile): string[] {
  return Array.from(
    new Set([
      ...profile.skills,
      ...profile.skillGroups.flatMap(g => g.skills),
      ...profile.workHistory.flatMap(w => w.skills ?? []),
    ]),
  )
}

function detectDisallowedTools(
  profile: UserProfile,
  jdMap: JDRequirementMap,
): string[] {
  const profileToolsLower = new Set(collectProfileTools(profile).map(t => t.toLowerCase()))
  // JD-required tools not present in profile are disallowed (insufficient evidence)
  return jdMap.required
    .filter(r => r.category === 'tool' && !profileToolsLower.has(r.text.toLowerCase()))
    .map(r => r.text)
}

function buildEvidenceRouting(
  evidenceAtoms: EvidenceAtom[],
  jdMap: JDRequirementMap,
  roleFamily: RoleFamily,
): Record<string, string[]> {
  const routing: Record<string, string[]> = {}

  // Group atoms by text → derive sections from allowedUses
  for (const atom of evidenceAtoms) {
    if (atom.atomType === 'tool') {
      const sections: string[] = []
      if (atom.allowedUses.includes('skills')) sections.push('skills')
      if (atom.allowedUses.includes('po_bullet')) sections.push('experience-po')
      if (atom.allowedUses.includes('pa_bullet')) sections.push('experience-ba')
      if (sections.length > 0) routing[atom.text] = sections
    }
    if (atom.atomType === 'certification') {
      routing[atom.text] = ['summary', 'education']
    }
  }

  // Static JD-driven routing
  const jdText = [
    ...jdMap.required.map(r => r.text),
    ...jdMap.niceToHave.map(r => r.text),
  ].join(' ').toLowerCase()

  if (/uat|user acceptance/i.test(jdText)) {
    routing['UAT coordination'] = ['experience-ba', 'experience-po']
  }
  if (/backlog|sprint|roadmap/i.test(jdText)) {
    routing['backlog execution'] = ['experience-po']
  }
  if (/travel/i.test(jdText)) {
    routing['travel willingness'] = [] // never in resume
  }

  return routing
}

function deriveBannedPhrases(profile: UserProfile, jdMap: JDRequirementMap): string[] {
  const phrases: string[] = ['managed a team', 'managed the team']

  // Tools confirmed absent from profile
  const flatSkillsLower = new Set(
    collectProfileTools(profile).map(t => t.toLowerCase()),
  )
  const unsupportedJDTools = jdMap.required
    .filter(r => r.category === 'tool' && !flatSkillsLower.has(r.text.toLowerCase()))
    .map(r => r.text)
  phrases.push(...unsupportedJDTools)

  return phrases
}

function derivePreferredReplacements(
  profile: UserProfile,
  jdMap: JDRequirementMap,
): Record<string, string> {
  const replacements: Record<string, string> = {
    'managed a team': 'led delivery for a squad',
    'managed the team': 'led the squad',
  }
  return replacements
}

function deriveRequiredExperienceThemes(jdMap: JDRequirementMap): string[] {
  const themes: string[] = []
  const jdText = [
    ...jdMap.required.map(r => r.text),
    ...jdMap.niceToHave.map(r => r.text),
  ].join(' ').toLowerCase()

  if (/uat|user acceptance|acceptance testing/.test(jdText)) themes.push('UAT / QA collaboration')
  if (/kpi|performance metric|analytics|reporting|dashboard/.test(jdText))
    themes.push('product performance / KPI / usage analysis')
  if (/documentation|training|walkthrough|communicate/.test(jdText))
    themes.push('documentation / training / stakeholder communication')
  if (/backlog|prioriti|sprint|roadmap/.test(jdText)) themes.push('backlog ownership / sprint delivery')
  if (/requirement|acceptance criteria|user stor/.test(jdText))
    themes.push('requirements / acceptance criteria')
  if (/stakeholder|cross.?functional|collaboration/.test(jdText))
    themes.push('stakeholder alignment / cross-functional delivery')

  return themes
}
