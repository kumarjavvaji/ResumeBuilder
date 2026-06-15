import type {
  ArtifactSection,
  ResumeGenerationContract,
  ResumeReadinessContract,
  SectionType,
  Stage4ExperienceBlock,
  Stage4RawResumeSections,
  Stage4RawResumeText,
  Stage4SourceArtifactSnapshot,
  Stage4StructureSource,
  UserProfile,
  WorkEntry
} from '@/contracts'
import { applyDeterministicRepairs } from './resume-generation-contract'

export const REQUIRED_RESUME_SECTION_TYPES: SectionType[] = [
  'summary',
  'skills',
  'experience-po',
  'experience-ba',
  'experience-qa'
]

const OPTIONAL_ARTIFACT_TYPES = new Set<SectionType>([
  'cover-letter',
  'referral-message',
  'recruiter-message',
  'linkedin-dm',
  'talking-points'
])

const SECTION_LABELS: Record<SectionType, string> = {
  summary: 'Professional Summary',
  skills: 'Skills',
  'experience-po': 'Experience: Product Owner',
  'experience-ba': 'Experience: Business Analyst',
  'experience-qa': 'Experience: QA / Quality',
  'cover-letter': 'Cover Letter',
  'referral-message': 'Referral Message',
  'recruiter-message': 'Recruiter Message',
  'linkedin-dm': 'LinkedIn DM',
  'talking-points': 'Interview Talking Points'
}

const BUZZY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bleveraged\b/gi, 'used'],
  [/\butilized\b/gi, 'used'],
  [/\bspearheaded\b/gi, 'led'],
  [/\brobust\b/gi, ''],
  [/\btransformative\b/gi, ''],
  [/\bsynergy\b/gi, 'collaboration'],
  [/\bparadigm\b/gi, 'approach']
]

export interface Stage4Readiness {
  ready: boolean
  missingRequired: SectionType[]
}

export interface BuildStage4RawResumeTextOptions {
  sessionId: string
  sections: ArtifactSection[]
  profile: UserProfile
  allowDraft?: boolean
  structureSource?: Stage4StructureSource
  contract?: ResumeGenerationContract
  readinessContract?: ResumeReadinessContract
}

export function getStage4Readiness(sections: ArtifactSection[]): Stage4Readiness {
  const accepted = new Set(sections.filter(s => s.status === 'accepted').map(s => s.type))
  const missingRequired = REQUIRED_RESUME_SECTION_TYPES.filter(type => !accepted.has(type))
  return {
    ready: missingRequired.length === 0,
    missingRequired
  }
}

export function buildStage4RawResumeText(opts: BuildStage4RawResumeTextOptions): Omit<Stage4RawResumeText, 'id' | 'generatedAt' | 'updatedAt'> {
  const readiness = getStage4Readiness(opts.sections)
  const finalMode = readiness.ready
  const warnings: string[] = []

  if (!finalMode && !opts.allowDraft) {
    return emptyStage4RawResumeText(opts.sessionId, readiness.missingRequired)
  }

  if (!finalMode) {
    warnings.push(`Draft preview only. Missing accepted sections: ${readiness.missingRequired.map(t => SECTION_LABELS[t]).join(', ')}.`)
  }

  const eligible = opts.sections.filter(section => {
    if (OPTIONAL_ARTIFACT_TYPES.has(section.type)) return false
    if (section.status === 'accepted') return true
    return opts.allowDraft && (section.status === 'generated' || section.status === 'needs_review')
  })

  const byType = new Map<SectionType, ArtifactSection>()
  for (const section of eligible) byType.set(section.type, section)

  const summary = naturalizeText(byType.get('summary')?.content ?? '')
  const skills = naturalizeSkills(byType.get('skills')?.content ?? '')
  const experiences = buildExperienceBlocks(byType, opts.profile)
  const education = buildEducationText(opts.profile)
  let assembled = assembleSections({ summary, skills, experiences, education })
  const sourceArtifacts = eligible.filter(s => REQUIRED_RESUME_SECTION_TYPES.includes(s.type))

  // Apply deterministic repairs if a contract was provided
  if (opts.contract) {
    const { repairedText, repairsApplied } = applyDeterministicRepairs(
      assembled.fullText,
      opts.contract,
      'fullText'
    )
    if (repairsApplied.length > 0) {
      assembled = { ...assembled, fullText: repairedText }
      warnings.push(...repairsApplied.map(r => `[auto-repair] ${r}`))
    }
  }

  return {
    sessionId: opts.sessionId,
    status: finalMode ? 'generated' : 'needs_review',
    sourceArtifactSectionIds: sourceArtifacts.map(s => s.id),
    sourceArtifactSnapshots: sourceArtifacts.map(snapshotSourceArtifact),
    structureSource: opts.structureSource ?? inferStructureSource(opts.profile),
    sections: assembled,
    warnings,
    staleReasons: [],
    contract: opts.contract,
    readinessContract: opts.readinessContract,
  }
}

export function getStage4StaleReasons(
  raw: Stage4RawResumeText | undefined,
  currentSections: ArtifactSection[]
): string[] {
  if (!raw) return []
  const byId = new Map(currentSections.map(s => [s.id, s]))
  const reasons: string[] = []

  for (const snapshot of raw.sourceArtifactSnapshots) {
    const current = byId.get(snapshot.id)
    if (!current) {
      reasons.push(`${SECTION_LABELS[snapshot.type]} source artifact was removed.`)
      continue
    }
    if (current.version !== snapshot.version || current.updatedAt !== snapshot.updatedAt) {
      reasons.push(`${SECTION_LABELS[snapshot.type]} changed after Stage 4 text was generated.`)
    }
  }

  return reasons
}

export function naturalizeText(text: string): string {
  return text
    .split('\n')
    .map(line => naturalizeLine(line))
    .filter(Boolean)
    .join('\n')
}

export function naturalizeLine(line: string): string {
  let cleaned = line
    .trim()
    .replace(/^[•*-]\s*/, '')
    .replace(/\s+[—–]\s+/g, ', ')

  for (const [pattern, replacement] of BUZZY_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, replacement)
  }

  return cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

function emptyStage4RawResumeText(
  sessionId: string,
  missingRequired: SectionType[]
): Omit<Stage4RawResumeText, 'id' | 'generatedAt' | 'updatedAt'> {
  return {
    sessionId,
    status: 'not_generated',
    sourceArtifactSectionIds: [],
    sourceArtifactSnapshots: [],
    structureSource: 'default',
    sections: { summary: '', skills: '', experiences: [], education: '', fullText: '' },
    warnings: ['Not ready for final raw text.'],
    staleReasons: missingRequired.map(type => `Missing accepted section: ${SECTION_LABELS[type]}.`)
  }
}

function naturalizeSkills(text: string): string {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
}

function buildExperienceBlocks(
  byType: Map<SectionType, ArtifactSection>,
  profile: UserProfile
): Stage4ExperienceBlock[] {
  const blocks: Stage4ExperienceBlock[] = []
  const usedRoleIds = new Set<string>()

  for (const work of profile.workHistory) {
    const sectionType = sectionTypeForWorkEntry(work)
    if (!sectionType) continue
    const source = byType.get(sectionType)
    if (!source) continue
    const bullets = acceptedBulletTexts(source)
    if (bullets.length === 0) continue
    usedRoleIds.add(work.id)
    blocks.push(workEntryToBlock(work, bullets, source.id))
  }

  for (const sectionType of ['experience-po', 'experience-ba', 'experience-qa'] as SectionType[]) {
    const source = byType.get(sectionType)
    if (!source) continue
    const alreadyUsed = blocks.some(b => b.sourceArtifactSectionId === source.id)
    if (alreadyUsed) continue
    const fallback = profile.workHistory.find(w => !usedRoleIds.has(w.id))
    const bullets = acceptedBulletTexts(source)
    if (bullets.length === 0) continue
    if (fallback) {
      usedRoleIds.add(fallback.id)
      blocks.push(workEntryToBlock(fallback, bullets, source.id))
    } else {
      blocks.push({
        roleId: sectionType,
        title: SECTION_LABELS[sectionType].replace('Experience: ', ''),
        company: '',
        dates: '',
        headingText: SECTION_LABELS[sectionType].replace('Experience: ', ''),
        bullets,
        sourceArtifactSectionId: source.id
      })
    }
  }

  return blocks
}

function sectionTypeForWorkEntry(work: WorkEntry): SectionType | null {
  const text = `${work.title} ${work.company} ${work.domain}`.toLowerCase()
  if (/\b(product owner|po)\b/.test(text)) return 'experience-po'
  if (/\b(qa|quality|test|automation)\b/.test(text)) return 'experience-qa'
  if (/\b(business analyst|product analyst|analyst|ba)\b/.test(text)) return 'experience-ba'
  return null
}

function acceptedBulletTexts(section: ArtifactSection): string[] {
  if (section.status !== 'accepted' && section.status !== 'generated' && section.status !== 'needs_review') return []
  const bullets = section.bullets
    .filter(b => (b.partition ?? 'display') === 'display')
    .filter(b => b.approved !== false)
    .map(b => naturalizeLine(b.text))
    .filter(Boolean)

  if (bullets.length > 0) return bullets

  return section.content
    .split('\n')
    .map(line => naturalizeLine(line))
    .filter(Boolean)
}

function workEntryToBlock(work: WorkEntry, bullets: string[], sourceArtifactSectionId: string): Stage4ExperienceBlock {
  const dates = [work.startDate, work.endDate].filter(Boolean).join(' - ')
  const headingText = [work.title, work.company, dates].filter(Boolean).join('\n')
  return {
    roleId: work.id,
    title: work.title,
    company: work.company,
    dates,
    location: work.domain || undefined,
    headingText,
    bullets,
    sourceArtifactSectionId
  }
}

function buildEducationText(profile: UserProfile): string {
  const education = profile.education
    .map(e => [e.degree, e.field, e.institution, e.graduationYear].filter(Boolean).join(' | '))
  const certs = profile.certifications ?? []
  return [...education, ...certs].filter(Boolean).join('\n')
}

function assembleSections(parts: Omit<Stage4RawResumeSections, 'fullText'>): Stage4RawResumeSections {
  const experienceText = parts.experiences.map(formatExperienceBlock).join('\n\n')
  const fullText = [
    parts.summary ? `SUMMARY\n${parts.summary}` : '',
    parts.skills ? `SKILLS\n${parts.skills}` : '',
    experienceText ? `EXPERIENCE\n${experienceText}` : '',
    parts.education ? `EDUCATION\n${parts.education}` : ''
  ].filter(Boolean).join('\n\n')

  return {
    ...parts,
    fullText
  }
}

export function formatExperienceBlock(block: Stage4ExperienceBlock): string {
  const header = [
    block.title,
    [block.company, block.dates].filter(Boolean).join(' | '),
    block.location
  ].filter(Boolean).join('\n')
  const bullets = block.bullets.map(b => `- ${b}`).join('\n')
  return [header, bullets].filter(Boolean).join('\n')
}

function snapshotSourceArtifact(section: ArtifactSection): Stage4SourceArtifactSnapshot {
  return {
    id: section.id,
    type: section.type,
    version: section.version,
    updatedAt: section.updatedAt
  }
}

function inferStructureSource(profile: UserProfile): Stage4StructureSource {
  return profile.workHistory.length > 0 || profile.education.length > 0
    ? 'manual_profile'
    : 'default'
}
