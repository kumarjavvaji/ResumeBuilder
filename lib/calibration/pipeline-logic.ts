import type {
  CalibrationCandidate,
  CalibrationReference,
  CandidateStatus,
  CalibrationSourceType
} from '@/contracts'

// ─── Dedup ────────────────────────────────────────────────────────────────────

export function candidateKey(c: { sourceUrl?: string; title: string; company: string }): string {
  if (c.sourceUrl) return c.sourceUrl.toLowerCase().replace(/\/$/, '')
  return `${c.title.toLowerCase().trim()}@${c.company.toLowerCase().trim()}`
}

/** Mark incoming candidates as 'duplicate' if they conflict with existing candidates. */
export function dedupeCandidates(
  incoming: CalibrationCandidate[],
  existing: CalibrationCandidate[]
): CalibrationCandidate[] {
  const seen = new Set<string>()
  for (const e of existing) seen.add(candidateKey(e))

  return incoming.map(c => {
    const key = candidateKey(c)
    if (seen.has(key)) return { ...c, status: 'duplicate' as CandidateStatus }
    seen.add(key)
    return c
  })
}

// ─── Threshold helpers ────────────────────────────────────────────────────────

export function countByType(refs: CalibrationReference[]) {
  return {
    target: refs.filter(r => r.matchType === 'target_company').length,
    comparable: refs.filter(r => r.matchType !== 'target_company').length
  }
}

/** Minimum threshold for enabling "Apply to artifacts". */
export function isMinThresholdMet(refs: CalibrationReference[]): boolean {
  const { target, comparable } = countByType(refs)
  return target >= 3 || comparable >= 3
}

/** Full/ideal threshold: 5 target AND 5 comparable (per spec: "5+5 = full calibration"). */
export function isIdealThresholdMet(refs: CalibrationReference[]): boolean {
  const { target, comparable } = countByType(refs)
  return target >= 5 && comparable >= 5
}

// ─── Candidate → Reference (mechanical, no LLM) ───────────────────────────────

/** Resolve sourceType from URL or default. */
export function resolveSourceType(url?: string): CalibrationSourceType {
  if (!url) return 'search_result'
  const lower = url.toLowerCase()
  if (lower.includes('linkedin.com')) return 'public_profile'
  if (lower.includes('about.') || lower.includes('/about/') || lower.includes('/team/')) return 'company_page'
  return 'search_result'
}

/** Build a CalibrationReference from a candidate without an LLM call. */
export function mechanicalEnrichCandidate(
  candidate: CalibrationCandidate,
  sessionId?: string
): CalibrationReference {
  const isGated = isLikelyGatedUrl(candidate.sourceUrl)
  const confidence = isGated ? 'low' : candidate.initialConfidence
  const relevanceScore = confidence === 'high' ? 0.8 : confidence === 'medium' ? 0.6 : 0.35

  return {
    id: candidate.id,
    sessionId: sessionId ?? candidate.sessionId,
    sourceType: resolveSourceType(candidate.sourceUrl),
    title: candidate.title,
    company: candidate.company,
    sourceUrl: candidate.sourceUrl,
    snippetOrSummary: candidate.discoverySnippet,
    matchReason: candidate.roughMatchReason,
    matchType: candidate.candidateMatchType,
    relevanceScore,
    confidence,
    limitations: isGated
      ? 'Source page appears gated; public snippet used only.'
      : candidate.limitationsNote,
    collectedAt: new Date().toISOString()
  }
}

// ─── Gated URL detection ──────────────────────────────────────────────────────

const GATED_DOMAINS = [
  'linkedin.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'glassdoor.com'
]

export function isLikelyGatedUrl(url?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return GATED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/** Is a fetch response likely a login/captcha wall? */
export function isGatedContent(text: string): boolean {
  const lower = text.slice(0, 800).toLowerCase()
  return (
    lower.includes('sign in') ||
    lower.includes('log in') ||
    lower.includes('create account') ||
    lower.includes('join now') ||
    lower.includes('authwall')
  )
}

// ─── Enriched refs from candidates ───────────────────────────────────────────

export function getEnrichedRefsFromCandidates(
  candidates: CalibrationCandidate[]
): CalibrationReference[] {
  return candidates
    .filter(c => c.status === 'enriched' && c.enrichedRef != null)
    .map(c => c.enrichedRef!)
}

// ─── Queue processor (injectable enrichFn for testability) ───────────────────

export interface ProcessQueueOpts {
  signal: AbortSignal
  maxConcurrency?: number
  onCandidateUpdate?: (updated: CalibrationCandidate) => void
}

export async function processEnrichmentQueue(
  candidates: CalibrationCandidate[],
  enrichFn: (c: CalibrationCandidate) => Promise<CalibrationCandidate>,
  opts: ProcessQueueOpts
): Promise<CalibrationCandidate[]> {
  const { signal, maxConcurrency = 2, onCandidateUpdate } = opts
  const results: CalibrationCandidate[] = [...candidates]
  const queue = candidates
    .filter(c => c.status === 'queued')
    .map((c, i) => ({ c, idx: candidates.indexOf(c) >= 0 ? candidates.indexOf(c) : i }))

  async function processOne(item: { c: CalibrationCandidate; idx: number }) {
    if (signal.aborted) return

    const enriching: CalibrationCandidate = { ...item.c, status: 'enriching' }
    results[item.idx] = enriching
    onCandidateUpdate?.(enriching)

    try {
      const enriched = await enrichFn(item.c)
      results[item.idx] = enriched
      onCandidateUpdate?.(enriched)
    } catch (err) {
      const failed: CalibrationCandidate = {
        ...item.c,
        status: 'failed',
        failureReason: err instanceof Error ? err.message : 'Enrichment failed.'
      }
      results[item.idx] = failed
      onCandidateUpdate?.(failed)
    }
  }

  // Process in batches of maxConcurrency
  for (let i = 0; i < queue.length; i += maxConcurrency) {
    if (signal.aborted) break
    const batch = queue.slice(i, i + maxConcurrency)
    await Promise.all(batch.map(processOne))
  }

  return results
}
