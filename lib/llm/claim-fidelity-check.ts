/**
 * Claim Fidelity Check
 *
 * Post-generation deterministic check that catches overclaiming before the result
 * is shown to the user. Runs against QualifiedEvidenceCards built from the user's
 * profile and bridge answers.
 *
 * Four violation types:
 *   1. learning-only-overclaim  — professional verbs used for learning-only evidence
 *   2. adjacent-overclaim       — adjacent entry claimed directly without framing
 *   3. negative-claim           — claim made for evidence user explicitly denied
 *   4. prohibited-language      — text matches a card's prohibitedResumeLanguage entry
 *
 * Does NOT make LLM calls. Output is merged into evidenceWarnings and bullet partitions
 * in generateArtifactSection.
 */

import type { QualifiedEvidenceCard } from './qualified-evidence-cards'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FidelityViolationType =
  | 'learning-only-overclaim'
  | 'adjacent-overclaim'
  | 'negative-claim'
  | 'prohibited-language'

export interface FidelityViolation {
  bulletIndex: number
  violationType: FidelityViolationType
  violatingText: string
  evidenceCardId: string
  explanation: string
  suggestedFix?: string
}

export interface FidelityCheckResult {
  passed: boolean
  violations: FidelityViolation[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Strong ownership verbs that cannot be applied to learning-only or negative evidence
const PROFESSIONAL_OVERCLAIM_VERBS = [
  'managed', 'led', 'owned', 'drove', 'built', 'designed', 'deployed',
  'developed', 'architected', 'orchestrated', 'directed', 'spearheaded',
  'established', 'delivered', 'launched', 'implemented', 'defined',
  'created', 'produced', 'authored', 'headed',
]

// Phrases that satisfy the adjacent-evidence framing requirement
const ADJACENT_FRAMING_PHRASES = [
  'prior background', 'earlier career', 'prior role', 'previously',
  'earlier experience', 'before joining', 'in my previous', 'prior to',
  'coming from', 'transitioning from', 'earlier in my career',
  'background in', 'experience from', 'building on my prior',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasAdjacentFraming(text: string): boolean {
  const lower = text.toLowerCase()
  return ADJACENT_FRAMING_PHRASES.some(p => lower.includes(p))
}

function hasProfessionalVerb(text: string): boolean {
  const lower = text.toLowerCase()
  return PROFESSIONAL_OVERCLAIM_VERBS.some(v => {
    // Exclude compound adjectives: "self-directed", "user-directed" → not an action verb
    const re = new RegExp(`(?<![-\\w])\\b${v}\\b(?![-\\w])`)
    return re.test(lower)
  })
}

function bulletMentionsCard(bulletLower: string, card: QualifiedEvidenceCard): boolean {
  return card.supportedKeywords.some(
    k => k.length >= 3 && bulletLower.includes(k.toLowerCase())
  )
}

// ─── Main check ───────────────────────────────────────────────────────────────

export function runClaimFidelityCheck(
  bullets: Array<{ text: string }>,
  evidenceCards: QualifiedEvidenceCard[]
): FidelityCheckResult {
  const violations: FidelityViolation[] = []

  const learningOnlyCards = evidenceCards.filter(
    c => c.evidenceType === 'learning-only' && c.confidence !== 'none'
  )
  const negativeCards = evidenceCards.filter(
    c => c.evidenceType === 'learning-only' && c.confidence === 'none'
  )
  const adjacentCards = evidenceCards.filter(
    c => c.evidenceType === 'adjacent' && c.sourceType === 'work-history-bullet'
  )

  for (let idx = 0; idx < bullets.length; idx++) {
    const { text } = bullets[idx]
    const lower = text.toLowerCase()
    let violationFound = false

    // ── Rule 1: Learning-only overclaim ──────────────────────────────────────
    for (const card of learningOnlyCards) {
      if (!bulletMentionsCard(lower, card)) continue
      if (!hasProfessionalVerb(text)) continue

      violations.push({
        bulletIndex: idx,
        violationType: 'learning-only-overclaim',
        violatingText: text,
        evidenceCardId: card.id,
        explanation: `Bullet uses professional action verbs for "${card.supportedKeywords.slice(0, 2).join(', ')}" which is learning-context only — user has not claimed professional experience with this.`,
        suggestedFix: `Rephrase as "familiar with" or "developing proficiency in" — do not claim ownership or delivery.`,
      })
      violationFound = true
      break
    }
    if (violationFound) continue

    // ── Rule 2: Negative evidence used for positive claim ─────────────────────
    for (const card of negativeCards) {
      if (!bulletMentionsCard(lower, card)) continue

      violations.push({
        bulletIndex: idx,
        violationType: 'negative-claim',
        violatingText: text,
        evidenceCardId: card.id,
        explanation: `Bullet claims experience with "${card.supportedKeywords.slice(0, 2).join(', ')}" but user denied having this or expressed no knowledge — no resume claim allowed.`,
        suggestedFix: `Remove this claim — user has no evidence for it.`,
      })
      violationFound = true
      break
    }
    if (violationFound) continue

    // ── Rule 3: Adjacent overclaim without prior-background framing ───────────
    for (const card of adjacentCards) {
      if (!bulletMentionsCard(lower, card)) continue
      if (hasAdjacentFraming(text)) continue
      if (!hasProfessionalVerb(text)) continue

      violations.push({
        bulletIndex: idx,
        violationType: 'adjacent-overclaim',
        violatingText: text,
        evidenceCardId: card.id,
        explanation: `Bullet claims "${card.supportedKeywords.slice(0, 2).join(', ')}" from an adjacent (non-primary) role without prior-background framing.`,
        suggestedFix: `Add explicit framing: "Prior background in..." or "Earlier career experience with..."`,
      })
      violationFound = true
      break
    }
    if (violationFound) continue

    // ── Rule 4: Explicit prohibited language from evidence cards ──────────────
    for (const card of evidenceCards) {
      for (const prohibited of card.prohibitedResumeLanguage) {
        if (prohibited.length < 4) continue
        if (!lower.includes(prohibited.toLowerCase())) continue

        violations.push({
          bulletIndex: idx,
          violationType: 'prohibited-language',
          violatingText: text,
          evidenceCardId: card.id,
          explanation: `Bullet contains prohibited language from evidence card "${card.id}": "${prohibited}"`,
        })
        violationFound = true
        break
      }
      if (violationFound) break
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  }
}
