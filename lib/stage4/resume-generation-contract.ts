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
  const representPOFrom2021 = detectPOFrom2021(overallRefinementPrompt, profile)
  const avoidFormalTitleHedging =
    representPOFrom2021 ||
    /hedg|PO-adjacent|acting PO|informal PO/i.test(overallRefinementPrompt)

  const salesforcePreferredPhrase = detectSalesforcePhrase(overallRefinementPrompt)

  const sessionDirection: Stage4SessionDirection = {
    representPOFrom2021,
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
    preferredReplacements['formal PO title experience'] = '3.5 years leading backlog execution'
    preferredReplacements['formal PO tenure'] = '3.5 years leading backlog execution'
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

  const jdHasSupplyChain = /supply chain|distribution|logistics|cpg|enterprise it/i.test(jdText)

  const evidenceRouting: Record<string, string[]> = {
    CSPO: ['summary', 'education'],
    Jira: ['skills', 'experience-po', 'experience-ba'],
    Pendo: ['skills', 'experience-po', 'experience-ba'],
    'travel willingness': [],
    'Azure DevOps': azureDevOpsAllowed ? ['skills'] : [],
    'roadmap ownership': ['experience-po'],
    GAINSystems: jdHasSupplyChain ? ['summary'] : [],
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
  if (emphasis === 'QA') return 'qa'
  if (emphasis === 'data') return 'product_analyst'
  if (emphasis === 'BA') return 'business_analyst'
  if (emphasis === 'PO') {
    return roleTitleLower.includes('associate') ? 'associate_pm' : 'product_owner'
  }
  if (
    roleTitleLower.includes('associate') &&
    (roleTitleLower.includes('product') || roleTitleLower.includes(' pm') || roleTitleLower.includes('manager'))
  ) {
    return 'associate_pm'
  }
  if (roleTitleLower.includes('product owner')) return 'product_owner'
  if (roleTitleLower.includes('business analyst') || roleTitleLower.includes(' ba ')) return 'business_analyst'
  if (roleTitleLower.includes('product analyst')) return 'product_analyst'
  return 'other'
}

function defaultSectionPlan(roleFamily: Stage4RoleFamily): Stage4SectionPlan {
  const isQA = roleFamily === 'qa'
  return {
    summary: { maxLines: 4 },
    skills: { maxRows: 5 },
    productOwner: { minBullets: 5, maxBullets: 6 },
    productAnalyst: { minBullets: 4, maxBullets: 5 },
    qa: {
      minBullets: isQA ? 5 : 3,
      maxBullets: isQA ? 6 : 4,
    },
    education: { maxLines: 3 },
  }
}

function deriveTargetPosture(roleFamily: Stage4RoleFamily, roleTitleLower: string): string {
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

// ─── Session direction helpers ────────────────────────────────────────────────

function detectPOFrom2021(overallPrompt: string, profile: UserProfile): boolean {
  if (/2021.*product owner|product owner.*2021|march 2021|treat.*2021|represent.*2021/i.test(overallPrompt)) return true
  if (/treat.*product owner|represent.*product owner/i.test(overallPrompt)) return true
  return profile.workHistory.some(
    w => /product owner/i.test(w.title) && (w.startDate?.includes('2021') || w.startDate?.includes('Mar 2021'))
  )
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

  // Experience block bullet counts
  const blocks = parseExperienceBlocks(experienceText)
  const poBullets = blocks.filter(b => /product owner/i.test(b.title)).reduce((s, b) => s + b.bullets.length, 0)
  const paBullets = blocks
    .filter(b => /product analyst|business analyst/i.test(b.title))
    .reduce((s, b) => s + b.bullets.length, 0)
  const qaBullets = blocks
    .filter(b => /test engineer|qa engineer|quality|software test/i.test(b.title))
    .reduce((s, b) => s + b.bullets.length, 0)

  const poBlocks = blocks.filter(b => /product owner/i.test(b.title))
  if (poBlocks.length > 0) {
    if (poBullets < contract.sectionPlan.productOwner.minBullets) {
      violations.push({
        rule: 'po_min_bullets',
        section: 'experience-po',
        detail: `Product Owner has ${poBullets} bullets; min is ${contract.sectionPlan.productOwner.minBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
    if (poBullets > contract.sectionPlan.productOwner.maxBullets) {
      violations.push({
        rule: 'po_max_bullets',
        section: 'experience-po',
        detail: `Product Owner has ${poBullets} bullets; max is ${contract.sectionPlan.productOwner.maxBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
  }

  const paBlocks = blocks.filter(b => /product analyst|business analyst/i.test(b.title))
  if (paBlocks.length > 0) {
    if (paBullets < contract.sectionPlan.productAnalyst.minBullets) {
      violations.push({
        rule: 'pa_min_bullets',
        section: 'experience-ba',
        detail: `Product Analyst has ${paBullets} bullets; min is ${contract.sectionPlan.productAnalyst.minBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
    if (paBullets > contract.sectionPlan.productAnalyst.maxBullets) {
      violations.push({
        rule: 'pa_max_bullets',
        section: 'experience-ba',
        detail: `Product Analyst has ${paBullets} bullets; max is ${contract.sectionPlan.productAnalyst.maxBullets}`,
        canAutoRepair: false,
        severity: 'error',
      })
    }
  }

  // QA should not dominate for product / BA roles
  const isProductRole = [
    'product_owner',
    'associate_pm',
    'product_analyst',
    'business_analyst',
  ].includes(contract.targetRoleFamily)
  const qaBlocks = blocks.filter(b => /test engineer|qa engineer|quality|software test/i.test(b.title))
  if (isProductRole && qaBlocks.length > 0 && paBlocks.length > 0 && qaBullets > paBullets) {
    violations.push({
      rule: 'qa_exceeds_pa',
      section: 'experience-qa',
      detail: `QA has ${qaBullets} bullets but PA only has ${paBullets} — QA should not exceed PA for product/BA roles`,
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
      section: 'experience-po',
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
    `  Product Owner: ${sp.productOwner.minBullets}–${sp.productOwner.maxBullets} bullets`,
    `  Product Analyst/BA: ${sp.productAnalyst.minBullets}–${sp.productAnalyst.maxBullets} bullets`,
    `  QA: ${sp.qa.minBullets}–${sp.qa.maxBullets} bullets${contract.targetRoleFamily !== 'qa' ? ' (supporting only)' : ''}`,
    '',
    'SESSION DIRECTION:',
    `  PO from 2021: ${sd.representPOFrom2021 ? 'YES — March 2021–October 2024 is Product Owner; no title hedging' : 'not set'}`,
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
