/**
 * Stage 4 quality system tests.
 *
 * A. Summary de-duplication — metric/phrase/team-size signals detected; concept-level passes
 * B. Section purpose — serializeContractForPrompt includes section-purpose language;
 *    generate-artifact-section source includes SECTION PURPOSE block
 * C. Section budget — validator flags over-budget; repair API route exists and is structured correctly
 * D. Refinement contract — contract is accepted by refine-stage4-resume and repair-stage4-resume;
 *    repair source enforces "fix only failing sections" constraint
 * E. Evidence and tools — de-duplication interaction with known tools from profile
 * F. Persistence — contract field on Stage4RawResumeText type; contract flows through buildStage4RawResumeText
 */

import { describe, it, expect } from 'vitest'
import {
  checkSummaryDuplication,
  validateResumeAgainstContract,
  validateStage4ResumeOutput,
  buildResumeGenerationContract,
  serializeContractForPrompt,
} from '../lib/stage4/resume-generation-contract'
import type { ContractBuildInput } from '../lib/stage4/resume-generation-contract'
import type { UserProfile, JDRequirementMap, WorkEntry, SkillGroup, ResumeReadinessContract } from '../contracts'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'p1',
    fullName: 'Test User',
    email: 'test@test.com',
    phone: '',
    location: '',
    linkedIn: '',
    summary: '',
    workHistory: [
      {
        id: 'w1',
        company: 'Acme Corp',
        title: 'Product Owner',
        startDate: 'Jan 2021',
        endDate: 'Dec 2024',
        bullets: [],
        approvedMetrics: [],
        domain: 'Software',
        skills: ['Jira', 'Confluence'],
      } as WorkEntry,
    ],
    education: [],
    skillGroups: [
      { id: 'sg1', heading: 'Product', skills: ['Jira', 'Confluence', 'Pendo'] } as SkillGroup,
      { id: 'sg2', heading: 'Delivery', skills: ['UAT', 'SQL'] } as SkillGroup,
    ],
    skills: ['Jira', 'Confluence', 'Pendo', 'UAT', 'SQL'],
    certifications: [],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: '2025-01-01',
    ...overrides,
  }
}

function makeJDMap(overrides: Partial<JDRequirementMap> = {}): JDRequirementMap {
  return {
    required: [
      { text: 'Backlog prioritization', category: 'process', userCoverageStatus: 'covered' },
      { text: 'User story writing', category: 'process', userCoverageStatus: 'covered' },
    ],
    niceToHave: [],
    realJobFunction: 'Product Owner',
    needsEvidenceItems: [],
    unsupportedRequirements: [],
    weaklySupportedRequirements: [],
    ...overrides,
  }
}

function makeInput(overrides: Partial<ContractBuildInput> = {}): ContractBuildInput {
  return {
    emphasisRecommendation: 'PO',
    roleTitle: 'Product Owner',
    jdMap: makeJDMap(),
    profile: makeProfile(),
    ...overrides,
  }
}

function makeReadinessContract(overrides: Partial<ResumeReadinessContract> = {}): ResumeReadinessContract {
  return {
    targetRoleFamily: 'primary',
    targetPosture: 'product delivery',
    sectionPlan: {
      summary: { purpose: 'positioning', maxSentences: 4, maxApproxLines: 4 },
      skills: { purpose: 'ats_support', maxRows: 5 },
      primaryExperience: { minBullets: 5, maxBullets: 6 },
      secondaryExperience: { minBullets: 4, maxBullets: 5 },
      earlierExperience: { maxBullets: 3 },
      education: { maxLines: 3 },
    },
    evidenceRouting: {},
    resolvedDecisions: {},
    bannedPhrases: [],
    preferredReplacements: {},
    allowedTools: ['Jira'],
    disallowedTools: ['Azure DevOps'],
    requiredExperienceThemes: ['stakeholder alignment / cross-functional delivery'],
    metricPolicy: {
      preferImpactOverVolume: true,
      volumeMetricsRequireImpactTie: true,
    },
    summaryPolicy: {
      noProofLevelDuplication: true,
      noTeamSizeIfInExperience: true,
      noCadenceIfInExperience: true,
      noMetricsIfInExperience: true,
      noToolDetailsIfInExperience: true,
    },
    ...overrides,
  }
}

// ─── A. Summary de-duplication ────────────────────────────────────────────────

describe('A. Summary de-duplication', () => {
  it('A1: detects numeric metric duplicated from Experience in Summary', () => {
    const summary = 'Managed 12 direct stakeholders and drove 35% adoption.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Coordinated with 12 stakeholders across 3 business units to define release scope.
- Drove platform adoption by 35% over two quarters through roadmap adjustments.
`
    const result = checkSummaryDuplication(summary, experience, [])
    expect(result.hasDuplication).toBe(true)
    const types = result.duplicatedSignals.map(s => s.type)
    expect(types).toContain('metric')
  })

  it('A2: detects team-size pattern duplicated from Experience', () => {
    const summary = 'Led a 6-person team to deliver two major releases.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Partnered with a 6-person team to scope and execute quarterly roadmap.
`
    const result = checkSummaryDuplication(summary, experience, [])
    expect(result.hasDuplication).toBe(true)
    const types = result.duplicatedSignals.map(s => s.type)
    expect(types).toContain('team_size')
  })

  it('A3: detects sprint cadence duplicated from Experience', () => {
    const summary = 'Facilitated 2-week sprints and managed ceremony cadence.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Facilitated 2-week sprints including planning, grooming, retrospectives.
`
    const result = checkSummaryDuplication(summary, experience, [])
    expect(result.hasDuplication).toBe(true)
    const types = result.duplicatedSignals.map(s => s.type)
    expect(types).toContain('cadence')
  })

  it('A4: detects known tool duplicated from Experience bullet', () => {
    const knownTools = ['Pendo', 'Jira', 'Confluence']
    const summary = 'Used Pendo analytics to inform backlog priorities.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Used Pendo analytics to identify low-adoption features and prioritize backlog items.
`
    const result = checkSummaryDuplication(summary, experience, knownTools)
    expect(result.hasDuplication).toBe(true)
    const types = result.duplicatedSignals.map(s => s.type)
    expect(types).toContain('tool')
  })

  it('A5: detects near-exact phrase duplicated from Experience bullet', () => {
    const summary = 'Sequenced dependencies for the quarterly launch gate.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Sequenced dependencies for the quarterly launch gate across product, engineering, and support.
`
    const result = checkSummaryDuplication(summary, experience, [])
    expect(result.hasDuplication).toBe(true)
  })

  it('A6: concept-level Summary does NOT trigger duplication when metric only in Experience', () => {
    const summary = 'Product Owner with strong stakeholder communication and backlog execution.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Managed 12 stakeholders and delivered 35% adoption improvement.
`
    const result = checkSummaryDuplication(summary, experience, [])
    expect(result.hasDuplication).toBe(false)
  })

  it('A7: concept-level language (no proof signals) passes de-duplication', () => {
    const summary = 'Experienced Product Owner skilled in backlog management and stakeholder alignment.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Led sprint ceremonies and maintained product roadmap for three business units.
- Delivered release-ready scope each quarter.
`
    const result = checkSummaryDuplication(summary, experience, [])
    expect(result.hasDuplication).toBe(false)
  })

  it('A8: validator reports summary_duplicates_experience as error when duplication found', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const resumeText = `SUMMARY
Drove 35% feature adoption through data-informed backlog prioritization.

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Drove 35% adoption improvement by applying usage analytics to backlog ranking.
- Delivered 3 major releases and managed sprint planning ceremonies.
- Coordinated acceptance criteria with stakeholders each sprint cycle.
- Partnered with engineering on release-ready scope and dependency sequencing.
- Maintained product roadmap aligned to leadership priorities.

SKILLS
Product: Jira | Confluence

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, ['Jira', 'Confluence'])
    const dupViolation = result.violations.find(v => v.rule === 'summary_duplicates_experience')
    expect(dupViolation).toBeDefined()
    expect(dupViolation?.severity).toBe('error')
  })

  it('A9: validator passes when Summary is concept-level and Experience has proof signals', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const resumeText = `SUMMARY
Results-driven Product Owner with experience in backlog execution, stakeholder alignment, and release planning.

SKILLS
Product: Jira | Confluence

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Managed 12 stakeholders to define quarterly roadmap scope.
- Drove 35% adoption improvement via data-informed backlog prioritization.
- Partnered with a 6-person engineering team to deliver two major releases.

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, ['Jira', 'Confluence'])
    const dupViolation = result.violations.find(v => v.rule === 'summary_duplicates_experience')
    expect(dupViolation).toBeUndefined()
  })

  it('A10: Summary containing UAT readiness passes when Experience also contains UAT details', () => {
    const summary = 'Product Owner focused on UAT readiness, release readiness, and stakeholder communication.'
    const experience = `
EXPERIENCE
Product Owner
- Coordinated UAT readiness with QA and business stakeholders before release.
`
    const result = checkSummaryDuplication(summary, experience, ['UAT Readiness'])
    expect(result.hasDuplication).toBe(false)
  })

  it('A11: Summary containing acceptance criteria passes when Experience also contains acceptance criteria', () => {
    const summary = 'Product delivery professional skilled in product requirements and acceptance criteria.'
    const experience = `
EXPERIENCE
Product Owner
- Refined user stories and acceptance criteria with engineering for sprint delivery.
`
    const result = checkSummaryDuplication(summary, experience, ['Acceptance Criteria'])
    expect(result.hasDuplication).toBe(false)
  })

  it('A12: Summary still fails when proof-level details repeat from Experience', () => {
    const summary = 'Product Owner who led a 6-person team in 2-week sprints and drove 35% adoption.'
    const experience = `
EXPERIENCE
Product Owner
- Led a 6-person team through 2-week sprints to drive 35% adoption.
`
    const result = checkSummaryDuplication(summary, experience, [])
    expect(result.hasDuplication).toBe(true)
    expect(result.duplicatedSignals.map(s => s.type)).toEqual(
      expect.arrayContaining(['team_size', 'cadence', 'metric']),
    )
  })
})

// ─── B. Section purpose ────────────────────────────────────────────────────────

describe('B. Section purpose contract', () => {
  it('B1: serializeContractForPrompt contains SECTION PURPOSE CONTRACT block', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const serialized = serializeContractForPrompt(contract)
    expect(serialized).toContain('SECTION PURPOSE CONTRACT')
  })

  it('B2: serialized prompt includes "Summary — positions only" language', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const serialized = serializeContractForPrompt(contract)
    expect(serialized.toLowerCase()).toContain('positions only')
  })

  it('B3: serialized prompt includes DE-DUPLICATION RULE block', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const serialized = serializeContractForPrompt(contract)
    expect(serialized).toContain('DE-DUPLICATION RULE')
  })

  it('B4: serialized prompt instructs that Experience is the proof section', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const serialized = serializeContractForPrompt(contract)
    expect(serialized.toLowerCase()).toContain('proof')
  })

  it('B5: serialized prompt includes NO proof-level detail instruction for Summary', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const serialized = serializeContractForPrompt(contract)
    expect(serialized).toContain('NO proof')
  })

  it('B6: generate-artifact-section source appends the section quality gate', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/generate-artifact-section.ts'),
      'utf-8',
    )
    expect(src).toContain('buildSectionQualityGate')
  })

  it('B7: generate-artifact-section keeps summary prompt concise', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/generate-artifact-section.ts'),
      'utf-8',
    )
    expect(src).toContain('Keep it positioning-level')
  })

  it('B8: generate-artifact-section source does not rely on long prompt essays', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/generate-artifact-section.ts'),
      'utf-8',
    )
    expect(src).not.toContain('SECTION PURPOSE - SUMMARY POSITIONS')
  })
})

// ─── C. Section budget ────────────────────────────────────────────────────────

describe('C. Section budget enforcement', () => {
  it('C1: validator flags skills_max_rows when skill groups exceed sectionPlan limit', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const maxRows = contract.sectionPlan.skills.maxRows

    // Build a resume with more skill rows than allowed
    const tooManySkillRows = Array.from({ length: maxRows + 2 }, (_, i) =>
      `Category${i + 1}: ToolA, ToolB, ToolC`
    ).join('\n')

    const resumeText = `SUMMARY
Product Owner with experience in backlog management.

SKILLS
${tooManySkillRows}

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Managed backlog and stakeholder priorities each sprint.

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, [])
    const budgetViolation = result.violations.find(v => v.rule === 'skills_max_rows')
    expect(budgetViolation).toBeDefined()
    expect(budgetViolation?.severity).toBe('error')
  })

  it('C2: validator does not flag skills_max_rows when within budget', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const maxRows = contract.sectionPlan.skills.maxRows

    const okSkillRows = Array.from({ length: maxRows - 1 }, (_, i) =>
      `Category${i + 1}: ToolA, ToolB`
    ).join('\n')

    const resumeText = `SUMMARY
Product Owner with experience in backlog management.

SKILLS
${okSkillRows}

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Managed backlog and stakeholder priorities each sprint.

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, [])
    const budgetViolation = result.violations.find(v => v.rule === 'skills_max_rows')
    expect(budgetViolation).toBeUndefined()
  })

  it('C3: repair API route file exists', () => {
    const src = readFileSync(
      join(__dirname, '../app/api/stage4-repair/route.ts'),
      'utf-8',
    )
    expect(src).toContain('repairStage4Resume')
    expect(src).toContain('applyDeterministicRepairs')
    expect(src).toContain('validateStage4ResumeOutput')
  })

  it('C4: repair API route runs deterministic pass before LLM pass', () => {
    const src = readFileSync(
      join(__dirname, '../app/api/stage4-repair/route.ts'),
      'utf-8',
    )
    // Use the function call site (with opening paren) to skip past import declarations
    const deterministicIdx = src.indexOf('applyDeterministicRepairs(')
    const llmIdx = src.indexOf('repairStage4Resume(')
    expect(deterministicIdx).toBeGreaterThan(-1)
    expect(llmIdx).toBeGreaterThan(-1)
    expect(deterministicIdx).toBeLessThan(llmIdx)
  })

  it('C5: repair API route runs validation after deterministic repairs', () => {
    const src = readFileSync(
      join(__dirname, '../app/api/stage4-repair/route.ts'),
      'utf-8',
    )
    const deterministicIdx = src.indexOf('applyDeterministicRepairs(')
    const validationIdx = src.indexOf('validateStage4ResumeOutput(')
    expect(validationIdx).toBeGreaterThan(deterministicIdx)
  })

  it('C5b: repair API derives unfixedViolations from validation errors', () => {
    const src = readFileSync(
      join(__dirname, '../app/api/stage4-repair/route.ts'),
      'utf-8',
    )
    expect(src).toContain('validationToUnfixedViolations')
    expect(src).toContain(".filter(v => v.severity === 'error')")
    expect(src).toContain('unfixedViolations = finalValidation.pass')
  })

  it('C5c: repair API response includes repairStatus and partial-state handling', () => {
    const src = readFileSync(
      join(__dirname, '../app/api/stage4-repair/route.ts'),
      'utf-8',
    )
    expect(src).toContain("repairStatus: finalValidation.pass ? 'repaired' : 'partial'")
    expect(src).toContain('validationToUnfixedViolations(finalValidation.violations)')
  })

  it('C5d: Stage 4 UI distinguishes repaired preview from accepted text', () => {
    const src = readFileSync(
      join(__dirname, '../components/export/raw-resume-text-page.tsx'),
      'utf-8',
    )
    expect(src).toContain('Partial Auto-Repair Preview')
    expect(src).toContain('Accept Partial Repair')
    expect(src).toContain('repairPreview')
    expect(src).toContain('unfixedViolations')
  })

  it('C6: validator pass is false when error violations exist', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const maxRows = contract.sectionPlan.skills.maxRows

    const tooManySkillRows = Array.from({ length: maxRows + 3 }, (_, i) =>
      `Category${i + 1}: ToolA, ToolB, ToolC`
    ).join('\n')

    const resumeText = `SUMMARY
Product Owner.

SKILLS
${tooManySkillRows}

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Managed backlog.

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, [])
    expect(result.pass).toBe(false)
  })

  it('C7: validator pass is true when only warnings (no errors)', () => {
    const contract = buildResumeGenerationContract(
      makeInput({
        jdMap: makeJDMap({
          required: [],
          // No required themes means no missing_jd_theme error
        }),
      })
    )

    // Resume with no errors — no banned phrases, no over-budget, no duplication
    const resumeText = `SUMMARY
Product Owner with experience in backlog management and stakeholder alignment.

SKILLS
Product: Jira | Confluence

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Led sprint ceremonies and maintained product roadmap for three business units.
- Delivered release-ready scope each quarter based on KPI signals.
- Translated stakeholder requirements into user stories and acceptance criteria.
- Coordinated UAT with QA team prior to each release.
- Applied backlog prioritization frameworks to manage sprint capacity.

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, ['Jira', 'Confluence'])
    const errors = result.violations.filter(v => v.severity === 'error')
    expect(errors).toHaveLength(0)
    expect(result.pass).toBe(true)
  })
})

// ─── D. Refinement contract ────────────────────────────────────────────────────

describe('D. Refinement contract enforcement', () => {
  it('D1: refine-stage4-resume source accepts contract parameter in FullResumeRefineOptions', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/refine-stage4-resume.ts'),
      'utf-8',
    )
    expect(src).toContain('contract')
    expect(src).toContain('ResumeGenerationContract')
  })

  it('D2: refine-stage4-resume source calls serializeContractForPrompt', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/refine-stage4-resume.ts'),
      'utf-8',
    )
    expect(src).toContain('serializeContractForPrompt')
  })

  it('D3: repair-stage4-resume source enforces "fix only failing sections" constraint', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/repair-stage4-resume.ts'),
      'utf-8',
    )
    expect(src.toLowerCase()).toContain('fix only')
  })

  it('D4: repair-stage4-resume source enforces "do not add new facts" constraint', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/repair-stage4-resume.ts'),
      'utf-8',
    )
    expect(src.toLowerCase()).toContain('do not add new facts')
  })

  it('D5: repair-stage4-resume source enforces "do not rewrite passing sections"', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/repair-stage4-resume.ts'),
      'utf-8',
    )
    expect(src.toLowerCase()).toContain('do not rewrite')
  })

  it('D6: repair-stage4-resume only passes severity=error + non-autoRepairable violations to LLM', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/repair-stage4-resume.ts'),
      'utf-8',
    )
    expect(src).toContain("severity === 'error'")
    expect(src).toContain('canAutoRepair')
  })

  it('D7: repair-stage4-resume uses tool_choice forced tool (not auto)', () => {
    const src = readFileSync(
      join(__dirname, '../lib/llm/repair-stage4-resume.ts'),
      'utf-8',
    )
    expect(src).toContain("type: 'tool'")
    expect(src).toContain('repair_resume')
  })

  it('D8: stage4-refine route passes contract to full refinement', () => {
    const src = readFileSync(
      join(__dirname, '../app/api/stage4-refine/route.ts'),
      'utf-8',
    )
    expect(src).toContain('contract')
    expect(src).toContain('applyDeterministicRepairs')
  })
})

// ─── E. Evidence and tools de-duplication ─────────────────────────────────────

describe('E. Evidence and tools de-duplication', () => {
  it('E1: tool mentioned in profile skills AND Experience bullet AND Summary triggers tool signal', () => {
    const knownTools = ['Pendo', 'Jira', 'Confluence']
    const summary = 'Used Pendo to support data-driven backlog prioritization.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Used Pendo analytics to analyze feature adoption metrics and inform sprint priorities.
`
    const result = checkSummaryDuplication(summary, experience, knownTools)
    expect(result.hasDuplication).toBe(true)
    const toolSignals = result.duplicatedSignals.filter(s => s.type === 'tool')
    expect(toolSignals.some(s => s.value.toLowerCase() === 'pendo')).toBe(true)
  })

  it('E2: tool mentioned only in Summary (not in Experience) does not trigger tool signal', () => {
    const knownTools = ['Pendo', 'Jira', 'Confluence']
    const summary = 'Proficient in Pendo for product analytics and stakeholder reporting.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Led backlog grooming and sprint planning ceremonies.
- Worked with analytics team to improve product metrics.
`
    const result = checkSummaryDuplication(summary, experience, knownTools)
    // Pendo is in summary but NOT in experience bullets — should not be flagged as tool duplication
    const pendoSignals = result.duplicatedSignals.filter(
      s => s.type === 'tool' && s.value.toLowerCase() === 'pendo'
    )
    expect(pendoSignals).toHaveLength(0)
  })

  it('E3: multiple signals from same Experience section all detected', () => {
    const knownTools = ['Pendo', 'Jira']
    const summary = 'Used Pendo analytics and led a 5-person team, driving 20% adoption.'
    const experience = `
EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Used Pendo analytics to identify low-adoption features across the platform.
- Partnered with a 5-person team on sprint delivery and scope prioritization.
- Drove 20% adoption improvement through targeted backlog adjustments.
`
    const result = checkSummaryDuplication(summary, experience, knownTools)
    expect(result.hasDuplication).toBe(true)
    const types = result.duplicatedSignals.map(s => s.type)
    expect(types).toContain('tool')
    expect(types).toContain('team_size')
    expect(types).toContain('metric')
  })

  it('E4: empty experience section produces no duplication signals', () => {
    const summary = 'Product Owner with 3 years experience in agile delivery.'
    const experience = ''
    const result = checkSummaryDuplication(summary, experience, ['Jira'])
    expect(result.hasDuplication).toBe(false)
    expect(result.duplicatedSignals).toHaveLength(0)
  })

  it('E5: validator does not flag azureDevOps_not_allowed when Azure DevOps absent', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const resumeText = `SUMMARY
Product Owner.

SKILLS
Product: Jira | Confluence

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Managed sprint ceremonies using Jira.

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, ['Jira'])
    const azureViolation = result.violations.find(v => v.rule === 'azure_devops_banned')
    expect(azureViolation).toBeUndefined()
  })

  it('E6: validator flags azureDevOps_not_allowed when contract disallows it and text contains Azure DevOps', () => {
    const contract = buildResumeGenerationContract(makeInput())
    // Verify contract does not allow azureDevOps
    if (contract.sessionDirection.azureDevOpsAllowed) {
      // If contract allows it, skip — depends on JD fixture
      return
    }

    const resumeText = `SUMMARY
Product Owner.

SKILLS
Product: Jira | Azure DevOps

EXPERIENCE
Acme Corp — Product Owner (Jan 2021–Dec 2024)
- Used Azure DevOps to manage sprint ceremonies.

EDUCATION
BS Computer Science, State University, 2013`

    const result = validateResumeAgainstContract(resumeText, contract, ['Jira'])
    const azureViolation = result.violations.find(v => v.rule === 'azure_devops_banned')
    expect(azureViolation).toBeDefined()
  })

  it('E7: extended Stage 4 validator flags volume-led bullets without impact tie', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const readinessContract = makeReadinessContract({
      requiredExperienceThemes: [],
    })
    const resumeText = `SUMMARY
Product Owner with backlog execution experience.

SKILLS
Product: Jira

EXPERIENCE
Product Owner
Acme Corp | Jan 2021 - Dec 2024
- Managed 60 support tickets per sprint.
- Refined backlog priorities with stakeholders.
- Coordinated UAT readiness.
- Documented acceptance criteria.
- Supported release planning.

Product Analyst
Acme Corp | Jan 2019 - Jan 2021
- Analyzed requirements.
- Supported sprint demos.
- Maintained documentation.
- Coordinated stakeholder feedback.

EDUCATION
BS Computer Science`

    const result = validateStage4ResumeOutput(resumeText, contract, { readinessContract })
    expect(result.violations.some(v => v.rule === 'volume_metric_without_impact')).toBe(true)
  })

  it('E8: extended Stage 4 validator flags required themes present only in Skills', () => {
    const contract = buildResumeGenerationContract(makeInput())
    const readinessContract = makeReadinessContract({
      requiredExperienceThemes: ['stakeholder alignment / cross-functional delivery'],
    })
    const resumeText = `SUMMARY
Product Owner with backlog execution experience.

SKILLS
Product: Jira
Delivery: Stakeholder alignment, Cross-functional delivery

EXPERIENCE
Product Owner
Acme Corp | Jan 2021 - Dec 2024
- Refined backlog priorities.
- Coordinated UAT readiness.
- Documented acceptance criteria.
- Supported release planning.
- Maintained product notes.

Product Analyst
Acme Corp | Jan 2019 - Jan 2021
- Analyzed requirements.
- Supported sprint demos.
- Maintained documentation.
- Reviewed workflow gaps.

EDUCATION
BS Computer Science`

    const result = validateStage4ResumeOutput(resumeText, contract, { readinessContract })
    expect(result.violations.some(v => v.rule === 'required_theme_only_in_skills')).toBe(true)
  })
})

// ─── F. Persistence ────────────────────────────────────────────────────────────

describe('F. Persistence and type contract', () => {
  it('F1: Stage4RawResumeText type includes optional contract field', () => {
    const src = readFileSync(
      join(__dirname, '../contracts/index.ts'),
      'utf-8',
    )
    expect(src).toContain('contract?: ResumeGenerationContract')
  })

  it('F2: buildStage4RawResumeText source accepts contract in options and assigns it to record', () => {
    const src = readFileSync(
      join(__dirname, '../lib/stage4/raw-resume-text.ts'),
      'utf-8',
    )
    expect(src).toContain('contract')
    expect(src).toContain('applyDeterministicRepairs')
  })

  it('F3: buildStage4RawResumeText applies deterministic repairs to assembled text', () => {
    const src = readFileSync(
      join(__dirname, '../lib/stage4/raw-resume-text.ts'),
      'utf-8',
    )
    expect(src).toContain('applyDeterministicRepairs')
    // Repairs applied before storage
    const repairIdx = src.indexOf('applyDeterministicRepairs')
    const returnIdx = src.lastIndexOf('return ')
    expect(repairIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(repairIdx)
  })

  it('F4: contracts/index.ts defines ResumeGenerationContract interface', () => {
    const src = readFileSync(
      join(__dirname, '../contracts/index.ts'),
      'utf-8',
    )
    expect(src).toContain('ResumeGenerationContract')
    expect(src).toContain('sectionPlan')
    expect(src).toContain('sessionDirection')
    expect(src).toContain('bannedPhrases')
  })

  it('F5: contracts/index.ts defines ContractViolation with severity field', () => {
    const src = readFileSync(
      join(__dirname, '../contracts/index.ts'),
      'utf-8',
    )
    expect(src).toContain('ContractViolation')
    expect(src).toContain("severity: 'error' | 'warning'")
  })

  it('F6: contracts/index.ts defines ContractValidationResult with pass and violations', () => {
    const src = readFileSync(
      join(__dirname, '../contracts/index.ts'),
      'utf-8',
    )
    expect(src).toContain('ContractValidationResult')
    expect(src).toContain('pass: boolean')
    expect(src).toContain('violations: ContractViolation')
  })

  it('F7: buildResumeGenerationContract returns a contract with correct shape', () => {
    const contract = buildResumeGenerationContract(makeInput())
    expect(contract).toBeDefined()
    expect(contract.sectionPlan).toBeDefined()
    expect(contract.sessionDirection).toBeDefined()
    expect(contract.bannedPhrases).toBeInstanceOf(Array)
    expect(contract.requiredBulletThemes).toBeInstanceOf(Array)
  })

  it('F8: contract requiredBulletThemes derived from JD required items', () => {
    const jdMap = makeJDMap({
      required: [
        { text: 'Backlog prioritization', category: 'process', userCoverageStatus: 'covered' },
        { text: 'Stakeholder management', category: 'soft', userCoverageStatus: 'covered' },
        { text: 'UAT coordination', category: 'process', userCoverageStatus: 'covered' },
      ],
    })
    const contract = buildResumeGenerationContract(makeInput({ jdMap }))
    expect(contract.requiredBulletThemes.length).toBeGreaterThan(0)
  })
})

