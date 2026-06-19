import type {
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeStrategyBrief,
  ResumeWritingRuleset,
} from '@/contracts'
import { buildDefaultResumeWritingRuleset } from './resume-writing-ruleset'

export interface BuildResumeStrategyBriefInput {
  jdMap: JDRequirementMap
  blueprint?: ResumeGenerationContract | string
  ruleset?: ResumeWritingRuleset
  targetRole?: string
}

export function buildResumeStrategyBrief(input: BuildResumeStrategyBriefInput): ResumeStrategyBrief {
  const ruleset = input.ruleset ?? buildDefaultResumeWritingRuleset()
  const selectedSourceRules = ruleset.sourceBackedRules.filter(rule =>
    rule.appliesToRoleFamilies.some(roleFamily => targetMatchesRoleFamily(input, roleFamily)),
  )
  const selectedRuleIds = selectedSourceRules.map(rule => rule.id)
  const selectedSourceBasis = ruleset.sourceBasis
    .map(source => ({
      ...source,
      ruleIds: source.ruleIds.filter(ruleId => selectedRuleIds.includes(ruleId)),
    }))
    .filter(source => source.ruleIds.length > 0)
  const blueprintStrategy = typeof input.blueprint === 'string'
    ? input.blueprint
    : input.blueprint
      ? [
          input.blueprint.targetPosture,
          `Role family: ${input.blueprint.targetRoleFamily}.`,
          `Summary max lines: ${input.blueprint.sectionPlan.summary.maxLines}.`,
          `Skills max rows: ${input.blueprint.sectionPlan.skills.maxRows}.`,
        ].join(' ')
      : ''

  const jdCriticalThemes = input.jdMap.required.map(requirement => ({
    theme: requirement.text,
    mustAppearIn: ['experience'],
    evidenceRequired: true,
  }))

  return {
    sourceBasis: selectedSourceBasis,
    activeRuleIds: selectedRuleIds,
    targetRoleStrategy: [input.targetRole, blueprintStrategy]
      .filter(Boolean)
      .join(' - ')
      .trim() || input.jdMap.realJobFunction || 'Target role strategy follows the session Blueprint.',
    sectionPurpose: {
      ...ruleset.sectionPurposeGuidance,
      summary: appendRules(ruleset.sectionPurposeGuidance.summary, selectedSourceRules, 'summaryPurpose'),
      skills: appendRules(ruleset.sectionPurposeGuidance.skills, selectedSourceRules, 'skillsPurpose'),
    },
    jdCriticalThemes,
    bulletConstructionRules: [
      ...ruleset.bulletConstructionRules,
      ...textsForCategory(selectedSourceRules, 'bulletConstruction'),
    ],
    metricUseRules: ruleset.metricUseRules,
    executivePresenceRules: [
      ...ruleset.executivePresenceRules,
      ...textsForCategory(selectedSourceRules, 'executivePresence'),
    ],
    antiPatternsToAvoid: [
      ...ruleset.antiPatternsToAvoid,
      ...ruleset.jdAlignmentRules,
      ...ruleset.productOwnerAgileScrumProofRules,
      ...textsForCategory(selectedSourceRules, 'jdAlignment'),
      ...textsForCategory(selectedSourceRules, 'productOwnerAgileScrumProof'),
      ...textsForCategory(selectedSourceRules, 'antiPattern'),
    ],
    rewritePreferences: [
      ...ruleset.rewritePreferences,
      ...textsForCategory(selectedSourceRules, 'rewritePreference'),
    ],
  }
}

function targetMatchesRoleFamily(input: BuildResumeStrategyBriefInput, roleFamily: string): boolean {
  const targetText = [
    input.targetRole,
    input.jdMap.realJobFunction,
    typeof input.blueprint === 'string' ? input.blueprint : input.blueprint?.targetRoleFamily,
    typeof input.blueprint === 'string' ? '' : input.blueprint?.targetPosture,
  ].filter(Boolean).join(' ').toLowerCase()

  if (roleFamily === 'primary') return /\b(product owner|po|scrum product owner)\b/.test(targetText)
  if (roleFamily === 'secondary') return /\b(product analyst)\b/.test(targetText)
  if (roleFamily === 'primary') return /\b(associate product manager|apm)\b/.test(targetText)
  if (roleFamily === 'secondary') return /\b(business analyst|ba)\b/.test(targetText)
  if (roleFamily === 'it_product') return /\b(it product|technology product|product management|product role)\b/.test(targetText)
  return targetText.includes(roleFamily.replace(/_/g, ' '))
}

function textsForCategory(
  rules: ResumeWritingRuleset['sourceBackedRules'],
  category: ResumeWritingRuleset['sourceBackedRules'][number]['category'],
): string[] {
  return rules.filter(rule => rule.category === category).map(rule => rule.text)
}

function appendRules(
  base: string,
  rules: ResumeWritingRuleset['sourceBackedRules'],
  category: ResumeWritingRuleset['sourceBackedRules'][number]['category'],
): string {
  const additions = textsForCategory(rules, category)
  return additions.length ? [base, ...additions].join(' ') : base
}

export function serializeResumeStrategyBriefForPrompt(brief: ResumeStrategyBrief | undefined): string {
  if (!brief) return ''
  return [
    'RESUME STRATEGY BRIEF:',
    `Target role strategy: ${brief.targetRoleStrategy}`,
    '',
    'Section purpose:',
    `  Summary: ${brief.sectionPurpose.summary}`,
    `  Skills: ${brief.sectionPurpose.skills}`,
    `  Experience: ${brief.sectionPurpose.experience}`,
    `  Education: ${brief.sectionPurpose.education}`,
    '',
    'JD-critical themes:',
    ...brief.jdCriticalThemes.map(theme =>
      `  - ${theme.theme} | must appear in: ${theme.mustAppearIn.join(', ')} | evidence required: ${theme.evidenceRequired}`,
    ),
    '',
    'Bullet construction rules:',
    ...brief.bulletConstructionRules.map(rule => `  - ${rule}`),
    '',
    'Metric use rules:',
    ...brief.metricUseRules.map(rule => `  - ${rule}`),
    '',
    'Executive presence rules:',
    ...brief.executivePresenceRules.map(rule => `  - ${rule}`),
    '',
    'Anti-patterns to avoid:',
    ...brief.antiPatternsToAvoid.map(rule => `  - ${rule}`),
    '',
    'Rewrite preferences:',
    ...brief.rewritePreferences.map(rule => `  - ${rule}`),
  ].join('\n')
}
