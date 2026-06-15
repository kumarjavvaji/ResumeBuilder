/**
 * stage1-evidence-atoms.test.ts — A–C suites
 *
 * All fixtures are synthetic. No candidate employers, metrics, or role titles
 * that are specific to any real session.
 */

import { classifyProfileEvidence } from '@/lib/validators/evidence-atoms'
import type { JDRequirementMap, UserProfile, WorkEntry } from '@/contracts'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeWorkEntry(overrides: Partial<WorkEntry> = {}): WorkEntry {
  return {
    id: 'entry-1',
    company: 'Generic Corp',
    title: 'Product Owner',
    startDate: '2021-01',
    endDate: '2024-06',
    bullets: [],
    approvedMetrics: [],
    domain: '',
    skills: [],
    ...overrides,
  }
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'profile-1',
    fullName: 'Test User',
    email: 'test@example.com',
    phone: '',
    location: '',
    linkedIn: '',
    summary: '',
    workHistory: [makeWorkEntry()],
    education: [],
    skillGroups: [],
    skills: [],
    certifications: [],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeJDMap(overrides: Partial<JDRequirementMap> = {}): JDRequirementMap {
  return {
    required: [],
    niceToHave: [],
    ...overrides,
  }
}

// ─── Suite A — role and bullet atoms ──────────────────────────────────────────

describe('A: role and bullet atoms from work history', () => {
  it('A1: produces a role atom for the work entry title', () => {
    const profile = makeProfile({ workHistory: [makeWorkEntry({ title: 'Product Owner' })] })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const roleAtoms = atoms.filter(a => a.atomType === 'role')
    expect(roleAtoms).toHaveLength(1)
    expect(roleAtoms[0].text).toBe('Product Owner')
  })

  it('A2: impact bullet classified as outcome atom', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({
          bullets: ['Improved feature adoption by 22% through guided onboarding redesign'],
        }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const outcomes = atoms.filter(a => a.atomType === 'outcome')
    expect(outcomes.length).toBeGreaterThan(0)
    expect(outcomes[0].isImpactEvidence).toBe(true)
  })

  it('A3: volume-led bullet gets too_volume_led warning', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({
          bullets: ['Managed 75 support tickets per sprint across two teams'],
        }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const bulletAtoms = atoms.filter(a => a.atomType === 'responsibility' || a.atomType === 'outcome')
    expect(bulletAtoms.some(a => a.warnings.includes('too_volume_led'))).toBe(true)
  })

  it('A4: impact bullet has no too_volume_led warning', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({
          bullets: ['Reduced defect rate by 30% through automated regression testing'],
        }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const bulletAtoms = atoms.filter(a => a.atomType === 'outcome')
    expect(bulletAtoms.every(a => !a.warnings.includes('too_volume_led'))).toBe(true)
  })

  it('A5: vague bullet (under 20 chars) gets vague warning', () => {
    const profile = makeProfile({
      workHistory: [makeWorkEntry({ bullets: ['Worked on backlog'] })],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const bulletAtoms = atoms.filter(a => a.sourceSection === 'work_history' && (a.atomType === 'responsibility' || a.atomType === 'outcome'))
    expect(bulletAtoms.some(a => a.warnings.includes('vague'))).toBe(true)
  })

  it('A6: approved metric atom has sourceSection work_history and atomType metric', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({ approvedMetrics: ['35% improvement in release frequency'] }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const metricAtoms = atoms.filter(a => a.atomType === 'metric')
    expect(metricAtoms).toHaveLength(1)
    expect(metricAtoms[0].sourceSection).toBe('work_history')
  })

  it('A7: impact metric is classified as isImpactEvidence=true', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({ approvedMetrics: ['Improved retention by 18% across three products'] }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const metricAtom = atoms.find(a => a.atomType === 'metric')
    expect(metricAtom?.isImpactEvidence).toBe(true)
  })
})

// ─── Suite B — skills, certs, education ──────────────────────────────────────

describe('B: skills, certifications, education', () => {
  it('B1: flat skills produce tool atoms with sourceSection=skill', () => {
    const profile = makeProfile({ workHistory: [], skills: ['Jira', 'Confluence', 'Figma'] })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const toolAtoms = atoms.filter(a => a.sourceSection === 'skill')
    expect(toolAtoms).toHaveLength(3)
  })

  it('B2: flat skills have medium confidence', () => {
    const profile = makeProfile({ workHistory: [], skills: ['Tableau'] })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const toolAtom = atoms.find(a => a.sourceSection === 'skill')
    expect(toolAtom?.confidence).toBe('medium')
  })

  it('B3: certification produces certification atom', () => {
    const profile = makeProfile({ workHistory: [], certifications: ['Certified Scrum Product Owner (CSPO)'] })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const certAtoms = atoms.filter(a => a.atomType === 'certification')
    expect(certAtoms).toHaveLength(1)
    expect(certAtoms[0].confidence).toBe('high')
  })

  it('B4: certification atom is allowed in summary and education', () => {
    const profile = makeProfile({ workHistory: [], certifications: ['CSPO'] })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const certAtom = atoms.find(a => a.atomType === 'certification')
    expect(certAtom?.allowedUses).toContain('summary')
    expect(certAtom?.allowedUses).toContain('education')
  })

  it('B5: education entry produces education atom', () => {
    const profile = makeProfile({
      workHistory: [],
      education: [{ id: 'edu-1', institution: 'State University', degree: "Bachelor's", field: 'Computer Science', graduationYear: '2015' }],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const eduAtoms = atoms.filter(a => a.atomType === 'education')
    expect(eduAtoms).toHaveLength(1)
    expect(eduAtoms[0].allowedUses).toContain('education')
  })

  it('B6: domain field produces a domain atom', () => {
    const profile = makeProfile({
      workHistory: [makeWorkEntry({ domain: 'FinTech', bullets: [] })],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const domainAtom = atoms.find(a => a.atomType === 'domain')
    expect(domainAtom).toBeDefined()
    expect(domainAtom?.allowedUses).toContain('summary')
  })
})

// ─── Suite C — JD alignment ───────────────────────────────────────────────────

describe('C: JD alignment', () => {
  it('C1: every atom has a unique id', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({
          bullets: ['Facilitated sprint planning across three squads'],
          skills: ['Jira'],
        }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const ids = atoms.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('C2: isCandidateSpecificFact is true for all work history atoms', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({ bullets: ['Delivered roadmap items aligned to KPIs'] }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const whAtoms = atoms.filter(a => a.sourceSection === 'work_history')
    expect(whAtoms.every(a => a.isCandidateSpecificFact)).toBe(true)
  })

  it('C3: entry-level skills produce high confidence tool atoms', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({ skills: ['SQL', 'Tableau'], bullets: [] }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const entrySkills = atoms.filter(a => a.atomType === 'tool' && a.sourceSection === 'work_history')
    expect(entrySkills.every(a => a.confidence === 'high')).toBe(true)
  })

  it('C4: empty work history produces no work_history atoms', () => {
    const profile = makeProfile({ workHistory: [], skills: [] })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    expect(atoms.filter(a => a.sourceSection === 'work_history')).toHaveLength(0)
  })

  it('C5: volume metric atom gets too_volume_led warning', () => {
    const profile = makeProfile({
      workHistory: [
        makeWorkEntry({ approvedMetrics: ['Handled 500 monthly active requests from customer success'] }),
      ],
    })
    const atoms = classifyProfileEvidence(profile, makeJDMap())
    const metricAtom = atoms.find(a => a.atomType === 'metric')
    expect(metricAtom?.warnings).toContain('too_volume_led')
  })
})
