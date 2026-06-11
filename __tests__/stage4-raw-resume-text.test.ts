import { describe, expect, it } from 'vitest'
import type { ArtifactSection, ResumeBullet, SectionType, UserProfile, WorkEntry } from '@/contracts'
import {
  buildStage4RawResumeText,
  formatExperienceBlock,
  getStage4Readiness,
  getStage4StaleReasons,
  naturalizeLine
} from '@/lib/stage4/raw-resume-text'

function bullet(text: string, overrides: Partial<ResumeBullet> = {}): ResumeBullet {
  return {
    id: `bullet-${text.slice(0, 6)}`,
    text,
    claimStatus: 'supported',
    sourceSignal: 'user-history',
    approved: null,
    partition: 'display',
    ...overrides
  }
}

function section(type: SectionType, overrides: Partial<ArtifactSection> = {}): ArtifactSection {
  return {
    id: `section-${type}`,
    sessionId: 'sess-1',
    type,
    content: `${type} content`,
    bullets: [],
    status: 'accepted',
    generationRationale: 'Why this was written should not export.',
    evidenceWarnings: ['Evidence warning should not export.'],
    sourceMappings: ['Source mapping should not export.'],
    calibrationInfluence: {
      calibrationAvailable: true,
      calibrationUsed: true,
      useLevel: 'material',
      influenceSummary: 'Calibration influence should not export.',
      influencedPatterns: ['Market pattern'],
      artifactDecisions: [{
        pattern: 'Market pattern',
        decisionType: 'ordering',
        decision: 'Calibration decision should not export.'
      }]
    },
    signalInfluence: 'Signal influence should not export.',
    jdTraceability: ['JD traceability should not export.'],
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function work(overrides: Partial<WorkEntry> & Pick<WorkEntry, 'id' | 'title' | 'company'>): WorkEntry {
  return {
    startDate: 'Jan 2020',
    endDate: 'Dec 2022',
    domain: '',
    bullets: [],
    approvedMetrics: [],
    skills: [],
    ...overrides
  }
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'profile-1',
    fullName: 'Test User',
    email: '',
    phone: '',
    location: '',
    linkedIn: '',
    summary: '',
    workHistory: [
      work({ id: 'po-role', title: 'Product Owner', company: 'Paylocity', startDate: '2023', endDate: 'Present' }),
      work({ id: 'ba-role', title: 'Product Analyst', company: 'Paylocity', startDate: '2020', endDate: '2023' }),
      work({ id: 'qa-role', title: 'Lead QA Analyst', company: 'Paylocity', startDate: '2017', endDate: '2020' })
    ],
    education: [{ id: 'edu-1', institution: 'State University', degree: 'BS', field: 'Information Systems', graduationYear: '2016' }],
    skillGroups: [],
    skills: [],
    certifications: ['CSM'],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function requiredSections(): ArtifactSection[] {
  return [
    section('summary', { content: 'Business analyst focused on requirements translation and release readiness.' }),
    section('skills', { content: 'Analysis: Requirements, Gap Analysis\nData: SQL, Pendo' }),
    section('experience-po', {
      bullets: [bullet('Owned backlog sequencing for releases with 12 scrum teams.')]
    }),
    section('experience-ba', {
      bullets: [
        bullet('Used Salesforce, Pendo, and support signals to prioritize backlog items tied to user impact.'),
        bullet('Leveraged stakeholder alignment to drive transformative delivery outcomes.'),
        bullet('Needs confirmation claim.', { partition: 'needs-confirmation' }),
        bullet('Suggested elsewhere claim.', { partition: 'suggested-other', suggestedSection: 'experience-po' })
      ]
    }),
    section('experience-qa', {
      bullets: [bullet('Reduced regression review time by 40% during 2019 release cycles.')]
    })
  ]
}

describe('Stage 4 raw resume text', () => {
  it('blocks final raw text when required Stage 3 sections are not accepted', () => {
    const sections = requiredSections().map(s => s.type === 'skills' ? { ...s, status: 'generated' as const } : s)
    const readiness = getStage4Readiness(sections)
    expect(readiness.ready).toBe(false)
    expect(readiness.missingRequired).toContain('skills')

    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections, profile: profile() })
    expect(raw.status).toBe('not_generated')
    expect(raw.staleReasons[0]).toContain('Missing accepted section')
  })

  it('includes only accepted display bullets', () => {
    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections: requiredSections(), profile: profile() })
    expect(raw.sections.fullText).toContain('Used Salesforce, Pendo')
    expect(raw.sections.fullText).not.toContain('Needs confirmation claim')
    expect(raw.sections.fullText).not.toContain('Suggested elsewhere claim')
  })

  it('excludes evidence warnings, source mappings, and calibration influence text', () => {
    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections: requiredSections(), profile: profile() })
    expect(raw.sections.fullText).not.toContain('Evidence warning should not export')
    expect(raw.sections.fullText).not.toContain('Source mapping should not export')
    expect(raw.sections.fullText).not.toContain('Calibration influence should not export')
    expect(raw.sections.fullText).not.toContain('Calibration decision should not export')
    expect(raw.sections.fullText).not.toContain('Why this was written')
  })

  it('preserves role order from profile work history', () => {
    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections: requiredSections(), profile: profile() })
    expect(raw.sections.experiences.map(e => e.roleId)).toEqual(['po-role', 'ba-role', 'qa-role'])
  })

  it('uses default common resume order when manual profile structure is used', () => {
    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections: requiredSections(), profile: profile() })
    expect(raw.sections.fullText.indexOf('SUMMARY')).toBeLessThan(raw.sections.fullText.indexOf('SKILLS'))
    expect(raw.sections.fullText.indexOf('SKILLS')).toBeLessThan(raw.sections.fullText.indexOf('EXPERIENCE'))
    expect(raw.sections.fullText.indexOf('EXPERIENCE')).toBeLessThan(raw.sections.fullText.indexOf('EDUCATION'))
  })

  it('full text includes Summary, Skills, Experience, and Education', () => {
    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections: requiredSections(), profile: profile() })
    expect(raw.sections.fullText).toContain('SUMMARY')
    expect(raw.sections.fullText).toContain('SKILLS')
    expect(raw.sections.fullText).toContain('EXPERIENCE')
    expect(raw.sections.fullText).toContain('EDUCATION')
  })

  it('copyable section text is plain left-aligned text', () => {
    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections: requiredSections(), profile: profile() })
    const roleText = formatExperienceBlock(raw.sections.experiences[0])
    expect(roleText).toContain('\n- Owned backlog sequencing')
    expect(roleText).not.toContain('<table')
    expect(roleText).not.toContain('```')
    expect(roleText.startsWith('Product Owner')).toBe(true)
  })

  it('marks text stale when accepted Stage 3 source artifacts change', () => {
    const sections = requiredSections()
    const raw = {
      ...buildStage4RawResumeText({ sessionId: 'sess-1', sections, profile: profile() }),
      id: 'raw-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const changed = sections.map(s => s.type === 'experience-ba'
      ? { ...s, version: s.version + 1, updatedAt: '2026-01-02T00:00:00.000Z' }
      : s)
    const staleReasons = getStage4StaleReasons(raw, changed)
    expect(staleReasons).toHaveLength(1)
    expect(staleReasons[0]).toContain('Business Analyst')
  })

  it('naturalization pass does not add unsupported claims', () => {
    const original = 'Leveraged stakeholder alignment to drive delivery outcomes.'
    const cleaned = naturalizeLine(original)
    expect(cleaned).toBe('used stakeholder alignment to drive delivery outcomes.')
    expect(cleaned).not.toContain('insurance')
    expect(cleaned).not.toContain('platform ownership')
  })

  it('naturalization preserves approved metrics and dates', () => {
    const cleaned = naturalizeLine('Spearheaded release work that reduced regression review time by 40% during 2019 release cycles.')
    expect(cleaned).toContain('40%')
    expect(cleaned).toContain('2019')
  })

  it('optional cover letter and message artifacts are not included', () => {
    const sections = [
      ...requiredSections(),
      section('cover-letter', { content: 'Cover letter should not export.' }),
      section('linkedin-dm', { content: 'LinkedIn DM should not export.' })
    ]
    const raw = buildStage4RawResumeText({ sessionId: 'sess-1', sections, profile: profile() })
    expect(raw.sections.fullText).not.toContain('Cover letter should not export')
    expect(raw.sections.fullText).not.toContain('LinkedIn DM should not export')
  })

  it('regenerating one Stage 3 section makes Stage 4 stale without changing accepted source status', () => {
    const sections = requiredSections()
    const raw = {
      ...buildStage4RawResumeText({ sessionId: 'sess-1', sections, profile: profile() }),
      id: 'raw-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const regenerated = sections.map(s => s.type === 'summary'
      ? { ...s, version: 2, updatedAt: '2026-01-03T00:00:00.000Z' }
      : s)
    expect(getStage4StaleReasons(raw, regenerated)).toHaveLength(1)
    expect(regenerated.find(s => s.type === 'summary')?.status).toBe('accepted')
  })
})
