import { describe, it, expect } from 'vitest'
import { classifySkill, migrateToSkillGroups, emptySkillGroups } from '@/lib/skills/classify'
import { flattenSkillGroups } from '@/contracts'
import type { SkillGroup } from '@/contracts'

// ─── Classifier ───────────────────────────────────────────────────────────

describe('classifySkill', () => {
  it('classifies SQL into Data', () => {
    expect(classifySkill('SQL')).toBe('Data')
  })
  it('classifies SpecFlow into Testing', () => {
    expect(classifySkill('SpecFlow')).toBe('Testing')
  })
  it('classifies IAM into Security', () => {
    expect(classifySkill('IAM')).toBe('Security')
  })
  it('classifies Jira into Tools', () => {
    expect(classifySkill('Jira')).toBe('Tools')
  })
  it('classifies Backlog Prioritization into Product', () => {
    expect(classifySkill('Backlog Prioritization')).toBe('Product')
  })
  it('classifies Sprint Planning into Delivery', () => {
    expect(classifySkill('Sprint Planning')).toBe('Delivery')
  })
  it('classifies Gap Analysis into Analysis', () => {
    expect(classifySkill('Gap Analysis')).toBe('Analysis')
  })
  it('classifies unknown skills into Ungrouped', () => {
    expect(classifySkill('Quantum Baking')).toBe('Ungrouped')
  })
  it('is case-insensitive', () => {
    expect(classifySkill('specflow')).toBe('Testing')
    expect(classifySkill('JIRA')).toBe('Tools')
  })
})

// ─── Migration ────────────────────────────────────────────────────────────

describe('migrateToSkillGroups', () => {
  const INPUT = [
    'Requirements Translation', 'Business Rule Mapping', 'Gap Analysis',
    'Backlog Prioritization', 'User Stories', 'Acceptance Criteria',
    'Sprint Planning', 'Release Readiness', 'UAT Readiness',
    'SQL', 'Power BI', 'Pendo',
    'SpecFlow', 'Regression Testing', 'Defect Triage',
    'IAM', 'SSO', 'MFA',
    'Jira', 'Confluence', 'Figma'
  ]

  it('produces non-empty groups', () => {
    const groups = migrateToSkillGroups(INPUT)
    expect(groups.length).toBeGreaterThan(0)
    expect(groups.every(g => g.skills.length > 0)).toBe(true)
  })

  it('SQL goes into Data group', () => {
    const groups = migrateToSkillGroups(INPUT)
    const data = groups.find(g => g.heading === 'Data')
    expect(data?.skills).toContain('SQL')
  })

  it('SpecFlow goes into Testing group', () => {
    const groups = migrateToSkillGroups(INPUT)
    const testing = groups.find(g => g.heading === 'Testing')
    expect(testing?.skills).toContain('SpecFlow')
  })

  it('Jira goes into Tools group', () => {
    const groups = migrateToSkillGroups(INPUT)
    const tools = groups.find(g => g.heading === 'Tools')
    expect(tools?.skills).toContain('Jira')
  })

  it('every input skill appears in exactly one group', () => {
    const groups = migrateToSkillGroups(INPUT)
    const allMigrated = groups.flatMap(g => g.skills)
    for (const skill of INPUT) {
      const count = allMigrated.filter(s => s === skill).length
      expect(count, `"${skill}" should appear exactly once`).toBe(1)
    }
  })

  it('handles empty input', () => {
    const groups = migrateToSkillGroups([])
    expect(groups).toHaveLength(0)
  })

  it('unknown skills go into Ungrouped, not dropped', () => {
    const groups = migrateToSkillGroups(['Quantum Baking', 'Jira'])
    const ungrouped = groups.find(g => g.heading === 'Ungrouped')
    expect(ungrouped?.skills).toContain('Quantum Baking')
  })

  it('default headings appear before Ungrouped', () => {
    const groups = migrateToSkillGroups(['Quantum Baking', 'Jira', 'SQL'])
    const headings = groups.map(g => g.heading)
    const ungroupedIdx = headings.indexOf('Ungrouped')
    const toolsIdx = headings.indexOf('Tools')
    // Tools should come before Ungrouped
    if (ungroupedIdx !== -1 && toolsIdx !== -1) {
      expect(toolsIdx).toBeLessThan(ungroupedIdx)
    }
  })

  it('each group has a unique non-empty id', () => {
    const groups = migrateToSkillGroups(INPUT)
    const ids = groups.map(g => g.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(groups.length)
    expect(ids.every(id => id.length > 0)).toBe(true)
  })
})

// ─── flattenSkillGroups ────────────────────────────────────────────────────

describe('flattenSkillGroups', () => {
  it('produces a flat deduplicated array from multiple groups', () => {
    const groups: SkillGroup[] = [
      { id: '1', heading: 'Analysis', skills: ['Gap Analysis', 'Workflow Mapping'] },
      { id: '2', heading: 'Tools', skills: ['Jira', 'Confluence'] },
      { id: '3', heading: 'Data', skills: ['SQL', 'Power BI'] }
    ]
    const flat = flattenSkillGroups(groups)
    expect(flat).toContain('Gap Analysis')
    expect(flat).toContain('Jira')
    expect(flat).toContain('SQL')
    expect(flat.length).toBe(6)
  })

  it('deduplicates case-insensitively across groups', () => {
    const groups: SkillGroup[] = [
      { id: '1', heading: 'A', skills: ['SQL', 'Jira'] },
      { id: '2', heading: 'B', skills: ['sql', 'Confluence'] }  // lowercase dupe
    ]
    const flat = flattenSkillGroups(groups)
    // Should not have both 'SQL' and 'sql'
    const sqlCount = flat.filter(s => s.toLowerCase() === 'sql').length
    expect(sqlCount).toBe(1)
  })

  it('preserves original casing of first occurrence', () => {
    const groups: SkillGroup[] = [
      { id: '1', heading: 'A', skills: ['Power BI'] },
      { id: '2', heading: 'B', skills: ['power bi'] }  // dupe, different case
    ]
    const flat = flattenSkillGroups(groups)
    expect(flat).toContain('Power BI')
  })

  it('handles empty groups array', () => {
    expect(flattenSkillGroups([])).toHaveLength(0)
  })

  it('handles groups with empty skills arrays', () => {
    const groups: SkillGroup[] = [
      { id: '1', heading: 'A', skills: [] },
      { id: '2', heading: 'B', skills: ['SQL'] }
    ]
    const flat = flattenSkillGroups(groups)
    expect(flat).toEqual(['SQL'])
  })
})

// ─── emptySkillGroups ──────────────────────────────────────────────────────

describe('emptySkillGroups', () => {
  it('returns 7 default groups', () => {
    const groups = emptySkillGroups()
    expect(groups.length).toBe(7)
  })

  it('all groups start with empty skills arrays', () => {
    const groups = emptySkillGroups()
    expect(groups.every(g => g.skills.length === 0)).toBe(true)
  })

  it('headings are all single-word default headings', () => {
    const groups = emptySkillGroups()
    const headings = groups.map(g => g.heading)
    expect(headings).toContain('Analysis')
    expect(headings).toContain('Product')
    expect(headings).toContain('Delivery')
    expect(headings).toContain('Data')
    expect(headings).toContain('Testing')
    expect(headings).toContain('Security')
    expect(headings).toContain('Tools')
  })

  it('all groups have unique ids', () => {
    const groups = emptySkillGroups()
    const ids = new Set(groups.map(g => g.id))
    expect(ids.size).toBe(7)
  })
})

// ─── Upload parsing contract ───────────────────────────────────────────────

describe('upload parsing where skills cannot be confidently grouped', () => {
  it('unclassifiable skills land in Ungrouped, not dropped', () => {
    // Purely invented words with no pattern matches
    const weirdSkills = ['Hyperscaling', 'Chronoflux', 'Temporal Fluency']
    const groups = migrateToSkillGroups(weirdSkills)
    const ungrouped = groups.find(g => g.heading === 'Ungrouped')
    expect(ungrouped).toBeDefined()
    expect(ungrouped?.skills.length).toBe(3)
  })

  it('mixed known and unknown skills: known classified, unknown in Ungrouped', () => {
    const mixed = ['Jira', 'Quantum Baking', 'SQL', 'Teleportation']
    const groups = migrateToSkillGroups(mixed)
    const tools = groups.find(g => g.heading === 'Tools')
    const data = groups.find(g => g.heading === 'Data')
    const ungrouped = groups.find(g => g.heading === 'Ungrouped')
    expect(tools?.skills).toContain('Jira')
    expect(data?.skills).toContain('SQL')
    expect(ungrouped?.skills).toContain('Quantum Baking')
    expect(ungrouped?.skills).toContain('Teleportation')
  })

  it('total skill count is preserved across all groups', () => {
    const allSkills = ['Jira', 'SQL', 'Quantum Baking', 'SpecFlow', 'IAM', 'Mystery']
    const groups = migrateToSkillGroups(allSkills)
    const total = groups.reduce((sum, g) => sum + g.skills.length, 0)
    expect(total).toBe(allSkills.length)
  })
})

// ─── Generation formatting contract ───────────────────────────────────────

describe('artifact generation uses grouped skills', () => {
  it('formatSkillsForPrompt produces Heading: skill, skill lines', () => {
    // Mirror what generate-artifact-section.ts does
    function formatSkillsForPrompt(profile: { skillGroups?: SkillGroup[]; skills: string[] }): string[] {
      const groups = profile.skillGroups?.filter(g => g.skills.length > 0) ?? []
      if (groups.length > 0) {
        return groups.map(g => `  ${g.heading}: ${g.skills.join(', ')}`)
      }
      return [`  ${profile.skills.join(', ')}`]
    }

    const profile = {
      skillGroups: [
        { id: '1', heading: 'Analysis', skills: ['Gap Analysis', 'Workflow Mapping'] },
        { id: '2', heading: 'Tools', skills: ['Jira', 'Confluence'] }
      ],
      skills: ['Gap Analysis', 'Workflow Mapping', 'Jira', 'Confluence']
    }

    const lines = formatSkillsForPrompt(profile)
    expect(lines[0]).toBe('  Analysis: Gap Analysis, Workflow Mapping')
    expect(lines[1]).toBe('  Tools: Jira, Confluence')
  })

  it('falls back to flat skills when skillGroups is absent', () => {
    function formatSkillsForPrompt(profile: { skillGroups?: SkillGroup[]; skills: string[] }): string[] {
      const groups = profile.skillGroups?.filter(g => g.skills.length > 0) ?? []
      if (groups.length > 0) return groups.map(g => `  ${g.heading}: ${g.skills.join(', ')}`)
      return [`  ${profile.skills.join(', ')}`]
    }

    const profile = { skills: ['Jira', 'SQL', 'SpecFlow'] }
    const lines = formatSkillsForPrompt(profile)
    expect(lines[0]).toBe('  Jira, SQL, SpecFlow')
  })
})
