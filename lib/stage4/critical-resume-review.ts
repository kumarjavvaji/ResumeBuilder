import type {
  ContractValidationResult,
  CriticalResumeIssueType,
  CriticalResumeReview,
  CriticalResumeSectionPurpose,
  JDRequirementMap,
  ResumeStrategyBrief,
  RewriteDirective,
  SectionFinding,
} from '@/contracts'
import { serializeResumeStrategyBriefForPrompt } from '@/lib/resume-strategy/resume-strategy-brief'

export interface ReviewEvidenceItem {
  id: string
  text: string
  allowedSections: string[]
  confidence?: 'high' | 'medium' | 'low'
}

export interface ReviewSectionStrategy {
  sectionKey: string
  sectionPurpose: CriticalResumeSectionPurpose
  requiredThemes: string[]
  allowedEvidenceIds: string[]
  metricPreference?: 'impact_first' | 'scope_context' | 'technical_depth' | 'volume_ok_if_contextualized'
  authorityBoundary?: string
}

export interface CriticalResumeReviewInput {
  targetJd: JDRequirementMap
  resumeBlueprint: string
  evidenceMap: ReviewEvidenceItem[]
  sectionStrategies: ReviewSectionStrategy[]
  artifactText: string
  deterministicValidation?: ContractValidationResult
  userSessionDecisions?: Record<string, unknown>
  bannedPhrases?: string[]
  unsupportedClaimsOrTools?: string[]
  acceptedCalibrationNotes?: string[]
  strategyBrief?: ResumeStrategyBrief
}

const ARTIFACT_STATUSES = new Set(['ready', 'needs_targeted_rewrite', 'needs_regeneration', 'blocked_by_missing_evidence'])
const SECTION_PURPOSES = new Set(['positioning', 'ats_support', 'proof', 'credentials'])
const ISSUE_TYPES = new Set<CriticalResumeIssueType>([
  'summary_recap_instead_of_positioning',
  'summary_duplicates_proof',
  'skills_overloaded',
  'skills_carry_fit_without_experience_proof',
  'jd_theme_missing_from_proof',
  'volume_led_bullet',
  'task_led_bullet',
  'process_led_bullet',
  'hollow_bullet',
  'weak_metric_framing',
  'impact_gap',
  'judgment_gap',
  'authority_boundary_violation',
  'overclaiming',
  'underclaiming',
  'evidence_misrouting',
  'unsupported_claim',
  'unsupported_tool',
  'weak_executive_presence',
  'poor_section_ordering',
  'credential_incomplete',
])
const DIRECTIVE_ACTIONS = new Set([
  'rewrite',
  'replace',
  'remove',
  'reorder',
  'expand',
  'compress',
  'move',
  'convert_volume_to_impact',
  'convert_task_to_judgment',
  'add_jd_proof',
  'clarify_authority_boundary',
  'complete_credential',
])

export const CRITICAL_RESUME_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['artifactStatus', 'reviewSummary', 'sectionFindings', 'rewriteDirectives', 'blockedQuestions'],
  properties: {
    artifactStatus: { enum: [...ARTIFACT_STATUSES] },
    reviewSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'primaryReason'],
      properties: {
        decision: { type: 'string' },
        primaryReason: { type: 'string' },
        noRewriteNeededReason: { type: 'string' },
      },
    },
    sectionFindings: { type: 'array' },
    rewriteDirectives: { type: 'array' },
    blockedQuestions: { type: 'array' },
  },
} as const

export function buildCriticalResumeReviewPrompt(input: CriticalResumeReviewInput): {
  system: string
  user: string
  jsonSchema: typeof CRITICAL_RESUME_REVIEW_JSON_SCHEMA
} {
  return {
    system: [
      'You are a constrained Critical Resume Reviewer, an editorial gate rather than a freeform writer.',
      'Return strict JSON only matching the provided schema. Do not include scores, numeric ratings, praise, markdown, or a rewritten resume.',
      'Use only the target JD, blueprint, evidence map, section strategy, validation results, user decisions, banned terms, and calibration notes provided.',
      'For each must_fix issue, provide an executable rewrite directive with target scope, allowed evidence IDs, must-preserve facts, must-avoid terms, and success criteria.',
    ].join('\n'),
    user: [
      'TARGET JD:',
      JSON.stringify(input.targetJd, null, 2),
      '',
      'RESUME BLUEPRINT:',
      input.resumeBlueprint,
      '',
      'EVIDENCE MAP:',
      JSON.stringify(input.evidenceMap, null, 2),
      '',
      'SECTION STRATEGY:',
      JSON.stringify(input.sectionStrategies, null, 2),
      '',
      serializeResumeStrategyBriefForPrompt(input.strategyBrief),
      '',
      'DETERMINISTIC VALIDATION:',
      JSON.stringify(input.deterministicValidation ?? null, null, 2),
      '',
      'USER / SESSION DECISIONS:',
      JSON.stringify(input.userSessionDecisions ?? {}, null, 2),
      '',
      'BANNED PHRASES / UNSUPPORTED CLAIMS:',
      JSON.stringify({
        bannedPhrases: input.bannedPhrases ?? [],
        unsupportedClaimsOrTools: input.unsupportedClaimsOrTools ?? [],
      }, null, 2),
      '',
      'ACCEPTED CALIBRATION NOTES:',
      JSON.stringify(input.acceptedCalibrationNotes ?? [], null, 2),
      '',
      'ARTIFACT TO REVIEW:',
      input.artifactText,
    ].join('\n'),
    jsonSchema: CRITICAL_RESUME_REVIEW_JSON_SCHEMA,
  }
}

export function validateCriticalResumeReviewOutput(value: unknown): CriticalResumeReview {
  assertNoScoreFields(value)
  if (!isRecord(value)) throw new Error('Critical review must be an object.')
  if (!ARTIFACT_STATUSES.has(String(value.artifactStatus))) throw new Error('Invalid artifactStatus.')
  if (!isRecord(value.reviewSummary)) throw new Error('reviewSummary is required.')
  if (typeof value.reviewSummary.decision !== 'string') throw new Error('reviewSummary.decision is required.')
  if (typeof value.reviewSummary.primaryReason !== 'string') throw new Error('reviewSummary.primaryReason is required.')
  if (!Array.isArray(value.sectionFindings)) throw new Error('sectionFindings must be an array.')
  if (!Array.isArray(value.rewriteDirectives)) throw new Error('rewriteDirectives must be an array.')
  if (!Array.isArray(value.blockedQuestions)) throw new Error('blockedQuestions must be an array.')

  for (const finding of value.sectionFindings) validateSectionFinding(finding)
  for (const directive of value.rewriteDirectives) validateRewriteDirective(directive)

  return value as unknown as CriticalResumeReview
}

export function reviewCriticalResumeArtifact(input: CriticalResumeReviewInput): CriticalResumeReview {
  const sections = parseResumeSections(input.artifactText)
  const findings: SectionFinding[] = []

  const summary = sections.get('summary')
  if (summary) findings.push(reviewSummarySection(summary, sections, input))

  const skills = sections.get('skills')
  if (skills) findings.push(reviewSkillsSection(skills, sections, input))

  const firstProof = input.sectionStrategies.find(s => s.sectionPurpose === 'proof')
  const experience = sections.get(firstProof?.sectionKey ?? 'experience') ?? sections.get('experience')
  if (experience && firstProof) findings.push(reviewExperienceSection(firstProof, experience, input))

  const rewriteDirectives = findings.flatMap(finding =>
    finding.findings
      .filter(issue => issue.severity === 'must_fix')
      .map((issue, index) => issueToDirective(finding.sectionKey, issue, index)),
  )

  const mustFixCount = findings.flatMap(f => f.findings).filter(f => f.severity === 'must_fix').length
  const artifactStatus = mustFixCount > 0 ? 'needs_targeted_rewrite' : 'ready'

  return {
    artifactStatus,
    reviewSummary: {
      decision: artifactStatus,
      primaryReason: mustFixCount > 0
        ? `${mustFixCount} must-fix issue(s) require targeted rewrite.`
        : 'No must-fix editorial issues found.',
      noRewriteNeededReason: mustFixCount === 0 ? 'Sections satisfy the configured review strategy.' : undefined,
    },
    sectionFindings: findings,
    rewriteDirectives,
    blockedQuestions: [],
  }
}

export function executeRewriteDirective(input: {
  fullText: string
  directive: RewriteDirective
  revisedText: string
}): string {
  const referencedEvidenceIds = Array.from(input.revisedText.matchAll(/\bE\d+\b/g)).map(m => m[0])
  const unsupportedRefs = referencedEvidenceIds.filter(id => !input.directive.allowedEvidenceIds.includes(id))
  if (unsupportedRefs.length > 0) {
    throw new Error(`Rewrite references evidence outside directive boundary: ${unsupportedRefs.join(', ')}`)
  }

  return replaceSection(input.fullText, input.directive.targetSection, input.revisedText)
}

function reviewSummarySection(
  summary: string,
  sections: Map<string, string>,
  input: CriticalResumeReviewInput,
): SectionFinding {
  const issues: SectionFinding['findings'] = []
  const experience = sections.get('experience') ?? ''
  const proofSignals = extractProofSignals(experience)
  const duplicated = proofSignals.find(signal => summary.toLowerCase().includes(signal.toLowerCase()))

  if (duplicated) {
    issues.push(makeIssue({
      issueType: 'summary_duplicates_proof',
      excerpt: duplicated,
      whyItFails: 'Summary repeats proof-level details that belong in Experience.',
      desiredStrategy: 'Keep Summary at role identity, target fit, and differentiator level.',
      rewriteHint: 'Remove repeated proof details and replace with high-level positioning.',
      allowedEvidenceIds: allEvidenceIds(input),
    }))
  }

  if (/\b\d+\s*(?:developers?|engineers?|qa|stakeholders?)\b|\b\d+[-\s]?week\b|\b\d+%|\$\d+/i.test(summary)) {
    issues.push(makeIssue({
      issueType: 'summary_recap_instead_of_positioning',
      excerpt: summary,
      whyItFails: 'Summary is carrying bullet-level proof instead of positioning.',
      desiredStrategy: 'Use target identity, core fit, and one or two differentiators.',
      rewriteHint: 'Compress proof details into capability language; leave metrics and team size in Experience.',
      allowedEvidenceIds: allEvidenceIds(input),
    }))
  }

  return sectionResult('summary', 'positioning', issues)
}

function reviewSkillsSection(
  skills: string,
  sections: Map<string, string>,
  input: CriticalResumeReviewInput,
): SectionFinding {
  const issues: SectionFinding['findings'] = []
  const experience = sections.get('experience') ?? ''
  const requiredThemes = input.strategyBrief?.jdCriticalThemes.map(theme => theme.theme)
    ?? input.targetJd.required.map(r => r.text)

  for (const theme of requiredThemes) {
    if (containsTheme(skills, theme) && !containsTheme(experience, theme)) {
      issues.push(makeIssue({
        issueType: 'skills_carry_fit_without_experience_proof',
        excerpt: theme,
        whyItFails: 'A JD-critical theme appears in Skills but is not proven in Experience.',
        desiredStrategy: 'Skills may support ATS matching, but Experience must carry primary proof.',
        rewriteHint: 'Add proof for this theme to the configured proof section using allowed evidence.',
        allowedEvidenceIds: evidenceIdsForTheme(input, theme),
      }))
    }
  }

  return sectionResult('skills', 'ats_support', issues)
}

function reviewExperienceSection(
  strategy: ReviewSectionStrategy,
  sectionText: string,
  input: CriticalResumeReviewInput,
): SectionFinding {
  const issues: SectionFinding['findings'] = []
  const bullets = sectionText.split('\n').map(l => l.trim()).filter(l => l.startsWith('- '))

  for (const bullet of bullets) {
    if (isVolumeLed(bullet, input.strategyBrief)) {
      issues.push(makeIssue({
        issueType: 'volume_led_bullet',
        excerpt: bullet,
        whyItFails: 'The bullet uses workload volume as fake proof without explaining the decision or impact.',
        desiredStrategy: 'Lead with impact, decision quality, risk reduction, or support reduction.',
        rewriteHint: 'Convert the volume statement into an impact-led or judgment-led bullet.',
        allowedEvidenceIds: strategy.allowedEvidenceIds,
        action: 'convert_volume_to_impact',
      }))
    } else if (isTaskLed(bullet, input.strategyBrief)) {
      issues.push(makeIssue({
        issueType: 'task_led_bullet',
        excerpt: bullet,
        whyItFails: 'The bullet describes activity without decision value or outcome.',
        desiredStrategy: 'Show operator judgment, tradeoff, readiness, or measurable effect.',
        rewriteHint: 'Rewrite to lead with the decision or risk reduced, not the task performed.',
        allowedEvidenceIds: strategy.allowedEvidenceIds,
        action: 'convert_task_to_judgment',
      }))
    }
  }

  return sectionResult(strategy.sectionKey, 'proof', issues)
}

function issueToDirective(
  sectionKey: string,
  issue: SectionFinding['findings'][number],
  index: number,
): RewriteDirective {
  const action = issue.issueType === 'volume_led_bullet'
    ? 'convert_volume_to_impact'
    : issue.issueType === 'task_led_bullet'
      ? 'convert_task_to_judgment'
      : issue.issueType === 'skills_carry_fit_without_experience_proof'
        ? 'add_jd_proof'
        : 'rewrite'

  return {
    directiveId: `${sectionKey}-${issue.issueType}-${index + 1}`,
    targetSection: sectionKey,
    targetScope: issue.issueType.includes('bullet') ? 'bullet' : 'section',
    action,
    sourceIssueType: issue.issueType,
    instruction: issue.rewriteHint,
    allowedEvidenceIds: issue.allowedEvidenceIds,
    mustPreserve: issue.allowedEvidenceIds,
    mustAvoid: ['unsupported facts', 'generic praise', 'numeric scores'],
    successCriteria: [
      issue.desiredStrategy,
      'Use only allowed evidence IDs.',
      'Do not rewrite sections already marked ready.',
    ],
  }
}

function makeIssue(input: {
  issueType: CriticalResumeIssueType
  excerpt: string
  whyItFails: string
  desiredStrategy: string
  rewriteHint: string
  allowedEvidenceIds: string[]
  action?: RewriteDirective['action']
}): SectionFinding['findings'][number] {
  return {
    issueType: input.issueType,
    severity: 'must_fix',
    excerpt: input.excerpt,
    whyItFails: input.whyItFails,
    desiredStrategy: input.desiredStrategy,
    rewriteHint: input.rewriteHint,
    allowedEvidenceIds: input.allowedEvidenceIds,
  }
}

function sectionResult(
  sectionKey: string,
  sectionPurpose: CriticalResumeSectionPurpose,
  findings: SectionFinding['findings'],
): SectionFinding {
  return {
    sectionKey,
    sectionPurpose,
    status: findings.some(f => f.severity === 'must_fix') ? 'needs_targeted_rewrite' : 'ready',
    findings,
  }
}

function isVolumeLed(bullet: string, strategyBrief?: ResumeStrategyBrief): boolean {
  const lower = bullet.toLowerCase().replace(/^-\s*/, '')
  const volumeLead = /^(triaged|analyz(?:ed|ing)|processed|handled|reviewed)\b.*\b(?:requests?|tickets?|cases?|records?|reports?|stories?|defects?)\b/.test(lower) ||
    /^high volume of \w+/.test(lower) ||
    /\bhigh volume of (?:requests?|tickets?|cases?|records?|reports?|stories?|defects?)\b/.test(lower) ||
    (strategyMentions(strategyBrief, 'volume') && /\b(?:request|ticket|case|record|report|story|defect)\s+load\b/.test(lower))
  if (!volumeLead) return false
  return !/\b(reduced|improved|accelerated|increased|decreased|saved|cut|lowered|prevented|strengthened)\b/.test(lower)
}

function isTaskLed(bullet: string, strategyBrief?: ResumeStrategyBrief): boolean {
  const lower = bullet.toLowerCase().replace(/^-\s*/, '')
  if (/^led ceremonies\b|^responsible for\b|^worked on\b|^helped with\b/.test(lower) ||
    (strategyMentions(strategyBrief, 'ceremony') && /^facilitated ceremonies\b/.test(lower))) {
    return !/\b(decision|tradeoff|reduced|improved|risk|outcome|impact|adoption|support reduction|quality)\b/.test(lower)
  }
  return false
}

function strategyMentions(strategyBrief: ResumeStrategyBrief | undefined, word: string): boolean {
  if (!strategyBrief) return false
  const haystack = [
    ...strategyBrief.antiPatternsToAvoid,
    ...strategyBrief.bulletConstructionRules,
    ...strategyBrief.metricUseRules,
    ...strategyBrief.executivePresenceRules,
    ...strategyBrief.rewritePreferences,
  ].join(' ').toLowerCase()
  return haystack.includes(word)
}

function containsTheme(text: string, theme: string): boolean {
  const lower = text.toLowerCase()
  return theme
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .some(word => lower.includes(word))
}

function evidenceIdsForTheme(input: CriticalResumeReviewInput, theme: string): string[] {
  const lower = theme.toLowerCase()
  const ids = input.evidenceMap
    .filter(e => lower.split(/\s+/).some(word => word.length > 3 && e.text.toLowerCase().includes(word)))
    .map(e => e.id)
  return ids.length > 0 ? ids : allEvidenceIds(input)
}

function allEvidenceIds(input: CriticalResumeReviewInput): string[] {
  return input.evidenceMap.map(e => e.id)
}

function parseResumeSections(text: string): Map<string, string> {
  const result = new Map<string, string>()
  const headers = Array.from(text.matchAll(/(?:^|\n)(SUMMARY|SKILLS|EXPERIENCE|EDUCATION)\n/g))
  for (let i = 0; i < headers.length; i++) {
    const match = headers[i]
    const next = headers[i + 1]
    const key = match[1].toLowerCase()
    const start = (match.index ?? 0) + match[0].length
    const end = next?.index ?? text.length
    result.set(key, text.slice(start, end).trim())
  }
  return result
}

function replaceSection(fullText: string, sectionKey: string, revisedText: string): string {
  const header = sectionKey.toUpperCase()
  const regex = new RegExp(`(^|\\n)${header}\\n([\\s\\S]*?)(?=\\n[A-Z]{2,}\\n|$)`)
  if (!regex.test(fullText)) throw new Error(`Target section not found: ${sectionKey}`)
  return fullText.replace(regex, `$1${header}\n${revisedText.trim()}`)
}

function extractProofSignals(experienceText: string): string[] {
  const signals: string[] = []
  for (const match of experienceText.matchAll(/\b\d+\s*(?:developers?|engineers?|qa|stakeholders?)\b|\b\d+[-\s]?week\s+sprints?\b|\b\d+%|\$\d[\d,.]*/gi)) {
    signals.push(match[0])
  }
  return signals
}

function validateSectionFinding(value: unknown): void {
  if (!isRecord(value)) throw new Error('Section finding must be an object.')
  if (typeof value.sectionKey !== 'string') throw new Error('sectionKey is required.')
  if (!SECTION_PURPOSES.has(String(value.sectionPurpose))) throw new Error('Invalid sectionPurpose.')
  if (!ARTIFACT_STATUSES.has(String(value.status))) throw new Error('Invalid section finding status.')
  if (!Array.isArray(value.findings)) throw new Error('findings must be an array.')
  for (const finding of value.findings) {
    if (!isRecord(finding)) throw new Error('finding must be an object.')
    if (!ISSUE_TYPES.has(finding.issueType as CriticalResumeIssueType)) throw new Error('Invalid issueType.')
    if (!['must_fix', 'should_fix', 'note'].includes(String(finding.severity))) throw new Error('Invalid severity.')
    for (const key of ['excerpt', 'whyItFails', 'desiredStrategy', 'rewriteHint']) {
      if (typeof finding[key] !== 'string') throw new Error(`${key} is required.`)
    }
    if (!Array.isArray(finding.allowedEvidenceIds)) throw new Error('allowedEvidenceIds must be an array.')
  }
}

function validateRewriteDirective(value: unknown): void {
  if (!isRecord(value)) throw new Error('Rewrite directive must be an object.')
  for (const key of ['directiveId', 'targetSection', 'targetScope', 'sourceIssueType', 'instruction']) {
    if (typeof value[key] !== 'string') throw new Error(`${key} is required.`)
  }
  if (!DIRECTIVE_ACTIONS.has(String(value.action))) throw new Error('Invalid directive action.')
  for (const key of ['allowedEvidenceIds', 'mustPreserve', 'mustAvoid', 'successCriteria']) {
    if (!Array.isArray(value[key]) || value[key].length === 0) throw new Error(`${key} must be a non-empty array.`)
  }
}

function assertNoScoreFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoScoreFields)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (/score|rating|grade/i.test(key)) throw new Error('Critical reviews must not include score fields.')
    assertNoScoreFields(child)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
