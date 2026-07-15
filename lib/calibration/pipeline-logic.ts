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

/** Minimum threshold for enabling "Apply to artifacts". Rejected refs do not count. */
export function isMinThresholdMet(refs: CalibrationReference[]): boolean {
  const active = refs.filter(r => r.calibrationGroup !== 'rejected')
  const { target, comparable } = countByType(active)
  return target >= 3 || comparable >= 3
}

/** Full/ideal threshold: 5 target AND 5 comparable. Rejected refs do not count. */
export function isIdealThresholdMet(refs: CalibrationReference[]): boolean {
  const active = refs.filter(r => r.calibrationGroup !== 'rejected')
  const { target, comparable } = countByType(active)
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
    collectedAt: new Date().toISOString(),
    // Mechanical enrichment has no JD context — treat as supporting pending LLM classification
    calibrationGroup: 'supporting' as const,
    sourceDepth: isGated ? 'shallow' as const : 'moderate' as const,
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

// ─── Ref deduplication ───────────────────────────────────────────────────────

/** Stable source key for a CalibrationReference — url takes priority, then name@company, then title@company. */
function refSourceKey(r: CalibrationReference): string {
  const url = r.sourceUrl ?? r.profileUrl
  if (url) return url.toLowerCase().replace(/\/$/, '')
  if (r.personName) return `${r.personName.toLowerCase().trim()}@${r.company.toLowerCase().trim()}`
  return `${r.title.toLowerCase().trim()}@${r.company.toLowerCase().trim()}`
}

const SOURCE_DEPTH_RANK: Record<NonNullable<CalibrationReference['sourceDepth']>, number> = {
  rich: 3, moderate: 2, shallow: 1,
}
const CALIB_GROUP_RANK: Record<NonNullable<CalibrationReference['calibrationGroup']>, number> = {
  primary: 4, supporting: 3, context_only: 2, rejected: 1,
}

/** Merge two refs that represent the same source, preserving richer data from each. */
function mergeCalibrationRefs(
  a: CalibrationReference,
  b: CalibrationReference
): CalibrationReference {
  const depthA = a.sourceDepth ? SOURCE_DEPTH_RANK[a.sourceDepth] : 0
  const depthB = b.sourceDepth ? SOURCE_DEPTH_RANK[b.sourceDepth] : 0
  const richer = depthA >= depthB ? a : b

  // Prefer whichever calibrationGroup is most specific.
  // 'supporting' is the mechanical enrichment default — an explicit LLM classification beats it.
  const groupRankA = a.calibrationGroup ? CALIB_GROUP_RANK[a.calibrationGroup] : 0
  const groupRankB = b.calibrationGroup ? CALIB_GROUP_RANK[b.calibrationGroup] : 0
  const calibrationGroup = (groupRankA >= groupRankB ? a : b).calibrationGroup

  const longer = <T>(x?: T[], y?: T[]) => ((x?.length ?? 0) >= (y?.length ?? 0) ? x : y)

  return {
    ...richer,
    id: a.id,  // keep first id — handlers use this id
    sessionId: a.sessionId,
    calibrationGroup,
    manualContext: (a.manualContext?.length ?? 0) >= (b.manualContext?.length ?? 0)
      ? a.manualContext
      : b.manualContext,
    manualContextUpdatedAt: a.manualContextUpdatedAt ?? b.manualContextUpdatedAt,
    referenceDepth:
      a.referenceDepth === 'manual_enriched' || b.referenceDepth === 'manual_enriched'
        ? 'manual_enriched'
        : a.referenceDepth ?? b.referenceDepth,
    enrichmentSource: a.enrichmentSource ?? b.enrichmentSource,
    useFor: longer(a.useFor, b.useFor),
    doNotUseFor: longer(a.doNotUseFor, b.doNotUseFor),
    jdAlignmentElements: longer(a.jdAlignmentElements, b.jdAlignmentElements),
    riskNote: a.riskNote ?? b.riskNote,
    rejectedReason: a.rejectedReason ?? b.rejectedReason,
    limitations: a.limitations ?? b.limitations,
  }
}

/**
 * Deduplicate a mixed list of CalibrationReferences coming from multiple sources
 * (enrichedRefs from candidates + userRefs from the refs store).
 *
 * Phase 1: merge by id — the main case where the same ref was written to both stores.
 * Phase 2: merge by source identity (url / name@company) across different ids —
 * guards against rare cases where the same real person ended up with two distinct ids.
 *
 * The first occurrence's id is kept so that handleRemoveRef / handleUpdateRef still
 * target the correct record.
 */
export function dedupeRefs(refs: CalibrationReference[]): CalibrationReference[] {
  // Phase 1: merge by id
  const byId = new Map<string, CalibrationReference>()
  for (const r of refs) {
    const existing = byId.get(r.id)
    byId.set(r.id, existing ? mergeCalibrationRefs(existing, r) : r)
  }

  // Phase 2: merge by source key across different ids
  const bySourceKey = new Map<string, CalibrationReference>()
  for (const r of byId.values()) {
    const key = refSourceKey(r)
    const existing = bySourceKey.get(key)
    if (existing) {
      // Same source, different ids — merge, keep first id
      bySourceKey.set(key, mergeCalibrationRefs(existing, r))
    } else {
      bySourceKey.set(key, r)
    }
  }

  return Array.from(bySourceKey.values())
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
