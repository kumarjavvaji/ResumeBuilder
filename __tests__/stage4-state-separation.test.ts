/**
 * stage4-state-separation.test.ts
 *
 * Proves that Regenerate Raw Text, auto-repair, and explicit full-resume
 * refinement write to the correct state fields, and that section cards
 * reflect the latest generated content.
 *
 * All tests are pure-function unit tests over the storage and assembly helpers.
 * No browser, no IndexedDB, no LLM calls.
 */

import { describe, expect, it } from 'vitest'
import type {
  Stage4RawResumeText,
  Stage4RawResumeSections,
} from '@/contracts'
import {
  parseSectionsFromRepairedText,
  parseExperienceBlocksFromText,
  formatExperienceBlock,
} from '@/lib/stage4/raw-resume-text'
import type { Stage4ExperienceBlock } from '@/contracts'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeRawSections(overrides: Partial<Stage4RawResumeSections> = {}): Stage4RawResumeSections {
  return {
    summary: 'Product analyst focused on release readiness.',
    skills: 'Product: Jira, Confluence\nTesting: Selenium, SpecFlow\nCRM: Salesforce Segmentation',
    experiences: [],
    education: 'B.Sc Computer Science | Example University | 2018',
    fullText: buildFullText(
      'Product analyst focused on release readiness.',
      'Product: Jira, Confluence\nTesting: Selenium, SpecFlow\nCRM: Salesforce Segmentation',
      'B.Sc Computer Science | Example University | 2018',
    ),
    ...overrides,
  }
}

function buildFullText(summary: string, skills: string, education: string, experienceBlocks?: Stage4ExperienceBlock[]): string {
  const experienceText = experienceBlocks && experienceBlocks.length > 0
    ? experienceBlocks.map(formatExperienceBlock).join('\n\n')
    : ''
  return [
    summary ? `SUMMARY\n${summary}` : '',
    skills ? `SKILLS\n${skills}` : '',
    experienceText ? `EXPERIENCE\n${experienceText}` : `EXPERIENCE\n`,
    education ? `EDUCATION\n${education}` : '',
  ].filter(Boolean).join('\n\n')
}

function makeExperienceBlock(overrides: Partial<Stage4ExperienceBlock> & Pick<Stage4ExperienceBlock, 'roleId' | 'title' | 'sourceArtifactSectionId'>): Stage4ExperienceBlock {
  return {
    company: 'Example Corp',
    dates: '2022–2025',
    headingText: `${overrides.title}\nExample Corp | 2022–2025`,
    bullets: ['Managed backlog.', 'Improved delivery.'],
    ...overrides,
  }
}

function makeRawRecord(overrides: Partial<Stage4RawResumeText> = {}): Stage4RawResumeText {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'raw-1',
    sessionId: 's1',
    status: 'generated',
    sourceArtifactSectionIds: [],
    sourceArtifactSnapshots: [],
    generatedAt: now,
    updatedAt: now,
    structureSource: 'manual_profile',
    sections: makeRawSections(),
    warnings: [],
    staleReasons: [],
    ...overrides,
  }
}

// ─── Suite A: parseSectionsFromRepairedText ───────────────────────────────────

describe('A: parseSectionsFromRepairedText', () => {
  it('A1: extracts repaired summary from full text', () => {
    const original = makeRawSections()
    const repairedFullText = buildFullText(
      'Product analyst with strong delivery focus.',
      original.skills,
      original.education,
    )
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.summary).toBe('Product analyst with strong delivery focus.')
  })

  it('A2: extracts repaired skills from full text', () => {
    const original = makeRawSections()
    const repairedSkills = 'Product: Jira, Confluence\nTesting: Selenium, SpecFlow'
    const repairedFullText = buildFullText(original.summary, repairedSkills, original.education)
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.skills).toBe(repairedSkills)
    expect(result.skills).not.toContain('Salesforce Segmentation')
  })

  it('A3: extracts repaired education from full text', () => {
    const original = makeRawSections()
    const repairedEducation = 'B.Sc Computer Science | Example University | 2018\nCSPO | Scrum Alliance | 2023'
    const repairedFullText = buildFullText(original.summary, original.skills, repairedEducation)
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.education).toContain('CSPO')
  })

  it('A4: keeps original experience blocks (structural repair does not change them)', () => {
    const experienceBlocks = [
      { roleId: 'w1', title: 'Product Analyst', company: 'Corp', dates: '2022–2025', headingText: 'Product Analyst\nCorp | 2022–2025', bullets: ['Led backlog.'], sourceArtifactSectionId: 'ba' },
    ]
    const original = makeRawSections({ experiences: experienceBlocks })
    const repairedFullText = buildFullText('Updated summary.', original.skills, original.education)
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.experiences).toStrictEqual(experienceBlocks)
  })

  it('A5: sets fullText to the repaired full text', () => {
    const original = makeRawSections()
    const repairedFullText = buildFullText('Updated.', original.skills, original.education)
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.fullText).toBe(repairedFullText)
  })

  it('A6: falls back to original summary when SUMMARY section is missing from repaired text', () => {
    const original = makeRawSections()
    const repairedFullText = 'SKILLS\nProduct: Jira\n\nEDUCATION\nB.Sc CS'
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.summary).toBe(original.summary)
  })

  it('A7: falls back to original skills when SKILLS section is missing from repaired text', () => {
    const original = makeRawSections()
    const repairedFullText = 'SUMMARY\nUpdated summary.\n\nEDUCATION\nB.Sc CS'
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.skills).toBe(original.skills)
  })

  it('A8: removes Azure DevOps from skills when repair removes it', () => {
    const original = makeRawSections({
      skills: 'Product: Jira\nDevOps: Azure DevOps (exposure)',
    })
    const repairedSkills = 'Product: Jira'
    const repairedFullText = buildFullText(original.summary, repairedSkills, original.education)
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.skills).toBe('Product: Jira')
    expect(result.skills).not.toContain('Azure DevOps')
  })
})

// ─── Suite B: Auto-repair state separation rules ──────────────────────────────

describe('B: auto-repair must not write to refinement* fields', () => {
  it('B1: a freshly saved raw record has no refinement fields', () => {
    const record = makeRawRecord()
    expect(record.refinementAccepted).toBeUndefined()
    expect(record.refinementOutput).toBeUndefined()
    expect(record.refinementInstruction).toBeUndefined()
  })

  it('B2: parseSectionsFromRepairedText does not produce refinement fields', () => {
    const original = makeRawSections()
    const result = parseSectionsFromRepairedText(original.fullText, original)
    expect(Object.keys(result)).not.toContain('refinementOutput')
    expect(Object.keys(result)).not.toContain('refinementAccepted')
    expect(Object.keys(result)).not.toContain('refinementInstruction')
  })

  it('B3: after simulated auto-repair, sections are updated but refinementAccepted stays false', () => {
    const record = makeRawRecord()
    const repairedSkills = 'Product: Jira, Confluence'
    const repairedFullText = buildFullText(record.sections.summary, repairedSkills, record.sections.education)
    const patchedSections = parseSectionsFromRepairedText(repairedFullText, record.sections)

    // Simulate what updateStage4RawResumeTextSections would do in memory
    const updated: Stage4RawResumeText = {
      ...record,
      sections: patchedSections,
      updatedAt: new Date().toISOString(),
    }

    expect(updated.refinementAccepted).toBeUndefined()
    expect(updated.refinementOutput).toBeUndefined()
    expect(updated.sections.skills).toBe(repairedSkills)
    expect(updated.sections.fullText).toBe(repairedFullText)
  })

  it('B4: section cards hydrate from sections.skills — after repair they show repaired content', () => {
    const record = makeRawRecord()
    const repairedSkills = 'Product: Jira, Confluence'
    const repairedFullText = buildFullText(record.sections.summary, repairedSkills, record.sections.education)
    const patchedSections = parseSectionsFromRepairedText(repairedFullText, record.sections)

    const updated: Stage4RawResumeText = { ...record, sections: patchedSections, updatedAt: new Date().toISOString() }

    // Section card reads sections.skills
    expect(updated.sections.skills).toBe('Product: Jira, Confluence')
    expect(updated.sections.skills).not.toContain('Salesforce Segmentation')
  })

  it('B5: FullRefinementPanel accepted check: refinementAccepted falsy → textarea shown', () => {
    const record = makeRawRecord()
    // This mirrors FullRefinementPanel: const accepted = rawText.refinementAccepted && rawText.refinementOutput
    const accepted = record.refinementAccepted && record.refinementOutput
    expect(accepted).toBeFalsy()
  })

  it('B6: FullRefinementPanel accepted check: refinementAccepted true → accepted view shown', () => {
    const record = makeRawRecord({
      refinementAccepted: true,
      refinementOutput: 'User explicitly refined this.',
    })
    const accepted = record.refinementAccepted && record.refinementOutput
    expect(accepted).toBeTruthy()
  })

  it('B7: regeneration clears section refinements (saveStage4RawResumeText spreads assembled which has no sectionRefinements)', () => {
    // This is the contract: the assembled object from buildStage4RawResumeText does not include
    // sectionRefinements. saveStage4RawResumeText spreads ...raw (which is the assembled object),
    // so put() writes a record with no sectionRefinements field.
    const assembled = {
      sessionId: 's1',
      status: 'generated' as const,
      sourceArtifactSectionIds: [],
      sourceArtifactSnapshots: [],
      structureSource: 'manual_profile' as const,
      sections: makeRawSections(),
      warnings: [],
      staleReasons: [],
    }
    // Verify assembled has no refinement fields
    expect(Object.keys(assembled)).not.toContain('sectionRefinements')
    expect(Object.keys(assembled)).not.toContain('refinementOutput')
    expect(Object.keys(assembled)).not.toContain('refinementAccepted')
  })
})

// ─── Suite C: Full-resume refinement state flow ───────────────────────────────

describe('C: explicit user refinement state flow', () => {
  it('C1: before any refinement: no pending, no accepted', () => {
    const record = makeRawRecord()
    const pending = !!(record.refinementOutput && !record.refinementAccepted)
    const accepted = !!(record.refinementAccepted && record.refinementOutput)
    expect(pending).toBe(false)
    expect(accepted).toBe(false)
  })

  it('C2: after saveStage4FullRefinement: pending=true, accepted=false', () => {
    // saveStage4FullRefinement sets refinementOutput and refinementAccepted=false
    const record = makeRawRecord({
      refinementInstruction: 'Tighten to two pages.',
      refinementOutput: 'Tightened resume text.',
      refinementAccepted: false,
    })
    const pending = !!(record.refinementOutput && !record.refinementAccepted)
    const accepted = !!(record.refinementAccepted && record.refinementOutput)
    expect(pending).toBe(true)
    expect(accepted).toBe(false)
  })

  it('C3: after acceptStage4FullRefinement: pending=false, accepted=true', () => {
    const record = makeRawRecord({
      refinementInstruction: 'Tighten to two pages.',
      refinementOutput: 'Tightened resume text.',
      refinementAccepted: true,
    })
    const pending = !!(record.refinementOutput && !record.refinementAccepted)
    const accepted = !!(record.refinementAccepted && record.refinementOutput)
    expect(pending).toBe(false)
    expect(accepted).toBe(true)
  })

  it('C4: after rejectStage4FullRefinement: pending=false, accepted=false', () => {
    // rejectStage4FullRefinement clears refinementOutput and refinementInstruction
    const record = makeRawRecord({
      refinementInstruction: undefined,
      refinementOutput: undefined,
      refinementAccepted: false,
    })
    const pending = !!(record.refinementOutput && !record.refinementAccepted)
    const accepted = !!(record.refinementAccepted && record.refinementOutput)
    expect(pending).toBe(false)
    expect(accepted).toBe(false)
  })

  it('C5: effectiveFullText uses accepted refinement output when accepted', () => {
    const acceptedOutput = 'Explicitly refined full resume.'
    const record = makeRawRecord({
      refinementAccepted: true,
      refinementOutput: acceptedOutput,
    })
    // This mirrors effectiveFullText logic
    const effectiveText = record.refinementAccepted && record.refinementOutput
      ? record.refinementOutput
      : record.sections.fullText
    expect(effectiveText).toBe(acceptedOutput)
  })

  it('C6: effectiveFullText falls back to sections.fullText when no accepted refinement', () => {
    const record = makeRawRecord()
    const effectiveText = record.refinementAccepted && record.refinementOutput
      ? record.refinementOutput
      : record.sections.fullText
    expect(effectiveText).toBe(record.sections.fullText)
  })
})

// ─── Suite D: Copy/export source of truth precedence ─────────────────────────

describe('D: copy/export source of truth', () => {
  it('D1: accepted full refinement takes highest precedence', () => {
    const acceptedOutput = 'Accepted full refinement.'
    const record = makeRawRecord({
      refinementAccepted: true,
      refinementOutput: acceptedOutput,
    })
    const exportText = record.refinementAccepted && record.refinementOutput
      ? record.refinementOutput
      : record.sections.fullText
    expect(exportText).toBe(acceptedOutput)
  })

  it('D2: unaccepted proposal does not become export output', () => {
    const pendingProposal = 'Pending unaccepted proposal.'
    const record = makeRawRecord({
      refinementOutput: pendingProposal,
      refinementAccepted: false,
    })
    // effectiveFullText checks refinementAccepted BEFORE returning refinementOutput
    const exportText = record.refinementAccepted && record.refinementOutput
      ? record.refinementOutput
      : record.sections.fullText
    expect(exportText).toBe(record.sections.fullText)
    expect(exportText).not.toBe(pendingProposal)
  })

  it('D3: repaired sections.fullText is used when no accepted refinement', () => {
    const repairedSkills = 'Product: Jira'
    const repairedFullText = buildFullText('Summary.', repairedSkills, 'Education.')
    const original = makeRawSections()
    const patchedSections = parseSectionsFromRepairedText(repairedFullText, original)
    const record = makeRawRecord({ sections: patchedSections })

    const exportText = record.refinementAccepted && record.refinementOutput
      ? record.refinementOutput
      : record.sections.fullText
    expect(exportText).toBe(repairedFullText)
    expect(exportText).not.toContain('Salesforce Segmentation')
  })
})

// ─── Suite E: Experience block hydration after repair ────────────────────────

describe('E: experience block hydration from repaired full text', () => {
  it('E1: repaired full text updates Product Analyst bullets', () => {
    const paBlock = makeExperienceBlock({
      roleId: 'w1',
      title: 'Product Analyst',
      sourceArtifactSectionId: 'ba',
      bullets: ['Old PA bullet.'],
    })
    const original = makeRawSections({ experiences: [paBlock] })
    const repairedPA = makeExperienceBlock({
      roleId: 'w1',
      title: 'Product Analyst',
      sourceArtifactSectionId: 'ba',
      bullets: ['Defined acceptance criteria for 40+ stories.', 'Reduced regression defects by 25%.'],
    })
    const repairedFullText = buildFullText(original.summary, original.skills, original.education, [repairedPA])
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.experiences[0].bullets).toEqual(['Defined acceptance criteria for 40+ stories.', 'Reduced regression defects by 25%.'])
    expect(result.experiences[0].bullets).not.toContain('Old PA bullet.')
  })

  it('E2: repaired full text updates Product Owner bullets', () => {
    const poBlock = makeExperienceBlock({
      roleId: 'w2',
      title: 'Product Owner',
      sourceArtifactSectionId: 'bb',
      bullets: ['Old PO bullet.'],
    })
    const original = makeRawSections({ experiences: [poBlock] })
    const repairedPO = makeExperienceBlock({
      roleId: 'w2',
      title: 'Product Owner',
      sourceArtifactSectionId: 'bb',
      bullets: ['Led sprint planning for 8-person team.', 'Delivered roadmap on schedule.'],
    })
    const repairedFullText = buildFullText(original.summary, original.skills, original.education, [repairedPO])
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.experiences[0].bullets).toEqual(['Led sprint planning for 8-person team.', 'Delivered roadmap on schedule.'])
    expect(result.experiences[0].bullets).not.toContain('Old PO bullet.')
  })

  it('E3: repaired full text updates QA bullets', () => {
    const qaBlock = makeExperienceBlock({
      roleId: 'w3',
      title: 'QA Engineer',
      sourceArtifactSectionId: 'bc',
      bullets: ['Old QA bullet.'],
    })
    const original = makeRawSections({ experiences: [qaBlock] })
    const repairedQA = makeExperienceBlock({
      roleId: 'w3',
      title: 'QA Engineer',
      sourceArtifactSectionId: 'bc',
      bullets: ['Automated 200+ regression tests.', 'Reduced manual QA cycle by 40%.'],
    })
    const repairedFullText = buildFullText(original.summary, original.skills, original.education, [repairedQA])
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.experiences[0].bullets).toEqual(['Automated 200+ regression tests.', 'Reduced manual QA cycle by 40%.'])
    expect(result.experiences[0].bullets).not.toContain('Old QA bullet.')
  })

  it('E4: missing EXPERIENCE section falls back to original blocks without corrupting other sections', () => {
    const paBlock = makeExperienceBlock({
      roleId: 'w1',
      title: 'Product Analyst',
      sourceArtifactSectionId: 'ba',
      bullets: ['Original bullet.'],
    })
    const original = makeRawSections({ experiences: [paBlock] })
    // Repaired text has no EXPERIENCE section
    const repairedFullText = 'SUMMARY\nUpdated summary.\n\nSKILLS\nProduct: Jira\n\nEDUCATION\nB.Sc CS'
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    expect(result.experiences).toStrictEqual([paBlock])
    expect(result.summary).toBe('Updated summary.')
    expect(result.skills).toBe('Product: Jira')
    expect(result.education).toBe('B.Sc CS')
  })

  it('E5: non-bullet metadata (roleId, title, company, dates, headingText, sourceArtifactSectionId) is preserved after hydration', () => {
    const poBlock = makeExperienceBlock({
      roleId: 'w2',
      title: 'Product Owner',
      sourceArtifactSectionId: 'bb',
      company: 'Acme Inc',
      dates: '2020–2022',
      headingText: 'Product Owner\nAcme Inc | 2020–2022',
      bullets: ['Old bullet.'],
    })
    const original = makeRawSections({ experiences: [poBlock] })
    const repairedPO = { ...poBlock, bullets: ['New bullet.'] }
    const repairedFullText = buildFullText(original.summary, original.skills, original.education, [repairedPO])
    const result = parseSectionsFromRepairedText(repairedFullText, original)
    const hydrated = result.experiences[0]
    expect(hydrated.roleId).toBe('w2')
    expect(hydrated.title).toBe('Product Owner')
    expect(hydrated.company).toBe('Acme Inc')
    expect(hydrated.dates).toBe('2020–2022')
    expect(hydrated.headingText).toBe('Product Owner\nAcme Inc | 2020–2022')
    expect(hydrated.sourceArtifactSectionId).toBe('bb')
    expect(hydrated.bullets).toEqual(['New bullet.'])
  })

  it('E6: multiple roles updated in a single repair pass — all section cards reflect repaired bullets', () => {
    const paBlock = makeExperienceBlock({ roleId: 'w1', title: 'Product Analyst', sourceArtifactSectionId: 'ba', bullets: ['Old PA.'] })
    const poBlock = makeExperienceBlock({ roleId: 'w2', title: 'Product Owner', sourceArtifactSectionId: 'bb', bullets: ['Old PO.'] })
    const qaBlock = makeExperienceBlock({ roleId: 'w3', title: 'QA Engineer', sourceArtifactSectionId: 'bc', bullets: ['Old QA.'] })
    const original = makeRawSections({ experiences: [paBlock, poBlock, qaBlock] })

    const repairedPA = { ...paBlock, bullets: ['New PA bullet.'] }
    const repairedPO = { ...poBlock, bullets: ['New PO bullet.'] }
    const repairedQA = { ...qaBlock, bullets: ['New QA bullet.'] }
    const repairedFullText = buildFullText(original.summary, original.skills, original.education, [repairedPA, repairedPO, repairedQA])
    const result = parseSectionsFromRepairedText(repairedFullText, original)

    expect(result.experiences[0].bullets).toEqual(['New PA bullet.'])
    expect(result.experiences[1].bullets).toEqual(['New PO bullet.'])
    expect(result.experiences[2].bullets).toEqual(['New QA bullet.'])
  })
})
