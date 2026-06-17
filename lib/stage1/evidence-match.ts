/**
 * Deterministic matching of parsed JD requirements against a compact profile
 * evidence index. No LLM involved.
 *
 * Uses containment (what fraction of the evidence item's tokens appear in the
 * requirement's token set) rather than symmetric Jaccard overlap — requirement
 * sentences are long and evidence items (esp. single-word skills like "Jira")
 * are short, so symmetric overlap unfairly penalizes short, exact matches.
 */
import type { JDRequirement, ProfileEvidenceIndexItem } from '@/contracts'
import { normalizeKey } from '@/lib/profile/profileNormalizer'

const STRENGTH_RANK = { strong: 2, medium: 1, weak: 0 }
const RANK_TO_LABEL = ['none', 'weak', 'moderate', 'strong'] as const

function strengthForMatches(
  matched: ProfileEvidenceIndexItem[]
): 'strong' | 'moderate' | 'weak' | 'none' {
  if (matched.length === 0) return 'none'
  const maxRank = Math.max(...matched.map(m => STRENGTH_RANK[m.evidenceStrength])) + 1
  return RANK_TO_LABEL[maxRank]
}

/** Fraction of itemTokens present in rowTokens. Short items need full containment; longer ones need a majority. */
function containment(rowTokens: Set<string>, itemKey: string): number {
  const itemTokens = itemKey.split(' ').filter(Boolean)
  if (itemTokens.length === 0) return 0
  const hits = itemTokens.filter(t => rowTokens.has(t)).length
  return hits / itemTokens.length
}

function matchRow(row: JDRequirement, index: ProfileEvidenceIndexItem[]): JDRequirement {
  // Match against the requirement text only. profileGrounding is the LLM's narrative
  // explanation and often names skills in a *contrastive* sense (e.g. "profile shows
  // Scrum but no Salesforce" for a gap row) — including it caused false-positive matches.
  const rowKey = normalizeKey(row.text)
  const rowTokens = new Set(rowKey.split(' ').filter(Boolean))

  const matched = index.filter(item => {
    const threshold = item.normalizedKey.split(' ').filter(Boolean).length <= 2 ? 1.0 : 0.5
    return containment(rowTokens, item.normalizedKey) >= threshold
  })

  if (matched.length === 0) {
    return { ...row, matchedClaimIds: [], profileEvidenceStrength: 'none' }
  }
  return {
    ...row,
    matchedClaimIds: matched.map(m => m.claimId),
    profileEvidenceStrength: strengthForMatches(matched),
  }
}

/** Enriches required/niceToHave rows with matchedClaimIds + profileEvidenceStrength. Pure, deterministic. */
export function matchRequirementsToEvidence(
  requirements: JDRequirement[],
  index: ProfileEvidenceIndexItem[]
): JDRequirement[] {
  if (index.length === 0) return requirements
  return requirements.map(r => matchRow(r, index))
}
