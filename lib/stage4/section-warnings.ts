/**
 * Client-side section warning generator for Stage 4 document spine.
 *
 * Detects: duplicate_evidence, role_boundary_leakage, overclaim_risk, style advisories.
 * Runs synchronously from sectionBlocks — no LLM call.
 * Warning IDs are stable (content-derived) so ignored IDs persist across re-renders.
 */

import type { Stage4Section, SectionWarning, SectionWarningType } from '@/contracts'

// ─── Domain signals ────────────────────────────────────────────────────────────

const QA_TESTING_SIGNALS = [
  'burp suite', 'wireshark', 'specflow', 'selenium', 'jmeter', 'cucumber',
  'test case', 'test script', 'test plan', 'defect log', 'regression test',
  'penetration test', 'security test', 'performance test', 'load test',
  'vulnerability', 'sso migration', 'secureauth', 'onelogin migration',
  'identity platform migration', 'authentication platform', 'ldap migration',
  'api test', 'automated test', 'smoke test', 'uat script',
]

// Weak-verb patterns that weaken impact (advisory)
const WEAK_VERB_RE = /^(was responsible for|helped to|assisted with|worked with|worked on|participated in|supported the|involved in|contributed to|aided in)\b/i
const PASSIVE_RE = /\b(was|were)\s+(?:\w+\s+){0,3}(done|completed|conducted|performed|carried out|managed|handled|created|delivered)\b/i
const OVERCLAIM_RE = /(?:own|define|set|drive)\s+(?:the\s+)?(?:full\s+)?product\s+(?:roadmap|strategy|vision)|executive\s+product\s+strategy/i

// ─── Utilities ─────────────────────────────────────────────────────────────────

function extractBullets(text: string): string[] {
  return text
    .split('\n')
    .filter(l => l.trim().startsWith('- '))
    .map(l => l.trim().slice(2).trim())
    .filter(Boolean)
}

function parseRoleTitle(sectionText: string): string {
  const firstLine = sectionText.trim().split('\n')[0] ?? ''
  return firstLine.replace(/\([^)]*\)/g, '').trim()
}

type RoleDomain = 'pm_po' | 'analyst' | 'qa_testing' | 'engineering' | 'unknown'

function inferRoleDomain(roleTitle: string): RoleDomain {
  const t = roleTitle.toLowerCase()
  if (/product owner|product manager|\bpo\b|\bpm\b|program manager/.test(t)) return 'pm_po'
  if (/analyst|business analyst|\bba\b|data analyst/.test(t)) return 'analyst'
  if (/test|qa |quality assurance|\bsdet\b|automation engineer/.test(t)) return 'qa_testing'
  if (/software engineer|developer|architect|tech lead|technical lead/.test(t)) return 'engineering'
  return 'unknown'
}

function wordSet(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
  )
}

function jaccard(a: string, b: string): number {
  const sa = wordSet(a)
  const sb = wordSet(b)
  const inter = [...sa].filter(w => sb.has(w)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 0 : inter / union
}

/**
 * Stable warning ID derived from content — same bullet + type = same ID across renders.
 * This allows `ignoredWarningIds` to survive hot-reloads and re-memoizations.
 */
function stableId(sectionId: string, warningType: string, affectedText: string): string {
  // Use full affectedText (not truncated) to minimise hash collisions
  const key = `${sectionId}|${warningType}|${affectedText}`
  let h = 5381
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(33, h) ^ key.charCodeAt(i)
  }
  return `sw-${(h >>> 0).toString(36)}`
}

function makeWarning(
  sectionId: string,
  warningType: SectionWarningType,
  severity: SectionWarning['severity'],
  affectedText: string,
  explanation: string,
  suggestedAction: SectionWarning['suggestedAction'],
  opts?: {
    suggestedSectionId?: string
    repairInstruction?: string
    evidenceIds?: string[]
  }
): SectionWarning {
  return {
    id: stableId(sectionId, warningType, affectedText),
    sectionId,
    severity,
    warningType,
    affectedText,
    explanation,
    suggestedAction,
    ...opts,
  }
}

// ─── Detectors ─────────────────────────────────────────────────────────────────

function detectDuplicateEvidence(
  section: Stage4Section,
  allSections: Stage4Section[],
): SectionWarning[] {
  const warnings: SectionWarning[] = []
  const myBullets = extractBullets(section.acceptedText)
  const others = allSections.filter(
    s => s.sectionId !== section.sectionId && s.sectionType.startsWith('experience')
  )

  for (const bullet of myBullets) {
    for (const other of others) {
      const otherBullets = extractBullets(other.acceptedText)
      const match = otherBullets.find(ob => jaccard(bullet, ob) >= 0.7)
      if (match) {
        const otherTitle = parseRoleTitle(other.acceptedText) || other.sectionId
        warnings.push(makeWarning(
          section.sectionId,
          'duplicate_evidence',
          'warning',
          `- ${bullet}`,
          `This bullet closely matches content in "${otherTitle}". Duplicate evidence across role sections undermines both sections.`,
          'move_to_correct_section',
          {
            suggestedSectionId: other.sectionId,
            repairInstruction: `Keep this bullet only in the section where the work actually occurred. If the other section needs a reference, reframe as "Prior background: …" rather than repeating the bullet.`,
          },
        ))
        break
      }
    }
  }

  return warnings
}

function detectRoleBoundaryLeakage(
  section: Stage4Section,
  allSections: Stage4Section[],
): SectionWarning[] {
  if (!section.sectionType.startsWith('experience')) return []
  const warnings: SectionWarning[] = []
  const roleTitle = parseRoleTitle(section.acceptedText)
  const domain = inferRoleDomain(roleTitle)

  if (domain !== 'pm_po' && domain !== 'analyst') return []

  const myBullets = extractBullets(section.acceptedText)
  const qaSection = allSections.find(
    s => s.sectionId !== section.sectionId && inferRoleDomain(parseRoleTitle(s.acceptedText)) === 'qa_testing'
  )

  for (const bullet of myBullets) {
    const bulletLower = bullet.toLowerCase()
    const triggeredSignal = QA_TESTING_SIGNALS.find(sig => bulletLower.includes(sig))
    if (!triggeredSignal) continue

    const targetTitle = qaSection ? parseRoleTitle(qaSection.acceptedText) : undefined
    warnings.push(makeWarning(
      section.sectionId,
      'role_boundary_leakage',
      'warning',
      `- ${bullet}`,
      `This bullet mentions "${triggeredSignal}" — a QA/testing-domain term — but appears inside the ${roleTitle} section. Evidence should live in the role where it was primary work.`,
      'move_to_correct_section',
      {
        suggestedSectionId: qaSection?.sectionId,
        repairInstruction: targetTitle
          ? `Move to the "${targetTitle}" section. If cross-role context is needed here, reframe as: "Prior QA foundation: …" or "Earlier technical background: …"`
          : `Move this bullet to the role where this work occurred, or reframe as "Prior technical background."`,
      },
    ))
  }

  return warnings
}

function detectOverclaim(section: Stage4Section): SectionWarning[] {
  if (!section.sectionType.startsWith('experience')) return []
  const warnings: SectionWarning[] = []

  for (const bullet of extractBullets(section.acceptedText)) {
    if (OVERCLAIM_RE.test(bullet)) {
      warnings.push(makeWarning(
        section.sectionId,
        'overclaim_risk',
        'warning',
        `- ${bullet}`,
        'This bullet claims full ownership of product roadmap/strategy. If the role was leadership-sponsored execution, this may misrepresent authority level.',
        'rewrite_with_boundary',
        {
          repairInstruction: 'Reframe as "contributed to," "executed against," "shaped," or "influenced" rather than "owned" or "defined."',
        },
      ))
    }
  }

  return warnings
}

function detectStyleIssues(section: Stage4Section): SectionWarning[] {
  if (!section.sectionType.startsWith('experience') && section.sectionType !== 'summary') return []
  const warnings: SectionWarning[] = []

  for (const bullet of extractBullets(section.acceptedText)) {
    const words = bullet.split(/\s+/).length

    if (words > 40) {
      warnings.push(makeWarning(
        section.sectionId,
        'too_dense',
        'advisory',
        `- ${bullet.slice(0, 90)}…`,
        `Bullet is ${words} words. ATS systems and recruiters prefer under 30 words — longer bullets reduce scannability.`,
        'refine_section',
        { repairInstruction: 'Split into two focused bullets or trim to the core action + outcome.' },
      ))
    } else if (WEAK_VERB_RE.test(bullet.trim())) {
      const match = bullet.trim().match(WEAK_VERB_RE)?.[0] ?? ''
      warnings.push(makeWarning(
        section.sectionId,
        'style_robotic',
        'advisory',
        `- ${bullet.slice(0, 90)}`,
        `Bullet starts with "${match}" — a weak opener that hides agency. Strong bullets lead with an action verb.`,
        'refine_section',
        { repairInstruction: 'Start with a strong action verb that shows ownership: "Led," "Built," "Reduced," "Shipped," "Defined," etc.' },
      ))
    } else if (PASSIVE_RE.test(bullet)) {
      warnings.push(makeWarning(
        section.sectionId,
        'style_robotic',
        'advisory',
        `- ${bullet.slice(0, 90)}`,
        'Passive voice detected. Active-voice bullets are stronger, clearer, and easier to scan.',
        'refine_section',
        { repairInstruction: 'Rewrite in active voice, leading with the action you personally took.' },
      ))
    }
  }

  return warnings
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Generates SectionWarning[] for every section, keyed by sectionId. */
export function generateAllSectionWarnings(
  sections: Stage4Section[],
): Map<string, SectionWarning[]> {
  const result = new Map<string, SectionWarning[]>()

  for (const section of sections) {
    const raw = [
      ...detectDuplicateEvidence(section, sections),
      ...detectRoleBoundaryLeakage(section, sections),
      ...detectOverclaim(section),
      ...detectStyleIssues(section),
    ]

    // Deduplicate IDs within a section — last-resort guard against hash collisions
    const seen = new Set<string>()
    const deduped = raw.map(w => {
      let id = w.id
      let n = 1
      while (seen.has(id)) id = `${w.id}-${++n}`
      seen.add(id)
      return id === w.id ? w : { ...w, id }
    })

    result.set(section.sectionId, deduped)
  }

  return result
}

/** Summarizes warning counts by category across all sections. */
export interface WarningSummary {
  errorCount: number
  warningCount: number
  advisoryCount: number
  byType: Partial<Record<SectionWarningType, number>>
  bySectionId: Record<string, { error: number; warning: number; advisory: number }>
}

export function summarizeWarnings(
  warningMap: Map<string, SectionWarning[]>,
  ignoredIdsBySection: Record<string, string[]>,
): WarningSummary {
  let errorCount = 0
  let warningCount = 0
  let advisoryCount = 0
  const byType: Partial<Record<SectionWarningType, number>> = {}
  const bySectionId: Record<string, { error: number; warning: number; advisory: number }> = {}

  for (const [sectionId, warnings] of warningMap) {
    const ignored = new Set(ignoredIdsBySection[sectionId] ?? [])
    const visible = warnings.filter(w => !ignored.has(w.id))
    const counts = { error: 0, warning: 0, advisory: 0 }

    for (const w of visible) {
      if (w.severity === 'error') { errorCount++; counts.error++ }
      else if (w.severity === 'warning') { warningCount++; counts.warning++ }
      else { advisoryCount++; counts.advisory++ }
      byType[w.warningType] = (byType[w.warningType] ?? 0) + 1
    }

    if (visible.length > 0) bySectionId[sectionId] = counts
  }

  return { errorCount, warningCount, advisoryCount, byType, bySectionId }
}

// ─── Display labels ────────────────────────────────────────────────────────────

export const SECTION_WARNING_LABELS: Record<string, string> = {
  role_boundary_leakage: 'Evidence in wrong role section',
  duplicate_evidence: 'Duplicate evidence across sections',
  unsupported_claim: 'Unsupported claim',
  overclaim_risk: 'Overclaim risk',
  theme_missing_from_experience: 'JD theme not represented in experience',
  skill_not_proven: 'Skill not yet proven in experience',
  section_overlap: 'Section content overlaps',
  style_robotic: 'Weak or passive phrasing',
  too_dense: 'Bullet too long',
  ats_structure: 'ATS structure issue',
  page_length: 'Page length concern',
}

export const SECTION_WARNING_SEVERITY_COLOR: Record<string, string> = {
  error: 'text-red-400 bg-red-900/30',
  warning: 'text-amber-400 bg-amber-900/30',
  advisory: 'text-blue-400 bg-blue-900/20',
}

export const SUGGESTED_ACTION_LABELS: Record<string, string> = {
  move_to_correct_section: 'Move to the correct section',
  rewrite_with_boundary: 'Rewrite with role boundary',
  remove_claim: 'Remove this claim',
  add_evidence: 'Add supporting evidence',
  ignore: 'No action needed',
  refine_section: 'Refine this bullet',
}
