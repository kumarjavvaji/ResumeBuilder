/**
 * ResumeGenerationContract — deterministic assembly rules for Stage 4.
 *
 * ResumeBuilder (not the LLM) owns:
 *   - Section balance (skill rows, bullet counts)
 *   - Session decisions (PO tenure framing, Azure DevOps, Salesforce phrase)
 *   - Evidence routing (what belongs where)
 *   - Banned phrases and preferred replacements
 *   - Post-generation validation
 *   - Deterministic repair before any LLM refinement call
 */

import type {
  ContractValidationResult,
  ContractViolation,
  EmphasisCategory,
  JDRequirementMap,
  MetricPolicy,
  ResumeGenerationContract,
  ResumeReadinessContract,
  Stage4RoleFamily,
  Stage4SectionPlan,
  Stage4SessionDirection,
  UserProfile,
} from '@/contracts'
import { validateBulletMetrics } from '@/lib/validators/metric-quality'

// ─── Contract builder ─────────────────────────────────────────────────────────

export interface ContractBuildInput {
  emphasisRecommendation: EmphasisCategory
  roleTitle?: string
  overallRefinementPrompt?: string
  jdMap: JDRequirementMap
  profile: UserProfile
}

export function buildResumeGenerationContract(input: ContractBuildInput): ResumeGenerationContract {
  const { emphasisRecommendation, roleTitle = '', overallRefinementPrompt = '', jdMap, profile } = input
  const roleTitleLower = roleTitle.toLowerCase()

  const targetRoleFamily = detectRoleFamily(emphasisRecommendation, roleTitleLower)
  const sectionPlan = defaultSectionPlan(targetRoleFamily)

  const azureDevOpsAllowed = detectAzureDevOpsAllowed(profile)
  const representPrimaryRole = detectPrimaryPORole(overallRefinementPrompt, profile)
  const avoidFormalTitleHedging =
    representPrimaryRole ||
    /hedg|PO-adjacent|acting PO|informal PO/i.test(overallRefinementPrompt)

  const salesforcePreferredPhrase = detectSalesforcePhrase(overallRefinementPrompt)

  const sessionDirection: Stage4SessionDirection = {
    representPrimaryRole,
    avoidFormalTitleHedging,
    targetPosture: deriveTargetPosture(targetRoleFamily, roleTitleLower),
    roadmapBoundary:
      'leadership-sponsored roadmap execution, tactical recommendations, dependency sequencing, release-ready scope, KPI-informed pivots',
    azureDevOpsAllowed,
    travelResumeAllowed: false,
    salesforcePreferredPhrase,
  }

  const bannedPhrases = buildBannedPhrases(sessionDirection)

  const preferredReplacements: Record<string, string> = {
    'Salesforce Segmentation': salesforcePreferredPhrase,
    'managed a team': 'led delivery for a squad',
    'managed the team': 'led the squad',
  }
  if (avoidFormalTitleHedging) {
    const poTenure = computePOTenure(profile)
    const tenureLabel = poTenure ? `${poTenure} leading backlog execution` : 'backlog execution and sprint delivery'
    preferredReplacements['formal PO title experience'] = tenureLabel
    preferredReplacements['formal PO tenure'] = tenureLabel
    preferredReplacements['PO-adjacent'] = 'Product Owner'
    preferredReplacements['acting PO'] = 'Product Owner'
    preferredReplacements['informal PO'] = 'Product Owner'
  }
  if (!azureDevOpsAllowed) {
    preferredReplacements['Azure DevOps'] = 'Jira'
  }

  const jdText = [
    ...jdMap.required.map(r => r.text),
    ...jdMap.niceToHave.map(r => r.text),
  ].join(' ').toLowerCase()

  const evidenceRouting: Record<string, string[]> = {
    CSPO: ['summary', 'education'],
    Jira: ['skills', 'experience-primary', 'experience-secondary'],
    Pendo: ['skills', 'experience-primary', 'experience-secondary'],
    'travel willingness': [],
    'Azure DevOps': azureDevOpsAllowed ? ['skills'] : [],
    'roadmap ownership': ['experience-primary'],
    // Dynamic: older/non-primary employer entries routed to summary when JD needs their domain
    ...buildDynamicEmployerRouting(profile, jdText),
  }

  return {
    targetRoleFamily,
    targetPosture: sessionDirection.targetPosture,
    sectionPlan,
    sessionDirection,
    bannedPhrases,
    preferredReplacements,
    evidenceRouting,
    requiredBulletThemes: deriveRequiredBulletThemes(jdText),
  }
}

// ─── Role family detection ────────────────────────────────────────────────────

function detectRoleFamily(emphasis: EmphasisCategory, roleTitleLower: string): Stage4RoleFamily {
  // Title-based detection is the primary signal
  if (
    roleTitleLower.includes('product owner') ||
    roleTitleLower.includes('product manager') ||
    roleTitleLower.includes('program manager') ||
    roleTitleLower.includes('scrum master')
  ) return 'primary'

  if (
    roleTitleLower.includes('analyst') ||
    roleTitleLower.includes('business analyst') ||
    roleTitleLower.includes('product analyst') ||
    roleTitleLower.includes('systems analyst') ||
    roleTitleLower.includes('data analyst')
  ) return 'secondary'

  if (
    roleTitleLower.includes('supporting') ||
    roleTitleLower.includes('quality') ||
    roleTitleLower.includes('test engineer') ||
    roleTitleLower.includes('tester')
  ) return 'supporting'

  // Emphasis string as a secondary signal (caller can pass the role title or a category label)
  const emphasisLower = emphasis.toLowerCase()
  if (emphasisLower.includes('analyst') || emphasisLower.includes('data')) return 'secondary'
  if (emphasisLower.includes('supporting') || emphasisLower.includes('quality')) return 'supporting'

  return 'other'
}

function defaultSectionPlan(roleFamily: Stage4RoleFamily): Stage4SectionPlan {
  const isSupporting = roleFamily === 'supporting'
  return {
    summary: { maxLines: 4 },
    skills: { maxRows: 5 },
    primaryRole: { minBullets: 5, maxBullets: 6 },
    secondaryRole: { minBullets: 4, maxBullets: 5 },
    supportingRole: {
      minBullets: isSupporting ? 5 : 3,
      maxBullets: isSupporting ? 6 : 4,
    },
    education: { maxLines: 3 },
  }
}

function deriveTargetPosture(roleFamily: Stage4RoleFamily, roleTitleLower: string): string {
  switch (roleFamily) {
    case 'primary':
      return roleTitleLower
        ? `${roleTitleLower} / backlog execution / sprint delivery / stakeholder alignment`
        : 'tactical product delivery / backlog execution / sprint delivery / stakeholder alignment'
    case 'secondary':
      return roleTitleLower
        ? `${roleTitleLower} / requirements elicitation / gap analysis / acceptance criteria`
        : 'requirements elicitation / gap analysis / acceptance criteria / UAT / release readiness'
    case 'supporting':
      return roleTitleLower
        ? `${roleTitleLower} / release readiness / defect prevention`
        : 'release readiness / defect prevention / quality frameworks'
    default:
      return roleTitleLower
        ? `product delivery targeting: ${roleTitleLower}`
        : 'product delivery / stakeholder alignment / cross-functional execution'
  }
}

// ─── Session direction helpers ────────────────────────────────────────────────

function detectPrimaryPORole(overallPrompt: string, profile: UserProfile): boolean {
  if (/treat.*primary role|represent.*primary/i.test(overallPrompt)) return true
  if (/treat.*product owner|represent.*product owner/i.test(overallPrompt)) return true
  if (/treat.*PO|represent.*PO/i.test(overallPrompt)) return true
  // Any work history with a clear primary role title is treated as primary
  return profile.workHistory.length > 0
}

/**
 * Computes PO role tenure from work history dates.
 * Returns e.g. "3.5 years" or "18 months" — or "" if dates can't be parsed.
 * Replaces the previously hardcoded "3.5 years" literal.
 */
function computePOTenure(profile: UserProfile): string {
  const poEntry = profile.workHistory.find(w => /product owner/i.test(w.title))
  if (!poEntry) return ''

  const parseDate = (d: string): Date | null => {
    if (!d) return null
    if (/^present$/i.test(d)) return new Date()
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }
    const parts = d.trim().toLowerCase().split(/\s+/)
    if (parts.length === 2) {
      const monthKey = parts[0].slice(0, 3)
      const year = parseInt(parts[1])
      if (months[monthKey] !== undefined && !isNaN(year)) return new Date(year, months[monthKey], 1)
    }
    if (parts.length === 1 && /^\d{4}$/.test(parts[0])) return new Date(parseInt(parts[0]), 0, 1)
    return null
  }

  const start = parseDate(poEntry.startDate)
  const end = poEntry.endDate === 'present' ? new Date() : parseDate(poEntry.endDate ?? '')
  if (!start || !end) return ''

  const totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (totalMonths < 12) return `${totalMonths} months`
  const years = totalMonths / 12
  const rounded = Math.round(years * 2) / 2
  return `${rounded} years`
}

/**
 * Derives evidence routing for non-primary work history entries.
 * When an older employer's domain matches JD requirements, routes that employer
 * to the summary section so the LLM can reference it as supporting context.
 * Replaces the hardcoded employer-specific routing that previously existed.
 */
function buildDynamicEmployerRouting(profile: UserProfile, jdTextLower: string): Record<string, string[]> {
  const primaryKeywords = ['product owner', 'product manager', 'business analyst',
    'product analyst', 'systems analyst', 'data analyst']
  const routing: Record<string, string[]> = {}

  for (const entry of profile.workHistory) {
    const titleLower = entry.title.toLowerCase()
    const isPrimary = primaryKeywords.some(kw => titleLower.includes(kw))
    if (isPrimary) continue

    const domain = (entry.domain ?? '').toLowerCase()
    if (!domain) continue
    const domainWords = domain.split(/\W+/).filter(w => w.length > 3)
    const jdRelevant = domainWords.some(word => jdTextLower.includes(word))
    if (jdRelevant) routing[entry.company] = ['summary']
  }

  return routing
}

function detectAzureDevOpsAllowed(profile: UserProfile): boolean {
  const flatSkills = [
    ...profile.skills,
    ...profile.skillGroups.flatMap(g => g.skills),
    ...profile.workHistory.flatMap(w => w.skills ?? []),
  ]
    .join(' ')
    .toLowerCase()
  return flatSkills.includes('azure devops')
}

function detectSalesforcePhrase(overallPrompt: string): string {
  if (/salesforce reporting/i.test(overallPrompt)) return 'Salesforce Reporting'
  if (/salesforce request/i.test(overallPrompt)) return 'Salesforce request data'
  return 'Salesforce Reporting'
}

function buildBannedPhrases(dir: Stage4SessionDirection): string[] {
  const phrases: string[] = ['Salesforce Segmentation', 'managed a team', 'managed the team']
  if (dir.avoidFormalTitleHedging) {
    phrases.push(
      'formal PO title experience',
      'formal PO tenure',
      'PO-adjacent',
      'acting PO',
      'informal PO',
      'PO-like',
    )
  }
  if (!dir.azureDevOpsAllowed) {
    phrases.push('Azure DevOps')
  }
  if (!dir.travelResumeAllowed) {
    phrases.push('travel up to', 'willing to travel', 'ability to travel', 'comfortable with travel')
  }
  return phrases
}

function deriveRequiredBulletThemes(jdTextLower: string): string[] {
  const themes: string[] = []
  if (/uat|user acceptance|acceptance testing/.test(jdTextLower)) themes.push('UAT / QA collaboration')
  if (/kpi|performance metric|analytics|reporting|dashboard/.test(jdTextLower))
    themes.push('product performance / KPI / usage analysis')
  if (/documentation|training|walkthrough|communicate/.test(jdTextLower))
    themes.push('documentation / training / stakeholder communication')
  if (/backlog|prioriti|sprint|roadmap/.test(jdTextLower)) themes.push('backlog ownership / sprint delivery')
  if (/requirement|acceptance criteria|user stor/.test(jdTextLower))
    themes.push('requirements / acceptance criteria')
  return themes
}

// ─── Summary-vs-Experience de-duplication ────────────────────────────────────

export interface DuplicatedSignal {
  type: 'metric' | 'tool' | 'phrase' | 'team_size' | 'cadence'
  value: string
  foundInBullet: string
}

export interface SummaryDuplicationResult {
  hasDuplication: boolean
  duplicatedSignals: DuplicatedSignal[]
}

const SUMMARY_ALLOWED_POSITIONING_CONCEPTS = [
  'uat',
  'uat readiness',
  'qa collaboration',
  'acceptance criteria',
  'user stories',
  'backlog execution',
  'product requirements',
  'business-to-it translation',
  'release readiness',
  'stakeholder communication',
  'documentation',
  'data-informed prioritization',
  'scrum delivery',
]

function isAllowedSummaryConcept(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return SUMMARY_ALLOWED_POSITIONING_CONCEPTS.some(concept => {
    const c = concept.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return normalized === c || normalized.includes(c)
  })
}

/**
 * Extracts proof-level signals from Experience bullets and checks whether the
 * Summary repeats them. Summary should position; Experience should prove.
 *
 * Does NOT use a hardcoded list of candidate-specific values — signals are
 * extracted dynamically from the generated Experience content.
 */
export function checkSummaryDuplication(
  summaryText: string,
  experienceText: string,
  knownTools: string[] = [],
): SummaryDuplicationResult {
  const bulletLines = experienceText
    .split('\n')
    .filter(l => l.trim().startsWith('- '))
    .map(l => l.trim().slice(2).trim())

  if (bulletLines.length === 0) return { hasDuplication: false, duplicatedSignals: [] }

  const summaryLower = summaryText.toLowerCase()
  const signals: DuplicatedSignal[] = []

  // 1. Numeric metrics (percentages, dollar amounts, large numbers with K/M/B suffix)
  const metricRe = /\$?\d+[,.]?\d*\s*(?:[%km+]|\bk\b|\bmillion\b|\bbillion\b)?/gi
  for (const bullet of bulletLines) {
    for (const m of (bullet.match(metricRe) ?? [])) {
      const v = m.trim()
      if (v.length < 2 || /^\d$/.test(v)) continue // skip bare single digits
      if (summaryLower.includes(v.toLowerCase())) {
        signals.push({ type: 'metric', value: v, foundInBullet: truncate(bullet) })
      }
    }
  }

  // 2. Team size language: "N-person team", "team of N", "N engineers/developers"
  const teamRe = /\b\d+[-\s]?(?:person|member|engineer|developer|people)\s*team\b|\bteam\s+of\s+\d+\b|\b\d+[-\s]?engineers?\b|\b\d+[-\s]?developers?\b/gi
  for (const bullet of bulletLines) {
    for (const m of (bullet.match(teamRe) ?? [])) {
      if (summaryLower.includes(m.toLowerCase())) {
        signals.push({ type: 'team_size', value: m, foundInBullet: truncate(bullet) })
      }
    }
  }

  // 3. Sprint cadence: "N-week sprint", "bi-weekly sprint"
  const cadenceRe = /\b(?:\d+[-\s]?week|bi[-\s]?weekly|two[-\s]?week)\s*sprints?\b/gi
  for (const bullet of bulletLines) {
    for (const m of (bullet.match(cadenceRe) ?? [])) {
      if (summaryLower.includes(m.toLowerCase())) {
        signals.push({ type: 'cadence', value: m, foundInBullet: truncate(bullet) })
      }
    }
  }

  // 4. Known tools that appear in Experience bullets AND in Summary
  const significantTools = knownTools.filter(t => t.length >= 4 && !isAllowedSummaryConcept(t))
  for (const tool of significantTools) {
    const tl = tool.toLowerCase()
    const inExperience = bulletLines.some(b => b.toLowerCase().includes(tl))
    if (inExperience && summaryLower.includes(tl)) {
      const sourceBullet = bulletLines.find(b => b.toLowerCase().includes(tl)) ?? ''
      signals.push({ type: 'tool', value: tool, foundInBullet: truncate(sourceBullet) })
    }
  }

  // 5. Near-exact phrase matching: 6+ word sequences from Experience in Summary
  for (const bullet of bulletLines) {
    const words = bullet.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length >= 3)
    const NGRAM = 6
    for (let i = 0; i <= words.length - NGRAM; i++) {
      const phrase = words.slice(i, i + NGRAM).join(' ').toLowerCase()
      // Skip generic concept phrases that are OK in both sections
      if (
        /^(product owner|business analyst|product analyst|stakeholder alignment)/.test(phrase) ||
        isAllowedSummaryConcept(phrase)
      ) {
        i += NGRAM - 1
        continue
      }
      if (summaryLower.includes(phrase)) {
        signals.push({ type: 'phrase', value: phrase, foundInBullet: truncate(bullet) })
        i += NGRAM - 1 // skip overlapping ngrams
      }
    }
  }

  // Deduplicate by value+type
  const seen = new Set<string>()
  const unique = signals.filter(s => {
    const key = `${s.type}:${s.value.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { hasDuplication: unique.length > 0, duplicatedSignals: unique }
}

function truncate(s: string, max = 80): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ─── Post-generation validator ────────────────────────────────────────────────

export function validateResumeAgainstContract(
  text: string,
  contract: ResumeGenerationContract,
  knownTools: string[] = [],
): ContractValidationResult {
  const violations: ContractViolation[] = []

  const summaryText = extractSectionText(text, 'SUMMARY')
  const skillsText = extractSectionText(text, 'SKILLS')
  const experienceText = extractSectionText(text, 'EXPERIENCE')

  // Summary-vs-Experience de-duplication (highest priority — semantic error)
  if (summaryText && experienceText) {
    const dupResult = checkSummaryDuplication(summaryText, experienceText, knownTools)
    if (dupResult.hasDuplication) {
      const examples = dupResult.duplicatedSignals.slice(0, 3)
        .map(s => `"${s.value}" (${s.type})`)
        .join(', ')
      violations.push({
        rule: 'summary_duplicates_experience',
        section: 'summary',
        detail: `Summary repeats proof-level details from Experience: ${examples}. Move these to Experience only.`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
  }

  // Summary line count
  const summaryLines = countNonEmptyLines(summaryText)
  if (summaryLines > contract.sectionPlan.summary.maxLines) {
    violations.push({
      rule: 'summary_max_lines',
      section: 'summary',
      detail: `Summary has ${summaryLines} lines; max is ${contract.sectionPlan.summary.maxLines}`,
      canAutoRepair: false,
      severity: 'error',
    })
  }

  // Skills row count
  const skillsRows = countNonEmptyLines(skillsText)
  if (skillsRows > contract.sectionPlan.skills.maxRows) {
    violations.push({
      rule: 'skills_max_rows',
      section: 'skills',
      detail: `Skills has ${skillsRows} rows; max is ${contract.sectionPlan.skills.maxRows}`,
      canAutoRepair: false,
      severity: 'error',
    })
  }

  // Experience block bullet counts — use contract.sectionPlan to validate
  const blocks = parseExperienceBlocks(experienceText)
  const primaryBlocks = blocks.slice(0, 1)  // first block = primary role
  const secondaryBlocks = blocks.slice(1, 2) // second block = secondary role
  const supportingBlocks = blocks.slice(2)   // remaining = supporting

  const primaryBullets = primaryBlocks.reduce((s, b) => s + b.bullets.length, 0)
  const secondaryBullets = secondaryBlocks.reduce((s, b) => s + b.bullets.length, 0)
  const supportingBullets = supportingBlocks.reduce((s, b) => s + b.bullets.length, 0)

  if (primaryBlocks.length > 0) {
    if (primaryBullets < contract.sectionPlan.primaryRole.minBullets) {
      violations.push({
        rule: 'primary_min_bullets',
        section: 'experience-primary',
        detail: `Primary role has ${primaryBullets} bullets; min is ${contract.sectionPlan.primaryRole.minBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
    if (primaryBullets > contract.sectionPlan.primaryRole.maxBullets) {
      violations.push({
        rule: 'primary_max_bullets',
        section: 'experience-primary',
        detail: `Primary role has ${primaryBullets} bullets; max is ${contract.sectionPlan.primaryRole.maxBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
  }

  if (secondaryBlocks.length > 0) {
    if (secondaryBullets < contract.sectionPlan.secondaryRole.minBullets) {
      violations.push({
        rule: 'secondary_min_bullets',
        section: 'experience-secondary',
        detail: `Secondary role has ${secondaryBullets} bullets; min is ${contract.sectionPlan.secondaryRole.minBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
    if (secondaryBullets > contract.sectionPlan.secondaryRole.maxBullets) {
      violations.push({
        rule: 'secondary_max_bullets',
        section: 'experience-secondary',
        detail: `Secondary role has ${secondaryBullets} bullets; max is ${contract.sectionPlan.secondaryRole.maxBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
  }

  // Supporting role should not dominate for primary/secondary-focused resumes
  const isNonSupportingTarget = contract.targetRoleFamily !== 'supporting'
  if (isNonSupportingTarget && supportingBlocks.length > 0 && secondaryBlocks.length > 0 && supportingBullets > secondaryBullets) {
    violations.push({
      rule: 'supporting_exceeds_secondary',
      section: 'experience-supporting',
      detail: `Supporting role has ${supportingBullets} bullets but secondary role only has ${secondaryBullets} — supporting should not exceed secondary`,
      canAutoRepair: false,
      severity: 'error',
    })
  }

  // Banned phrases
  for (const phrase of contract.bannedPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(escaped, 'gi').test(text)) {
      violations.push({
        rule: 'banned_phrase',
        section: 'any',
        detail: `Banned phrase found: "${phrase}"`,
        canAutoRepair: phrase in contract.preferredReplacements,
        severity: 'error',
      })
    }
  }

  // Azure DevOps hard check (in case it slipped through repair)
  if (!contract.sessionDirection.azureDevOpsAllowed && /azure devops/i.test(text)) {
    violations.push({
      rule: 'azure_devops_banned',
      section: 'skills',
      detail: 'Azure DevOps appears but is not evidenced in profile',
      canAutoRepair: true,
      severity: 'error',
    })
  }

  // Salesforce Segmentation
  if (/salesforce segmentation/i.test(text)) {
    violations.push({
      rule: 'salesforce_segmentation',
      section: 'skills',
      detail: `"Salesforce Segmentation" found — use "${contract.sessionDirection.salesforcePreferredPhrase}" instead`,
      canAutoRepair: true,
      severity: 'error',
    })
  }

  // Travel willingness
  if (!contract.sessionDirection.travelResumeAllowed && /\btravel\b/i.test(text)) {
    violations.push({
      rule: 'travel_not_allowed',
      section: 'any',
      detail: 'Travel willingness mention found — belongs in cover letter only',
      canAutoRepair: true,
      severity: 'warning',
    })
  }

  // Roadmap overclaim
  if (
    /(?:own|define|set|drive)\s+(?:the\s+)?(?:full\s+)?product\s+(?:roadmap|strategy|vision)/i.test(text) ||
    /executive\s+product\s+strategy/i.test(text)
  ) {
    violations.push({
      rule: 'roadmap_overclaim',
      section: 'experience-primary',
      detail: 'Roadmap language may exceed leadership-sponsored execution boundary',
      canAutoRepair: false,
      severity: 'warning',
    })
  }

  // Required JD themes in bullets
  const searchSpace = (experienceText + ' ' + summaryText).toLowerCase()
  for (const theme of contract.requiredBulletThemes) {
    const terms = theme.split('/').map(t => t.trim().toLowerCase())
    const found = terms.some(term => term.split(' ').every(word => searchSpace.includes(word)))
    if (!found) {
      violations.push({
        rule: 'missing_jd_theme',
        section: 'experience',
        detail: `Required JD theme not found in resume: "${theme}"`,
        canAutoRepair: false,
        severity: 'warning',
      })
    }
  }

  const errors = violations.filter(v => v.severity === 'error')
  return {
    pass: errors.length === 0,
    violations,
    suggestedRepairs: violations.filter(v => v.canAutoRepair).map(v => v.detail),
  }
}

// ─── Extended validator (reads ResumeReadinessContract) ──────────────────────

export interface Stage4ValidationContext {
  knownTools?: string[]
  readinessContract?: ResumeReadinessContract
}

/**
 * Full Stage 4 output validator.
 * Runs all existing contract checks PLUS:
 *   - volume_metric_without_impact (when readinessContract.metricPolicy is set)
 *   - required_theme_only_in_skills (JD theme found in Skills but absent from Experience)
 */
export function validateStage4ResumeOutput(
  text: string,
  contract: ResumeGenerationContract,
  ctx: Stage4ValidationContext = {},
): ContractValidationResult {
  const base = validateResumeAgainstContract(text, contract, ctx.knownTools ?? [])

  if (!ctx.readinessContract) return base

  const extraViolations: ContractViolation[] = []
  const rc = ctx.readinessContract
  const skillsText = extractSectionText(text, 'SKILLS')
  const experienceText = extractSectionText(text, 'EXPERIENCE')

  // 1. Volume metrics without impact tie in experience bullets
  const experienceBullets = experienceText
    .split('\n')
    .filter(l => l.trim().startsWith('- '))
    .map(l => l.trim())

  const metricViolations = validateBulletMetrics(experienceBullets, rc.metricPolicy)
  for (const mv of metricViolations) {
    extraViolations.push({
      rule: 'volume_metric_without_impact',
      section: 'experience',
      detail: `Volume metric without impact tie: "${mv.metricSnippet || mv.bulletText.slice(0, 60)}"`,
      canAutoRepair: false,
      severity: mv.severity,
    })
  }

  // 2. Required JD themes that appear only in Skills, not in Experience
  const experienceLower = experienceText.toLowerCase()
  const skillsLower = skillsText.toLowerCase()
  for (const theme of rc.requiredExperienceThemes) {
    const terms = theme.split('/').map(t => t.trim().toLowerCase())
    const inExperience = terms.some(term =>
      term.split(' ').every(word => word.length <= 2 || experienceLower.includes(word)),
    )
    const inSkillsOnly =
      !inExperience &&
      terms.some(term =>
        term.split(' ').some(word => word.length > 3 && skillsLower.includes(word)),
      )
    if (inSkillsOnly) {
      extraViolations.push({
        rule: 'required_theme_only_in_skills',
        section: 'experience',
        detail: `Required theme "${theme}" found in Skills but not in Experience bullets — must be proven, not just listed.`,
        canAutoRepair: false,
        severity: 'warning',
      })
    }
  }

  const allViolations = [...base.violations, ...extraViolations]
  const errors = allViolations.filter(v => v.severity === 'error')
  return {
    pass: errors.length === 0,
    violations: allViolations,
    suggestedRepairs: allViolations.filter(v => v.canAutoRepair).map(v => v.detail),
  }
}

// ─── Deterministic repair ─────────────────────────────────────────────────────

export interface RepairResult {
  repairedText: string
  repairsApplied: string[]
}

export function applyDeterministicRepairs(
  text: string,
  contract: ResumeGenerationContract,
  context: 'fullText' | 'section' = 'section'
): RepairResult {
  let result = text
  const repairsApplied: string[] = []

  // Phrase replacements (case-insensitive, globally)
  for (const [phrase, replacement] of Object.entries(contract.preferredReplacements)) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    if (regex.test(result)) {
      result = result.replace(regex, replacement)
      repairsApplied.push(`Replaced "${phrase}" → "${replacement}"`)
    }
  }

  // Azure DevOps removal
  if (!contract.sessionDirection.azureDevOpsAllowed && /azure devops/i.test(result)) {
    if (context === 'fullText') {
      result = removeToolFromSkillsSection(result, 'Azure DevOps')
    } else {
      result = result
        .replace(/,\s*Azure DevOps/gi, '')
        .replace(/Azure DevOps\s*,\s*/gi, '')
        .replace(/Azure DevOps/gi, '')
    }
    repairsApplied.push('Removed Azure DevOps (not evidenced in profile)')
  }

  // Travel willingness removal
  if (!contract.sessionDirection.travelResumeAllowed && /\btravel\b/i.test(result)) {
    const before = result
    result = result
      .split('\n')
      .filter(line => !/\btravel\b/i.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
    if (result !== before) {
      repairsApplied.push('Removed travel willingness mention')
    }
  }

  return { repairedText: result.trim() ? result : text, repairsApplied }
}

// ─── Prompt serialization ─────────────────────────────────────────────────────

export function serializeContractForPrompt(contract: ResumeGenerationContract): string {
  const { sectionPlan: sp, sessionDirection: sd } = contract
  const lines: string[] = [
    '',
    '── RESUME GENERATION CONTRACT (deterministic rules — not negotiable) ──',
    '',
    `Role: ${contract.targetRoleFamily}  |  Posture: ${contract.targetPosture}`,
    '',
    'SECTION PURPOSE CONTRACT:',
    '  Summary — positions only. Target-role identity, core differentiators, high-level fit.',
    '    ✗ NO proof-level detail: team sizes, sprint cadence, release counts, specific metrics,',
    '      specific tools used in Evidence bullets, platform names already proven in Experience.',
    '    ✓ OK: concept-level language (backlog execution, business-to-IT translation, UAT coordination).',
    '  Skills — compact ATS keyword support only. Not the primary fit argument.',
    '  Experience — the proof section. Scope, methods, tools, metrics, outcomes, tradeoffs belong here.',
    '  Education — credential facts only. Compact.',
    '',
    'DE-DUPLICATION RULE:',
    '  If a metric, tool, team size, cadence, or phrase already appears in an Experience bullet,',
    '  it must NOT appear in the Summary in the same level of detail.',
    '  The Summary may reference the same concept at a higher level only.',
    '',
    'SECTION LIMITS:',
    `  Summary: max ${sp.summary.maxLines} lines`,
    `  Skills: max ${sp.skills.maxRows} rows`,
    `  Primary role: ${sp.primaryRole.minBullets}–${sp.primaryRole.maxBullets} bullets`,
    `  Secondary role: ${sp.secondaryRole.minBullets}–${sp.secondaryRole.maxBullets} bullets`,
    `  Supporting role: ${sp.supportingRole.minBullets}–${sp.supportingRole.maxBullets} bullets${contract.targetRoleFamily !== 'supporting' ? ' (supporting only)' : ''}`,
    '',
    'SESSION DIRECTION:',
    `  Primary role: ${sd.representPrimaryRole ? 'YES — treat first work history entry as primary role; no title hedging' : 'not set'}`,
    `  Avoid title hedging: ${sd.avoidFormalTitleHedging ? 'YES — no defensive PO title language' : 'no'}`,
    `  Roadmap boundary: ${sd.roadmapBoundary}`,
    `  Azure DevOps: ${sd.azureDevOpsAllowed ? 'allowed' : 'NOT allowed — use Jira'}`,
    `  Travel in resume: ${sd.travelResumeAllowed ? 'allowed' : 'NOT allowed — cover letter only'}`,
    `  Salesforce phrase: use "${sd.salesforcePreferredPhrase}" (never "Salesforce Segmentation")`,
    '',
    'BANNED PHRASES:',
    ...contract.bannedPhrases.map(p => `  ✗ "${p}"`),
    '',
    'REQUIRED JD THEMES (must appear in Experience bullets, not only Skills):',
    ...(contract.requiredBulletThemes.length
      ? contract.requiredBulletThemes.map(t => `  · ${t}`)
      : ['  (none derived from JD)']),
    '── END CONTRACT ──',
    '',
  ]
  return lines.join('\n')
}

// ─── Readiness contract serializer ──────────────────────────────────────────

export function serializeReadinessContractForPrompt(rc: ResumeReadinessContract): string {
  const { sectionPlan: sp, metricPolicy: mp, summaryPolicy: sup } = rc
  const lines: string[] = [
    '',
    '── RESUME READINESS CONTRACT (pre-generation rules — non-negotiable) ──',
    '',
    `Role: ${rc.targetRoleFamily}  |  Posture: ${rc.targetPosture}`,
    '',
    'SECTION PURPOSE CONTRACT:',
    '  Summary — positions only. No proof-level details from Experience.',
    '  Skills — compact ATS keyword support. Not the primary fit argument.',
    '  Experience — the proof section. Scope, methods, tools, metrics, outcomes.',
    '  Education — credential facts only.',
    '',
    'SECTION LIMITS:',
    `  Summary: max ${sp.summary.maxApproxLines} lines / ${sp.summary.maxSentences} sentences`,
    `  Skills: max ${sp.skills.maxRows} rows`,
    `  Primary experience: ${sp.primaryExperience.minBullets}–${sp.primaryExperience.maxBullets} bullets`,
    `  Secondary experience: ${sp.secondaryExperience.minBullets}–${sp.secondaryExperience.maxBullets} bullets`,
    `  Earlier/supporting: max ${sp.earlierExperience.maxBullets} bullets`,
    '',
    'METRIC POLICY:',
    `  Prefer impact over volume: ${mp.preferImpactOverVolume ? 'YES' : 'no'}`,
    `  Volume metrics require impact tie: ${mp.volumeMetricsRequireImpactTie ? 'YES — every count must answer "so what?"' : 'no'}`,
    '',
    'SUMMARY POLICY:',
    `  No proof-level duplication: ${sup.noProofLevelDuplication ? 'YES' : 'no'}`,
    `  No team size if in Experience: ${sup.noTeamSizeIfInExperience ? 'YES' : 'no'}`,
    `  No cadence if in Experience: ${sup.noCadenceIfInExperience ? 'YES' : 'no'}`,
    `  No metrics if in Experience: ${sup.noMetricsIfInExperience ? 'YES' : 'no'}`,
    `  No tool details if in Experience: ${sup.noToolDetailsIfInExperience ? 'YES' : 'no'}`,
    '',
    'DISALLOWED TOOLS (insufficient evidence — do not include):',
    ...(rc.disallowedTools.length
      ? rc.disallowedTools.map(t => `  ✗ ${t}`)
      : ['  (none)']),
    '',
    'REQUIRED EXPERIENCE THEMES (must appear in bullets, not only Skills):',
    ...(rc.requiredExperienceThemes.length
      ? rc.requiredExperienceThemes.map(t => `  · ${t}`)
      : ['  (none derived from JD)']),
    '',
    'BANNED PHRASES:',
    ...(rc.bannedPhrases.length
      ? rc.bannedPhrases.map(p => `  ✗ "${p}"`)
      : ['  (none)']),
    '── END READINESS CONTRACT ──',
    '',
  ]
  return lines.join('\n')
}

// ─── Text parsing helpers ─────────────────────────────────────────────────────

function extractSectionText(text: string, header: string): string {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(?:^|\\n)${escaped}\\n([\\s\\S]*?)(?=\\n[A-Z]{2,}\\n|$)`)
  return regex.exec(text)?.[1]?.trim() ?? ''
}

function countNonEmptyLines(text: string): number {
  return text.split('\n').filter(l => l.trim().length > 0).length
}

interface ExperienceBlock {
  title: string
  bullets: string[]
}

function parseExperienceBlocks(experienceText: string): ExperienceBlock[] {
  if (!experienceText.trim()) return []
  const rawBlocks = experienceText.split(/\n\n+/)
  return rawBlocks
    .map(block => {
      const lines = block.trim().split('\n').filter(l => l.trim())
      if (lines.length === 0) return null
      const title = lines[0].trim()
      const bullets = lines.filter(l => l.trim().startsWith('- '))
      return bullets.length > 0 ? { title, bullets } : null
    })
    .filter((b): b is ExperienceBlock => b !== null)
}

function removeToolFromSkillsSection(text: string, tool: string): string {
  const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text
    .split('\n')
    .map(line => {
      if (!new RegExp(escaped, 'i').test(line)) return line
      // Remove from comma-separated skills line
      const cleaned = line
        .replace(new RegExp(`,\\s*${escaped}`, 'gi'), '')
        .replace(new RegExp(`${escaped}\\s*,\\s*`, 'gi'), '')
        .replace(new RegExp(escaped, 'gi'), '')
        .replace(/:\s*,/, ':')
        .trim()
      // Drop the line entirely if it became empty after the colon
      const afterColon = cleaned.includes(':') ? cleaned.split(':')[1]?.trim() : cleaned.trim()
      return afterColon ? cleaned : ''
    })
    .filter(l => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
