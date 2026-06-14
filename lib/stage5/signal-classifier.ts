/**
 * Classification boundary for Stage 5.
 *
 * Three buckets:
 *   profile-evidence  — facts about what the candidate has done (skills, tools, metrics,
 *                       experience statements). Belongs in the profile evidence bank.
 *   artifact-history  — generated/accepted/rejected resume content. Belongs in artifact
 *                       history for traceability.
 *   learning-signal   — reusable generation intelligence that changes how ResumeBuilder
 *                       should generate, reduce, prioritize, guard, or adapt future resumes.
 *
 * Rule: if it can appear directly on a resume, it is NOT a learning signal.
 */

export type SignalClassification = 'profile-evidence' | 'artifact-history' | 'learning-signal'

// Raw resume content patterns — bullet-shaped text that belongs in artifact-history.
const RESUME_CONTENT_PATTERNS = [
  // Starts with a past-tense action verb followed by a noun phrase (typical bullet)
  /^(Led|Managed|Built|Developed|Designed|Collaborated|Supported|Analyzed|Delivered|Reduced|Increased|Improved|Owned|Drove|Facilitated|Coordinated|Executed|Created|Implemented|Reviewed|Conducted|Defined|Authored|Translated|Aligned|Partnered|Worked|Used|Maintained|Trained|Documented|Monitored|Tested|Identified|Resolved|Migrated|Configured|Deployed|Integrated|Extracted|Produced|Generated|Presented|Prepared|Validated|Prioritized|Gathered|Tracked|Scheduled|Communicated|Launched|Scaled|Shipped|Released)\b/i,
]

// Profile evidence patterns — skills, tools, metrics, role claims.
const PROFILE_EVIDENCE_PATTERNS = [
  /^[A-Z][a-zA-Z0-9+#.\s]{1,30}$/, // Short tool/skill names: "SQL", "Jira", "UAT", "Python 3"
  /\d[\d,+]*(x|\+|%|k|M)\b/,         // Metrics: "4M+", "3,000+", "40%"
]

/**
 * Classifies a candidate content string into one of three buckets.
 *
 * @param content  The text to classify.
 * @param context  Optional context hint ('generation-rule' forces learning-signal;
 *                 'bullet' forces artifact-history).
 */
export function classifyContent(
  content: string,
  context?: 'generation-rule' | 'bullet' | 'skill-tool' | 'metric' | 'rejection-phrase'
): SignalClassification {
  if (context === 'generation-rule') return 'learning-signal'
  if (context === 'bullet') return 'artifact-history'
  if (context === 'skill-tool') return 'profile-evidence'
  if (context === 'metric') return 'profile-evidence'
  // Rejection phrases are learning signals — they constrain future generation.
  if (context === 'rejection-phrase') return 'learning-signal'

  const trimmed = content.trim()

  // Short strings that look like individual skills or tools
  if (PROFILE_EVIDENCE_PATTERNS[0].test(trimmed) && trimmed.split(/\s+/).length <= 4) {
    return 'profile-evidence'
  }

  // Metric values
  if (PROFILE_EVIDENCE_PATTERNS[1].test(trimmed) && trimmed.split(/\s+/).length <= 6) {
    return 'profile-evidence'
  }

  // Bullet-shaped text → artifact history
  if (RESUME_CONTENT_PATTERNS[0].test(trimmed)) {
    return 'artifact-history'
  }

  // "When X, Y" sentences at the start of a string are conditional generation rules,
  // not resume bullets (bullets never start with "When").
  if (/^when\b/i.test(trimmed)) {
    return 'learning-signal'
  }

  // Heuristic: content that describes what ResumeBuilder SHOULD do → learning signal.
  // Covers modal verbs, imperative generation directives, and scoped role instructions.
  if (/\b(should|must|do not|avoid|prefer|prioritize|preserve|guard|for .* roles?|next time|future (sessions?|generation)|instead of)\b/i.test(trimmed)) {
    return 'learning-signal'
  }

  // Default: treat as artifact-history to prevent false positives in the signal store.
  return 'artifact-history'
}

/**
 * Returns true if a LearningSignalType value is a raw-content type that should
 * no longer be stored in learningSignals. Used during migration and validation.
 */
export function isContentType(type: string): boolean {
  return type === 'accepted-bullet' || type === 'rejected-bullet' || type === 'approved-metric'
}
