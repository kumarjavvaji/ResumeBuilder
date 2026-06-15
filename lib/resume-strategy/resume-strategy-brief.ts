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
    targetRoleStrategy: [input.targetRole, blueprintStrategy]
      .filter(Boolean)
      .join(' - ')
      .trim() || input.jdMap.realJobFunction || 'Target role strategy follows the session Blueprint.',
    sectionPurpose: ruleset.sectionPurposeGuidance,
    jdCriticalThemes,
    bulletConstructionRules: ruleset.bulletConstructionRules,
    metricUseRules: ruleset.metricUseRules,
    executivePresenceRules: ruleset.executivePresenceRules,
    antiPatternsToAvoid: [
      ...ruleset.antiPatternsToAvoid,
      ...ruleset.jdAlignmentRules,
      ...ruleset.productOwnerAgileScrumProofRules,
    ],
    rewritePreferences: ruleset.rewritePreferences,
  }
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
