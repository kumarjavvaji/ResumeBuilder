import type {
  ArtifactSection,
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeReadinessContract,
  ResumeStrategyBrief,
  SectionType,
  Stage4ExperienceBlock,
  Stage4RawResumeSections,
  Stage4RawResumeText,
  Stage4SourceArtifactSnapshot,
  Stage4StructureSource,
  UserProfile,
  WorkEntry
} from '@/contracts'
import { applyDeterministicRepairs, validateResumeAgainstContract } from './resume-generation-contract'
import { reviewCriticalResumeArtifact } from './critical-resume-review'
import type { ReviewEvidenceItem, ReviewSectionStrategy } from './critical-resume-review'
import { buildStage4QualityTrace } from './quality-trace'

export const REQUIRED_RESUME_SECTION_TYPES: SectionType[] = [
  'summary',
  'skills',
  'experience-primary',
  'experience-secondary',
  'experience-supporting'
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
  'experience-primary': 'Experience: Product Owner',
  'experience-secondary': 'Experience: Business Analyst',
  'experience-supporting': 'Experience: QA / Quality',
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
  strategyBrief?: ResumeStrategyBrief
  jdMap?: JDRequirementMap
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
  let repairsAppliedCount = 0
  if (opts.contract) {
    const { repairedText, repairsApplied } = applyDeterministicRepairs(
      assembled.fullText,
      opts.contract,
      'fullText'
    )
    if (repairsApplied.length > 0) {
      assembled = { ...assembled, fullText: repairedText }
      warnings.push(...repairsApplied.map(r => `[auto-repair] ${r}`))
      repairsAppliedCount = repairsApplied.length
    }
  }

  // Run deterministic validation
  const validation = opts.contract
    ? validateResumeAgainstContract(assembled.fullText, opts.contract)
    : null

  // Run critical review when both strategy brief and JD map are available
  const reviewEvidenceMap = buildReviewEvidenceMap(sourceArtifacts)
  const review =
    opts.strategyBrief && opts.jdMap
      ? reviewCriticalResumeArtifact({
          targetJd: opts.jdMap,
          resumeBlueprint: opts.contract?.targetPosture ?? '',
          evidenceMap: reviewEvidenceMap,
          sectionStrategies: buildReviewSectionStrategies(opts.strategyBrief, reviewEvidenceMap),
          artifactText: assembled.fullText,
          deterministicValidation: validation ?? undefined,
          strategyBrief: opts.strategyBrief,
        })
      : null

  const qualityTrace = buildStage4QualityTrace({
    sessionId: opts.sessionId,
    strategyBrief: opts.strategyBrief,
    contract: opts.contract,
    validation,
    review,
    deterministicRepairsApplied: repairsAppliedCount,
  })

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
    strategyBrief: opts.strategyBrief,
    qualityTrace,
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

  for (const sectionType of ['experience-primary', 'experience-secondary', 'experience-supporting'] as SectionType[]) {
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
  if (/\b(product owner|po)\b/.test(text)) return 'experience-primary'
  if (/\b(qa|quality|test|automation)\b/.test(text)) return 'experience-supporting'
  if (/\b(business analyst|product analyst|analyst|ba)\b/.test(text)) return 'experience-secondary'
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

/**
 * Re-parses experience bullet lines from the repaired experience section text.
 * Uses positional matching: the i-th text block maps to the i-th original block.
 * Only `bullets` is updated — roleId, title, company, dates, headingText, and
 * sourceArtifactSectionId are always preserved from the original block.
 */
export function parseExperienceBlocksFromText(
  experienceText: string,
  originalBlocks: Stage4ExperienceBlock[],
): Stage4ExperienceBlock[] {
  if (!experienceText.trim() || originalBlocks.length === 0) return originalBlocks

  const rawBlocks = experienceText.split(/\n\n+/).map(b => b.trim()).filter(Boolean)
  if (rawBlocks.length === 0) return originalBlocks

  return originalBlocks.map((orig, i) => {
    const raw = rawBlocks[i]
    if (!raw) return orig
    const bullets = raw
      .split('\n')
      .filter(l => l.startsWith('- '))
      .map(l => l.slice(2))
    return bullets.length > 0 ? { ...orig, bullets } : orig
  })
}

/**
 * Parses a repaired full-text resume back into Stage4RawResumeSections.
 *
 * Used by auto-repair to update sections.* in-place so all section cards
 * reflect the repaired content. Structural metadata on experience blocks
 * (roleId, title, company, dates, sourceArtifactSectionId) is always kept
 * from the original; only bullet text is updated.
 */
export function parseSectionsFromRepairedText(
  fullText: string,
  original: Stage4RawResumeSections,
): Stage4RawResumeSections {
  // No 'm' flag so '$' anchors to end-of-string, not end-of-line.
  // Sections are separated by '\n\nLABEL\n' in the assembled format.
  const ALL_LABELS = 'SUMMARY|SKILLS|EXPERIENCE|EDUCATION'
  function extractSection(label: string): string {
    const re = new RegExp(
      `(?:^|\\n)${label}\\n([\\s\\S]*?)(?=\\n\\n(?:${ALL_LABELS})\\n|$)`,
    )
    const m = fullText.match(re)
    return m ? m[1].trim() : ''
  }

  const summary = extractSection('SUMMARY') || original.summary
  const skills = extractSection('SKILLS') || original.skills
  const education = extractSection('EDUCATION') || original.education
  const experienceText = extractSection('EXPERIENCE')
  const experiences = parseExperienceBlocksFromText(experienceText, original.experiences)

  return {
    summary,
    skills,
    experiences,
    education,
    fullText,
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

function buildReviewEvidenceMap(sections: ArtifactSection[]): ReviewEvidenceItem[] {
  return sections.map((section, index) => ({
    id: `E${index + 1}`,
    text: section.content,
    allowedSections: [section.type],
    confidence: section.status === 'accepted' ? 'high' : 'medium',
  }))
}

function buildReviewSectionStrategies(
  strategyBrief: ResumeStrategyBrief | undefined,
  evidenceMap: ReviewEvidenceItem[],
): ReviewSectionStrategy[] {
  return [
    {
      sectionKey: 'experience',
      sectionPurpose: 'proof',
      requiredThemes: strategyBrief?.jdCriticalThemes.map(theme => theme.theme) ?? [],
      allowedEvidenceIds: evidenceMap.map(evidence => evidence.id),
    },
  ]
}
