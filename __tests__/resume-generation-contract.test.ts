/**
 * ResumeGenerationContract tests.
 *
 * A. Section balance â€” sectionPlan limits derived correctly
 * B. Banned phrases â€” present in bannedPhrases + preferredReplacements
 * C. Session direction â€” representPrimaryRole, azureDevOpsAllowed, salesforcePreferredPhrase
 * D. JD theme placement â€” requiredBulletThemes derived from JD; validateResumeAgainstContract reports missing
 * E. Refinement contract reuse â€” serializeContractForPrompt produces correct prompt block
 * F. Deterministic repairs â€” applyDeterministicRepairs removes banned content
 */

import { describe, it, expect } from 'vitest'
import {
  buildResumeGenerationContract,
  validateResumeAgainstContract,
  applyDeterministicRepairs,
  serializeContractForPrompt,
} from '../lib/stage4/resume-generation-contract'
import type { ContractBuildInput } from '../lib/stage4/resume-generation-contract'
import type { UserProfile, JDRequirementMap, WorkEntry, SkillGroup } from '../contracts'
import { readFileSync } from 'fs'
import { join } from 'path'

// â”€â”€â”€ Fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        company: 'SaaS Co',
        title: 'Product Owner',
        startDate: 'Mar 2021',
        endDate: 'Oct 2024',
        bullets: [],
        approvedMetrics: [],
        domain: 'HR Technology',
        skills: ['Jira', 'Confluence'],
      } as WorkEntry,
      {
        id: 'w2',
        company: 'SaaS Co',
        title: 'Product Analyst',
        startDate: 'Nov 2018',
        endDate: 'Mar 2021',
        bullets: [],
        approvedMetrics: [],
        domain: 'HR Technology',
        skills: ['Jira'],
      } as WorkEntry,
      {
        id: 'w3',
        company: 'Prior Employer Corp',
        title: 'Lead Software Test Engineer',
        startDate: 'Jan 2014',
        endDate: 'Nov 2018',
        bullets: [],
        approvedMetrics: [],
        domain: 'Supply Chain',
        skills: [],
      } as WorkEntry,
    ],
    education: [
      {
        id: 'e1',
        institution: 'University of Illinois at Chicago',
        degree: 'BS',
        field: 'Electrical and Computer Engineering',
        graduationYear: '2013',
      },
    ],
    skillGroups: [
      { id: 'sg1', heading: 'Product', skills: ['Jira', 'Confluence', 'Pendo'] } as SkillGroup,
      { id: 'sg2', heading: 'Delivery', skills: ['UAT', 'Sprint Planning'] } as SkillGroup,
    ],
    skills: ['Jira', 'Confluence', 'Pendo', 'UAT', 'Sprint Planning'],
    certifications: ['Certified Scrum Product Owner (CSPO), Scrum Alliance, 2017'],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: '2024-01-01',
    ...overrides,
  }
}

function makeJDMap(overrides: Partial<JDRequirementMap> = {}): JDRequirementMap {
  return {
    required: [
      { text: 'Backlog prioritization and sprint planning', category: 'process', userCoverageStatus: 'covered' },
      { text: 'Acceptance criteria and user stories', category: 'process', userCoverageStatus: 'covered' },
      { text: 'UAT coordination and release readiness', category: 'process', userCoverageStatus: 'covered' },
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
    overallRefinementPrompt:
      'Treat March 2021â€“October 2024 as Product Owner experience. Do not hedge on the PO title.',
    jdMap: makeJDMap(),
    profile: makeProfile(),
    ...overrides,
  }
}

// â”€â”€â”€ A. Section balance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('A. Section balance', () => {
  it('A1: sectionPlan.summary.maxLines is 4 for PO role', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sectionPlan.summary.maxLines).toBe(4)
  })

  it('A2: sectionPlan.skills.maxRows is 5 for PO role', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sectionPlan.skills.maxRows).toBe(5)
  })

  it('A3: primaryRole min 5, max 6 bullets for primary role', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sectionPlan.primaryRole.minBullets).toBe(5)
    expect(c.sectionPlan.primaryRole.maxBullets).toBe(6)
  })

  it('A4: secondaryRole min 4, max 5 bullets for primary role', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sectionPlan.secondaryRole.minBullets).toBe(4)
    expect(c.sectionPlan.secondaryRole.maxBullets).toBe(5)
  })

  it('A5: QA max 4 bullets for non-QA product role (supporting only)', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sectionPlan.supportingRole.maxBullets).toBe(4)
  })

  it('A6: QA max 6 bullets when emphasis is QA', () => {
    const c = buildResumeGenerationContract(makeInput({ emphasisRecommendation: 'QA', roleTitle: 'QA Engineer' }))
    expect(c.sectionPlan.supportingRole.maxBullets).toBe(6)
    expect(c.targetRoleFamily).toBe('supporting')
  })

  it('A7: primary role family detected from product manager title', () => {
    const c = buildResumeGenerationContract(
      makeInput({ emphasisRecommendation: 'PO', roleTitle: 'Associate Product Manager' })
    )
    expect(c.targetRoleFamily).toBe('primary')
  })

  it('A8: validator flags Skills over maxRows', () => {
    const c = buildResumeGenerationContract(makeInput())
    const resumeWith6SkillRows = `SUMMARY\nPositioning statement.

SKILLS
Product: Jira, Confluence
Delivery: UAT, Sprint Planning
Analysis: Requirements, Gap Analysis
Stakeholders: Communication, Facilitation
Data: Excel, SQL
Testing: Selenium, TestRail

EXPERIENCE
Product Owner
SaaS Co | Mar 2021 - Oct 2024
- bullet one
- bullet two
- bullet three
- bullet four
- bullet five

Product Analyst
SaaS Co | Nov 2018 - Mar 2021
- bullet one
- bullet two
- bullet three
- bullet four

EDUCATION
BS Electrical and Computer Engineering | University of Illinois at Chicago | 2013`
    const result = validateResumeAgainstContract(resumeWith6SkillRows, c)
    const skillsViolation = result.violations.find(v => v.rule === 'skills_max_rows')
    expect(skillsViolation).toBeDefined()
    expect(skillsViolation!.section).toBe('skills')
  })

  it('A9: validator flags PO over maxBullets', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = `SUMMARY\nPositioning statement here.

SKILLS
Product: Jira

EXPERIENCE
Product Owner
SaaS Co | Mar 2021 - Oct 2024
- bullet 1
- bullet 2
- bullet 3
- bullet 4
- bullet 5
- bullet 6
- bullet 7

Product Analyst
SaaS Co | Nov 2018 - Mar 2021
- bullet 1
- bullet 2
- bullet 3
- bullet 4

EDUCATION
BS | University`
    const result = validateResumeAgainstContract(text, c)
    expect(result.violations.some(v => v.rule === 'po_max_bullets')).toBe(true)
  })

  it('A10: validator passes when all counts within limits', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = `SUMMARY
CSPO-certified Product Owner with 3.5 years leading backlog execution.
Delivered release-ready scope at SaaS Co across HR SaaS products.
Brings QA-informed judgment on acceptance criteria and release readiness.

SKILLS
Product: Jira, Confluence
Delivery: UAT, Sprint Planning
Analysis: Requirements, Gap Analysis
Stakeholders: Facilitation
Data: Excel

EXPERIENCE
Product Owner
SaaS Co | Mar 2021 - Oct 2024
- Executed leadership-sponsored roadmap for payroll module.
- Refined 200+ user stories with acceptance criteria.
- Coordinated UAT with QA team.
- Reduced sprint carry-over by ~40%.
- Translated KPI feedback into prioritization decisions.

Product Analyst
SaaS Co | Nov 2018 - Mar 2021
- Triaged business requirements for integration features.
- Maintained UAT documentation and sprint demo notes.
- Analyzed usage data to recommend product improvements.
- Supported backlog refinement, sprint demos, and ceremony preparation.

Lead Software Test Engineer
Prior Employer Corp | Jan 2014 - Nov 2018
- Built regression test suites for ERP modules.
- Reduced production defect rate by ~25%.
- Validated release readiness for 3 major product versions.

EDUCATION
BS Electrical and Computer Engineering | University of Illinois at Chicago | 2013
Certified Scrum Product Owner (CSPO), Scrum Alliance, 2017`
    const result = validateResumeAgainstContract(text, c)
    const sectionViolations = result.violations.filter(v =>
      ['skills_max_rows', 'po_min_bullets', 'po_max_bullets', 'pa_min_bullets', 'pa_max_bullets'].includes(v.rule)
    )
    expect(sectionViolations).toHaveLength(0)
  })
})

// â”€â”€â”€ B. Banned phrases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('B. Banned phrases', () => {
  it('B1: "Salesforce Segmentation" is always banned', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.bannedPhrases).toContain('Salesforce Segmentation')
  })

  it('B2: "formal PO tenure" is banned when avoidFormalTitleHedging is true', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sessionDirection.avoidFormalTitleHedging).toBe(true)
    expect(c.bannedPhrases).toContain('formal PO tenure')
  })

  it('B3: "PO-adjacent" is banned when avoidFormalTitleHedging is true', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.bannedPhrases).toContain('PO-adjacent')
  })

  it('B4: "Azure DevOps" is banned when not in profile skills', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sessionDirection.azureDevOpsAllowed).toBe(false)
    expect(c.bannedPhrases).toContain('Azure DevOps')
  })

  it('B5: "Azure DevOps" NOT banned when explicitly in profile skillGroups', () => {
    const profile = makeProfile({
      skillGroups: [
        { id: 'sg1', heading: 'Tools', skills: ['Azure DevOps', 'Jira'] } as SkillGroup,
      ],
      skills: ['Azure DevOps', 'Jira'],
    })
    const c = buildResumeGenerationContract(makeInput({ profile }))
    expect(c.sessionDirection.azureDevOpsAllowed).toBe(true)
    expect(c.bannedPhrases).not.toContain('Azure DevOps')
  })

  it('B6: preferred replacement maps "Salesforce Segmentation" â†’ salesforcePreferredPhrase', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.preferredReplacements['Salesforce Segmentation']).toBe('Salesforce Reporting')
  })

  it('B7: validator detects "formal PO tenure" as banned_phrase violation', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = `SUMMARY\nWith formal PO tenure at SaaS Co, I led delivery.\n\nSKILLS\nProduct: Jira\n\nEXPERIENCE\nProduct Owner\nSaaS Co | Mar 2021 - Oct 2024\n- bullet one\n- bullet two\n- bullet three\n- bullet four\n- bullet five\n\nProduct Analyst\nSaaS Co | Nov 2018 - Mar 2021\n- bullet one\n- bullet two\n- bullet three\n- bullet four\n\nEDUCATION\nBS Engineering`
    const result = validateResumeAgainstContract(text, c)
    expect(result.violations.some(v => v.rule === 'banned_phrase' && v.detail.includes('formal PO tenure'))).toBe(true)
  })

  it('B8: validator detects "Azure DevOps" when not allowed', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = `SUMMARY\nPositioning statement.\n\nSKILLS\nTools: Azure DevOps, Jira\n\nEXPERIENCE\nProduct Owner\nSaaS Co | Mar 2021 - Oct 2024\n- bullet 1\n- bullet 2\n- bullet 3\n- bullet 4\n- bullet 5\n\nProduct Analyst\nSaaS Co | Nov 2018 - Mar 2021\n- bullet 1\n- bullet 2\n- bullet 3\n- bullet 4\n\nEDUCATION\nBS Engineering`
    const result = validateResumeAgainstContract(text, c)
    expect(
      result.violations.some(v => v.rule === 'banned_phrase' || v.rule === 'azure_devops_banned')
    ).toBe(true)
  })

  it('B9: travel willingness bannedPhrases present when travelResumeAllowed is false', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sessionDirection.travelResumeAllowed).toBe(false)
    expect(c.bannedPhrases.some(p => /travel/i.test(p))).toBe(true)
  })
})

// â”€â”€â”€ C. Session direction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('C. Session direction', () => {
  it('C1: representPrimaryRole true when profile contains a Product Owner role', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sessionDirection.representPrimaryRole).toBe(true)
  })

  it('C2: representPrimaryRole false when profile has no PO work history', () => {
    const profile = makeProfile({
      workHistory: [
        {
          id: 'w1',
          company: 'Acme',
          title: 'Business Analyst',
          startDate: 'Jan 2020',
          endDate: 'Dec 2023',
          bullets: [],
          approvedMetrics: [],
          domain: 'Finance',
          skills: [],
        } as WorkEntry,
      ],
    })
    const c = buildResumeGenerationContract(
      makeInput({ overallRefinementPrompt: 'Focus on BA skills', profile, emphasisRecommendation: 'BA' })
    )
    expect(c.sessionDirection.representPrimaryRole).toBe(false)
  })

  it('C3: representPrimaryRole true when work history contains a Product Owner role', () => {
    const c = buildResumeGenerationContract(
      makeInput({ overallRefinementPrompt: 'Highlight analytical skills only' })
    )
    // Profile has a Product Owner work entry
    expect(c.sessionDirection.representPrimaryRole).toBe(true)
  })

  it('C4: avoidFormalTitleHedging is true when profile has primary PO role', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sessionDirection.avoidFormalTitleHedging).toBe(true)
  })

  it('C5: salesforcePreferredPhrase defaults to "Salesforce Reporting"', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sessionDirection.salesforcePreferredPhrase).toBe('Salesforce Reporting')
  })

  it('C6: salesforcePreferredPhrase detected from overallRefinementPrompt', () => {
    const c = buildResumeGenerationContract(
      makeInput({ overallRefinementPrompt: 'Use "Salesforce request data" not Segmentation' })
    )
    expect(c.sessionDirection.salesforcePreferredPhrase).toBe('Salesforce request data')
  })

  it('C7: roadmapBoundary contains "leadership-sponsored"', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.sessionDirection.roadmapBoundary).toContain('leadership-sponsored')
  })

  it('C8: targetRoleFamily is "primary" for product owner title', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.targetRoleFamily).toBe('primary')
  })

  it('C9: targetRoleFamily is "secondary" for business analyst title', () => {
    const c = buildResumeGenerationContract(makeInput({ emphasisRecommendation: 'BA', roleTitle: 'Business Analyst' }))
    expect(c.targetRoleFamily).toBe('secondary')
  })

  it('C10: evidenceRouting["Azure DevOps"] is empty when not allowed', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.evidenceRouting['Azure DevOps']).toEqual([])
  })

  it('C11: evidenceRouting["CSPO"] includes summary and education', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.evidenceRouting['CSPO']).toContain('summary')
    expect(c.evidenceRouting['CSPO']).toContain('education')
  })

  it('C12: roadmap ownership routed to experience-primary', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.evidenceRouting['roadmap ownership']).toContain('experience-primary')
  })
})

// â”€â”€â”€ D. JD theme placement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('D. JD theme placement', () => {
  it('D1: UAT JD requirement produces "UAT / QA collaboration" theme', () => {
    const c = buildResumeGenerationContract(makeInput())
    expect(c.requiredBulletThemes.some(t => /uat/i.test(t))).toBe(true)
  })

  it('D2: KPI requirement produces product performance theme', () => {
    const jdMap = makeJDMap({
      required: [
        { text: 'Monitor product KPI and report on adoption metrics', category: 'process', userCoverageStatus: 'covered' },
      ],
    })
    const c = buildResumeGenerationContract(makeInput({ jdMap }))
    expect(c.requiredBulletThemes.some(t => /kpi/i.test(t))).toBe(true)
  })

  it('D3: backlog requirement produces backlog ownership theme', () => {
    const jdMap = makeJDMap({
      required: [
        { text: 'Own product backlog and manage sprint priorities', category: 'process', userCoverageStatus: 'covered' },
      ],
    })
    const c = buildResumeGenerationContract(makeInput({ jdMap }))
    expect(c.requiredBulletThemes.some(t => /backlog/i.test(t))).toBe(true)
  })

  it('D4: validator reports missing_jd_theme when theme not found in bullets', () => {
    const jdMap = makeJDMap({
      required: [
        { text: 'KPI reporting and product performance dashboards', category: 'process', userCoverageStatus: 'covered' },
      ],
    })
    const c = buildResumeGenerationContract(makeInput({ jdMap }))
    const text = `SUMMARY\nPositioning statement.

SKILLS
Product: Jira

EXPERIENCE
Product Owner
SaaS Co | Mar 2021 - Oct 2024
- Executed roadmap for payroll module.
- Refined user stories with acceptance criteria.
- Coordinated UAT with QA.
- Reduced sprint carry-over.
- Translated stakeholder feedback.

Product Analyst
SaaS Co | Nov 2018 - Mar 2021
- Triaged requirements.
- Maintained documentation.
- Supported sprint demos.
- Analyzed requirements.

EDUCATION
BS Engineering`
    const result = validateResumeAgainstContract(text, c)
    expect(result.violations.some(v => v.rule === 'missing_jd_theme')).toBe(true)
  })

  it('D5: validator passes missing_jd_theme when theme IS present in bullets', () => {
    const jdMap = makeJDMap({
      required: [
        { text: 'KPI reporting and product performance dashboards', category: 'process', userCoverageStatus: 'covered' },
      ],
    })
    const c = buildResumeGenerationContract(makeInput({ jdMap }))
    const text = `SUMMARY\nPositioning statement.\n\nSKILLS\nProduct: Jira\n\nEXPERIENCE\nProduct Owner\nSaaS Co | Mar 2021 - Oct 2024\n- Tracked product KPI and reported performance via Pendo dashboards.\n- Refined user stories with acceptance criteria.\n- Coordinated UAT.\n- Reduced sprint carry-over.\n- Translated stakeholder feedback.\n\nProduct Analyst\nSaaS Co | Nov 2018 - Mar 2021\n- Triaged requirements.\n- Maintained documentation.\n- Supported sprint demos.\n- Analyzed usage data.\n\nEDUCATION\nBS Engineering`
    const result = validateResumeAgainstContract(text, c)
    expect(result.violations.some(v => v.rule === 'missing_jd_theme')).toBe(false)
  })

  it('D6: validator flags QA exceeding PA bullet count for product roles', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = `SUMMARY\nPositioning statement.\n\nSKILLS\nProduct: Jira\n\nEXPERIENCE\nProduct Owner\nSaaS Co | Mar 2021 - Oct 2024\n- bullet 1\n- bullet 2\n- bullet 3\n- bullet 4\n- bullet 5\n\nProduct Analyst\nSaaS Co | Nov 2018 - Mar 2021\n- bullet 1\n- bullet 2\n\nLead Software Test Engineer\nPrior Employer Corp | Jan 2014 - Nov 2018\n- bullet 1\n- bullet 2\n- bullet 3\n- bullet 4\n\nEDUCATION\nBS Engineering`
    const result = validateResumeAgainstContract(text, c)
    expect(result.violations.some(v => v.rule === 'qa_exceeds_pa')).toBe(true)
  })
})

// â”€â”€â”€ E. Refinement contract reuse (serialization) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('E. Refinement contract reuse â€” serializeContractForPrompt', () => {
  it('E1: serialized block contains role family', () => {
    const c = buildResumeGenerationContract(makeInput())
    const prompt = serializeContractForPrompt(c)
    expect(prompt).toContain('primary')
  })

  it('E2: serialized block contains section limits', () => {
    const c = buildResumeGenerationContract(makeInput())
    const prompt = serializeContractForPrompt(c)
    expect(prompt).toContain('max 4 lines')
    expect(prompt).toContain('max 5 rows')
    expect(prompt).toContain('5â€“6 bullets')
  })

  it('E3: serialized block contains PO 2021 session direction when set', () => {
    const c = buildResumeGenerationContract(makeInput())
    const prompt = serializeContractForPrompt(c)
    expect(prompt).toContain('March 2021')
    expect(prompt).toContain('no title hedging')
  })

  it('E4: serialized block contains Azure DevOps NOT allowed', () => {
    const c = buildResumeGenerationContract(makeInput())
    const prompt = serializeContractForPrompt(c)
    expect(prompt).toContain('NOT allowed')
    expect(prompt).toContain('Jira')
  })

  it('E5: serialized block contains salesforce preferred phrase', () => {
    const c = buildResumeGenerationContract(makeInput())
    const prompt = serializeContractForPrompt(c)
    expect(prompt).toContain('Salesforce Reporting')
    expect(prompt).toContain('Salesforce Segmentation')
  })

  it('E6: serialized block contains banned phrases list', () => {
    const c = buildResumeGenerationContract(makeInput())
    const prompt = serializeContractForPrompt(c)
    expect(prompt).toContain('BANNED PHRASES')
    expect(prompt).toContain('formal PO tenure')
  })

  it('E7: serialized block contains required JD themes', () => {
    const c = buildResumeGenerationContract(makeInput())
    const prompt = serializeContractForPrompt(c)
    expect(prompt).toContain('REQUIRED JD THEMES')
    expect(prompt).toContain('UAT')
  })

  it('E8: contract block is included in refine-stage4-resume source when contract provided', () => {
    const src = readFileSync(join(__dirname, '../lib/llm/refine-stage4-resume.ts'), 'utf-8')
    expect(src).toContain('serializeContractForPrompt')
    expect(src).toContain('contractBlock')
    expect(src).toContain('contract?: ResumeGenerationContract')
  })

  it('E9: API route passes contract to refineFullResumeExport', () => {
    const src = readFileSync(join(__dirname, '../app/api/stage4-refine/route.ts'), 'utf-8')
    expect(src).toContain('contract: body.contract')
    expect(src).toContain('applyDeterministicRepairs')
  })
})

// â”€â”€â”€ F. Deterministic repairs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('F. Deterministic repairs â€” applyDeterministicRepairs', () => {
  it('F1: replaces "Salesforce Segmentation" with salesforcePreferredPhrase', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'Skills: Salesforce Segmentation, Jira, Confluence'
    const { repairedText, repairsApplied } = applyDeterministicRepairs(text, c)
    expect(repairedText).not.toContain('Salesforce Segmentation')
    expect(repairedText).toContain('Salesforce Reporting')
    expect(repairsApplied.length).toBeGreaterThan(0)
  })

  it('F2: replaces "formal PO tenure" when avoidFormalTitleHedging is true', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'My formal PO tenure at SaaS Co spans 3.5 years.'
    const { repairedText } = applyDeterministicRepairs(text, c)
    expect(repairedText).not.toContain('formal PO tenure')
    expect(repairedText).toContain('3.5 years leading backlog execution')
  })

  it('F3: replaces "PO-adjacent" with "Product Owner"', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'Functioned in a PO-adjacent role at SaaS Co.'
    const { repairedText } = applyDeterministicRepairs(text, c)
    expect(repairedText).not.toContain('PO-adjacent')
    expect(repairedText).toContain('Product Owner')
  })

  it('F4: removes Azure DevOps from skills line in fullText mode', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'SKILLS\nTools: Azure DevOps, Jira, Confluence\n\nEXPERIENCE\n'
    const { repairedText, repairsApplied } = applyDeterministicRepairs(text, c, 'fullText')
    expect(repairedText).not.toContain('Azure DevOps')
    expect(repairsApplied.some(r => /Azure DevOps/i.test(r))).toBe(true)
  })

  it('F5: removes Azure DevOps from a section text in section mode', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'Tools: Azure DevOps, Jira, Confluence'
    const { repairedText } = applyDeterministicRepairs(text, c, 'section')
    expect(repairedText).not.toContain('Azure DevOps')
    expect(repairedText).toContain('Jira')
  })

  it('F6: removes travel willingness line', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'Experienced PO.\nWilling to travel up to 25% for client engagements.\nCSPO certified.'
    const { repairedText, repairsApplied } = applyDeterministicRepairs(text, c)
    expect(repairedText).not.toContain('travel')
    expect(repairsApplied.some(r => /travel/i.test(r))).toBe(true)
  })

  it('F7: no repair applied when text is already clean', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'Product Owner at SaaS Co with Jira, Confluence, Pendo.'
    const { repairsApplied } = applyDeterministicRepairs(text, c)
    expect(repairsApplied).toHaveLength(0)
  })

  it('F8: case-insensitive replacement of banned phrases', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'SALESFORCE SEGMENTATION usage tracked via reports.'
    const { repairedText } = applyDeterministicRepairs(text, c)
    expect(repairedText).not.toMatch(/salesforce segmentation/i)
  })

  it('F9: repair result repairsApplied lists each repair performed', () => {
    const c = buildResumeGenerationContract(makeInput())
    const text = 'Salesforce Segmentation users. Formal PO tenure at SaaS Co.'
    const { repairsApplied } = applyDeterministicRepairs(text, c)
    expect(repairsApplied.length).toBeGreaterThanOrEqual(2)
  })
})

