import type {
  AppliedCalibrationState,
  ArtifactSection,
  BridgeQuestion,
  JDRequirement,
  LearningSignal,
  LearningSignalType,
  SectionType,
  Stage4RawResumeText,
  TargetIntake,
  UserProfile
} from '@/contracts'

export type Stage5Tab = 'strategy' | 'stages' | 'personal' | 'global' | 'facts'
export type StageLearningStage = 'stage1' | 'stage2' | 'stage3a' | 'stage3b' | 'stage4'

export interface Stage5MetaSignal {
  id: string
  stage: StageLearningStage
  scope: 'personal' | 'global' | 'both'
  type: LearningSignalType
  content: string
  globalContent?: string
  sourceArtifactSectionIds?: string[]
}

export interface Stage5BeforeAfter {
  before: string
  after: string
  why: string
}

export interface Stage5ArtifactFacts {
  acceptedBullets: string[]
  acceptedSkills: string[]
  approvedMetrics: string[]
  rejectedPhrases: string[]
}

export interface Stage5LearningReport {
  strategySummary: string
  beforeAfter: Stage5BeforeAfter[]
  signals: Stage5MetaSignal[]
  artifactFacts: Stage5ArtifactFacts
  defaultTab: Stage5Tab
}

export interface BuildStage5LearningReportOptions {
  session: TargetIntake
  profile?: UserProfile
  bridgeQuestions: BridgeQuestion[]
  artifactSections: ArtifactSection[]
  appliedCalibration?: AppliedCalibrationState
  stage4RawText?: Stage4RawResumeText
  storedSignals?: LearningSignal[]
}

const FACT_TYPES = new Set<LearningSignalType>([
  'accepted-bullet',
  'approved-metric',
  'rejected-bullet',
  'rejected-phrase'
])

const PRIVATE_PLACEHOLDER = '[private]'

export function buildStage5LearningReport(opts: BuildStage5LearningReportOptions): Stage5LearningReport {
  const accepted = opts.artifactSections.filter(s => s.status === 'accepted')
  const facts = buildArtifactFacts(opts, accepted)
  const signals = [
    ...buildStage1Signals(opts.session),
    ...buildStage2Signals(opts.bridgeQuestions),
    ...buildStage3ASignals(opts.appliedCalibration, accepted),
    ...buildStage3BSignals(accepted),
    ...buildStage4Signals(opts.stage4RawText),
    ...buildStoredMetaSignals(opts.storedSignals ?? [])
  ]

  const finalFocus = inferFinalFocus(accepted)
  const before = opts.profile?.summary?.trim()
    ? summarize(opts.profile.summary, 140)
    : `Broad ${opts.session.emphasisRecommendation} positioning from the saved profile.`
  const after = finalFocus || `Targeted ${opts.session.roleTitle} positioning based on accepted Stage 3 artifacts.`
  const why = buildWhy(opts.session, opts.appliedCalibration)

  return {
    strategySummary: buildStrategySummary(opts, finalFocus),
    beforeAfter: [{ before, after, why }],
    signals: dedupeSignals(signals),
    artifactFacts: facts,
    defaultTab: 'strategy'
  }
}

export function primaryLearningSignals(report: Stage5LearningReport): Stage5MetaSignal[] {
  return report.signals.filter(s => !FACT_TYPES.has(s.type))
}

export function artifactFactsFromSignals(signals: LearningSignal[]): Stage5ArtifactFacts {
  return {
    acceptedBullets: signals.filter(s => s.type === 'accepted-bullet').map(s => s.content),
    acceptedSkills: signals.filter(s => s.type === 'approved-metric' && s.sectionType === 'skills').map(s => s.content),
    approvedMetrics: signals.filter(s => s.type === 'approved-metric' && s.sectionType !== 'skills').map(s => s.content),
    rejectedPhrases: signals.filter(s => s.type === 'rejected-phrase').map(s => s.content)
  }
}

export function sanitizeGlobalLearning(content: string, opts: { profile?: UserProfile; calibrationPeople?: string[] } = {}): string {
  let cleaned = content
  const privateTerms = [
    opts.profile?.fullName,
    opts.profile?.email,
    opts.profile?.phone,
    ...(opts.profile?.workHistory.flatMap(w => [w.company, ...w.approvedMetrics]) ?? []),
    ...(opts.calibrationPeople ?? [])
  ].filter((value): value is string => Boolean(value && value.trim()))

  for (const term of privateTerms) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(term), 'gi'), PRIVATE_PLACEHOLDER)
  }

  return cleaned
    .replace(/\b\d+%|\b\d{2,}\+?\b/g, 'quantified')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function buildArtifactFacts(opts: BuildStage5LearningReportOptions, accepted: ArtifactSection[]): Stage5ArtifactFacts {
  const stored = artifactFactsFromSignals(opts.storedSignals ?? [])
  const bullets = accepted.flatMap(s =>
    s.bullets
      .filter(b => (b.partition ?? 'display') === 'display')
      .filter(b => b.approved !== false)
      .map(b => b.text)
  )
  const skills = accepted
    .filter(s => s.type === 'skills')
    .flatMap(s => s.content.split('\n').map(line => line.trim()).filter(Boolean))
  const metrics = opts.profile?.workHistory.flatMap(w => w.approvedMetrics) ?? []

  return {
    acceptedBullets: unique([...stored.acceptedBullets, ...bullets]),
    acceptedSkills: unique([...stored.acceptedSkills, ...skills]),
    approvedMetrics: unique([...stored.approvedMetrics, ...metrics]),
    rejectedPhrases: unique(stored.rejectedPhrases)
  }
}

function buildStage1Signals(session: TargetIntake): Stage5MetaSignal[] {
  const required = session.jdRequirementMap?.required ?? []
  const gapRequirements = required.filter(r => r.userCoverageStatus === 'gap' || r.userCoverageStatus === 'unknown')
  const bridgeable = required.filter(r => r.userCoverageStatus === 'partial')
  const signals: Stage5MetaSignal[] = []

  if (gapRequirements.length > 0) {
    signals.push(signal('stage1', 'both', 'jd_alignment_strategy',
      `JD gaps should become evidence boundaries or bridge questions before artifact generation: ${listRequirements(gapRequirements)}.`,
      'When a JD requirement lacks profile evidence, convert it into a bridge question or credibility boundary rather than inferring a resume claim.'
    ))
  }

  if (bridgeable.length > 0) {
    signals.push(signal('stage1', 'personal', 'evidence_boundary',
      `Partially covered requirements were useful bridge targets: ${listRequirements(bridgeable)}.`
    ))
  }

  const degree = required.find(r => /bachelor|degree|education/i.test(r.text))
  if (degree) {
    signals.push(signal('stage1', 'global', 'reusable_prompt_heuristic',
      'Degree requirements should trigger an education visibility check before writing final resume text.'
    ))
  }

  return signals
}

function buildStage2Signals(bridgeQuestions: BridgeQuestion[]): Stage5MetaSignal[] {
  const answered = bridgeQuestions.filter(q => q.status === 'answered' && q.userAnswer?.trim())
  const uncertain = answered.filter(q => /\b(not sure|uncertain|no direct|do not have|don't have)\b/i.test(q.userAnswer ?? ''))
  const useful = answered.filter(q => !uncertain.includes(q))
  const signals: Stage5MetaSignal[] = []

  if (useful.length > 0) {
    signals.push(signal('stage2', 'personal', 'bridge_question_effectiveness',
      `Useful bridge answers changed artifact strategy for ${unique(useful.map(q => q.affectedArtifactSection)).join(', ')}.`
    ))
  }

  if (uncertain.length > 0) {
    signals.push(signal('stage2', 'both', 'evidence_boundary',
      'User uncertainty in bridge answers should remain negative or uncertain evidence, not positive resume content.',
      'Bridge-question uncertainty should be represented as an evidence boundary rather than converted into inferred experience.'
    ))
  }

  const apiAnswer = answered.find(q => /postman|api|json|xml/i.test(`${q.question} ${q.userAnswer}`))
  if (apiAnswer) {
    signals.push(signal('stage2', 'global', 'bridge_question_effectiveness',
      'API-related answers should distinguish validation/testing exposure from specification-authoring ownership.'
    ))
  }

  return signals
}

function buildStage3ASignals(applied: AppliedCalibrationState | undefined, accepted: ArtifactSection[]): Stage5MetaSignal[] {
  const signals: Stage5MetaSignal[] = []
  const summary = applied?.summary
  if (summary) {
    const patterns = [
      ...summary.domainExpectations,
      ...summary.repeatedSkillsTools,
      ...summary.artifactGuidance,
      ...summary.gapsToHandleCarefully
    ].filter(Boolean).slice(0, 5)
    if (patterns.length > 0) {
      signals.push(signal('stage3a', 'both', 'calibration_pattern',
        `Calibration patterns shaped artifact strategy around ${patterns.join('; ')}.`,
        'Calibration should tune wording, emphasis, ordering, and credibility boundaries without becoming resume evidence.'
      ))
    }
  }

  const decisions = accepted.flatMap(section =>
    (section.calibrationInfluence?.artifactDecisions ?? []).map(decision => ({ section, decision }))
  )
  if (decisions.length > 0) {
    signals.push(signal('stage3a', 'both', 'calibration_pattern',
      `Calibration influence was auditable through ${unique(decisions.map(d => d.decision.decisionType)).join(', ')} decisions.`,
      'Calibration influence should be audited as wording, emphasis, inclusion, exclusion, ordering, or gap handling.',
      decisions.map(d => d.section.id)
    ))
  }

  const boundaries = summary?.credibilityBoundaries ?? []
  if (boundaries.length > 0) {
    signals.push(signal('stage3a', 'global', 'rejected_overclaim',
      'Market patterns absent from user evidence should become credibility boundaries or bridge questions, not resume claims.'
    ))
  }

  return signals
}

function buildStage3BSignals(accepted: ArtifactSection[]): Stage5MetaSignal[] {
  const signals: Stage5MetaSignal[] = []
  const diagnostics = accepted.flatMap(s => s.blockedClaimDiagnostics ?? [])
  const sectionsWithDisplay = accepted.filter(s => s.bullets.some(b => (b.partition ?? 'display') === 'display'))

  if (diagnostics.length > 0) {
    signals.push(signal('stage3b', 'both', 'role_scope_rule',
      'Evidence-scoping diagnostics prevented strong but wrong-section claims from leaking into accepted resume sections.',
      'For role-specific sections, cross-role evidence should default to diagnostics unless explicitly framed as progression or context.',
      accepted.map(s => s.id)
    ))
  }

  if (sectionsWithDisplay.length > 0) {
    signals.push(signal('stage3b', 'personal', 'artifact_strategy',
      `Accepted section strategy favored display-safe evidence in ${sectionsWithDisplay.map(s => labelSection(s.type)).join(', ')}.`
    ))
  }

  const warnings = accepted.flatMap(s => s.evidenceWarnings ?? [])
  if (warnings.length > 0) {
    signals.push(signal('stage3b', 'global', 'evidence_boundary',
      'Unsupported JD tools and domains should remain warnings or gaps instead of being inserted into skills or bullets.'
    ))
  }

  return signals
}

function buildStage4Signals(stage4: Stage4RawResumeText | undefined): Stage5MetaSignal[] {
  if (!stage4) return []
  return [
    signal('stage4', 'global', 'export_assembly_rule',
      'Raw resume export worked as deterministic assembly from accepted Stage 3 content, not as a new generation pass.'
    ),
    signal('stage4', 'global', 'naturalization_rule',
      'Natural resume language should simplify AI-like phrasing while preserving metrics, dates, and evidence boundaries.'
    )
  ]
}

function buildStoredMetaSignals(signals: LearningSignal[]): Stage5MetaSignal[] {
  return signals
    .filter(s => !FACT_TYPES.has(s.type))
    .map(s => signal(
      'stage3b',
      s.scope,
      s.type,
      s.content,
      s.globalContent,
      s.sectionType ? [] : undefined
    ))
}

function buildStrategySummary(opts: BuildStage5LearningReportOptions, finalFocus: string): string {
  const jdFocus = opts.session.jdRequirementMap?.realJobFunction || opts.session.roleTitle
  const calibration = opts.appliedCalibration?.summary?.artifactGuidance?.[0]
    ?? opts.appliedCalibration?.summary?.calibrationPatterns?.[0]
    ?? 'market calibration and evidence boundaries'
  const artifactFocus = finalFocus || 'accepted Stage 3 resume sections'

  return `Resume Builder shifted the session toward ${jdFocus} alignment. ${calibration} helped shape wording and emphasis, while accepted artifacts anchored the final strategy in ${artifactFocus}. Unsupported gaps remained boundaries rather than claims, and downstream export should reuse accepted content instead of regenerating resume facts.`
}

function buildWhy(session: TargetIntake, applied: AppliedCalibrationState | undefined): string {
  const calibrationReason = applied?.summary?.calibrationUsed
    ? 'Calibration clarified which market patterns should affect wording, ordering, and gap handling.'
    : 'JD analysis and accepted artifacts clarified what evidence should lead.'
  return `${calibrationReason} The target role requires ${session.jdRequirementMap?.realJobFunction || session.roleTitle}, so future initial generation should foreground supported evidence before adjacent context.`
}

function inferFinalFocus(accepted: ArtifactSection[]): string {
  const ba = accepted.find(s => s.type === 'experience-ba')
  const summary = accepted.find(s => s.type === 'summary')
  const source = ba?.bullets?.[0]?.text || summary?.content || ''
  return source ? summarize(source, 150) : ''
}

function signal(
  stage: StageLearningStage,
  scope: Stage5MetaSignal['scope'],
  type: LearningSignalType,
  content: string,
  globalContent?: string,
  sourceArtifactSectionIds?: string[]
): Stage5MetaSignal {
  return {
    id: `${stage}-${type}-${hash(content)}`,
    stage,
    scope,
    type,
    content,
    globalContent,
    sourceArtifactSectionIds
  }
}

function dedupeSignals(signals: Stage5MetaSignal[]): Stage5MetaSignal[] {
  const seen = new Set<string>()
  const result: Stage5MetaSignal[] = []
  for (const s of signals) {
    const key = `${s.stage}:${s.scope}:${s.type}:${s.content}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(s)
  }
  return result
}

function listRequirements(requirements: JDRequirement[]): string {
  return requirements.map(r => r.text).slice(0, 5).join('; ')
}

function labelSection(type: SectionType): string {
  return type.replace('experience-', 'experience ')
}

function summarize(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1).trim()}...`
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function hash(value: string): string {
  let acc = 0
  for (let i = 0; i < value.length; i++) acc = ((acc << 5) - acc + value.charCodeAt(i)) | 0
  return Math.abs(acc).toString(36)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
