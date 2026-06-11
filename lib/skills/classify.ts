import type { SkillGroup } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'

// Keyword patterns for each default heading.
// A skill is assigned to the FIRST group whose pattern matches.
// Skills that match nothing go to Ungrouped.
const PATTERNS: Array<{ heading: string; pattern: RegExp }> = [
  {
    heading: 'Analysis',
    pattern: /requirements?|business rule|gap analysis|workflow|stakeholder|documentation|mapping|translation|gap|decision support|kpi|scope|adoption analysis|usage analysis|data reconcil|data valid|reconcil/i
  },
  {
    heading: 'Product',
    pattern: /backlog|user stor|acceptance criteria|roadmap|product owner|product manag|prioritiz|release plan|scope manag|dependency|feature/i
  },
  {
    heading: 'Delivery',
    pattern: /release|uat|readiness|validation|agile|scrum|sprint|delivery|risk manag|change manag|onboard|train|adoption|project manag/i
  },
  {
    heading: 'Data',
    pattern: /\bsql\b|power bi|salesforce report|pendo|data valid|usage analysis|adoption analysis|data reconcil|tableau|analytics|reporting|dashb|excel|metric/i
  },
  {
    heading: 'Testing',
    pattern: /specflow|teamcity|regression|smoke test|api test|defect|test automat|qa|quality assur|test case|test plan|test strateg/i
  },
  {
    heading: 'Security',
    pattern: /\biam\b|\bsso\b|\bmfa\b|role.based|access request|access control|owasp|permission|auth[en]|identity|security/i
  },
  {
    heading: 'Tools',
    pattern: /\bjira\b|confluence|figma|miro|lucid|visio|microsoft|azure devops|\bslack\b|notion|trello|asana|monday|servicenow|zendesk|postman|swagger|salesforce(?! report)|github|gitlab/i
  }
]

export function classifySkill(skill: string): string {
  for (const { heading, pattern } of PATTERNS) {
    if (pattern.test(skill)) return heading
  }
  return 'Ungrouped'
}

// Migrate a flat skills array into grouped SkillGroups.
// Returns only groups that have at least one skill.
export function migrateToSkillGroups(flatSkills: string[]): SkillGroup[] {
  const buckets = new Map<string, string[]>()

  for (const skill of flatSkills) {
    const heading = classifySkill(skill)
    if (!buckets.has(heading)) buckets.set(heading, [])
    buckets.get(heading)!.push(skill)
  }

  // Order: default headings first, then any extras (Ungrouped last)
  const defaultOrder = ['Analysis', 'Product', 'Delivery', 'Data', 'Testing', 'Security', 'Tools']
  const ordered: SkillGroup[] = []

  for (const h of defaultOrder) {
    if (buckets.has(h)) {
      ordered.push({ id: nanoid(), heading: h, skills: buckets.get(h)! })
    }
  }

  for (const [heading, skills] of buckets) {
    if (!defaultOrder.includes(heading)) {
      ordered.push({ id: nanoid(), heading, skills })
    }
  }

  return ordered
}

// Build empty groups for the default headings (used for new profiles).
export function emptySkillGroups(): SkillGroup[] {
  return ['Analysis', 'Product', 'Delivery', 'Data', 'Testing', 'Security', 'Tools'].map(h => ({
    id: nanoid(),
    heading: h,
    skills: []
  }))
}
