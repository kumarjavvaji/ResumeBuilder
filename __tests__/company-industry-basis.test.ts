import { describe, expect, it, vi } from 'vitest'
import {
  buildCompanyIndustryBasisQuickStart,
  serializeCompanyIndustryBasisForDomainIQ,
} from '@/lib/stage2/company-industry-basis'
import {
  buildCompanyIndustryBasisPrompt,
  evaluateCompanyIndustryBasisQuality,
  generateCompanyIndustryBasis,
  normalizeCompanyIndustryBasis,
  validateAndNormalizeCompanyIndustryBasis,
} from '@/lib/stage2/generate-company-industry-basis'
import type { CompanyIndustryBasis } from '@/contracts'

const ROLLOUT_JD = `
Analyst Technical Product Management role supporting restaurant technology rollout.
Partner with restaurant operations, field stakeholders, and IT teams to coordinate implementation,
release readiness, UAT, documentation, and training for digital platform changes.
`

const ANALYTICS_JD = `
Product Analyst role responsible for KPI reporting, product performance dashboards,
SQL analysis, and data-informed prioritization for stakeholder decisions.
`

const STAKEHOLDER_JD = `
Business Analyst role partnering with business stakeholders, engineering, and support teams
to translate requirements, prioritize needs, and clarify decisions.
`

const MCDONALDS_SUPPLY_CHAIN_JD = `
Analyst Technical Product Management role in Global Supply Chain Technology.
Support supply chain planning and reporting workflows, coordinate UAT and defect follow-through,
maintain backlog items and acceptance criteria, partner with business stakeholders, IT, QA, and
engineering teams, and support governance for technology releases across operational workflows.
`

describe('Company / Industry Basis quick start', () => {
  it('produces a structured JD-first resume-calibration basis with required fields', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      industry: 'restaurant technology',
    })

    expect(basis.targetCompany).toBe('ExampleCo')
    expect(basis.targetRoleTitle).toBe('Product Analyst')
    expect(basis.industry).toBe('restaurant technology')
    expect(basis.problemSpace.thesis).toMatch(/role appears to sit/i)
    expect(basis.problemSpace.companyProblemHypothesis).toMatch(/ExampleCo|execution|workflow|translation/i)
    expect(basis.problemSpace.rolePurposeHypothesis).toMatch(/Product Analyst|delivery|workflow|release/i)
    expect(basis.problemSpace.sourceBasis).toEqual(expect.arrayContaining(['jd', 'inference']))
    expect(basis.calibrationSummary).toMatch(/JD-supported calibration themes/i)
    expect(basis.companyPerspectiveNeeds.length).toBeGreaterThan(0)
    expect(basis.resumeCalibrationAngles.length).toBeGreaterThan(0)
    expect(basis.bridgeQuestionRecommendations.length).toBeGreaterThan(0)
    expect(basis.stage3StrategyInputs.proofThemesToPrioritize).toContain('rollout and operational workflow readiness')
    expect(basis.evidenceRoutingHints.length).toBeGreaterThan(0)
  })

  it('does not set industry to the target company name', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'McDonalds',
      targetRoleTitle: 'Analyst Technical Product Management',
      jobDescription: ROLLOUT_JD,
      industry: 'McDonalds',
    })

    expect(basis.industry).not.toBe('McDonalds')
    expect(basis.industry).toBe('restaurant technology')
  })

  it('does not claim company_research or industry_research without research input', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      industry: 'restaurant technology',
    })

    const sourceBasisValues = basis.companyPerspectiveNeeds.map(item => item.sourceBasis)
    expect(sourceBasisValues).not.toContain('company_research')
    expect(sourceBasisValues).not.toContain('industry_research')
    expect(sourceBasisValues).toContain('jd')
  })

  it('includes JD-specific supporting signals on perspective needs', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    })

    const rollout = basis.companyPerspectiveNeeds.find(item => item.perspective === 'implementation_or_operations')
    expect(rollout?.supportingSignals?.join(' ')).toMatch(/rollout|implementation|documentation|training/i)
    expect(rollout?.whyItMattersForResume).toMatch(/restaurant technology rollout|documentation|UAT/i)
  })

  it('omits perspective needs when unsupported by JD or user notes', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: 'Product Analyst role with clear communication and collaboration.',
    })

    expect(basis.companyPerspectiveNeeds.some(item => item.perspective === 'data_reporting_analytics')).toBe(false)
    expect(basis.companyPerspectiveNeeds.some(item => item.perspective === 'risk_quality_compliance')).toBe(false)
  })

  it('changes bridge questions based on rollout and implementation JD signals', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    })

    const questions = basis.bridgeQuestionRecommendations.map(q => q.question).join(' ')
    expect(questions).toMatch(/rollout|implementation/i)
    expect(questions).toMatch(/documentation|UAT|training/i)
  })

  it('analytics/reporting JD text generates KPI and product performance questions', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ANALYTICS_JD,
    })

    const questions = basis.bridgeQuestionRecommendations.map(q => q.question).join(' ')
    expect(questions).toMatch(/KPI|reporting|dashboard|product performance|analytics/i)
    expect(basis.stage3StrategyInputs.proofThemesToPrioritize).toContain('product performance reporting')
  })

  it('stakeholder JD text generates business-to-IT and prioritization questions', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Business Analyst',
      jobDescription: STAKEHOLDER_JD,
    })

    const questions = basis.bridgeQuestionRecommendations.map(q => q.question).join(' ')
    expect(questions).toMatch(/business-to-IT translation|prioritization|stakeholder coordination/i)
    expect(basis.stage3StrategyInputs.proofThemesToPrioritize).toContain('business-to-IT translation and prioritization')
  })

  it('uses user_note sourceBasis when a signal only comes from notes', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: 'Product Analyst role.',
      userNotes: 'Known focus on release rollout and field training.',
    })

    expect(basis.companyPerspectiveNeeds.some(item => item.sourceBasis === 'user_note')).toBe(true)
  })

  it('does not contain repeated filler perspective language', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    })

    expect(JSON.stringify(basis)).not.toContain('This perspective helps decide')
  })

  it('does not fabricate unsupported precise company facts', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    })
    const text = JSON.stringify(basis)

    expect(text).not.toMatch(/\$\d|\b\d+\s+(?:employees|customers|users)\b|market share/i)
    expect(text).toContain('Do not turn company or industry context into candidate claims')
  })

  it('serializes to valid diq_stage3_resume_builder_basis JSON', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      industry: 'restaurant technology',
    })
    const json = serializeCompanyIndustryBasisForDomainIQ(basis)
    const parsedJson = JSON.parse(json)

    expect(parsedJson.export.exportKind).toBe('diq_stage3_resume_builder_basis')
    expect(parsedJson.export.companyIndustryBasis.targetCompany).toBe('ExampleCo')
    expect(parsedJson.export.domainBasis.thesis).toContain('role appears to sit')
    expect(parsedJson.export.domainBasis.problemSpace.thesis).toContain('role appears to sit')
    expect(parsedJson.export.domainBasis.keyThemes).toContain('restaurant technology')
    expect(parsedJson.export.resumePositioningBasis.bridgeQuestions.length).toBeGreaterThan(0)
  })

  it('LLM-backed generator calls the LLM in normal mode', async () => {
    const createMessage = vi.fn().mockResolvedValue(toolResponse(makeValidLlmBasis()))

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      industry: 'restaurant technology',
    }, { createMessage })

    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(createMessage.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-4-6' })
    expect(result.mode).toBe('llm')
    expect(result.diagnostic.mode).toBe('llm')
    expect(result.diagnostic.modelCallAttempted).toBe(true)
    expect(result.diagnostic.modelCallSucceeded).toBe(true)
    expect(result.diagnostic.parseSucceeded).toBe(true)
    expect(result.diagnostic.validationSucceeded).toBe(true)
    expect(result.diagnostic.fallbackReason).toBe('')
    expect(result.diagnostic.rejectedOutputPreview).toBeUndefined()
    expect(result.domainIQJson).toContain('diq_stage3_resume_builder_basis')
  })

  it('LLM-backed generator supports an injected model override', async () => {
    const createMessage = vi.fn().mockResolvedValue(toolResponse(makeValidLlmBasis()))

    await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    }, { createMessage, model: 'claude-test-model' })

    expect(createMessage.mock.calls[0][0]).toMatchObject({ model: 'claude-test-model' })
  })

  it('keeps Quick Start output within bounded structured limits', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'McDonalds',
      targetRoleTitle: 'Analyst Technical Product Management',
      jobDescription: MCDONALDS_SUPPLY_CHAIN_JD,
    })

    expect(basis.problemSpace.operatingContext.length).toBeLessThanOrEqual(5)
    expect(basis.problemSpace.impliedBusinessPressures.length).toBeLessThanOrEqual(5)
    expect(basis.problemSpace.likelyUserOrStakeholderGroups.length).toBeLessThanOrEqual(5)
    expect(basis.problemSpace.systemsOrWorkflowContext.length).toBeLessThanOrEqual(5)
    expect(basis.companyPerspectiveNeeds.length).toBeLessThanOrEqual(6)
    expect(basis.resumeCalibrationAngles.length).toBeLessThanOrEqual(5)
    expect(basis.bridgeQuestionRecommendations.length).toBeLessThanOrEqual(8)
    expect(basis.evidenceRoutingHints.length).toBeLessThanOrEqual(6)
    expect(JSON.stringify(basis.companyPerspectiveNeeds.map(item => item.supportingSignals))).not.toMatch(/This role is responsible|\.\.\.|…/)
  })

  it('retries once with smaller-output prompt after truncated LLM JSON', async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce(toolResponseInput('{ "targetCompany": "ExampleCo", "problemSpace": '))
      .mockResolvedValueOnce(toolResponse(makeValidLlmBasis()))

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      industry: 'restaurant technology',
    }, { createMessage })

    expect(createMessage).toHaveBeenCalledTimes(2)
    expect(result.mode).toBe('retry')
    expect(result.diagnostic.mode).toBe('retry')
    expect(result.diagnostic.retryAttempted).toBe(true)
    expect(result.diagnostic.retrySucceeded).toBe(true)
    expect(result.diagnostic.parseSucceeded).toBe(true)
    expect(result.diagnostic.validationSucceeded).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/not valid JSON/i)
    expect(JSON.stringify(createMessage.mock.calls[1][0])).toContain('SMALLER-OUTPUT REPAIR MODE')
  })

  it('falls back safely when truncated LLM JSON fails both attempts', async () => {
    const createMessage = vi.fn()
      .mockResolvedValueOnce(toolResponseInput('{ "targetCompany": "ExampleCo", "problemSpace": '))
      .mockResolvedValueOnce(toolResponseInput('{ "targetCompany": "ExampleCo", "problemSpace": '))

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    }, { createMessage })

    expect(createMessage).toHaveBeenCalledTimes(2)
    expect(result.mode).toBe('fallback')
    expect(result.diagnostic.mode).toBe('deterministic_fallback')
    expect(result.diagnostic.fallbackReason).toBe('parse_failed')
    expect(result.diagnostic.retryAttempted).toBe(true)
    expect(result.diagnostic.retrySucceeded).toBe(false)
    expect(result.basis.calibrationSummary).toContain('Deterministic fallback basis')
    expect(result.warnings.length).toBe(2)
  })

  it('provider failure returns fallbackReason and provider details', async () => {
    const providerError = new Error('Anthropic authentication failed for api_key=secret-value')
    providerError.name = 'AuthenticationError'
    const createMessage = vi.fn().mockRejectedValue(providerError)

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    }, { createMessage })

    expect(result.mode).toBe('fallback')
    expect(result.diagnostic.fallbackReason).toBe('provider_error')
    expect(result.diagnostic.providerErrorName).toBe('AuthenticationError')
    expect(result.diagnostic.providerErrorMessage).toContain('[redacted]')
    expect(result.diagnostic.providerErrorMessage).not.toContain('secret-value')
  })

  it('model not found provider error is surfaced as provider_error', async () => {
    const providerError = new Error('404 {"type":"error","error":{"type":"not_found_error","message":"model: stale-model"}}')
    providerError.name = 'Error'
    const createMessage = vi.fn().mockRejectedValue(providerError)

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    }, { createMessage })

    expect(result.mode).toBe('fallback')
    expect(result.diagnostic.fallbackReason).toBe('provider_error')
    expect(result.diagnostic.providerErrorMessage).toContain('not_found_error')
    expect(result.diagnostic.providerErrorMessage).toContain('stale-model')
  })

  it('normalizes parseable LLM output with overlong operatingContext instead of falling back', async () => {
    const rejectedBasis = makeRejectedCompactLabelBasis('first rejected operating context label that is intentionally far longer than the compact label limit and should fail validation')
    const createMessage = vi.fn().mockResolvedValue(toolResponse(rejectedBasis))

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    }, { createMessage })

    expect(result.mode).toBe('llm_normalized')
    expect(result.diagnostic.mode).toBe('llm_normalized')
    expect(result.diagnostic.fallbackReason).toBe('')
    expect(result.diagnostic.parseSucceeded).toBe(true)
    expect(result.diagnostic.normalizationAttempted).toBe(true)
    expect(result.diagnostic.normalizationSucceeded).toBe(true)
    expect(result.diagnostic.validationSucceeded).toBe(true)
    expect(result.diagnostic.normalizedWarnings?.join(' ')).toMatch(/compact synthesized labels/)
    expect(result.diagnostic.rejectedAttemptNumber).toBe(1)
    expect(result.diagnostic.rejectedOutputPreview).toContain('first rejected operating context label')
    expect(result.diagnostic.rejectedBasisPreview).toContain('problemSpace')
    expect(result.domainIQJson).not.toContain('Deterministic fallback basis')
    expect(result.basis.problemSpace.operatingContext[0].length).toBeLessThanOrEqual(80)
  })

  it('canonicalizes and normalizes the McDonalds rejected-preview shape into usable LLM output', async () => {
    const createMessage = vi.fn().mockResolvedValue(toolResponse(makeMcdonaldsRejectedPreviewBasis()))

    const result = await generateCompanyIndustryBasis({
      targetCompany: "McDonald's",
      targetRoleTitle: 'Technical Product Management Analyst',
      jobDescription: MCDONALDS_SUPPLY_CHAIN_JD,
    }, { createMessage })

    const text = JSON.stringify(result.basis)
    expect(result.mode).toBe('llm_normalized')
    expect(result.diagnostic.validationSucceeded).toBe(true)
    expect(result.diagnostic.displayedJsonSource).toBe('llm_normalized')
    expect(result.basis.industry).toMatch(/restaurant supply-chain technology|quick-service restaurant technology/i)
    expect(result.basis.companyPerspectiveNeeds[0].whyItMattersForResume).toMatch(/JD suggests|JD implies|role appears|resume should/i)
    expect(result.basis.companyPerspectiveNeeds[0].resumeImplication).toMatch(/evidence/i)
    expect(result.basis.companyPerspectiveNeeds[0].sourceBasis).toBe('inference')
    expect(result.basis.problemSpace.operatingContext).toContain('embedded agile supply-chain team')
    expect(result.basis.problemSpace.operatingContext).toContain('UAT and production validation')
    expect(text).not.toMatch(/Deterministic fallback basis|JD emphasizes|product \/ user \/ adoption|growth \/ restaurant|Maintains knowledge of key business processes an|"industry":"McDonald"/)
  })

  it('derives resumeImplication and exampleResumeUse when missing instead of falling back', async () => {
    const createMessage = vi.fn().mockResolvedValue(toolResponseInput(makeMcdonaldsLiveMissingImplicationBasis()))

    const result = await generateCompanyIndustryBasis({
      targetCompany: "McDonald's",
      targetRoleTitle: 'Technical Product Management Analyst',
      jobDescription: MCDONALDS_SUPPLY_CHAIN_JD,
    }, { createMessage })

    expect(['llm_normalized', 'retry_normalized']).toContain(result.mode)
    expect(result.diagnostic.normalizationAttempted).toBe(true)
    expect(result.diagnostic.normalizationSucceeded).toBe(true)
    expect(result.diagnostic.validationSucceeded).toBe(true)
    expect(result.diagnostic.fallbackReason).toBe('')
    expect(result.diagnostic.displayedJsonSource).not.toBe('deterministic_fallback')
    expect(result.basis.companyPerspectiveNeeds[0].resumeImplication.trim().length).toBeGreaterThan(0)
    expect(result.basis.resumeCalibrationAngles[0].exampleResumeUse.trim().length).toBeGreaterThan(0)

    const text = JSON.stringify(result.basis)
    expect(text).not.toMatch(/Deterministic fallback basis|JD emphasizes|product \/ user \/ adoption|Maintains knowledge of key business processes an|"industry":"McDonald"/)
  })

  it('regression: missing resumeImplication/exampleResumeUse no longer force fallback', async () => {
    const createMessage = vi.fn().mockResolvedValue(toolResponseInput(makeMcdonaldsLiveMissingImplicationBasis()))

    const result = await generateCompanyIndustryBasis({
      targetCompany: "McDonald's",
      targetRoleTitle: 'Technical Product Management Analyst',
      jobDescription: MCDONALDS_SUPPLY_CHAIN_JD,
    }, { createMessage })

    expect(result.mode).not.toBe('fallback')
    expect(result.diagnostic.mode).not.toBe('deterministic_fallback')
    expect(result.diagnostic.fallbackReason).not.toBe('validation_failed')
    expect(result.diagnostic.validationErrors?.join(' ') ?? '').not.toMatch(
      /Each perspective needs resumeImplication|Each calibration angle needs exampleResumeUse/,
    )
  })

  it('problemSpace contains hypotheses and avoids clipped JD boilerplate', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      industry: 'restaurant technology',
    })
    const text = JSON.stringify(basis.problemSpace)

    expect(basis.problemSpace.companyProblemHypothesis).toMatch(/execution|workflow|translation|readiness/i)
    expect(basis.problemSpace.rolePurposeHypothesis).toMatch(/delivery|release|workflow|requirements/i)
    expect(text).not.toMatch(/JD emphasizes This role is responsible/i)
  })

  it('McDonalds supply-chain JD produces DomainIQ-lite problem-space themes', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'McDonalds',
      targetRoleTitle: 'Analyst Technical Product Management',
      jobDescription: MCDONALDS_SUPPLY_CHAIN_JD,
    })
    const text = JSON.stringify(basis).toLowerCase()

    expect(basis.problemSpace.thesis).toMatch(/supply-chain|operations|operating/i)
    expect(text).toContain('supply-chain')
    expect(text).toContain('operational workflow readiness')
    expect(text).toContain('planning and reporting discipline')
    expect(text).toContain('uat and defect follow-through')
    expect(text).toContain('stakeholder coordination')
    expect(text).toContain('governance')
  })

  it('marks unsupported company/domain reasoning as inference', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'McDonalds',
      targetRoleTitle: 'Analyst Technical Product Management',
      jobDescription: MCDONALDS_SUPPLY_CHAIN_JD,
    })

    expect(basis.problemSpace.sourceBasis).toContain('inference')
    expect(basis.problemSpace.sourceBasis).not.toContain('company_research')
    expect(basis.problemSpace.sourceBasis).not.toContain('industry_research')
  })

  it('bridge questions are specific to the problem space', () => {
    const basis = buildCompanyIndustryBasisQuickStart({
      targetCompany: 'McDonalds',
      targetRoleTitle: 'Analyst Technical Product Management',
      jobDescription: MCDONALDS_SUPPLY_CHAIN_JD,
    })
    const questions = basis.bridgeQuestionRecommendations.map(q => q.question).join(' ')

    expect(questions).toMatch(/backlog|acceptance criteria|UAT|release readiness|stakeholder coordination|quality controls|reporting/i)
    expect(questions).not.toMatch(/tell me about your experience|what relevant experience do you have/i)
  })

  it('falls back to deterministic generation when LLM synthesis fails twice', async () => {
    const createMessage = vi.fn().mockRejectedValue(new Error('model unavailable'))

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    }, { createMessage })

    expect(createMessage).toHaveBeenCalledTimes(2)
    expect(result.mode).toBe('fallback')
    expect(result.diagnostic.fallbackReason).toBe('model_call_failed')
    expect(result.diagnostic.modelCallAttempted).toBe(true)
    expect(result.diagnostic.modelCallSucceeded).toBe(false)
    expect(result.basis.calibrationSummary).toContain('Deterministic fallback basis')
  })

  it('mock mode returns a stable fixture without calling the LLM', async () => {
    const createMessage = vi.fn()

    const result = await generateCompanyIndustryBasis({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      mockMode: true,
    }, { createMessage })

    expect(createMessage).not.toHaveBeenCalled()
    expect(result.mode).toBe('mock')
    expect(result.basis.calibrationSummary).toContain('Mock LLM company basis')
  })

  it('prompt includes grounding inputs and source policy', () => {
    const prompt = buildCompanyIndustryBasisPrompt({
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
      industry: 'restaurant technology',
      userNotes: 'Field rollout matters.',
      profileEvidenceSummary: 'Profile includes UAT and release notes.',
    })
    const combined = `${prompt.system}\n${prompt.user}`

    expect(combined).toContain('ExampleCo')
    expect(combined).toContain('Product Analyst')
    expect(combined).toContain('restaurant technology')
    expect(combined).toContain('Field rollout matters.')
    expect(combined).toContain('Profile includes UAT')
    expect(combined).toContain('EXTRACTED JD SIGNALS')
    expect(combined).toContain('problemSpace')
    expect(combined).toContain('JD-aligned problem space')
    expect(combined).toContain('Do not fabricate precise company facts')
    expect(combined).toContain('jd, user_note, profile_evidence, inference, company_research, industry_research')
  })

  it('validation normalizes industry equal to company name', () => {
    const normalized = validateAndNormalizeCompanyIndustryBasis(
      { ...makeValidLlmBasis(), industry: 'ExampleCo' },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )

    expect(normalized.industry).not.toBe('ExampleCo')
  })

  it('validation downgrades research sourceBasis when no research source exists', () => {
    const normalized = validateAndNormalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        companyPerspectiveNeeds: makeValidLlmBasis().companyPerspectiveNeeds.map(item => ({
          ...item,
          sourceBasis: 'company_research' as const,
        })),
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )

    expect(normalized.companyPerspectiveNeeds.every(item => item.sourceBasis === 'inference')).toBe(true)
  })

  it('validation rejects missing problemSpace', () => {
    const { problemSpace: _problemSpace, ...missingProblemSpace } = makeValidLlmBasis()

    expect(() => validateAndNormalizeCompanyIndustryBasis(
      missingProblemSpace,
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )).toThrow(/problemSpace is required/)
  })

  it('validation normalizes repairable over-limit labels and still rejects clipped prose', () => {
    const normalized = validateAndNormalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        problemSpace: {
          ...makeValidLlmBasis().problemSpace,
          operatingContext: ['one', 'two', 'three', 'four', 'five', 'six'],
        },
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )

    expect(normalized.problemSpace.operatingContext).toHaveLength(5)

    expect(() => validateAndNormalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        problemSpace: {
          ...makeValidLlmBasis().problemSpace,
          thesis: 'This role is responsible...',
        },
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )).toThrow(/truncated|boilerplate/i)
  })

  it('validation downgrades unsupported research sourceBasis on problemSpace', () => {
    const normalized = validateAndNormalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        problemSpace: {
          ...makeValidLlmBasis().problemSpace,
          sourceBasis: ['company_research'],
        },
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )

    expect(normalized.problemSpace.sourceBasis).toEqual(expect.arrayContaining(['inference']))
    expect(normalized.problemSpace.sourceBasis).not.toContain('company_research')
  })

  it('validation rejects generic bridge questions and calibration angles', () => {
    expect(() => validateAndNormalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        bridgeQuestionRecommendations: [
          {
            ...makeValidLlmBasis().bridgeQuestionRecommendations[0],
            question: 'Tell me about your experience.',
          },
        ],
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )).toThrow(/Bridge question is generic/)

    expect(() => validateAndNormalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        resumeCalibrationAngles: [
          {
            ...makeValidLlmBasis().resumeCalibrationAngles[0],
            angle: 'Highlight relevant experience',
          },
        ],
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )).toThrow(/Calibration angle is generic/)
  })

  it('validation rejects raw stitched JD snippets in bridge questions', () => {
    const rawSnippet = 'Analyst Technical Product Management role supporting restaurant technology rollout Partner with restaurant operations field stakeholders and IT teams'
    expect(() => validateAndNormalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        bridgeQuestionRecommendations: [
          {
            ...makeValidLlmBasis().bridgeQuestionRecommendations[0],
            question: `Which examples prove ${rawSnippet}?`,
          },
        ],
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )).toThrow(/raw stitched JD text/)
  })

  it('semantic quality guard flags generic one-word labels as not downstream-ready', () => {
    const basis: CompanyIndustryBasis = {
      ...makeValidLlmBasis(),
      stage3StrategyInputs: {
        ...makeValidLlmBasis().stage3StrategyInputs,
        proofThemesToPrioritize: ['global', 'restaurant', 'stakeholder'],
      },
    }

    const quality = evaluateCompanyIndustryBasisQuality(basis)

    expect(quality.passed).toBe(false)
    expect(quality.downstreamReady).toBe(false)
    expect(quality.issues.join(' ')).toMatch(/generic one-word label/)
  })

  it('derived resumeImplication uses candidate-evidence language instead of restating the JD sentence', () => {
    const { basis } = normalizeCompanyIndustryBasis(
      {
        ...makeValidLlmBasis(),
        companyPerspectiveNeeds: [
          {
            ...makeValidLlmBasis().companyPerspectiveNeeds[0],
            resumeImplication: 'Emphasize evidence of The team needs someone who can own ceremonies, backlog grooming, and sprint tracking with minimal supervision.',
          },
        ],
      },
      {
        targetCompany: 'ExampleCo',
        targetRoleTitle: 'Product Analyst',
        jobDescription: ROLLOUT_JD,
      },
    )

    const resumeImplication = basis.companyPerspectiveNeeds[0].resumeImplication
    expect(resumeImplication).not.toMatch(/Emphasize evidence of The\b/)
    const quality = evaluateCompanyIndustryBasisQuality(basis)
    expect(quality.issues.join(' ')).not.toMatch(/awkward derived language/)
  })

  it('populates empty stage3StrategyInputs conservatively instead of letting it silently reach downstream stages', () => {
    const basisWithEmptyStage3: CompanyIndustryBasis = {
      ...makeValidLlmBasis(),
      stage3StrategyInputs: {
        targetPostureHints: [],
        proofThemesToPrioritize: [],
        domainTermsToUseIfEvidenced: [],
        toolsOrMethodsToVerify: [],
        risksOrClaimsToAvoid: [],
      },
    }

    const { basis } = normalizeCompanyIndustryBasis(basisWithEmptyStage3, {
      targetCompany: 'ExampleCo',
      targetRoleTitle: 'Product Analyst',
      jobDescription: ROLLOUT_JD,
    })

    const stage3 = basis.stage3StrategyInputs
    const isPopulated = [stage3.targetPostureHints, stage3.proofThemesToPrioritize, stage3.domainTermsToUseIfEvidenced, stage3.risksOrClaimsToAvoid]
      .some(arr => arr.length > 0)
    const quality = evaluateCompanyIndustryBasisQuality(basis)

    expect(isPopulated || !quality.downstreamReady).toBe(true)
  })
})

function toolResponse(basis: CompanyIndustryBasis) {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'company_industry_basis',
        input: basis,
      },
    ],
  }
}

function toolResponseInput(input: unknown) {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'company_industry_basis',
        input,
      },
    ],
  }
}

function makeValidLlmBasis(): CompanyIndustryBasis {
  return {
    targetCompany: 'ExampleCo',
    targetRoleTitle: 'Product Analyst',
    industry: 'restaurant technology',
    problemSpace: {
      thesis: 'This role appears to sit in restaurant technology, where the resume should prove operational-system delivery, release readiness, reporting discipline, and business-process translation.',
      companyProblemHypothesis: 'ExampleCo appears to need stronger execution around operational workflow readiness and release validation for technology changes.',
      rolePurposeHypothesis: 'The Product Analyst likely supports implementation support, delivery governance, release readiness, and workflow translation across business and technical teams.',
      operatingContext: ['operational workflow readiness', 'release readiness', 'business-process translation'],
      impliedBusinessPressures: ['implementation reliability', 'release readiness and delivery governance'],
      likelyUserOrStakeholderGroups: ['business stakeholders', 'IT or engineering teams', 'field or operations users'],
      systemsOrWorkflowContext: ['restaurant technology workflows', 'backlog, UAT, and release workflow'],
      confidence: 'medium',
      sourceBasis: ['jd', 'inference'],
    },
    calibrationSummary: 'The role sits in a restaurant technology environment, so the resume should prove operational-system delivery, release readiness, reporting discipline, and business-process translation.',
    companyPerspectiveNeeds: [
      {
        perspective: 'implementation_or_operations',
        whyItMattersForResume: 'The JD points to rollout and operational workflow execution.',
        resumeImplication: 'Pull forward implementation, release readiness, documentation, UAT, and training evidence.',
        confidence: 'medium',
        sourceBasis: 'jd',
        supportingSignals: ['restaurant technology rollout', 'documentation and training'],
      },
    ],
    resumeCalibrationAngles: [
      {
        angle: 'operational-system delivery',
        relevantEvidenceTypes: ['rollout', 'documentation', 'UAT'],
        sectionsAffected: ['experience', 'skills'],
        exampleResumeUse: 'Frame Experience proof around release-ready operational workflow delivery.',
        avoidOverclaiming: 'Do not claim ownership of ExampleCo systems.',
      },
    ],
    bridgeQuestionRecommendations: [
      {
        question: 'Which examples show release readiness, documentation, UAT, or training for operational users?',
        reason: 'Needed to prove rollout readiness without inventing company facts.',
        expectedUse: 'primary_experience_bullet',
        priority: 'must_ask',
      },
    ],
    stage3StrategyInputs: {
      targetPostureHints: ['Emphasize operational product delivery.'],
      proofThemesToPrioritize: ['rollout readiness', 'business-process translation'],
      domainTermsToUseIfEvidenced: ['restaurant technology'],
      toolsOrMethodsToVerify: ['UAT'],
      risksOrClaimsToAvoid: ['unsupported company strategy'],
    },
    evidenceRoutingHints: [
      {
        evidenceType: 'rollout readiness',
        preferredResumeSection: 'experience',
        reason: 'Experience must prove the operating context.',
      },
    ],
  }
}

function makeRejectedCompactLabelBasis(longOperatingContext: string): CompanyIndustryBasis {
  return {
    ...makeValidLlmBasis(),
    problemSpace: {
      ...makeValidLlmBasis().problemSpace,
      operatingContext: [longOperatingContext],
    },
  }
}

function makeMcdonaldsRejectedPreviewBasis(): any {
  return {
    targetCompany: "McDonald's",
    targetRoleTitle: 'Technical Product Management Analyst',
    industry: "McDonald's",
    problemSpace: {
      thesis: "McDonald's needs an embedded agile executor for Global Technology Supply Chain delivery.",
      companyProblemHypothesis: 'Current team structure cannot sustain release validation and stakeholder reporting alone.',
      rolePurposeHypothesis: 'As McDonald’s scales across 25,000+ locations, this role requires backlog, UAT, and delivery coordination.',
      operatingContext: [
        'Embedded agile team within Global Technology EPP, reporting to Sr. PM of Supply Chain',
        'Production release validation via test-account UAT in live environment',
      ],
      impliedBusinessPressures: [
        'McDonald’s needs stronger delivery governance and current team structure cannot sustain alone',
        'Must keep pace with supply chain platform releases and stakeholder reporting',
      ],
      likelyUserOrStakeholderGroups: ['Supply Chain business stakeholders', 'IT and QA teams'],
      systemsOrWorkflowContext: ['Jira, Confluence, Smartsheet, PI planning and sprint ceremonies'],
      confidence: 'medium',
      sourceBasis: ['jd', 'inference'],
    },
    calibrationSummary: "JD emphasizes product / user / adoption and growth / restaurant.",
    companyPerspectiveNeeds: [
      {
        need: 'McDonald’s needs backlog hygiene and UAT readiness.',
        rationale: 'Current team structure cannot sustain delivery quality without more reporting.',
        resumeUse: 'The resume should emphasize evidence of backlog readiness, UAT, stakeholder reporting, and business-to-IT translation.',
        confidence: 'medium',
        sourceBasis: 'company_research',
        supportingSignals: ['Global Technology / Supply Chain', 'Jira / Confluence / Smartsheet'],
      },
    ],
    resumeCalibrationAngles: [
      {
        angle: 'delivery governance and release readiness',
        evidenceTypes: ['backlog', 'UAT', 'stakeholder reporting'],
        affectedSections: ['experience', 'skills'],
        resumeUse: 'Frame evidence around supply-chain technology execution, release readiness, product reporting, and cross-functional execution.',
        avoidOverclaiming: 'Do not claim internal company strategy.',
      },
    ],
    bridgeQuestionRecommendations: [
      {
        question: 'Which examples show backlog hygiene, user stories, acceptance criteria, UAT, release validation, stakeholder reporting, or business-to-IT translation?',
        rationale: 'Needed to verify inferred supply-chain technology execution evidence.',
        questionUse: 'primary_experience_bullet',
        priority: 'must_ask',
      },
    ],
    stage3StrategyInputs: {
      targetPostureHints: ['Maintains knowledge of key business processes an'],
      proofThemesToPrioritize: ['supply-chain technology execution', 'delivery governance', 'release readiness'],
      domainTermsToUseIfEvidenced: ['Global Technology', 'Supply Chain', 'Jira', 'Confluence', 'Smartsheet'],
      toolsOrMethodsToVerify: ['Jira', 'Confluence', 'Smartsheet', 'PI planning', 'sprint ceremonies'],
      risksOrClaimsToAvoid: ['unsupported company strategy', 'unsupported metrics'],
    },
    evidenceRoutingHints: [
      {
        evidenceType: 'backlog and UAT readiness',
        preferredResumeSection: 'experience',
        reason: 'Tracks project risks, issues, and dependencies; ; quality',
      },
    ],
  }
}

function makeMcdonaldsLiveMissingImplicationBasis(): any {
  const base = makeMcdonaldsRejectedPreviewBasis()
  return {
    ...base,
    companyPerspectiveNeeds: [
      {
        need: 'Agile delivery execution ownership',
        rationale: 'The role requires backlog management and PI planning support.',
        confidence: 'medium',
        sourceBasis: 'inference',
        supportingSignals: ['Global Technology / Supply Chain', 'Jira / Confluence / Smartsheet'],
      },
    ],
    resumeCalibrationAngles: [
      {
        angle: 'UAT and release validation',
        evidenceTypes: ['UAT', 'release readiness', 'defect follow-through'],
        affectedSections: ['experience', 'skills'],
        avoidOverclaiming: 'Do not claim internal company strategy.',
      },
    ],
  }
}
