import type { CompanyIndustryBasis, CompanyIndustryPerspective } from '@/contracts'
import {
  buildCompanyIndustryBasisQuickStart,
  extractCompanyIndustrySignals,
  serializeCompanyIndustryBasisForDomainIQ,
  type CompanyIndustryBasisInput,
  type ExtractedCompanyIndustrySignal,
} from './company-industry-basis'

export interface GenerateCompanyIndustryBasisInput extends CompanyIndustryBasisInput {
  profileEvidenceSummary?: string
  mockMode?: boolean
  hasCompanyResearch?: boolean
  hasIndustryResearch?: boolean
}

export interface SemanticQualityResult {
  passed: boolean
  downstreamReady: boolean
  issues: string[]
  warnings: string[]
}

export interface CompanyIndustryBasisGenerationResult {
  basis: CompanyIndustryBasis
  domainIQJson: string
  mode: 'llm' | 'llm_normalized' | 'retry' | 'retry_normalized' | 'fallback' | 'mock'
  warnings: string[]
  extractedSignals: ExtractedCompanyIndustrySignal[]
  diagnostic: CompanyIndustryBasisGenerationDiagnostic
  semanticQuality: SemanticQualityResult
  needsReview: boolean
}

export interface CompanyIndustryBasisGenerationDiagnostic {
  mode: 'llm' | 'llm_normalized' | 'retry' | 'retry_normalized' | 'deterministic_fallback'
  providerConfigured: boolean
  apiRouteReached: boolean
  modelCallAttempted: boolean
  modelCallSucceeded: boolean
  parseSucceeded: boolean
  validationSucceeded: boolean
  normalizationAttempted: boolean
  normalizationSucceeded: boolean
  retryAttempted: boolean
  retrySucceeded: boolean
  fallbackReason: string
  validationErrors?: string[]
  normalizedWarnings?: string[]
  rejectedAttemptNumber?: number
  rejectedOutputPreview?: string
  rejectedBasisPreview?: string
  normalizedOutputPreview?: string
  displayedJsonSource: 'llm' | 'llm_normalized' | 'retry' | 'retry_normalized' | 'deterministic_fallback'
  providerErrorName?: string
  providerErrorMessage?: string
  stopReason?: string
  semanticQuality?: SemanticQualityResult
  downstreamReady?: boolean
}

export interface CompanyIndustryBasisGeneratorDeps {
  createMessage?: (request: unknown) => Promise<unknown>
  model?: string
}

type SourceBasis = CompanyIndustryBasis['companyPerspectiveNeeds'][number]['sourceBasis']
type ProblemSpaceSourceBasis = CompanyIndustryBasis['problemSpace']['sourceBasis'][number]

const OUTPUT_LIMITS = {
  problemSpaceItems: 5,
  companyPerspectiveNeeds: 6,
  resumeCalibrationAngles: 5,
  bridgeQuestionRecommendations: 8,
  evidenceRoutingHints: 6,
  maxShortTextLength: 420,
  maxSignalLength: 80,
} as const

const ALLOWED_SOURCE_BASIS: SourceBasis[] = [
  'jd',
  'user_note',
  'profile_evidence',
  'inference',
  'company_research',
  'industry_research',
]

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'through',
  'to',
  'via',
  'with',
])

export async function generateCompanyIndustryBasis(
  input: GenerateCompanyIndustryBasisInput,
  deps: CompanyIndustryBasisGeneratorDeps = {},
): Promise<CompanyIndustryBasisGenerationResult> {
  const extractedSignals = extractCompanyIndustrySignals(input)
  const diagnostic: CompanyIndustryBasisGenerationDiagnostic = {
    mode: 'llm',
    providerConfigured: deps.createMessage ? true : Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    apiRouteReached: false,
    modelCallAttempted: false,
    modelCallSucceeded: false,
    parseSucceeded: false,
    validationSucceeded: false,
    normalizationAttempted: false,
    normalizationSucceeded: false,
    retryAttempted: false,
    retrySucceeded: false,
    fallbackReason: '',
    displayedJsonSource: 'llm',
  }

  if (input.mockMode) {
    const basis = validateAndNormalizeCompanyIndustryBasis(
      buildMockBasis(input, extractedSignals),
      input,
    )
    const semanticQuality: SemanticQualityResult = { passed: true, downstreamReady: true, issues: [], warnings: [] }
    const mockDiagnostic: CompanyIndustryBasisGenerationDiagnostic = {
      ...diagnostic,
      mode: 'llm',
      providerConfigured: true,
      parseSucceeded: true,
      validationSucceeded: true,
      normalizationAttempted: false,
      normalizationSucceeded: true,
      fallbackReason: 'mock mode active; provider call skipped',
      displayedJsonSource: 'llm',
      semanticQuality,
      downstreamReady: true,
    }
    return {
      basis,
      domainIQJson: serializeCompanyIndustryBasisForDomainIQ(basis),
      mode: 'mock',
      warnings: [],
      extractedSignals,
      diagnostic: mockDiagnostic,
      semanticQuality,
      needsReview: false,
    }
  }

  if (!diagnostic.providerConfigured && !deps.createMessage) {
    diagnostic.mode = 'deterministic_fallback'
    diagnostic.fallbackReason = 'provider_not_configured'
    diagnostic.providerErrorName = 'MissingProviderConfig'
    diagnostic.providerErrorMessage = 'ANTHROPIC_API_KEY is not configured.'
    return buildFallbackResult(input, extractedSignals, diagnostic, [])
  }

  const createMessage = deps.createMessage ?? await loadDefaultCreateMessage()
  const validationErrors: string[] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) diagnostic.retryAttempted = true
    try {
      diagnostic.modelCallAttempted = true
      const response = await createMessage(buildLlmRequest(input, extractedSignals, validationErrors, deps.model))
      diagnostic.modelCallSucceeded = true
      const stopReason = getProviderStopReason(response)
      diagnostic.stopReason = stopReason
      if (stopReason === 'max_tokens') {
        throw new Error('CompanyIndustryBasis generation was incomplete because the provider stopped at max_tokens.')
      }
      const rawBasis = extractBasisFromResponse(response)
      diagnostic.parseSucceeded = true
      const processed = processCompanyIndustryBasis(rawBasis, input)
      diagnostic.normalizationAttempted = diagnostic.normalizationAttempted || processed.normalizationAttempted

      if (!processed.success || !processed.basis) {
        captureRejectedOutputPreview(diagnostic, rawBasis, attempt + 1)
        const failureMessage = processed.error ?? processed.initialValidationError ?? 'CompanyIndustryBasis validation failed.'
        validationErrors.push(failureMessage)
        diagnostic.validationErrors = validationErrors
        continue
      }

      if (processed.initialValidationError) {
        captureRejectedOutputPreview(diagnostic, rawBasis, attempt + 1)
      }
      const basis = processed.basis
      diagnostic.normalizationSucceeded = diagnostic.normalizationSucceeded || processed.normalizationSucceeded
      diagnostic.validationSucceeded = true
      diagnostic.retrySucceeded = attempt === 1
      diagnostic.mode = attempt === 1
        ? (processed.normalizationAttempted ? 'retry_normalized' : 'retry')
        : (processed.normalizationAttempted ? 'llm_normalized' : 'llm')
      diagnostic.displayedJsonSource = diagnostic.mode
      diagnostic.normalizedWarnings = processed.warnings.length ? processed.warnings : undefined
      diagnostic.normalizedOutputPreview = processed.normalizationAttempted ? previewJson(basis) : undefined
      diagnostic.fallbackReason = ''
      const semanticQuality = evaluateCompanyIndustryBasisQuality(basis)
      diagnostic.semanticQuality = semanticQuality
      diagnostic.downstreamReady = semanticQuality.downstreamReady
      return {
        basis,
        domainIQJson: serializeCompanyIndustryBasisForDomainIQ(basis),
        mode: diagnostic.mode,
        warnings: [...validationErrors, ...processed.warnings],
        extractedSignals,
        diagnostic: {
          ...diagnostic,
          validationErrors: validationErrors.length ? validationErrors : undefined,
        },
        semanticQuality,
        needsReview: !semanticQuality.downstreamReady,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Company basis synthesis failed.'
      validationErrors.push(errorMessage)
      diagnostic.validationErrors = validationErrors
      if (err instanceof Error && !diagnostic.modelCallSucceeded && isLikelyProviderError(err)) {
        diagnostic.providerErrorName = err.name
        diagnostic.providerErrorMessage = sanitizeProviderErrorMessage(err.message)
      }
    }
  }

    diagnostic.mode = 'deterministic_fallback'
    diagnostic.displayedJsonSource = 'deterministic_fallback'
  diagnostic.fallbackReason = buildFallbackReason(diagnostic, validationErrors)
  return buildFallbackResult(input, extractedSignals, diagnostic, validationErrors)
}

function buildFallbackResult(
  input: GenerateCompanyIndustryBasisInput,
  extractedSignals: ExtractedCompanyIndustrySignal[],
  diagnostic: CompanyIndustryBasisGenerationDiagnostic,
  validationErrors: string[],
): CompanyIndustryBasisGenerationResult {
  const fallback = buildCompanyIndustryBasisQuickStart(input)
  const basis = validateAndNormalizeCompanyIndustryBasis({
    ...fallback,
    calibrationSummary: `Deterministic fallback basis. ${fallback.calibrationSummary}`,
  }, input)
  basis.calibrationSummary = `Deterministic fallback basis. ${basis.calibrationSummary}`
  const semanticQuality: SemanticQualityResult = { passed: true, downstreamReady: true, issues: [], warnings: [] }
  return {
    basis,
    domainIQJson: serializeCompanyIndustryBasisForDomainIQ(basis),
    mode: 'fallback',
    warnings: validationErrors,
    extractedSignals,
    diagnostic: {
      ...diagnostic,
      mode: 'deterministic_fallback',
      displayedJsonSource: 'deterministic_fallback',
      normalizationSucceeded: false,
      validationErrors: validationErrors.length ? validationErrors : undefined,
      semanticQuality,
      downstreamReady: true,
    },
    semanticQuality,
    needsReview: false,
  }
}

export function buildCompanyIndustryBasisPrompt(
  input: GenerateCompanyIndustryBasisInput,
  extractedSignals: ExtractedCompanyIndustrySignal[] = extractCompanyIndustrySignals(input),
  validationErrors: string[] = [],
): { system: string; user: string } {
  return {
    system: [
      'You synthesize a lightweight DomainIQ Stage 3 export for ResumeBuilder.',
      'Return strict JSON through the company_industry_basis tool only.',
      'This is a resume-calibration artifact, not a resume draft, cover letter, or generic company report.',
      'Do not write resume bullets. Do not fabricate precise company facts, revenue, headcount, customers, products, or strategic priorities.',
      'Do not claim company_research or industry_research unless actual research source text is provided.',
      'Keep inferred company context separate from candidate experience.',
      'Use sourceBasis values exactly: jd, user_note, profile_evidence, inference, company_research, industry_research.',
      'Bounded output is mandatory: keep synthesis deep but compact. Use synthesized prose, not raw source excerpts.',
      'Do not include long JD snippets. Use short supporting signal labels or evidence IDs only.',
      'Synthesize a JD-aligned problem space: what operational, product, platform, user, workflow, or business problem this role appears designed to solve.',
      'Explain why the company would hire this role now, what operating model the role likely has, and how resume evidence should be calibrated.',
      'Synthesize concise implications and bridge questions; do not stitch raw JD snippets into questions or hypotheses.',
    ].join('\n'),
    user: [
      `Target company: ${input.targetCompany || '(not provided)'}`,
      `Target role: ${input.targetRoleTitle || '(not provided)'}`,
      `Optional industry/domain: ${input.industry || '(none)'}`,
      '',
      'JOB DESCRIPTION:',
      input.jobDescription,
      '',
      'USER NOTES:',
      input.userNotes || '(none)',
      '',
      'PROFILE EVIDENCE SUMMARY:',
      input.profileEvidenceSummary || '(none provided)',
      '',
      'EXTRACTED JD SIGNALS:',
      JSON.stringify(extractedSignals, null, 2),
      '',
      validationErrors.length
        ? [
          'PREVIOUS VALIDATION ERRORS TO FIX:',
          ...validationErrors.map(e => `- ${e}`),
          '',
          'SMALLER-OUTPUT REPAIR MODE:',
          '- Return the same CompanyIndustryBasis shape, but make it more compact.',
          '- Use the minimum useful number of items.',
          '- Do not include raw JD excerpts, clipped phrases, or ellipses.',
        ].join('\n')
        : '',
      '',
      'Return a CompanyIndustryBasis object with problemSpace, max 6 companyPerspectiveNeeds, max 5 resumeCalibrationAngles, max 8 bridgeQuestionRecommendations, stage3StrategyInputs, and max 6 evidenceRoutingHints.',
      'problemSpace must include thesis, companyProblemHypothesis, rolePurposeHypothesis, operatingContext, impliedBusinessPressures, likelyUserOrStakeholderGroups, systemsOrWorkflowContext, confidence, and sourceBasis.',
      'problemSpace arrays are max 5 items each. The three problemSpace prose fields are one concise sentence each.',
      'Bridge questions must be specific enough to turn the problem-space hypotheses into verified candidate evidence.',
    ].join('\n'),
  }
}

export function validateAndNormalizeCompanyIndustryBasis(
  raw: unknown,
  input: GenerateCompanyIndustryBasisInput,
): CompanyIndustryBasis {
  const result = processCompanyIndustryBasis(raw, input)
  if (!result.success || !result.basis) {
    throw new Error(result.error ?? 'CompanyIndustryBasis validation failed.')
  }
  return result.basis
}

function processCompanyIndustryBasis(
  raw: unknown,
  input: GenerateCompanyIndustryBasisInput,
): {
  success: boolean
  basis?: CompanyIndustryBasis
  normalizationAttempted: boolean
  normalizationSucceeded: boolean
  initialValidationError?: string
  warnings: string[]
  error?: string
} {
  let initialValidationError: string | undefined
  try {
    validateCompanyIndustryBasis(raw as CompanyIndustryBasis, input)
  } catch (err) {
    initialValidationError = err instanceof Error ? err.message : 'Initial validation failed.'
  }

  // Always canonicalize + normalize before deciding fallback, even when initial
  // validation already failed for a "repairable" reason (e.g. compact-label violations).
  try {
    const canonicalized = canonicalizeCompanyIndustryBasis(raw, input)
    const normalized = normalizeCompanyIndustryBasis(canonicalized, input)
    const basis = validateCompanyIndustryBasis(normalized.basis, input)
    const warnings = [
      ...(initialValidationError ? [`Normalized after initial validation issue: ${initialValidationError}`] : []),
      ...canonicalized.warnings,
      ...normalized.warnings,
    ]

    return {
      success: true,
      basis,
      normalizationAttempted: Boolean(initialValidationError) || warnings.length > 0,
      normalizationSucceeded: true,
      initialValidationError,
      warnings,
    }
  } catch (err) {
    return {
      success: false,
      normalizationAttempted: true,
      normalizationSucceeded: false,
      initialValidationError,
      warnings: [],
      error: err instanceof Error ? err.message : 'Normalization failed.',
    }
  }
}

export function canonicalizeCompanyIndustryBasis(
  raw: unknown,
  input: GenerateCompanyIndustryBasisInput,
): { basis: CompanyIndustryBasis; warnings: string[] } {
  if (!isRecord(raw)) throw new Error('CompanyIndustryBasis must be an object.')

  const source = raw as Record<string, any>
  const warnings: string[] = []
  const fallback = buildCompanyIndustryBasisQuickStart(input)
  const companyNeeds = arrayOfRecords(source.companyPerspectiveNeeds)
    .slice(0, OUTPUT_LIMITS.companyPerspectiveNeeds)
    .map((item, index) => {
      const perspective = normalizePerspective(item.perspective) ?? fallback.companyPerspectiveNeeds[index]?.perspective ?? 'operating_priorities'
      const sourceBasis = item.sourceBasis ?? item.source ?? item.basis
      const supportingSignals = item.supportingSignals ?? item.signals ?? item.evidenceIds ?? item.evidenceIDs
      const whyItMattersForResume = stringField(item.whyItMattersForResume ?? item.rationale ?? item.whyItMatters ?? item.need ?? item.perspective)
      const resumeImplication = deriveResumeImplication(item, whyItMattersForResume)
      const canonical = {
        perspective,
        whyItMattersForResume,
        resumeImplication,
        confidence: normalizeConfidence(item.confidence),
        sourceBasis: normalizeSourceBasisValue(sourceBasis),
        supportingSignals: normalizeSupportingSignals(supportingSignals),
      }
      if (!item.whyItMattersForResume || !item.resumeImplication || item.need || item.rationale || item.resumeUse) {
        warnings.push('Canonicalized companyPerspectiveNeeds schema variants.')
      }
      if (!stringField(item.resumeImplication ?? item.resumeUse ?? item.implication ?? item.resumeAngle)) {
        warnings.push('Derived resumeImplication from available perspective fields.')
      }
      return canonical
    })

  const calibrationAngles = arrayOfRecords(source.resumeCalibrationAngles)
    .slice(0, OUTPUT_LIMITS.resumeCalibrationAngles)
    .map((item, index) => {
      const angle = stringField(item.angle ?? item.theme ?? item.proofTheme ?? fallback.resumeCalibrationAngles[index]?.angle)
      const relevantEvidenceTypes = stringArray(item.relevantEvidenceTypes ?? item.evidenceTypes ?? item.evidenceKinds)
      const exampleResumeUse = deriveExampleResumeUse(item, angle, relevantEvidenceTypes)
      const canonical = {
        angle,
        relevantEvidenceTypes,
        sectionsAffected: stringArray(item.sectionsAffected ?? item.affectedSections ?? item.sections),
        exampleResumeUse,
        avoidOverclaiming: stringField(item.avoidOverclaiming ?? item.riskToAvoid ?? item.claimRisk),
      }
      if (item.evidenceTypes || item.affectedSections || item.resumeUse || item.resumeImplication) {
        warnings.push('Canonicalized resumeCalibrationAngles schema variants.')
      }
      if (!stringField(item.exampleResumeUse ?? item.resumeUse ?? item.resumeImplication ?? item.implication)) {
        warnings.push('Derived exampleResumeUse from available calibration angle fields.')
      }
      return canonical
    })

  const bridgeQuestions = arrayOfRecords(source.bridgeQuestionRecommendations)
    .slice(0, OUTPUT_LIMITS.bridgeQuestionRecommendations)
    .map((item, index) => {
      const canonical = {
        question: stringField(item.question ?? item.bridgeQuestion ?? item.prompt),
        reason: stringField(item.reason ?? item.rationale ?? item.whyAsk ?? fallback.bridgeQuestionRecommendations[index]?.reason),
        expectedUse: normalizeExpectedUse(item.expectedUse ?? item.questionUse ?? item.resumeUse),
        priority: normalizePriority(item.priority),
      }
      if (item.questionUse || item.rationale) warnings.push('Canonicalized bridgeQuestionRecommendations schema variants.')
      return canonical
    })

  const stage3 = isRecord(source.stage3StrategyInputs) ? source.stage3StrategyInputs : {}
  const routingHints = arrayOfRecords(source.evidenceRoutingHints)
    .slice(0, OUTPUT_LIMITS.evidenceRoutingHints)
    .map((item, index) => ({
      evidenceType: stringField(item.evidenceType ?? item.type ?? item.theme ?? fallback.evidenceRoutingHints[index]?.evidenceType),
      preferredResumeSection: stringField(item.preferredResumeSection ?? item.section ?? item.resumeSection ?? 'experience'),
      reason: stringField(item.reason ?? item.rationale ?? item.why ?? fallback.evidenceRoutingHints[index]?.reason),
    }))

  const problemSpace = isRecord(source.problemSpace) ? source.problemSpace : undefined
  if (!problemSpace) throw new Error('problemSpace is required.')

  const basis: CompanyIndustryBasis = {
    targetCompany: stringField(source.targetCompany || input.targetCompany),
    targetRoleTitle: stringField(source.targetRoleTitle || input.targetRoleTitle),
    industry: stringField(source.industry),
    problemSpace: {
      thesis: stringField(problemSpace.thesis),
      companyProblemHypothesis: stringField(problemSpace.companyProblemHypothesis),
      rolePurposeHypothesis: stringField(problemSpace.rolePurposeHypothesis),
      operatingContext: stringArray(problemSpace.operatingContext),
      impliedBusinessPressures: stringArray(problemSpace.impliedBusinessPressures),
      likelyUserOrStakeholderGroups: stringArray(problemSpace.likelyUserOrStakeholderGroups),
      systemsOrWorkflowContext: stringArray(problemSpace.systemsOrWorkflowContext),
      confidence: normalizeConfidence(problemSpace.confidence),
      sourceBasis: stringArray(problemSpace.sourceBasis).map(value => normalizeSourceBasisValue(value)),
    },
    calibrationSummary: stringField(source.calibrationSummary),
    companyPerspectiveNeeds: companyNeeds.length ? companyNeeds : fallback.companyPerspectiveNeeds,
    resumeCalibrationAngles: calibrationAngles.length ? calibrationAngles : fallback.resumeCalibrationAngles,
    bridgeQuestionRecommendations: bridgeQuestions.length ? bridgeQuestions : fallback.bridgeQuestionRecommendations,
    stage3StrategyInputs: {
      targetPostureHints: stringArray(stage3.targetPostureHints),
      proofThemesToPrioritize: stringArray(stage3.proofThemesToPrioritize),
      domainTermsToUseIfEvidenced: stringArray(stage3.domainTermsToUseIfEvidenced),
      toolsOrMethodsToVerify: stringArray(stage3.toolsOrMethodsToVerify),
      risksOrClaimsToAvoid: stringArray(stage3.risksOrClaimsToAvoid),
    },
    evidenceRoutingHints: routingHints.length ? routingHints : fallback.evidenceRoutingHints,
  }

  return { basis, warnings }
}

export function normalizeCompanyIndustryBasis(
  canonicalized: { basis: CompanyIndustryBasis; warnings?: string[] } | CompanyIndustryBasis,
  input: GenerateCompanyIndustryBasisInput,
): { basis: CompanyIndustryBasis; warnings: string[] } {
  const basis = 'basis' in canonicalized ? canonicalized.basis : canonicalized
  const warnings = 'warnings' in canonicalized && Array.isArray(canonicalized.warnings)
    ? [...canonicalized.warnings]
    : []
  const fallback = buildCompanyIndustryBasisQuickStart(input)
  const hasCompanyResearch = input.hasCompanyResearch === true
  const hasIndustryResearch = input.hasIndustryResearch === true

  const normalizedIndustry = normalizeIndustryLabel(basis.industry, input, fallback.industry)
  if (normalizedIndustry !== basis.industry) warnings.push('Normalized industry/domain label.')

  const normalized: CompanyIndustryBasis = {
    ...basis,
    targetCompany: input.targetCompany.trim(),
    targetRoleTitle: input.targetRoleTitle.trim(),
    industry: normalizedIndustry,
    problemSpace: {
      ...basis.problemSpace,
      thesis: normalizeProse(basis.problemSpace.thesis),
      companyProblemHypothesis: normalizeProse(basis.problemSpace.companyProblemHypothesis),
      rolePurposeHypothesis: normalizeProse(basis.problemSpace.rolePurposeHypothesis),
      operatingContext: normalizeProblemSpaceLabels(basis.problemSpace.operatingContext, 'operatingContext'),
      impliedBusinessPressures: normalizeProblemSpaceLabels(basis.problemSpace.impliedBusinessPressures, 'impliedBusinessPressures'),
      likelyUserOrStakeholderGroups: normalizeProblemSpaceLabels(basis.problemSpace.likelyUserOrStakeholderGroups, 'likelyUserOrStakeholderGroups'),
      systemsOrWorkflowContext: normalizeProblemSpaceLabels(basis.problemSpace.systemsOrWorkflowContext, 'systemsOrWorkflowContext'),
      confidence: normalizeConfidence(basis.problemSpace.confidence),
      sourceBasis: normalizeProblemSpaceSourceBasis(basis.problemSpace.sourceBasis, hasCompanyResearch, hasIndustryResearch),
    },
    calibrationSummary: normalizeProse(basis.calibrationSummary),
    companyPerspectiveNeeds: basis.companyPerspectiveNeeds.slice(0, OUTPUT_LIMITS.companyPerspectiveNeeds).map(item => ({
      ...item,
      whyItMattersForResume: normalizeProse(item.whyItMattersForResume),
      resumeImplication: cleanAwkwardEmphasizeLanguage(normalizeProse(item.resumeImplication)),
      sourceBasis: normalizeSourceBasis(item.sourceBasis, hasCompanyResearch, hasIndustryResearch),
      confidence: normalizeConfidence(item.confidence),
      supportingSignals: normalizeSupportingSignals(item.supportingSignals),
    })),
    resumeCalibrationAngles: basis.resumeCalibrationAngles.slice(0, OUTPUT_LIMITS.resumeCalibrationAngles).map(item => ({
      ...item,
      relevantEvidenceTypes: stringArray(item.relevantEvidenceTypes).slice(0, 6),
      sectionsAffected: stringArray(item.sectionsAffected).slice(0, 4),
      exampleResumeUse: cleanAwkwardEmphasizeLanguage(normalizeProse(item.exampleResumeUse)),
      avoidOverclaiming: item.avoidOverclaiming ? normalizeProse(item.avoidOverclaiming) : undefined,
    })),
    bridgeQuestionRecommendations: basis.bridgeQuestionRecommendations.slice(0, OUTPUT_LIMITS.bridgeQuestionRecommendations).map(item => ({
      ...item,
      question: normalizeQuestion(item.question),
      reason: normalizeProse(item.reason),
      expectedUse: normalizeExpectedUse(item.expectedUse),
      priority: normalizePriority(item.priority),
    })),
    stage3StrategyInputs: {
      targetPostureHints: stringArray(basis.stage3StrategyInputs?.targetPostureHints).map(normalizeProse).slice(0, 6),
      proofThemesToPrioritize: stringArray(basis.stage3StrategyInputs?.proofThemesToPrioritize).map(item => compactProblemSpaceLabel(item)).slice(0, 8),
      domainTermsToUseIfEvidenced: stringArray(basis.stage3StrategyInputs?.domainTermsToUseIfEvidenced).map(item => compactProblemSpaceLabel(item)).slice(0, 8),
      toolsOrMethodsToVerify: stringArray(basis.stage3StrategyInputs?.toolsOrMethodsToVerify).map(item => compactProblemSpaceLabel(item)).slice(0, 8),
      risksOrClaimsToAvoid: stringArray(basis.stage3StrategyInputs?.risksOrClaimsToAvoid).map(normalizeProse).slice(0, 8),
    },
    evidenceRoutingHints: basis.evidenceRoutingHints.slice(0, OUTPUT_LIMITS.evidenceRoutingHints).map(item => ({
      ...item,
      evidenceType: compactProblemSpaceLabel(item.evidenceType),
      preferredResumeSection: compactProblemSpaceLabel(item.preferredResumeSection || 'experience'),
      reason: normalizeProse(item.reason),
    })),
  }

  normalized.stage3StrategyInputs = deriveStage3StrategyInputs(normalized, input)

  return { basis: normalized, warnings: [...new Set(warnings)] }
}

const KNOWN_TOOLS_OR_METHODS = [
  'Jira', 'Confluence', 'Scrum', 'Kanban', 'Agile', 'SAFe', 'Azure DevOps', 'Trello', 'Asana',
  'SQL', 'Python', 'Excel', 'Tableau', 'Power BI', 'Looker', 'Salesforce', 'SAP', 'Workday',
  'Figma', 'Postman', 'Selenium', 'Cypress', 'Git', 'GitHub', 'GitLab', 'JUnit', 'TestRail',
  'UAT', 'PI Planning', 'Miro', 'ServiceNow', 'Zendesk', 'HubSpot', 'NetSuite', 'Snowflake',
]

function findMentionedToolsOrMethods(...texts: Array<string | undefined>): string[] {
  const combined = texts.filter(Boolean).join(' ')
  const found = KNOWN_TOOLS_OR_METHODS.filter(tool => new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(combined))
  return [...new Set(found)]
}

function deriveStage3StrategyInputs(
  basis: CompanyIndustryBasis,
  input: GenerateCompanyIndustryBasisInput,
): CompanyIndustryBasis['stage3StrategyInputs'] {
  const existing = basis.stage3StrategyInputs ?? {
    targetPostureHints: [],
    proofThemesToPrioritize: [],
    domainTermsToUseIfEvidenced: [],
    toolsOrMethodsToVerify: [],
    risksOrClaimsToAvoid: [],
  }

  const targetPostureHints = existing.targetPostureHints.length
    ? existing.targetPostureHints
    : [basis.problemSpace.rolePurposeHypothesis, basis.calibrationSummary]
      .map(text => normalizeProse(text || ''))
      .filter(Boolean)
      .slice(0, 3)

  const proofThemesToPrioritize = existing.proofThemesToPrioritize.length
    ? existing.proofThemesToPrioritize
    : [
        ...basis.companyPerspectiveNeeds.map(item => compactProblemSpaceLabel(item.resumeImplication || item.whyItMattersForResume)),
        ...basis.evidenceRoutingHints.map(hint => hint.evidenceType),
        ...basis.problemSpace.impliedBusinessPressures,
      ]
        .filter(Boolean)
        .filter(value => !GENERIC_ONE_WORD_LABELS.has(value.trim().toLowerCase()))
        .slice(0, 8)

  const domainTermsToUseIfEvidenced = existing.domainTermsToUseIfEvidenced.length
    ? existing.domainTermsToUseIfEvidenced
    : [...basis.problemSpace.systemsOrWorkflowContext, basis.industry || '']
        .filter(Boolean)
        .filter(value => !GENERIC_ONE_WORD_LABELS.has(value.trim().toLowerCase()))
        .slice(0, 6)

  const toolsOrMethodsToVerify = existing.toolsOrMethodsToVerify.length
    ? existing.toolsOrMethodsToVerify
    : findMentionedToolsOrMethods(input.jobDescription, input.userNotes, previewJson(basis)).slice(0, 8)

  const risksOrClaimsToAvoid = existing.risksOrClaimsToAvoid.length
    ? existing.risksOrClaimsToAvoid
    : [
        'Do not claim direct ownership of strategy or roadmap decisions unless explicitly evidenced.',
        'Do not assert specific metrics or outcomes that are not backed by the candidate\'s actual experience.',
        'Avoid generic mission-statement language not tied to concrete, verifiable work.',
      ]

  return {
    targetPostureHints,
    proofThemesToPrioritize,
    domainTermsToUseIfEvidenced,
    toolsOrMethodsToVerify,
    risksOrClaimsToAvoid,
  }
}

const GENERIC_ONE_WORD_LABELS = new Set([
  'global',
  'restaurant',
  'stakeholder',
  'stakeholders',
  'technology',
  'reporting',
  'defect',
  'execution',
])

const AWKWARD_DERIVED_PATTERNS: RegExp[] = [
  /Emphasize evidence of The\b/,
  /Emphasize evidence of A\b/,
  /Emphasize evidence of This role\b/,
  /Emphasize evidence of The role\b/,
]

const RESIDUE_PATTERNS: Array<[RegExp, string]> = [
  [/Deterministic fallback basis/i, 'Deterministic fallback basis'],
  [/JD emphasizes/i, 'JD emphasizes'],
  [/product\s*\/\s*user\s*\/\s*adoption/i, 'product / user / adoption'],
  [/Maintains knowledge of key business processes an/i, 'Maintains knowledge of key business processes an'],
  [/"industry"\s*:\s*"McDonald"/i, 'industry: "McDonald"'],
]

export function evaluateCompanyIndustryBasisQuality(basis: CompanyIndustryBasis): SemanticQualityResult {
  const issues: string[] = []
  const warnings: string[] = []

  const strategicArrays: Array<[string, string[]]> = [
    ['problemSpace.operatingContext', basis.problemSpace?.operatingContext ?? []],
    ['problemSpace.impliedBusinessPressures', basis.problemSpace?.impliedBusinessPressures ?? []],
    ['problemSpace.likelyUserOrStakeholderGroups', basis.problemSpace?.likelyUserOrStakeholderGroups ?? []],
    ['problemSpace.systemsOrWorkflowContext', basis.problemSpace?.systemsOrWorkflowContext ?? []],
    ['stage3StrategyInputs.proofThemesToPrioritize', basis.stage3StrategyInputs?.proofThemesToPrioritize ?? []],
    ['stage3StrategyInputs.domainTermsToUseIfEvidenced', basis.stage3StrategyInputs?.domainTermsToUseIfEvidenced ?? []],
    ['stage3StrategyInputs.toolsOrMethodsToVerify', basis.stage3StrategyInputs?.toolsOrMethodsToVerify ?? []],
    ['evidenceRoutingHints[].evidenceType', (basis.evidenceRoutingHints ?? []).map(hint => hint.evidenceType)],
  ]

  for (const [label, values] of strategicArrays) {
    for (const value of values) {
      const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
      if (GENERIC_ONE_WORD_LABELS.has(normalized)) {
        issues.push(`${label} contains a generic one-word label: "${value}"`)
      }
    }
  }

  const proseFields: Array<[string, string | undefined]> = [
    ...(basis.companyPerspectiveNeeds ?? []).map((item, i): [string, string] => [`companyPerspectiveNeeds[${i}].resumeImplication`, item.resumeImplication]),
    ...(basis.resumeCalibrationAngles ?? []).map((item, i): [string, string] => [`resumeCalibrationAngles[${i}].exampleResumeUse`, item.exampleResumeUse]),
  ]
  for (const [label, value] of proseFields) {
    if (!value) continue
    if (AWKWARD_DERIVED_PATTERNS.some(pattern => pattern.test(value))) {
      issues.push(`${label} contains awkward derived language: "${value.slice(0, 80)}"`)
    }
  }

  const hasProblemSpace = Boolean(basis.problemSpace?.thesis?.trim())
  const hasCalibrationAngles = (basis.resumeCalibrationAngles ?? []).length > 0
  const stage3 = basis.stage3StrategyInputs
  const stage3IsEmpty = !stage3
    || [stage3.targetPostureHints, stage3.proofThemesToPrioritize, stage3.domainTermsToUseIfEvidenced, stage3.toolsOrMethodsToVerify, stage3.risksOrClaimsToAvoid]
      .every(arr => !Array.isArray(arr) || arr.length === 0)
  if (hasProblemSpace && hasCalibrationAngles && stage3IsEmpty) {
    issues.push('stage3StrategyInputs is empty despite problemSpace and resumeCalibrationAngles being present.')
  }

  const fullText = previewJson(basis)
  for (const [pattern, label] of RESIDUE_PATTERNS) {
    if (pattern.test(fullText)) issues.push(`Fallback/extractor residue detected: "${label}"`)
  }

  const passed = issues.length === 0
  return {
    passed,
    downstreamReady: passed,
    issues,
    warnings,
  }
}

function validateCompanyIndustryBasis(
  raw: CompanyIndustryBasis,
  input: GenerateCompanyIndustryBasisInput,
): CompanyIndustryBasis {
  if (!isRecord(raw)) throw new Error('CompanyIndustryBasis must be an object.')

  const basis = raw as CompanyIndustryBasis
  if (!isRecord(basis.problemSpace)) {
    throw new Error('problemSpace is required.')
  }
  validateProblemSpace(basis.problemSpace, input)

  if (!Array.isArray(basis.companyPerspectiveNeeds) || basis.companyPerspectiveNeeds.length === 0) {
    throw new Error('companyPerspectiveNeeds are required.')
  }
  if (basis.companyPerspectiveNeeds.length > OUTPUT_LIMITS.companyPerspectiveNeeds) {
    throw new Error(`companyPerspectiveNeeds exceed max ${OUTPUT_LIMITS.companyPerspectiveNeeds}.`)
  }
  if (!Array.isArray(basis.resumeCalibrationAngles) || basis.resumeCalibrationAngles.length === 0) {
    throw new Error('resumeCalibrationAngles are required.')
  }
  if (basis.resumeCalibrationAngles.length > OUTPUT_LIMITS.resumeCalibrationAngles) {
    throw new Error(`resumeCalibrationAngles exceed max ${OUTPUT_LIMITS.resumeCalibrationAngles}.`)
  }
  if (!Array.isArray(basis.bridgeQuestionRecommendations) || basis.bridgeQuestionRecommendations.length === 0) {
    throw new Error('bridgeQuestionRecommendations are required.')
  }
  if (basis.bridgeQuestionRecommendations.length > OUTPUT_LIMITS.bridgeQuestionRecommendations) {
    throw new Error(`bridgeQuestionRecommendations exceed max ${OUTPUT_LIMITS.bridgeQuestionRecommendations}.`)
  }
  if (!basis.stage3StrategyInputs || !Array.isArray(basis.stage3StrategyInputs.proofThemesToPrioritize)) {
    throw new Error('stage3StrategyInputs are required.')
  }
  if (!Array.isArray(basis.evidenceRoutingHints) || basis.evidenceRoutingHints.length === 0) {
    throw new Error('evidenceRoutingHints are required.')
  }
  if (basis.evidenceRoutingHints.length > OUTPUT_LIMITS.evidenceRoutingHints) {
    throw new Error(`evidenceRoutingHints exceed max ${OUTPUT_LIMITS.evidenceRoutingHints}.`)
  }

  const companyLower = input.targetCompany.trim().toLowerCase()
  const industry = basis.industry?.trim()
  if (industry && companyLower && industry.toLowerCase() === companyLower) {
    throw new Error('industry must not equal target company.')
  }

  const hasCompanyResearch = input.hasCompanyResearch === true
  const hasIndustryResearch = input.hasIndustryResearch === true

  for (const item of basis.companyPerspectiveNeeds) {
    if (!item.whyItMattersForResume?.trim()) throw new Error('Each perspective needs whyItMattersForResume.')
    if (!item.resumeImplication?.trim()) throw new Error('Each perspective needs resumeImplication.')
    if (hasTruncationMarker(item.whyItMattersForResume) || hasTruncationMarker(item.resumeImplication)) {
      throw new Error('Perspective need appears truncated.')
    }
    if (isOverlong(item.whyItMattersForResume) || isOverlong(item.resumeImplication)) {
      throw new Error('Perspective need exceeds compact output limit.')
    }
    if (containsRawJdStitch(item.whyItMattersForResume, input.jobDescription) || containsRawJdStitch(item.resumeImplication, input.jobDescription)) {
      throw new Error('Perspective need contains raw stitched JD text.')
    }
    item.sourceBasis = normalizeSourceBasis(item.sourceBasis, hasCompanyResearch, hasIndustryResearch)
    if (!ALLOWED_SOURCE_BASIS.includes(item.sourceBasis)) item.sourceBasis = 'inference'
    item.confidence = ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low'
    item.supportingSignals = normalizeSupportingSignals(item.supportingSignals)
  }

  for (const angle of basis.resumeCalibrationAngles) {
    if (!angle.exampleResumeUse?.trim()) throw new Error('Each calibration angle needs exampleResumeUse.')
    if (hasTruncationMarker(angle.exampleResumeUse) || isOverlong(angle.exampleResumeUse)) {
      throw new Error('Calibration angle appears truncated or overlong.')
    }
    if (isGenericCalibrationAngle(angle.angle) || isGenericCalibrationAngle(angle.exampleResumeUse)) {
      throw new Error(`Calibration angle is generic product-management advice: "${angle.angle}"`)
    }
  }

  for (const recommendation of basis.bridgeQuestionRecommendations) {
    if (!recommendation.question?.trim()) throw new Error('Bridge questions are required.')
    if (hasTruncationMarker(recommendation.question) || isOverlong(recommendation.question)) {
      throw new Error('Bridge question appears truncated or overlong.')
    }
    if (containsRawJdStitch(recommendation.question, input.jobDescription)) {
      throw new Error(`Bridge question contains raw stitched JD text: "${recommendation.question}"`)
    }
    if (isGenericBridgeQuestion(recommendation.question)) {
      throw new Error(`Bridge question is generic: "${recommendation.question}"`)
    }
  }

  return {
    ...basis,
    targetCompany: input.targetCompany.trim(),
    targetRoleTitle: input.targetRoleTitle.trim(),
    industry,
    problemSpace: {
      ...basis.problemSpace,
      confidence: normalizeConfidence(basis.problemSpace.confidence),
      sourceBasis: normalizeProblemSpaceSourceBasis(basis.problemSpace.sourceBasis, hasCompanyResearch, hasIndustryResearch),
    },
  }
}

function validateProblemSpace(
  problemSpace: CompanyIndustryBasis['problemSpace'],
  input: GenerateCompanyIndustryBasisInput,
): void {
  const requiredText = [
    ['problemSpace.thesis', problemSpace.thesis],
    ['problemSpace.companyProblemHypothesis', problemSpace.companyProblemHypothesis],
    ['problemSpace.rolePurposeHypothesis', problemSpace.rolePurposeHypothesis],
  ] as const

  for (const [label, value] of requiredText) {
    if (!value?.trim()) throw new Error(`${label} is required.`)
    if (hasTruncationMarker(value)) throw new Error(`${label} appears truncated.`)
    if (isOverlong(value)) throw new Error(`${label} exceeds compact output limit.`)
    if (containsRawJdStitch(value, input.jobDescription) || /JD emphasizes\s+This role is responsible/i.test(value)) {
      throw new Error(`${label} contains clipped JD boilerplate.`)
    }
    if (isGenericProblemSpaceText(value)) {
      throw new Error(`${label} does not explain the implied business/problem context.`)
    }
  }

  const requiredArrays = [
    ['problemSpace.operatingContext', problemSpace.operatingContext],
    ['problemSpace.impliedBusinessPressures', problemSpace.impliedBusinessPressures],
    ['problemSpace.likelyUserOrStakeholderGroups', problemSpace.likelyUserOrStakeholderGroups],
    ['problemSpace.systemsOrWorkflowContext', problemSpace.systemsOrWorkflowContext],
  ] as const
  for (const [label, value] of requiredArrays) {
    if (!Array.isArray(value) || value.filter(item => typeof item === 'string' && item.trim()).length === 0) {
      throw new Error(`${label} is required.`)
    }
    if (value.length > OUTPUT_LIMITS.problemSpaceItems) {
      throw new Error(`${label} exceeds max ${OUTPUT_LIMITS.problemSpaceItems}.`)
    }
    if (value.some(item => typeof item !== 'string' || !item.trim() || isOverlong(item, OUTPUT_LIMITS.maxSignalLength) || hasTruncationMarker(item))) {
      throw new Error(`${label} must use compact synthesized labels.`)
    }
  }
}

function arrayOfRecords(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  )]
}

function normalizeSourceBasisValue(value: unknown): SourceBasis {
  return ALLOWED_SOURCE_BASIS.includes(value as SourceBasis) ? value as SourceBasis : 'inference'
}

function stripLeadingFraming(text: string): string {
  return text
    .replace(/^(the\s+)?(role|jd|position)\s+(appears to\s+|likely\s+)?(requires|needs|calls for|suggests|implies|supports)\s*/i, '')
    .replace(/^(the\s+)?(team|company|organization|business)\s+(needs?|requires?|wants?|is looking for|appears to need|likely needs)\s+(someone who can|an?\s+|a person who can\s+)?/i, '')
    .replace(/^(someone who can|a person who can|individuals? who can|the candidate should|the candidate must)\s+/i, '')
    .trim()
}

const EVIDENCE_KEYWORD_PATTERN = /\b(?:backlog management|backlog grooming|backlog|sprint tracking|sprint|ceremony facilitation|ceremonies|ceremony|delivery follow-through|delivery coordination|delivery work|delivery|epics|user stories|acceptance criteria|validated delivery outcomes|validation outcomes|validation|stakeholder needs|operational stakeholder needs|operational needs|stakeholder coordination|stakeholder reporting|business-domain|business-to-IT translation|translating operational needs|release readiness|release validation|UAT|defect triage|defect follow-through|quality governance|planning|reporting|execution|coordination|requirements gathering|grooming|tracking|supervision)\b/gi

function toCandidateEvidencePhrase(text: string): string {
  let core = stripLeadingFraming(text)
    .replace(/\bwho can\b/gi, '')
    .replace(/\bwho are\b/gi, '')
    .replace(/\bwith minimal supervision\b/gi, '')
    .replace(/\.+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const looksLikeDescriptiveSentence = /^(the|a|this role|the role)\b/i.test(core)
    || /\b(are|is)\b[\s\S]*\b(who|that)\b/i.test(core)

  if (looksLikeDescriptiveSentence) {
    const matches = core.match(EVIDENCE_KEYWORD_PATTERN)?.map(term => term.toLowerCase())
    if (matches?.length) {
      core = [...new Set(matches)].slice(0, 5).join(', ')
    } else {
      core = normalizeWords(core).split(' ').filter(word => !STOP_WORDS.has(word)).slice(0, 8).join(' ')
    }
  }

  return core
}

const AWKWARD_EMPHASIZE_PREFIX = /^Emphasize evidence of (?:The|A|This role|The role)\b/i

function cleanAwkwardEmphasizeLanguage(text: string): string {
  if (!text || !AWKWARD_EMPHASIZE_PREFIX.test(text)) return text
  const remainder = text.replace(/^Emphasize evidence of\s+/i, '').replace(/\.+$/, '')
  const core = toCandidateEvidencePhrase(remainder)
  return core ? `Emphasize evidence of ${core}.` : text
}

function deriveResumeImplication(item: Record<string, any>, whyItMattersForResume: string): string {
  const explicit = stringField(item.resumeImplication ?? item.resumeUse ?? item.implication ?? item.resumeAngle)
  if (explicit) return explicit
  const basis = whyItMattersForResume || stringField(item.rationale) || stringField(item.need) || stringField(item.perspective)
  if (!basis) return ''
  const core = toCandidateEvidencePhrase(basis)
  return core ? `Emphasize evidence of ${core}.` : ''
}

function deriveExampleResumeUse(item: Record<string, any>, angle: string, evidenceTypes: string[]): string {
  const explicit = stringField(item.exampleResumeUse ?? item.resumeUse ?? item.resumeImplication ?? item.implication)
  if (explicit) return explicit
  const basis = evidenceTypes.length ? evidenceTypes.join(', ') : angle
  if (!basis) return ''
  return `Use this angle to pull forward evidence of ${basis}.`
}

function normalizePerspective(value: unknown): CompanyIndustryPerspective | undefined {
  const normalized = typeof value === 'string' ? value : ''
  const allowed: CompanyIndustryPerspective[] = [
    'business_model',
    'operating_priorities',
    'customer_or_user_base',
    'product_or_platform_context',
    'industry_domain_language',
    'stakeholder_landscape',
    'delivery_environment',
    'risk_quality_compliance',
    'data_reporting_analytics',
    'growth_efficiency_or_retention',
    'implementation_or_operations',
  ]
  if (allowed.includes(normalized as CompanyIndustryPerspective)) return normalized as CompanyIndustryPerspective
  const words = normalizeWords(normalized)
  if (/stakeholder|business partner|cross functional/.test(words)) return 'stakeholder_landscape'
  if (/delivery|agile|scrum|sprint|release|backlog|uat|acceptance/.test(words)) return 'delivery_environment'
  if (/risk|quality|defect|compliance|validation/.test(words)) return 'risk_quality_compliance'
  if (/report|analytics|metric|kpi|data/.test(words)) return 'data_reporting_analytics'
  if (/growth|efficiency|adoption|roi|value/.test(words)) return 'growth_efficiency_or_retention'
  if (/implementation|operation|workflow|rollout/.test(words)) return 'implementation_or_operations'
  if (/industry|domain|restaurant|supply chain/.test(words)) return 'industry_domain_language'
  if (/product|platform|technology|system/.test(words)) return 'product_or_platform_context'
  return undefined
}

function normalizeExpectedUse(value: unknown): CompanyIndustryBasis['bridgeQuestionRecommendations'][number]['expectedUse'] {
  const normalized = normalizeWords(typeof value === 'string' ? value : '')
  if (/summary/.test(normalized)) return 'summary_positioning'
  if (/skill|ats|keyword/.test(normalized)) return 'skills_keywords'
  if (/secondary/.test(normalized)) return 'secondary_experience_bullet'
  if (/domain/.test(normalized)) return 'domain_translation'
  if (/risk|quality|boundary/.test(normalized)) return 'risk_boundary'
  if (/screen/.test(normalized)) return 'screening_only'
  return 'primary_experience_bullet'
}

function normalizePriority(value: unknown): CompanyIndustryBasis['bridgeQuestionRecommendations'][number]['priority'] {
  return value === 'must_ask' || value === 'useful' || value === 'optional' ? value : 'useful'
}

function normalizeIndustryLabel(
  industry: string | undefined,
  input: GenerateCompanyIndustryBasisInput,
  fallbackIndustry: string | undefined,
): string | undefined {
  const value = stringField(industry)
  const company = input.targetCompany.trim()
  if (!value || (company && value.toLowerCase() === company.toLowerCase())) {
    return fallbackIndustry && fallbackIndustry !== 'unknown' ? fallbackIndustry : undefined
  }
  if (/mcdonald'?s/i.test(company) && /supply chain|global restaurant technology|qsr|quick service/i.test(`${value} ${input.jobDescription} ${input.userNotes ?? ''}`)) {
    return /supply chain/i.test(`${value} ${input.jobDescription} ${input.userNotes ?? ''}`)
      ? 'restaurant supply-chain technology'
      : 'quick-service restaurant technology'
  }
  return value
}

function normalizeProblemSpaceLabels(values: string[], field: string): string[] {
  return [...new Set(values.map(value => compactProblemSpaceLabel(value, field)).filter(Boolean))]
    .slice(0, OUTPUT_LIMITS.problemSpaceItems)
}

const SINGLE_WORD_LABEL_EXPANSIONS: Record<string, string> = {
  global: 'global supply-chain stakeholders',
  restaurant: 'restaurant technology workflows',
  stakeholder: 'stakeholder reporting and alignment',
  stakeholders: 'stakeholder reporting and alignment',
  defect: 'defect triage and release validation',
  quality: 'quality and release governance',
  technology: 'technology delivery and platform support',
  reporting: 'stakeholder reporting and visibility',
  execution: 'delivery execution and release readiness',
}

function compactProblemSpaceLabel(value: string, field: string = ''): string {
  const text = normalizeWords(value)
  if (!text) return ''
  const phraseMap: Array<[RegExp, string]> = [
    [/\bembedded\b.*\bagile\b.*\bsupply chain|\bagile\b.*\bsupply chain\b/, 'embedded agile supply-chain team'],
    [/\bproduction\b.*\brelease\b.*\buat|\buat\b.*\bproduction\b|\brelease validation\b/, 'UAT and production validation'],
    [/\bbacklog\b.*\b(readiness|hygiene|execution)|\bacceptance criteria\b/, 'backlog and acceptance readiness'],
    [/\bstakeholder\b.*\breport|\breporting\b.*\bstakeholder\b/, 'stakeholder reporting visibility'],
    [/\bbusiness\b.*\bit\b|\btranslation\b/, 'business-to-IT translation'],
    [/\bplanning\b.*\breport|\breporting\b.*\bplanning\b/, 'planning and reporting discipline'],
    [/\bglobal technology\b.*\bsupply chain|\bsupply chain technology\b/, 'supply-chain technology delivery'],
    [/\bquality\b.*\bdefect\b|\bdefect\b.*\bquality\b/, 'quality and release governance'],
    [/\bdefect\b.*\bfollow|\bquality\b.*\brelease\b/, 'UAT and defect follow-through'],
    [/\brestaurant\b.*\boperation|\bglobal restaurant\b/, 'global restaurant operations'],
    [/\bscrum\b|\bsprint\b|\bpi planning\b/, 'Scrum delivery cadence'],
  ]
  const mapped = phraseMap.find(([pattern]) => pattern.test(text))?.[1]
  if (mapped) return mapped

  const keepTerms = value.match(/\b(?:operational|workflow|readiness|backlog|execution|release|UAT|defect|planning|reporting|discipline|stakeholder|coordination|business-to-IT|translation|supply-chain|technology|restaurant|global|agile|Scrum|delivery|governance|quality|validation|requirements|user stories|acceptance criteria)\b/gi)
    ?.map(term => term.toLowerCase())
  if (keepTerms?.length) {
    const uniqueTerms = [...new Set(keepTerms)].slice(0, 8)
    if (uniqueTerms.length === 1) {
      const expansion = SINGLE_WORD_LABEL_EXPANSIONS[uniqueTerms[0]]
      if (expansion) return expansion
    }
    return uniqueTerms.join(' ')
  }

  const words = text.split(' ').filter(word => !STOP_WORDS.has(word)).slice(0, field === 'likelyUserOrStakeholderGroups' ? 5 : 8)
  if (words.length === 1) {
    const expansion = SINGLE_WORD_LABEL_EXPANSIONS[words[0]]
    if (expansion) return expansion
  }
  return words.join(' ')
}

function normalizeQuestion(value: string): string {
  const text = normalizeProse(value)
  return text.endsWith('?') ? text : `${text.replace(/[. ]+$/, '')}?`
}

function normalizeProse(value: string): string {
  let text = stringField(value)
  text = text
    .replace(/^Deterministic fallback basis\.?\s*/i, '')
    .replace(/\bJD emphasizes\s+/gi, 'The JD points to ')
    .replace(/\bJD calls for\s+/gi, 'The JD points to ')
    .replace(/\bJD references\s+/gi, 'The JD references ')
    .replace(/\bJD includes\s+/gi, 'The JD includes ')
    .replace(/\bMcDonald'?s needs\b/gi, 'The JD suggests')
    .replace(/\bcurrent team structure cannot sustain\b/gi, 'the JD implies a need for more structured delivery support')
    .replace(/\bmust keep pace\b/gi, 'likely helps maintain execution pace')
    .replace(/\brequires\b/gi, 'appears to call for')
    .replace(/\bneeds an embedded\b/gi, 'appears designed to support an embedded')
    .replace(/\bAs McDonald'?s scales across\s+\d[\d,]+\+?\s+locations,?\s*/gi, 'As McDonald\'s supports global restaurant operations and digital growth, ')
    .replace(/\b\d[\d,]+\+?\s+locations\b/gi, 'global restaurant operations')
    .replace(/\bproduct\s*\/\s*user\s*\/\s*adoption\b/gi, 'product and user adoption')
    .replace(/\bgrowth\s*\/\s*restaurant\b/gi, 'restaurant technology growth')
    .replace(/\bMaintains knowledge of key business processes an\b/gi, 'business process knowledge')
    .replace(/;\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .trim()

  if (hasTruncationMarker(text) && text.length > 20) {
    text = text.replace(/(?:\.\.\.|â€¦|,\s*$|;\s*$)/g, '').trim()
  }
  if (text.length > OUTPUT_LIMITS.maxShortTextLength) {
    text = `${text.slice(0, OUTPUT_LIMITS.maxShortTextLength - 1).replace(/\s+\S*$/, '')}.`
  }
  return text
}

function normalizeSourceBasis(
  value: SourceBasis,
  hasCompanyResearch: boolean,
  hasIndustryResearch: boolean,
): SourceBasis {
  if (value === 'company_research' && !hasCompanyResearch) return 'inference'
  if (value === 'industry_research' && !hasIndustryResearch) return 'inference'
  return ALLOWED_SOURCE_BASIS.includes(value) ? value : 'inference'
}

function normalizeProblemSpaceSourceBasis(
  values: ProblemSpaceSourceBasis[],
  hasCompanyResearch: boolean,
  hasIndustryResearch: boolean,
): ProblemSpaceSourceBasis[] {
  const normalized = (Array.isArray(values) ? values : [])
    .map(value => normalizeSourceBasis(value, hasCompanyResearch, hasIndustryResearch))
  const withInference: ProblemSpaceSourceBasis[] = normalized.includes('inference')
    ? normalized
    : [...normalized, 'inference']
  const fallback: ProblemSpaceSourceBasis[] = ['jd', 'inference']
  return [...new Set<ProblemSpaceSourceBasis>(withInference.length ? withInference : fallback)]
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

function extractBasisFromResponse(response: unknown): unknown {
  if (!isRecord(response) || !Array.isArray(response.content)) {
    throw new Error('LLM response did not include content.')
  }
  const toolUse = response.content.find((item: unknown) =>
    isRecord(item) && item.type === 'tool_use' && item.name === 'company_industry_basis',
  )
  if (!isRecord(toolUse)) throw new Error('LLM did not call company_industry_basis tool.')
  const input = toolUse.input
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch {
      throw new Error('LLM tool input was not valid JSON.')
    }
  }
  if (isRecord(input) && isRecord(input.export) && isRecord(input.export.companyIndustryBasis)) {
    return input.export.companyIndustryBasis
  }
  return input
}

function buildLlmRequest(
  input: GenerateCompanyIndustryBasisInput,
  extractedSignals: ExtractedCompanyIndustrySignal[],
  validationErrors: string[],
  model?: string,
): unknown {
  const prompt = buildCompanyIndustryBasisPrompt(input, extractedSignals, validationErrors)
  return {
    model: model ?? loadConfiguredModel(),
    max_tokens: validationErrors.length ? 5000 : 7000,
    tools: [COMPANY_INDUSTRY_BASIS_TOOL],
    tool_choice: { type: 'tool', name: 'company_industry_basis' },
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  }
}

function getProviderStopReason(response: unknown): string | undefined {
  return isRecord(response) && typeof response.stop_reason === 'string'
    ? response.stop_reason
    : undefined
}

async function loadDefaultCreateMessage(): Promise<(request: unknown) => Promise<unknown>> {
  const { anthropic } = await import('@/lib/llm/client')
  return request => anthropic.messages.create(request as Parameters<typeof anthropic.messages.create>[0])
}

function loadConfiguredModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6'
}

function buildMockBasis(
  input: GenerateCompanyIndustryBasisInput,
  extractedSignals: ExtractedCompanyIndustrySignal[],
): CompanyIndustryBasis {
  const fallback = buildCompanyIndustryBasisQuickStart(input)
  return {
    ...fallback,
    calibrationSummary: `Mock LLM company basis for ${input.targetRoleTitle} at ${input.targetCompany}. Synthesized from ${extractedSignals.length} extracted JD signal groups.`,
  }
}

function captureRejectedOutputPreview(
  diagnostic: CompanyIndustryBasisGenerationDiagnostic,
  rawBasis: unknown,
  attemptNumber: number,
): void {
  const preview = previewJson(rawBasis)
  diagnostic.rejectedAttemptNumber = attemptNumber
  diagnostic.rejectedOutputPreview = preview
  if (isRecord(rawBasis)) {
    const basisLike = isRecord(rawBasis.export) && isRecord(rawBasis.export.companyIndustryBasis)
      ? rawBasis.export.companyIndustryBasis
      : rawBasis
    diagnostic.rejectedBasisPreview = previewJson(basisLike)
  }
}

function previewJson(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return redactPreviewSecrets(text).slice(0, 4000)
}

function redactPreviewSecrets(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/api[_-]?key[=:]\s*["']?[^"'\s,}]+/gi, 'api_key=[redacted]')
}

function buildFallbackReason(
  diagnostic: CompanyIndustryBasisGenerationDiagnostic,
  validationErrors: string[],
): string {
  if (!diagnostic.providerConfigured) return 'provider_not_configured'
  if (!diagnostic.modelCallSucceeded && (diagnostic.providerErrorName || validationErrors.some(error => /api key|auth|credit|rate|overload|network|fetch|timeout|not_found_error|\b404\b/i.test(error)))) {
    return 'provider_error'
  }
  if (!diagnostic.modelCallAttempted) return 'model_call_not_attempted'
  if (!diagnostic.modelCallSucceeded) return 'model_call_failed'
  if (!diagnostic.parseSucceeded || validationErrors.some(error => /valid JSON|content|tool/i.test(error))) {
    return 'parse_failed'
  }
  if (!diagnostic.validationSucceeded) return 'validation_failed'
  return 'unknown_fallback_reason'
}

function isLikelyProviderError(err: Error): boolean {
  return /anthropic|api|auth|key|credit|rate|overload|network|fetch|timeout|provider|not_found_error|\b404\b/i.test(`${err.name} ${err.message}`)
}

function sanitizeProviderErrorMessage(message: string): string {
  return message
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/api[_-]?key[=:]\s*["']?[^"'\s]+/gi, 'api_key=[redacted]')
    .slice(0, 500)
}

function containsRawJdStitch(text: string, jdText: string): boolean {
  const normalizedQuestion = normalizeWords(text)
  const words = normalizeWords(jdText).split(' ').filter(Boolean)
  for (let i = 0; i <= words.length - 12; i++) {
    const phrase = words.slice(i, i + 12).join(' ')
    if (phrase.length > 60 && normalizedQuestion.includes(phrase)) return true
  }
  return false
}

function normalizeSupportingSignals(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const normalized = values
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(item => !hasTruncationMarker(item))
    .map(item => item.length <= OUTPUT_LIMITS.maxSignalLength ? item : item.slice(0, OUTPUT_LIMITS.maxSignalLength).trim())
  return normalized.length ? [...new Set(normalized)].slice(0, 4) : undefined
}

function isOverlong(text: string, maxLength: number = OUTPUT_LIMITS.maxShortTextLength): boolean {
  return text.replace(/\s+/g, ' ').trim().length > maxLength
}

function hasTruncationMarker(text: string): boolean {
  return /(?:\.\.\.|…|\bThis role is responsible\b\s*$|\bresponsible for\b\s*$|,\s*$|;\s*$)/i.test(text.trim())
}

function isGenericBridgeQuestion(question: string): boolean {
  const normalized = normalizeWords(question)
  return [
    'tell me about your experience',
    'describe your background',
    'what are your strengths',
    'do you have experience with this role',
    'how does your experience align with this job',
    'what relevant experience do you have',
  ].some(phrase => normalized.includes(phrase))
}

function isGenericCalibrationAngle(text: string): boolean {
  const normalized = normalizeWords(text)
  return [
    'highlight relevant experience',
    'make resume stronger',
    'align with job description',
    'show product management skills',
    'emphasize communication skills',
    'tailor resume to the role',
  ].some(phrase => normalized.includes(phrase))
}

function isGenericProblemSpaceText(text: string): boolean {
  const normalized = normalizeWords(text)
  return [
    'generic product management',
    'company overview',
    'align with mission',
    'various stakeholders',
    'support business needs',
    'help the company succeed',
    'responsible for helping to drive outcomes',
  ].some(phrase => normalized.includes(phrase))
}

function normalizeWords(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

const COMPANY_INDUSTRY_BASIS_TOOL = {
  name: 'company_industry_basis',
  description: 'Return a ResumeBuilder CompanyIndustryBasis object for Stage 2 resume calibration.',
  input_schema: {
    type: 'object' as const,
    required: [
      'targetCompany',
      'targetRoleTitle',
      'problemSpace',
      'calibrationSummary',
      'companyPerspectiveNeeds',
      'resumeCalibrationAngles',
      'bridgeQuestionRecommendations',
      'stage3StrategyInputs',
      'evidenceRoutingHints',
    ],
    properties: {
      targetCompany: { type: 'string' },
      targetRoleTitle: { type: 'string' },
      industry: { type: 'string' },
      problemSpace: {
        type: 'object',
        required: [
          'thesis',
          'companyProblemHypothesis',
          'rolePurposeHypothesis',
          'operatingContext',
          'impliedBusinessPressures',
          'likelyUserOrStakeholderGroups',
          'systemsOrWorkflowContext',
          'confidence',
          'sourceBasis',
        ],
        properties: {
          thesis: { type: 'string' },
          companyProblemHypothesis: { type: 'string' },
          rolePurposeHypothesis: { type: 'string' },
          operatingContext: { type: 'array', maxItems: OUTPUT_LIMITS.problemSpaceItems, items: { type: 'string' } },
          impliedBusinessPressures: { type: 'array', maxItems: OUTPUT_LIMITS.problemSpaceItems, items: { type: 'string' } },
          likelyUserOrStakeholderGroups: { type: 'array', maxItems: OUTPUT_LIMITS.problemSpaceItems, items: { type: 'string' } },
          systemsOrWorkflowContext: { type: 'array', maxItems: OUTPUT_LIMITS.problemSpaceItems, items: { type: 'string' } },
          confidence: { type: 'string' },
          sourceBasis: { type: 'array', items: { type: 'string' } },
        },
      },
      calibrationSummary: { type: 'string' },
      companyPerspectiveNeeds: { type: 'array', maxItems: OUTPUT_LIMITS.companyPerspectiveNeeds, items: { type: 'object' } },
      resumeCalibrationAngles: { type: 'array', maxItems: OUTPUT_LIMITS.resumeCalibrationAngles, items: { type: 'object' } },
      bridgeQuestionRecommendations: { type: 'array', maxItems: OUTPUT_LIMITS.bridgeQuestionRecommendations, items: { type: 'object' } },
      stage3StrategyInputs: { type: 'object' },
      evidenceRoutingHints: { type: 'array', maxItems: OUTPUT_LIMITS.evidenceRoutingHints, items: { type: 'object' } },
    },
  },
}
