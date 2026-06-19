/**
 * QualifiedEvidenceCard
 *
 * A structured container for each piece of candidate evidence that preserves
 * what is safe to say and what must not be claimed.
 *
 * Built from work history bullets, approved metrics, bridge answers, and skills.
 * Used to: (1) derive ClaimGuardrails for the ArtifactGenerationBrief prompt,
 * and (2) run a deterministic post-generation claim fidelity check.
 *
 * Classification rules:
 *   - Work history bullet from primary (role-matched) entry → direct
 *   - Work history bullet from supporting (non-matched) entry → adjacent
 *   - Bridge answer with professional language → direct
 *   - Bridge answer with learning/self-study language → learning-only
 *   - Bridge answer with negative/uncertain language → learning-only, confidence: none
 *   - Profile skill → skill
 *   - Approved metric from primary entry → metric, high confidence
 */

import type {
  SectionType, JDRequirementMap, UserProfile, BridgeQuestion
} from '@/contracts'
import type { ScopedEvidenceBundle } from '@/lib/evidence-scope'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EvidenceCardSourceType =
  | 'work-history-bullet'
  | 'work-history-metric'
  | 'profile-skill'
  | 'bridge-answer'

export type EvidenceCardType =
  | 'direct'         // used professionally, confident
  | 'adjacent'       // from a different role context — transferable with framing
  | 'learning-only'  // studied or familiar, not professional experience
  | 'metric'         // quantified fact from approved metrics
  | 'skill'          // named skill from profile

export type EvidenceConfidence = 'high' | 'medium' | 'low' | 'none'

export interface QualifiedEvidenceCard {
  id: string
  sourceType: EvidenceCardSourceType
  /** ID of the work entry, skill, or bridge question this card came from. */
  sourceId: string
  /** Only set for bridge-answer cards. */
  sourceQuestionId?: string
  rawText: string
  normalizedClaim: string
  safeResumeClaim: string
  evidenceType: EvidenceCardType
  confidence: EvidenceConfidence
  /** Keywords that identify this card in generated text (for fidelity matching). */
  supportedKeywords: string[]
  allowedResumeLanguage: string[]
  prohibitedResumeLanguage: string[]
  boundaries: string[]
  useInSections: SectionType[]
  avoidInSections: SectionType[]
  notesForGenerator: string
}

// ─── Bridge answer classification ────────────────────────────────────────────

const LEARNING_ONLY_PATTERNS = [
  /\bi('?ve)?\s+(learned|studied|took\s+a\s+course|done\s+training|completed\s+training|been\s+learning)/i,
  /\bfamiliar\s+with\b/i,
  /\bexposure\s+to\b/i,
  /\bhaven'?t\s+used\s+(it\s+)?professionally\b/i,
  /\bnot\s+used\s+in\s+(a\s+)?professional/i,
  /\bself[- ]taught\b/i,
  /\bon\s+(my\s+own|the\s+side|my\s+personal)\b/i,
  /\boutside\s+(of\s+)?my\s+(current\s+)?role\b/i,
  /\b(in\s+)?(school|a\s+class|a\s+course|a\s+bootcamp|training)\b/i,
  /\bcertification\s+course\b/i,
  /\bjust\s+started\s+(learning|using)\b/i,
]

const NEGATIVE_PATTERNS = [
  /\b(i\s+)?haven'?t\b/i,
  /\bno\s+experience\b/i,
  /\bnot\s+(sure|confident|familiar)\b/i,
  /\bcan'?t\s+claim\b/i,
  /\bdon'?t\s+have\b/i,
  /\bnever\s+(used|worked\s+with|built|done)\b/i,
  /\bnot\s+my\s+(area|background|expertise)\b/i,
  /\bi\s+(don'?t|did\s+not)\s+(know|understand|have)\b/i,
]

const DIRECT_PROFESSIONAL_PATTERNS = [
  /\bi\s+(used|worked\s+with|built|created|managed|led|designed|developed|deployed|maintained|owned|ran|handled)\b/i,
  /\bin\s+my\s+(current|previous|prior\s+)?role\b/i,
  /\bas\s+part\s+of\s+(my\s+)?(work|job|role|responsibilities)\b/i,
  /\bprofessionally\b/i,
  /\bday[- ]to[- ]day\b/i,
  /\bregularly\b/i,
  /\bdaily\b/i,
  /\bat\s+(work|the\s+company|my\s+job)\b/i,
]

function classifyBridgeAnswer(answer: string): { type: EvidenceCardType; confidence: EvidenceConfidence } {
  if (!answer?.trim()) return { type: 'learning-only', confidence: 'none' }

  // Learning-only must be checked BEFORE negative — "haven't used it professionally"
  // is learning-context (studied but not professional), not a hard denial.
  if (LEARNING_ONLY_PATTERNS.some(p => p.test(answer))) {
    return { type: 'learning-only', confidence: 'low' }
  }

  // Hard negatives: user explicitly denies, expresses no knowledge, or has never done it
  if (NEGATIVE_PATTERNS.some(p => p.test(answer))) {
    return { type: 'learning-only', confidence: 'none' }
  }

  if (DIRECT_PROFESSIONAL_PATTERNS.some(p => p.test(answer))) {
    return { type: 'direct', confidence: 'medium' }
  }

  // Substantive answer without clear signal → treat as adjacent (may be paraphrased)
  return { type: 'adjacent', confidence: 'low' }
}

// ─── Keyword extraction ───────────────────────────────────────────────────────

/** Extracts named tools, platforms, and domain terms from text. */
export function extractEvidenceKeywords(text: string): string[] {
  // Multi-word ALLCAPS (NCUA, HMDA, CFPB, CRM)
  const allCaps = text.match(/\b[A-Z]{2,}\b/g) ?? []
  // Title-cased multi-word phrases (Power BI, Microsoft Excel, Salesforce Reports)
  const titleCase = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b/g) ?? []
  // Single-word tools with mixed case (SpecFlow, Jira, Pendo, dbt)
  const mixedCase = text.match(/\b[A-Z][a-z]+[A-Z][a-z]+\b/g) ?? []
  return [...new Set([...allCaps, ...titleCase, ...mixedCase])].slice(0, 8)
}

// ─── Section affinity ─────────────────────────────────────────────────────────

function roleTitleToSections(title: string): SectionType[] {
  const lower = title.toLowerCase()
  if (/analyst|ba\b|business analyst|product analyst|data analyst/i.test(lower)) return ['experience-secondary']
  if (/owner|product manager|pm\b|program manager/i.test(lower)) return ['experience-primary']
  if (/qa\b|quality|test engineer|tester/i.test(lower)) return ['experience-supporting']
  return ['experience-secondary', 'experience-primary', 'experience-supporting']
}

function bridgeSectionHint(q: BridgeQuestion): SectionType[] {
  const af = (q.affectedArtifactSection ?? '').toLowerCase()
  if (af.includes('ba') || af.includes('analyst')) return ['experience-secondary']
  if (af.includes('po') || af.includes('owner')) return ['experience-primary']
  if (af.includes('supporting') || af.includes('quality')) return ['experience-supporting']
  return ['experience-secondary', 'experience-primary', 'experience-supporting']
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildQualifiedEvidenceCards(
  profile: UserProfile,
  answeredQuestions: BridgeQuestion[],
  jdMap: JDRequirementMap,
  bundle: ScopedEvidenceBundle
): QualifiedEvidenceCard[] {
  const cards: QualifiedEvidenceCard[] = []
  let seq = 0

  const primaryIds = new Set(bundle.primaryWorkEntries.map(e => e.id))

  // ── Work history bullets + metrics ────────────────────────────────────────
  for (const entry of profile.workHistory) {
    const isPrimary = primaryIds.has(entry.id)
    const evidenceType: EvidenceCardType = isPrimary ? 'direct' : 'adjacent'
    const primarySections = roleTitleToSections(entry.title)

    for (const bullet of entry.bullets) {
      const id = `card-wh-${seq++}`
      const keywords = extractEvidenceKeywords(bullet)
      const prohibited: string[] = []

      if (!isPrimary) {
        prohibited.push(`claiming this as primary role work without prior-background framing`)
      }

      cards.push({
        id,
        sourceType: 'work-history-bullet',
        sourceId: entry.id,
        rawText: bullet,
        normalizedClaim: bullet.trim(),
        safeResumeClaim: isPrimary
          ? bullet.trim()
          : `Earlier career: ${bullet.trim()}`,
        evidenceType,
        confidence: entry.approvedMetrics.length > 0 ? 'high' : 'medium',
        supportedKeywords: keywords,
        allowedResumeLanguage: isPrimary
          ? ['active voice', 'impact-first', 'direct attribution to this role']
          : ['prior background', 'earlier career', 'previously', 'earlier experience'],
        prohibitedResumeLanguage: prohibited,
        boundaries: isPrimary
          ? []
          : [`Must include explicit prior-background framing — not current role work`],
        useInSections: isPrimary
          ? [...primarySections, 'summary', 'skills', 'cover-letter']
          : [...primarySections, 'summary', 'cover-letter', 'talking-points'],
        avoidInSections: isPrimary ? [] : [bundle.sectionType],
        notesForGenerator: isPrimary
          ? `Direct evidence from ${entry.title} at ${entry.company}.`
          : `Adjacent context from ${entry.title} at ${entry.company}. MUST include prior-background framing.`,
      })
    }

    // Metrics
    for (const metric of entry.approvedMetrics) {
      const id = `card-m-${seq++}`
      cards.push({
        id,
        sourceType: 'work-history-metric',
        sourceId: entry.id,
        rawText: metric,
        normalizedClaim: metric.trim(),
        safeResumeClaim: metric.trim(),
        evidenceType: 'metric',
        confidence: 'high',
        supportedKeywords: extractEvidenceKeywords(metric),
        allowedResumeLanguage: ['exact number', 'percentage claim', 'volume figure'],
        prohibitedResumeLanguage: isPrimary
          ? []
          : [`presenting metric from ${entry.title} as current-role result`],
        boundaries: [],
        useInSections: ['experience-secondary', 'experience-primary', 'experience-supporting', 'summary'],
        avoidInSections: [],
        notesForGenerator: `Approved metric from ${entry.title} — use exactly as stated, do not inflate.`,
      })
    }
  }

  // ── Bridge question answers ───────────────────────────────────────────────
  for (const q of answeredQuestions) {
    if (q.status !== 'answered' || !q.userAnswer?.trim()) continue

    const { type: evidenceType, confidence } = classifyBridgeAnswer(q.userAnswer)
    const id = `card-ba-${seq++}`
    const keywords = extractEvidenceKeywords(q.userAnswer)
    const isLearningOnly = evidenceType === 'learning-only' && confidence !== 'none'
    const isNegative = evidenceType === 'learning-only' && confidence === 'none'
    const affectedSections = bridgeSectionHint(q)

    const prohibited: string[] = []
    if (isLearningOnly) {
      prohibited.push(`professional experience claims (managed, led, owned, designed, built) for ${keywords.slice(0, 2).join(', ')}`)
    }
    if (isNegative) {
      prohibited.push(`any resume claim — user has no evidence`)
    }

    cards.push({
      id,
      sourceType: 'bridge-answer',
      sourceId: q.id,
      sourceQuestionId: q.id,
      rawText: q.userAnswer,
      normalizedClaim: q.userAnswer.trim(),
      safeResumeClaim: isNegative
        ? ''
        : isLearningOnly
          ? `Familiar with ${keywords.slice(0, 2).join(', ')} — developing proficiency`
          : q.userAnswer.trim(),
      evidenceType,
      confidence,
      supportedKeywords: keywords,
      allowedResumeLanguage: isLearningOnly
        ? ['familiar with', 'developing proficiency in', 'exposure to']
        : isNegative
          ? []
          : ['worked with', 'applied', 'contributed to', 'used professionally'],
      prohibitedResumeLanguage: prohibited,
      boundaries: [
        ...(isLearningOnly
          ? [`${keywords.slice(0, 2).join(', ')} is learning-context only — no professional experience claims`]
          : []),
        ...(isNegative
          ? [`User denied or expressed uncertainty — generate NO resume claims from this`]
          : []),
      ],
      useInSections: isNegative
        ? []
        : isLearningOnly
          ? ['skills', 'talking-points']
          : affectedSections,
      avoidInSections: isLearningOnly || isNegative
        ? ['experience-primary', 'experience-secondary', 'experience-supporting']
        : [],
      notesForGenerator: isNegative
        ? `User expressed no experience or denied — do not generate any resume claim from this.`
        : isLearningOnly
          ? `Learning-only. Never claim professional experience. May list as developing skill only.`
          : `Bridge evidence for ${affectedSections.join(', ')}.`,
    })
  }

  // ── Profile skills ────────────────────────────────────────────────────────
  const jdTermsLower = new Set(jdMap.required.map(r => r.text.toLowerCase()))

  for (const group of profile.skillGroups ?? []) {
    for (const skill of group.skills) {
      const inJD = jdTermsLower.has(skill.toLowerCase())
      const id = `card-sk-${seq++}`
      cards.push({
        id,
        sourceType: 'profile-skill',
        sourceId: `skill-${skill}`,
        rawText: skill,
        normalizedClaim: skill,
        safeResumeClaim: skill,
        evidenceType: 'skill',
        confidence: inJD ? 'high' : 'medium',
        supportedKeywords: [skill],
        allowedResumeLanguage: [`${skill} (skill group: ${group.heading})`],
        prohibitedResumeLanguage: [],
        boundaries: [],
        useInSections: ['skills', 'summary'],
        avoidInSections: [],
        notesForGenerator: inJD
          ? `JD-required skill — include in skills section.`
          : `Profile skill — include if contextually relevant.`,
      })
    }
  }

  return cards
}

// ─── Guardrail derivation ─────────────────────────────────────────────────────

/** Compact claim guardrail summary derived from evidence cards. Injected into brief prompt. */
export interface ClaimGuardrails {
  /** Items that cannot be claimed as professional experience. */
  learningOnlyItems: string[]
  /** Items that require explicit prior-background framing. */
  adjacentItems: string[]
  /** User denied or expressed no knowledge — generate nothing. */
  noEvidenceItems: string[]
}

export function deriveClaimGuardrails(cards: QualifiedEvidenceCard[]): ClaimGuardrails {
  const learningOnlyItems: string[] = []
  const adjacentItems: string[] = []
  const noEvidenceItems: string[] = []

  for (const card of cards) {
    if (card.evidenceType === 'learning-only') {
      const label = card.supportedKeywords.slice(0, 2).join(', ') || card.rawText.slice(0, 40)
      if (card.confidence === 'none') {
        noEvidenceItems.push(label)
      } else {
        learningOnlyItems.push(label)
      }
    }
    if (card.evidenceType === 'adjacent' && card.sourceType === 'work-history-bullet') {
      const match = card.notesForGenerator.match(/from (.+?) at (.+?)\./)
      if (match) adjacentItems.push(`${match[1]} at ${match[2]}`)
    }
  }

  return {
    learningOnlyItems: [...new Set(learningOnlyItems)],
    adjacentItems: [...new Set(adjacentItems)],
    noEvidenceItems: [...new Set(noEvidenceItems)],
  }
}
