import type { ResumeBullet, ClaimStatus, UserProfile } from '@/contracts'

/**
 * Validates a bullet's claimed status against the user profile.
 * Used before persisting generated bullets to catch status mismatches.
 */
export function validateBulletClaim(
  bullet: ResumeBullet,
  profile: UserProfile
): { valid: boolean; correctedStatus: ClaimStatus; reason: string } {
  const { text, claimStatus } = bullet

  // Unsupported claims must never slip through as supported
  if (claimStatus === 'unsupported') {
    return { valid: true, correctedStatus: 'unsupported', reason: 'Marked unsupported by generator.' }
  }

  // Check if any profile evidence matches
  const profileText = buildProfileText(profile).toLowerCase()
  const bulletLower = text.toLowerCase()

  // Extract key nouns/verbs from bullet for heuristic matching
  const keyTokens = extractKeyTokens(bulletLower)
  const matchCount = keyTokens.filter(t => profileText.includes(t)).length
  const matchRatio = keyTokens.length > 0 ? matchCount / keyTokens.length : 0

  if (claimStatus === 'supported' && matchRatio < 0.25) {
    return {
      valid: false,
      correctedStatus: 'needs-user-confirmation',
      reason: `Bullet claims "supported" but only ${Math.round(matchRatio * 100)}% of key tokens found in profile. Downgrading to needs-user-confirmation.`
    }
  }

  return { valid: true, correctedStatus: claimStatus, reason: 'Claim status consistent with profile.' }
}

/**
 * Scans bullet text for rejected phrases from learning signals.
 */
export function containsRejectedPhrase(text: string, rejectedPhrases: string[]): string | null {
  const lower = text.toLowerCase()
  for (const phrase of rejectedPhrases) {
    if (lower.includes(phrase.toLowerCase())) return phrase
  }
  return null
}

/**
 * Estimates word count for two-page constraint check.
 * Standard: ~500–600 words per page for a resume.
 */
export function estimatePageCount(sections: { content: string }[]): number {
  const totalWords = sections.reduce((sum, s) => {
    return sum + s.content.split(/\s+/).filter(Boolean).length
  }, 0)
  return totalWords / 550
}

function buildProfileText(profile: UserProfile): string {
  return [
    profile.skills.join(' '),
    ...profile.workHistory.flatMap(w => [
      w.title, w.company, w.domain, ...w.skills, ...w.bullets, ...w.approvedMetrics
    ])
  ].join(' ')
}

function extractKeyTokens(text: string): string[] {
  // Remove stopwords and short tokens
  const stopwords = new Set([
    'a', 'an', 'the', 'and', 'or', 'in', 'of', 'to', 'for', 'with', 'on', 'by',
    'as', 'at', 'from', 'is', 'was', 'were', 'be', 'been', 'being', 'have', 'had',
    'do', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'that', 'this',
    'which', 'who', 'what', 'when', 'where', 'how', 'all', 'each', 'across', 'within'
  ])
  return text
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3 && !stopwords.has(t))
}
