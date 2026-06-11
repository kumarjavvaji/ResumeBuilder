export type JDInvalidReason =
  | 'empty'
  | 'too_short'
  | 'login_wall'
  | 'cookie_wall'
  | 'navigation_dump'
  | 'no_job_sections'

export interface JDValidationResult {
  valid: boolean
  reason?: JDInvalidReason
  message?: string
}

// Minimum characters for text to even be considered
const MIN_CHARS = 200

// Phrases that appear when a site is blocking with a login prompt
const LOGIN_PATTERNS = [
  /\bsign\s+in\s+to\s+(view|apply|see|access)\b/i,
  /\blog\s+in\s+to\s+(view|apply|see|access)\b/i,
  /\bcreate\s+an?\s+account\s+to\s+(view|apply|see|access)\b/i,
  /\bplease\s+(sign|log)\s+in\b/i,
  /\byou(\'re|\s+are)\s+not\s+logged\s+in\b/i,
  /\bregister\s+to\s+apply\b/i,
  /\bsign\s+up\s+to\s+apply\b/i,
  /\bmust\s+be\s+logged\s+in\s+to\s+apply\b/i,
  /\bto\s+apply\s+for\s+this\s+(job|position|role).{0,30}(log|sign)\s+in\b/i,
]

// Keywords that appear in real job descriptions
const JOB_SECTION_PATTERNS = [
  /\b(responsibilities|qualifications|requirements|experience\s+required|key\s+responsibilities|essential\s+duties)\b/i,
  /\b(what\s+you('ll|\s+will)\s+do|about\s+the\s+role|we('re|\s+are)\s+looking\s+for)\b/i,
  /\b(what\s+we('re|\s+are)\s+looking\s+for|required\s+skills|minimum\s+qualifications|preferred\s+qualifications)\b/i,
  /\b(what\s+you\s+bring|your\s+background|your\s+experience|role\s+overview|position\s+overview)\b/i,
  /\b(job\s+summary|job\s+overview|role\s+description|position\s+description)\b/i,
]

/**
 * Validates that fetched or pasted text is an actual job description,
 * not a login wall, cookie consent page, or navigation dump.
 *
 * Pure function — no I/O, safe to call in tests.
 */
export function validateJDContent(
  text: string,
  context: { roleTitle?: string; company?: string } = {}
): JDValidationResult {
  const trimmed = (text ?? '').trim()

  if (!trimmed) {
    return { valid: false, reason: 'empty', message: 'No text was extracted from the page.' }
  }

  if (trimmed.length < MIN_CHARS) {
    return {
      valid: false,
      reason: 'too_short',
      message: `Extracted text is too short (${trimmed.length} chars). The page may be blocking automated access.`,
    }
  }

  // Login wall
  for (const pattern of LOGIN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        reason: 'login_wall',
        message: 'The job page returned a login prompt instead of job content.',
      }
    }
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  // Cookie/privacy consent wall: high density of privacy keywords
  const cookieMatches = (trimmed.match(/\b(cookie|cookies|privacy\s+policy|gdpr|consent)\b/gi) ?? []).length
  if (wordCount > 0 && cookieMatches / wordCount > 0.06) {
    return {
      valid: false,
      reason: 'cookie_wall',
      message: 'The page returned cookie or privacy consent content instead of a job description.',
    }
  }

  // Navigation dump: high density of nav/UI chrome words in short content
  const navMatches = (
    trimmed.match(
      /\b(home|about\s+us?|careers|contact\s+us?|sign\s+in|log\s+in|sign\s+up|menu|navigation|report\s+this\s+job|back\s+to\s+search|all\s+jobs|job\s+board)\b/gi
    ) ?? []
  ).length
  if (wordCount < 300 && wordCount > 0 && navMatches / wordCount > 0.12) {
    return {
      valid: false,
      reason: 'navigation_dump',
      message: 'The page returned mostly navigation or chrome content. Paste the job description text directly.',
    }
  }

  // Must contain at least one recognizable job section heading or keyword
  const hasJobSection = JOB_SECTION_PATTERNS.some(p => p.test(trimmed))
  if (!hasJobSection && wordCount < 150) {
    return {
      valid: false,
      reason: 'no_job_sections',
      message:
        'No recognizable job sections found (responsibilities, qualifications, requirements). Paste the full job description.',
    }
  }

  return { valid: true }
}

/** Human-readable label for an invalid reason, shown in the UI. */
export function jdInvalidLabel(reason: JDInvalidReason): string {
  const labels: Record<JDInvalidReason, string> = {
    empty: 'No content was returned from the page.',
    too_short: 'The page returned too little text — it may be blocking automated access.',
    login_wall: 'The page requires login. Paste the job description to continue.',
    cookie_wall: 'The page returned a cookie consent prompt, not job content.',
    navigation_dump: 'The page returned navigation content instead of a job description.',
    no_job_sections: 'The text has no recognizable job sections (responsibilities, qualifications, etc.).',
  }
  return labels[reason] ?? 'The job page could not be fetched.'
}
