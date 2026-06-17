import type { CompanyIndustryBasis, CompanyIndustryPerspective } from '@/contracts'

export interface CompanyIndustryBasisInput {
  targetCompany: string
  targetRoleTitle: string
  jobDescription: string
  industry?: string
  userNotes?: string
}

interface SignalGroup {
  perspective: CompanyIndustryPerspective
  label: string
  patterns: RegExp[]
  proofTheme: string
  implication: (signals: string[]) => string
  question: (signals: string[]) => string
  expectedUse: CompanyIndustryBasis['bridgeQuestionRecommendations'][number]['expectedUse']
}

export interface ExtractedCompanyIndustrySignal {
  perspective: CompanyIndustryPerspective
  proofTheme: string
  label: string
  signals: string[]
  sourceBasis: 'jd' | 'user_note'
}

type ProblemSpaceSourceBasis = CompanyIndustryBasis['problemSpace']['sourceBasis'][number]

const MAX_PROBLEM_SPACE_ITEMS = 5
const MAX_COMPANY_PERSPECTIVE_NEEDS = 6
const MAX_RESUME_CALIBRATION_ANGLES = 5
const MAX_BRIDGE_QUESTIONS = 8
const MAX_EVIDENCE_ROUTING_HINTS = 6

const SIGNAL_GROUPS: SignalGroup[] = [
  {
    perspective: 'implementation_or_operations',
    label: 'implementation, rollout, and operations',
    patterns: [
      /\bimplementation\b/i,
      /\brollout\b/i,
      /\bdeploy(?:ment|ments)?\b/i,
      /\boperations?\b/i,
      /\bworkflow(?:s)?\b/i,
      /\bprocess(?:es)?\b/i,
      /\benablement\b/i,
    ],
    proofTheme: 'rollout and operational workflow readiness',
    implication: signals => `JD emphasizes ${joinSignals(signals)}; resume should ask for proof of rollout readiness, workflow reliability, documentation, UAT, stakeholder enablement, or business process translation.`,
    question: () => 'Can you show rollout, implementation, documentation, UAT, training, or operational workflow examples tied to a measurable delivery outcome?',
    expectedUse: 'primary_experience_bullet',
  },
  {
    perspective: 'delivery_environment',
    label: 'delivery and release environment',
    patterns: [
      /\bagile\b/i,
      /\bscrum\b/i,
      /\bsprint(?:s)?\b/i,
      /\brelease(?:s)?\b/i,
      /\broadmap\b/i,
      /\bbacklog\b/i,
      /\bUAT\b/i,
      /\buser stor(?:y|ies)\b/i,
      /\bacceptance criteria\b/i,
    ],
    proofTheme: 'UAT/release validation and backlog delivery',
    implication: signals => `JD calls for ${joinSignals(signals)}; resume should pull forward evidence of backlog decisions, acceptance criteria, release readiness, UAT validation, and delivery tradeoffs.`,
    question: () => 'Which examples prove backlog prioritization, user stories, acceptance criteria, UAT, release readiness, or sprint delivery decisions?',
    expectedUse: 'primary_experience_bullet',
  },
  {
    perspective: 'data_reporting_analytics',
    label: 'analytics and reporting',
    patterns: [
      /\banalytics?\b/i,
      /\breport(?:ing|s)?\b/i,
      /\bdashboard(?:s)?\b/i,
      /\bmetric(?:s)?\b/i,
      /\bKPI(?:s)?\b/i,
      /\binsight(?:s)?\b/i,
      /\bSQL\b/i,
      /\bPower BI\b/i,
      /\bTableau\b/i,
    ],
    proofTheme: 'product performance reporting',
    implication: signals => `JD references ${joinSignals(signals)}; resume should verify evidence of KPI interpretation, product performance reporting, dashboard usage, SQL/reporting tools, or data-informed prioritization.`,
    question: () => 'Do you have SQL, Power BI, KPI, reporting, dashboard, product performance, or analytics examples that informed product or delivery decisions?',
    expectedUse: 'primary_experience_bullet',
  },
  {
    perspective: 'stakeholder_landscape',
    label: 'stakeholder and business partner landscape',
    patterns: [
      /\bstakeholder(?:s)?\b/i,
      /\bbusiness partner(?:s)?\b/i,
      /\bcross-functional\b/i,
      /\bengineering\b/i,
      /\bIT\b/i,
      /\busers?\b/i,
      /\bfield(?:\s+teams?)?\b/i,
      /\bfranchise(?:e|es|s)?\b/i,
    ],
    proofTheme: 'business-to-IT translation and prioritization',
    implication: signals => `JD names ${joinSignals(signals)}; resume should ask for business-to-IT translation, stakeholder prioritization, decision framing, and coordination examples.`,
    question: () => 'What examples show business-to-IT translation, prioritization, tradeoff decisions, or stakeholder coordination across business and technical partners?',
    expectedUse: 'secondary_experience_bullet',
  },
  {
    perspective: 'risk_quality_compliance',
    label: 'risk, quality, and compliance',
    patterns: [
      /\brisk(?:s)?\b/i,
      /\bquality\b/i,
      /\bcompliance\b/i,
      /\baudit(?:s)?\b/i,
      /\bdefect(?:s)?\b/i,
      /\bregulatory\b/i,
      /\bsecurity\b/i,
      /\bcontrols?\b/i,
    ],
    proofTheme: 'quality/risk boundary and defect prevention',
    implication: signals => `JD includes ${joinSignals(signals)}; resume should verify proof of quality controls, risk reduction, defect prevention, compliance support, or release validation.`,
    question: () => 'Can you connect prior work to quality controls, compliance support, release risk, defect prevention, or validation?',
    expectedUse: 'risk_boundary',
  },
  {
    perspective: 'growth_efficiency_or_retention',
    label: 'growth, efficiency, and adoption outcomes',
    patterns: [
      /\bgrowth\b/i,
      /\bretention\b/i,
      /\befficien(?:cy|t)\b/i,
      /\brevenue\b/i,
      /\bcost\b/i,
      /\badoption\b/i,
      /\bconversion\b/i,
      /\bsupport reduction\b/i,
    ],
    proofTheme: 'efficiency/adoption/support outcome',
    implication: signals => `JD points to ${joinSignals(signals)}; resume should prioritize verified outcomes such as efficiency, adoption, support reduction, cost/time savings, or business value.`,
    question: () => 'Which verified metrics or outcomes show efficiency, adoption, retention, support reduction, cost savings, or revenue support?',
    expectedUse: 'primary_experience_bullet',
  },
  {
    perspective: 'industry_domain_language',
    label: 'domain and workflow language',
    patterns: [
      /\brestaurant(?:s)?\b/i,
      /\bquick[-\s]?service\b/i,
      /\bretail\b/i,
      /\bstore(?:s)?\b/i,
      /\bpoint[-\s]?of[-\s]?sale\b/i,
      /\bPOS\b/i,
      /\blogistics\b/i,
      /\bscheduling\b/i,
      /\bdistribution\b/i,
      /\bfield operations?\b/i,
    ],
    proofTheme: 'domain workflow translation',
    implication: signals => `JD/company context includes ${joinSignals(signals)}; resume should use domain language only when candidate evidence supports comparable users, workflows, operations, or systems.`,
    question: () => 'Which examples credibly connect prior work to comparable domain terminology, users, workflows, operating constraints, or systems?',
    expectedUse: 'domain_translation',
  },
  {
    perspective: 'product_or_platform_context',
    label: 'product or platform context',
    patterns: [
      /\bplatform(?:s)?\b/i,
      /\bproduct(?:s)?\b/i,
      /\bapplication(?:s)?\b/i,
      /\bsystem(?:s)?\b/i,
      /\bAPI(?:s)?\b/i,
      /\bintegration(?:s)?\b/i,
      /\bdigital\b/i,
      /\btechnology\b/i,
    ],
    proofTheme: 'product/platform execution context',
    implication: signals => `JD references ${joinSignals(signals)}; resume should verify product/platform execution evidence without claiming ownership of unsupported systems or company products.`,
    question: () => 'Do you have product, platform, integration, API, system, or digital delivery examples that show execution context without overclaiming ownership?',
    expectedUse: 'primary_experience_bullet',
  },
]

export function buildCompanyIndustryBasisQuickStart(input: CompanyIndustryBasisInput): CompanyIndustryBasis {
  const company = input.targetCompany.trim()
  const role = input.targetRoleTitle.trim()
  const jdText = input.jobDescription.trim()
  const notes = input.userNotes?.trim() ?? ''
  const industry = normalizeIndustry(input.industry, company) ?? inferIndustry(company, jdText, notes)
  const extracted = extractSignalGroups(jdText, notes)

  const companyLabel = company || 'the target company'
  const roleLabel = role || 'the target role'
  const topThemes = extracted.map(item => item.group.proofTheme)
  const problemSpace = buildProblemSpace(companyLabel, roleLabel, industry.label, extracted, notes)

  return {
    targetCompany: company,
    targetRoleTitle: role,
    industry: industry.label,
    problemSpace,
    calibrationSummary: buildCalibrationSummary(companyLabel, roleLabel, industry.label, extracted, problemSpace.thesis),
    companyPerspectiveNeeds: extracted.slice(0, MAX_COMPANY_PERSPECTIVE_NEEDS).map(({ group, signals, sourceBasis }) => ({
      perspective: group.perspective,
      whyItMattersForResume: group.implication(signals),
      resumeImplication: buildResumeImplication(group, signals),
      confidence: sourceBasis === 'jd' ? 'medium' : 'low',
      sourceBasis,
      supportingSignals: signals,
    })),
    resumeCalibrationAngles: extracted.slice(0, MAX_RESUME_CALIBRATION_ANGLES).map(({ group, signals }) => ({
      angle: group.proofTheme,
      relevantEvidenceTypes: evidenceTypesForPerspective(group.perspective),
      sectionsAffected: ['experience', 'skills', group.perspective === 'industry_domain_language' ? 'summary' : ''],
      exampleResumeUse: group.implication(signals),
      avoidOverclaiming: 'Do not turn company or industry context into candidate claims unless the candidate provides evidence.',
    })).map(angle => ({
      ...angle,
      sectionsAffected: angle.sectionsAffected.filter(Boolean),
    })),
    bridgeQuestionRecommendations: extracted.slice(0, MAX_BRIDGE_QUESTIONS).map(({ group, signals, sourceBasis }) => ({
      question: group.question(signals),
      reason: buildQuestionReason(group, signals),
      expectedUse: group.expectedUse,
      priority: sourceBasis === 'jd' ? 'must_ask' : 'useful',
    })),
    stage3StrategyInputs: {
      targetPostureHints: [
        problemSpace.rolePurposeHypothesis,
        `Tailor posture toward ${roleLabel} at ${companyLabel} using JD-backed operating context and inferred problem-space only.`,
        industry.label
          ? `Use ${industry.label} language only where candidate evidence supports comparable workflows or users.`
          : 'Leave industry language broad unless bridge answers provide stronger evidence.',
      ],
      proofThemesToPrioritize: [...new Set(topThemes)].slice(0, 8),
      domainTermsToUseIfEvidenced: industry.label ? [industry.label, ...domainTermsFromSignals(extracted)] : domainTermsFromSignals(extracted),
      toolsOrMethodsToVerify: extractToolsOrMethods(jdText),
      risksOrClaimsToAvoid: [
        'unsupported company strategy',
        'unsupported product/platform ownership',
        'generic mission alignment',
        'direct resume bullets copied from research',
      ],
    },
    evidenceRoutingHints: buildEvidenceRoutingHints(extracted),
  }
}

export function serializeCompanyIndustryBasisForDomainIQ(basis: CompanyIndustryBasis): string {
  return JSON.stringify({
    export: {
      exportKind: 'diq_stage3_resume_builder_basis',
      generatedBy: 'ResumeBuilder Quick Start: Company / Industry Basis',
      sourcePolicy: 'JD-first; inferred company/industry context marked by confidence and sourceBasis.',
      domainBasis: {
        thesis: basis.problemSpace.thesis || basis.calibrationSummary,
        keyThemes: [
          ...(basis.industry ? [basis.industry] : []),
          ...basis.problemSpace.operatingContext,
          ...basis.problemSpace.impliedBusinessPressures,
          ...basis.stage3StrategyInputs.proofThemesToPrioritize,
        ].filter(Boolean),
        problemSpace: basis.problemSpace,
      },
      resumePositioningBasis: {
        businessConcepts: basis.resumeCalibrationAngles.map(angle => angle.angle),
        angles: basis.resumeCalibrationAngles.map(angle => angle.exampleResumeUse),
        bridgeQuestions: basis.bridgeQuestionRecommendations.map(q => q.question),
      },
      qualifiedInsights: basis.companyPerspectiveNeeds.map(item => ({
        claim: item.resumeImplication,
        confidence: item.confidence,
        sourceBasis: item.sourceBasis,
        supportingSignals: item.supportingSignals ?? [],
      })),
      companyIndustryBasis: basis,
    },
  }, null, 2)
}

function extractSignalGroups(
  jdText: string,
  notes: string,
): Array<{ group: SignalGroup; signals: string[]; sourceBasis: 'jd' | 'user_note' }> {
  return SIGNAL_GROUPS
    .map(group => {
      const jdSignals = extractSignals(jdText, group.patterns)
      const noteSignals = extractSignals(notes, group.patterns)
      const signals = [...jdSignals, ...noteSignals].slice(0, 4)
      if (signals.length === 0) return null
      return {
        group,
        signals,
        sourceBasis: jdSignals.length > 0 ? 'jd' as const : 'user_note' as const,
      }
    })
    .filter((item): item is { group: SignalGroup; signals: string[]; sourceBasis: 'jd' | 'user_note' } => item !== null)
}

export function extractCompanyIndustrySignals(input: Pick<CompanyIndustryBasisInput, 'jobDescription' | 'userNotes'>): ExtractedCompanyIndustrySignal[] {
  return extractSignalGroups(input.jobDescription, input.userNotes ?? '').map(({ group, signals, sourceBasis }) => ({
    perspective: group.perspective,
    proofTheme: group.proofTheme,
    label: group.label,
    signals,
    sourceBasis,
  }))
}

function extractSignals(text: string, patterns: RegExp[]): string[] {
  if (!text.trim()) return []
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const matches: string[] = []
  for (const sentence of sentences) {
    if (patterns.some(pattern => pattern.test(sentence))) {
      matches.push(compactSignalLabel(sentence))
    }
  }
  return [...new Set(matches)].slice(0, 3)
}

function compactSignalLabel(sentence: string): string {
  const terms = sentence.match(/\b(?:implementation|rollout|deployment|operations?|workflow|process|release|roadmap|backlog|UAT|user stories|acceptance criteria|analytics?|reporting|dashboard|metrics?|KPI|SQL|Power BI|Tableau|stakeholders?|business partners?|engineering|IT|users?|field teams?|risk|quality|compliance|audit|defects?|security|growth|retention|efficiency|revenue|cost|adoption|restaurant|quick-service|retail|store|POS|logistics|scheduling|distribution|platform|product|application|system|API|integration|digital|technology|governance|planning|training|documentation)\b/gi) ?? []
  const unique = [...new Set(terms.map(term => term.replace(/\s+/g, ' ').trim()))].slice(0, 5)
  return unique.length ? unique.join(' / ') : sentence.replace(/\s+/g, ' ').trim().slice(0, 48)
}

function buildCalibrationSummary(
  company: string,
  role: string,
  industry: string | undefined,
  extracted: Array<{ group: SignalGroup; signals: string[] }>,
  thesis: string,
): string {
  const themes = extracted.map(item => item.group.proofTheme).slice(0, 4)
  if (themes.length === 0) {
    return `Quick Start basis for ${role} at ${company}. The JD did not expose strong calibration signals, so use bridge questions to confirm role context before adding company or industry language to the resume.`
  }
  return [
    thesis,
    `Context: ${role} at ${company}${industry ? ` in ${industry}` : ''}.`,
    `JD-supported calibration themes: ${themes.join('; ')}.`,
    'Use these themes to ask sharper bridge questions and pull forward candidate evidence; do not copy company context into resume claims.',
  ].join(' ')
}

function buildProblemSpace(
  company: string,
  role: string,
  industry: string | undefined,
  extracted: Array<{ group: SignalGroup; signals: string[]; sourceBasis: 'jd' | 'user_note' }>,
  notes: string,
): CompanyIndustryBasis['problemSpace'] {
  const perspectives = new Set(extracted.map(item => item.group.perspective))
  const themes = [...new Set(extracted.map(item => item.group.proofTheme))].slice(0, 6)
  const operatingContext = buildOperatingContext(perspectives, themes).slice(0, MAX_PROBLEM_SPACE_ITEMS)
  const impliedBusinessPressures = buildBusinessPressures(perspectives).slice(0, MAX_PROBLEM_SPACE_ITEMS)
  const stakeholders = buildStakeholderGroups(perspectives, industry).slice(0, MAX_PROBLEM_SPACE_ITEMS)
  const systemsContext = buildSystemsOrWorkflowContext(perspectives, industry).slice(0, MAX_PROBLEM_SPACE_ITEMS)
  const sourceBasis: ProblemSpaceSourceBasis[] = ['jd', 'inference']
  if (notes.trim() || extracted.some(item => item.sourceBasis === 'user_note')) sourceBasis.push('user_note')

  if (themes.length === 0) {
    return {
      thesis: `This ${role} opening at ${company} needs a cautious JD-aligned problem-space read before resume calibration.`,
      companyProblemHypothesis: 'The JD does not expose a strong business problem, so company/domain claims should stay broad until bridge answers verify the operating context.',
      rolePurposeHypothesis: `The ${role} resume posture should focus on confirmed evidence and avoid unsupported company or platform claims.`,
      operatingContext: ['role context needs verification'],
      impliedBusinessPressures: ['unclear business pressure from JD'],
      likelyUserOrStakeholderGroups: ['hiring team', 'business stakeholders'],
      systemsOrWorkflowContext: ['workflow or platform context needs verification'],
      confidence: 'low',
      sourceBasis,
    }
  }

  const primaryContext = operatingContext.slice(0, 3).join(', ')
  const primaryPressures = impliedBusinessPressures.slice(0, 3).join(', ')
  return {
    thesis: `This role appears to sit in ${industry && industry !== 'unknown' ? industry : 'a JD-defined operating environment'}, where the resume should prove ${primaryContext} against pressures such as ${primaryPressures}.`,
    companyProblemHypothesis: `${company} appears to need stronger execution around ${primaryContext}, with resume calibration focused on business-process translation rather than generic product language.`,
    rolePurposeHypothesis: `The ${role} likely supports ${buildRoleOperatingModel(perspectives)} by connecting requirements, delivery evidence, stakeholder decisions, and validated workflow outcomes.`,
    operatingContext,
    impliedBusinessPressures,
    likelyUserOrStakeholderGroups: stakeholders,
    systemsOrWorkflowContext: systemsContext,
    confidence: extracted.some(item => item.sourceBasis === 'jd') ? 'medium' : 'low',
    sourceBasis,
  }
}

function buildOperatingContext(perspectives: Set<CompanyIndustryPerspective>, themes: string[]): string[] {
  const context: string[] = []
  if (perspectives.has('implementation_or_operations')) context.push('operational workflow readiness')
  if (perspectives.has('delivery_environment')) context.push('backlog execution and release readiness')
  if (perspectives.has('risk_quality_compliance')) context.push('UAT and defect follow-through')
  if (perspectives.has('data_reporting_analytics')) context.push('planning and reporting discipline')
  if (perspectives.has('stakeholder_landscape')) context.push('stakeholder coordination and business-to-IT translation')
  if (perspectives.has('product_or_platform_context')) context.push('product/platform execution')
  if (perspectives.has('industry_domain_language')) context.push('domain workflow translation')
  return [...new Set([...context, ...themes])].slice(0, MAX_PROBLEM_SPACE_ITEMS)
}

function buildBusinessPressures(perspectives: Set<CompanyIndustryPerspective>): string[] {
  const pressures: string[] = []
  if (perspectives.has('implementation_or_operations')) pressures.push('implementation reliability')
  if (perspectives.has('delivery_environment')) pressures.push('release readiness and delivery governance')
  if (perspectives.has('risk_quality_compliance')) pressures.push('quality control and defect prevention')
  if (perspectives.has('data_reporting_analytics')) pressures.push('planning, reporting, and prioritization visibility')
  if (perspectives.has('stakeholder_landscape')) pressures.push('cross-functional decision clarity')
  if (perspectives.has('growth_efficiency_or_retention')) pressures.push('efficiency, adoption, or support-load improvement')
  if (perspectives.has('product_or_platform_context')) pressures.push('system and platform change execution')
  return pressures.length ? pressures : ['verified role problem context']
}

function buildStakeholderGroups(perspectives: Set<CompanyIndustryPerspective>, industry: string | undefined): string[] {
  const groups = ['business stakeholders', 'IT or engineering teams']
  if (perspectives.has('industry_domain_language') || /restaurant|retail|operations/i.test(industry ?? '')) groups.push('field or operations users')
  if (perspectives.has('delivery_environment')) groups.push('product owners or delivery teams')
  if (perspectives.has('risk_quality_compliance')) groups.push('QA or release partners')
  if (perspectives.has('data_reporting_analytics')) groups.push('reporting or planning stakeholders')
  return [...new Set(groups)].slice(0, MAX_PROBLEM_SPACE_ITEMS)
}

function buildSystemsOrWorkflowContext(perspectives: Set<CompanyIndustryPerspective>, industry: string | undefined): string[] {
  const context: string[] = []
  if (/restaurant|quick-service/i.test(industry ?? '')) context.push('restaurant technology workflows')
  if (/logistics|operations|supply chain/i.test(industry ?? '')) context.push('supply-chain or operations workflows')
  if (perspectives.has('product_or_platform_context')) context.push('digital product or platform changes')
  if (perspectives.has('implementation_or_operations')) context.push('implementation and rollout workflows')
  if (perspectives.has('delivery_environment')) context.push('backlog, UAT, and release workflow')
  if (perspectives.has('data_reporting_analytics')) context.push('reporting dashboards and planning artifacts')
  if (perspectives.has('risk_quality_compliance')) context.push('defect triage and release validation')
  return context.length ? [...new Set(context)].slice(0, MAX_PROBLEM_SPACE_ITEMS) : ['workflow or platform context needs verification']
}

function buildRoleOperatingModel(perspectives: Set<CompanyIndustryPerspective>): string {
  const modes: string[] = []
  if (perspectives.has('implementation_or_operations')) modes.push('implementation support')
  if (perspectives.has('delivery_environment')) modes.push('delivery governance and release readiness')
  if (perspectives.has('stakeholder_landscape')) modes.push('workflow translation')
  if (perspectives.has('data_reporting_analytics')) modes.push('reporting-informed prioritization')
  if (perspectives.has('product_or_platform_context')) modes.push('platform operations')
  return modes.length ? modes.join(', ') : 'verified product or business-analysis execution'
}

function buildResumeImplication(group: SignalGroup, signals: string[]): string {
  return `${group.label}: ${group.implication(signals)}`
}

function buildQuestionReason(group: SignalGroup, signals: string[]): string {
  return `Needed because the JD signal "${signals[0]}" points to ${group.proofTheme}.`
}

function evidenceTypesForPerspective(perspective: CompanyIndustryPerspective): string[] {
  if (perspective === 'data_reporting_analytics') return ['metric', 'tool', 'reporting', 'analytics']
  if (perspective === 'delivery_environment') return ['backlog', 'release', 'UAT', 'acceptance criteria']
  if (perspective === 'stakeholder_landscape') return ['stakeholder', 'decision', 'translation']
  if (perspective === 'risk_quality_compliance') return ['risk', 'quality', 'defect', 'compliance']
  if (perspective === 'implementation_or_operations') return ['rollout', 'workflow', 'documentation', 'training']
  return ['domain', 'workflow', 'user context']
}

function buildEvidenceRoutingHints(
  extracted: Array<{ group: SignalGroup; signals: string[] }>,
): CompanyIndustryBasis['evidenceRoutingHints'] {
  return extracted.map(({ group, signals }) => ({
    evidenceType: group.proofTheme,
    preferredResumeSection: group.expectedUse === 'summary_positioning' ? 'summary' : 'experience',
    reason: `Route evidence for "${signals[0]}" into ${group.expectedUse}; unsupported context stays as bridge-question direction.`,
  })).slice(0, MAX_EVIDENCE_ROUTING_HINTS)
}

function normalizeIndustry(industry: string | undefined, company: string): { label: string; source: 'user_note' } | undefined {
  const value = industry?.trim()
  if (!value) return undefined
  if (company.trim() && value.toLowerCase() === company.trim().toLowerCase()) return undefined
  return { label: value, source: 'user_note' }
}

function inferIndustry(
  company: string,
  jdText: string,
  notes: string,
): { label: string; source: 'jd' | 'inference' } {
  const text = `${company} ${jdText} ${notes}`.toLowerCase()
  if (/\bmcdonald'?s?\b/.test(text) && /\b(supply chain|logistics|distribution)\b/.test(text)) {
    return { label: 'restaurant supply-chain technology', source: 'inference' }
  }
  if (/\bmcdonald'?s?\b/.test(text) && /\b(restaurant|store|pos|field|digital|technology|product)\b/.test(text)) {
    return { label: 'restaurant technology', source: 'inference' }
  }
  if (/\b(restaurant|quick[-\s]?service|qsr|franchise|store operations)\b/.test(text)) {
    return { label: 'quick-service restaurant operations', source: 'jd' }
  }
  if (/\b(logistics|distribution|scheduling|supply chain)\b/.test(text)) {
    return { label: 'logistics / operations', source: 'jd' }
  }
  if (/\b(fintech|banking|lending|payments|credit union|financial services)\b/.test(text)) {
    return { label: 'financial services technology', source: 'jd' }
  }
  if (/\b(healthcare|clinical|patient|payer|provider)\b/.test(text)) {
    return { label: 'healthcare technology', source: 'jd' }
  }
  return { label: 'unknown', source: 'inference' }
}

function domainTermsFromSignals(extracted: Array<{ group: SignalGroup; signals: string[] }>): string[] {
  return [...new Set(
    extracted
      .filter(item => item.group.perspective === 'industry_domain_language')
      .flatMap(item => item.signals)
      .flatMap(signal => signal.match(/\b(?:restaurant|retail|store|POS|logistics|scheduling|distribution|field operations)\b/gi) ?? []),
  )].slice(0, 6)
}

function joinSignals(signals: string[]): string {
  return signals.slice(0, 2).join('; ')
}

function extractToolsOrMethods(text: string): string[] {
  const terms = ['Jira', 'Confluence', 'Salesforce', 'SQL', 'Tableau', 'Power BI', 'Scrum', 'Agile', 'UAT', 'Pendo']
  return terms.filter(term => new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text))
}
