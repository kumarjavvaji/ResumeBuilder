import type { ResumeBullet, SectionType, ClaimStatus, BlockedClaimDiagnostic, BulletPartition } from '@/contracts'
import type { ScopedEvidenceBundle } from './evidence-scope'

// ── Framing detection ─────────────────────────────────────────────────────────
// Phrases that satisfy the 'explicit-framing-required' cross-role policy.
const EXPLICIT_FRAMING_PHRASES = [
  'prior background',
  'earlier career',
  'prior role',
  'previous role',
  'previously',
  'earlier experience',
  'earlier in my career',
  'cross-functional',
  'progression from',
  'building on my',
  'before joining',
  'in my previous',
  'background in',
  'prior to',
  'coming from a',
  'transitioning from',
]

function hasExplicitFraming(text: string): boolean {
  const lower = text.toLowerCase()
  return EXPLICIT_FRAMING_PHRASES.some(p => lower.includes(p))
}

// ── Evidence ref resolution ───────────────────────────────────────────────────

import type { WorkEntry } from '@/contracts'

function resolveEntryFromRef(
  evidenceRef: string | undefined,
  entries: WorkEntry[]
): WorkEntry | null {
  if (!evidenceRef) return null
  const lower = evidenceRef.toLowerCase()
  // Match on job title only — company alone is too ambiguous when multiple
  // roles share the same employer (e.g. Product Owner + Product Analyst at the same company).
  return entries.find(e => lower.includes(e.title.toLowerCase())) ?? null
}

// ── Per-bullet validation result ──────────────────────────────────────────────

export interface ClaimValidationResult {
  bulletIndex: number
  bulletText: string
  disposition: 'allowed' | 'blocked' | 'downgraded' | 'requires-framing'
  originalClaimStatus: ClaimStatus
  correctedClaimStatus: ClaimStatus
  primarySourceEntry: string | null
  primarySourceRole: string | null
  inScopeEntry: boolean
  blockReason: string | null
  suggestedSection: SectionType | null
  diagnostic: BlockedClaimDiagnostic | null
  /** Which UI partition this bullet belongs in. */
  partition: BulletPartition
  /** Short reason for partition assignment — surfaced in UI panels. */
  partitionReason: string
}

/**
 * Maps a validation result to a BulletPartition.
 * Only 'display' partition bullets are exported and accepted.
 */
export function mapResultToPartition(result: ClaimValidationResult): BulletPartition {
  switch (result.disposition) {
    case 'blocked':
      return 'excluded'
    case 'downgraded':
      return result.suggestedSection ? 'suggested-other' : 'excluded'
    case 'requires-framing':
      // Cross-role with prior-background framing — user should confirm before display
      return 'needs-confirmation'
    case 'allowed':
      if (result.correctedClaimStatus === 'unsupported') return 'excluded'
      if (result.correctedClaimStatus === 'needs-user-confirmation') return 'needs-confirmation'
      return 'display'
  }
}

// ── Main validator ────────────────────────────────────────────────────────────

type RawBullet = {
  text: string
  claimStatus: ResumeBullet['claimStatus']
  sourceSignal: ResumeBullet['sourceSignal']
  evidenceRef?: string
}

/**
 * Deterministically validates every generated bullet against the section's scoped bundle.
 * Does not rely on the LLM's own claimStatus label — enforcement is structural.
 *
 * Rules applied in order:
 * 1. Disallowed claim pattern → downgraded + diagnostic
 * 2. 'unsupported' claim in a section that blocks unsupported → downgraded + diagnostic
 * 3. evidenceRef resolves to a supporting (non-primary) entry:
 *    - crossRolePolicy='none' → downgraded
 *    - crossRolePolicy='explicit-framing-required' + no framing → downgraded
 *    - crossRolePolicy='explicit-framing-required' + framing present → requires-framing (allowed)
 * 4. evidenceRef resolves to a primary entry → allowed
 * 5. evidenceRef unresolved → allow (cannot determine scope; LLM may use short refs)
 */
export function validateSectionClaims(
  bullets: RawBullet[],
  bundle: ScopedEvidenceBundle
): ClaimValidationResult[] {
  return bullets.map((b, idx) => validateOneBullet(b, idx, bundle))
}

function validateOneBullet(
  b: RawBullet,
  idx: number,
  bundle: ScopedEvidenceBundle
): ClaimValidationResult {
  const { scope, primaryWorkEntries, supportingWorkEntries } = bundle

  // ── Rule 1: disallowed claim pattern ──────────────────────────────────────
  const matchedPattern = scope.disallowedClaimPatterns.find(p =>
    b.text.toLowerCase().includes(p.toLowerCase())
  )
  if (matchedPattern) {
    const suggestedSection = suggestAlternativeSection(b.text, scope.sectionType)
    return makeResult(idx, b, 'downgraded', b.claimStatus, 'needs-user-confirmation', null, null, false, {
      reason: `Bullet contains a claim pattern disallowed in ${scope.sectionType}: "${matchedPattern}"`,
      suggestedSection,
      disposition: 'downgraded',
      detectedSourceEntry: b.evidenceRef ?? null,
      detectedSourceRole: null,
    })
  }

  // ── Rule 2: unsupported claim in a section that forbids it ─────────────────
  if (b.claimStatus === 'unsupported' && !scope.allowedClaimStatuses.includes('unsupported')) {
    return makeResult(idx, b, 'blocked', b.claimStatus, 'unsupported', null, null, false, {
      reason: `Section ${scope.sectionType} does not allow unsupported claims. Skill or experience not evidenced in profile.`,
      suggestedSection: null,
      disposition: 'excluded',
      detectedSourceEntry: b.evidenceRef ?? null,
      detectedSourceRole: null,
    })
  }

  // ── Rule 3–4: evidence ref scope check ────────────────────────────────────
  const primaryMatch = resolveEntryFromRef(b.evidenceRef, primaryWorkEntries)
  if (primaryMatch) {
    return makeResult(idx, b, 'allowed', b.claimStatus, b.claimStatus,
      `${primaryMatch.title} at ${primaryMatch.company}`, primaryMatch.title, true, null)
  }

  const supportingMatch = resolveEntryFromRef(b.evidenceRef, supportingWorkEntries)
  if (supportingMatch) {
    const sourceLabel = `${supportingMatch.title} at ${supportingMatch.company}`

    if (scope.crossRolePolicy === 'none') {
      return makeResult(idx, b, 'downgraded', b.claimStatus, 'needs-user-confirmation', sourceLabel, supportingMatch.title, false, {
        reason: `evidenceRef "${b.evidenceRef}" resolves to a supporting (non-primary) role entry. Section ${scope.sectionType} does not allow cross-role evidence.`,
        suggestedSection: suggestAlternativeSection(b.text, scope.sectionType),
        disposition: 'downgraded',
        detectedSourceEntry: sourceLabel,
        detectedSourceRole: supportingMatch.title,
      })
    }

    if (scope.crossRolePolicy === 'explicit-framing-required') {
      if (hasExplicitFraming(b.text)) {
        return makeResult(idx, b, 'requires-framing', b.claimStatus, b.claimStatus, sourceLabel, supportingMatch.title, false, {
          reason: `Cross-role reference to "${sourceLabel}" — framing detected; allowed in section with explicit prior-background framing.`,
          suggestedSection: null,
          disposition: 'requires-framing',
          detectedSourceEntry: sourceLabel,
          detectedSourceRole: supportingMatch.title,
        })
      } else {
        return makeResult(idx, b, 'downgraded', b.claimStatus, 'needs-user-confirmation', sourceLabel, supportingMatch.title, false, {
          reason: `evidenceRef "${b.evidenceRef}" resolves to supporting role "${supportingMatch.title}". Cross-role evidence requires explicit framing (e.g. "prior background") but none was detected.`,
          suggestedSection: suggestAlternativeSection(b.text, scope.sectionType),
          disposition: 'downgraded',
          detectedSourceEntry: sourceLabel,
          detectedSourceRole: supportingMatch.title,
        })
      }
    }
  }

  // ── Rule 5: evidenceRef unresolved — allow with no scope judgment ──────────
  return makeResult(idx, b, 'allowed', b.claimStatus, b.claimStatus, b.evidenceRef ?? null, null, true, null)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(
  idx: number,
  b: RawBullet,
  disposition: ClaimValidationResult['disposition'],
  original: ClaimStatus,
  corrected: ClaimStatus,
  sourceEntry: string | null,
  sourceRole: string | null,
  inScope: boolean,
  diag: Omit<BlockedClaimDiagnostic, 'attemptedSection' | 'blockedClaimText'> | null
): ClaimValidationResult {
  const partial: Omit<ClaimValidationResult, 'partition' | 'partitionReason'> = {
    bulletIndex: idx,
    bulletText: b.text,
    disposition,
    originalClaimStatus: original,
    correctedClaimStatus: corrected,
    primarySourceEntry: sourceEntry,
    primarySourceRole: sourceRole,
    inScopeEntry: inScope,
    blockReason: diag?.reason ?? null,
    suggestedSection: diag?.suggestedSection ?? null,
    diagnostic: diag
      ? {
          attemptedSection: '' as SectionType,  // filled by caller
          blockedClaimText: b.text,
          detectedSourceEntry: diag.detectedSourceEntry,
          detectedSourceRole: diag.detectedSourceRole,
          reason: diag.reason,
          suggestedSection: diag.suggestedSection,
          disposition: diag.disposition,
        }
      : null,
  }
  // Compute partition after building the base result
  const result = partial as ClaimValidationResult
  result.partition = mapResultToPartition(result)
  result.partitionReason = diag?.reason ?? (result.partition === 'display' ? 'In-scope for this section' : '')
  return result
}

/**
 * Heuristic: given a bullet that doesn't fit a section, suggest where it belongs.
 * Used to populate BlockedClaimDiagnostic.suggestedSection.
 */
function suggestAlternativeSection(bulletText: string, currentSection: SectionType): SectionType | null {
  const lower = bulletText.toLowerCase()
  if (currentSection !== 'experience-primary' &&
      (lower.includes('backlog') || lower.includes('sprint') || lower.includes('roadmap') || lower.includes('product owner'))) {
    return 'experience-primary'
  }
  if (currentSection !== 'experience-secondary' &&
      (lower.includes('requirements') || lower.includes('acceptance criteria') || lower.includes('analyst') ||
       lower.includes('salesforce') || lower.includes('triage'))) {
    return 'experience-secondary'
  }
  if (currentSection !== 'experience-supporting' &&
      (lower.includes('test') || lower.includes('supporting') || lower.includes('quality') || lower.includes('specflow'))) {
    return 'experience-supporting'
  }
  return null
}
