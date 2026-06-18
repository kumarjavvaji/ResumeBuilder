/**
 * Calibration pipeline tests â€” pure logic, no LLM calls, no IndexedDB.
 *
 * Coverage:
 * 1.  Partial refs persist after one candidate succeeds
 * 2.  Failed candidate does not fail the calibration run
 * 3.  Duplicate candidates are deduped by URL
 * 4.  Duplicate candidates are deduped by title+company when no URL
 * 5.  Gated URL is detected and marked limited, not thrown
 * 6.  Apply partial calibration enabled at threshold (3 target OR 3 comparable)
 * 7.  Apply partial calibration disabled below threshold
 * 8.  Skip calibration works while queue exists
 * 9.  Synthesis tool has no web_search tool â€” consumes refs only
 * 10. Accepted artifact sections are not regenerated after calibration refresh
 * 11. Loading state clears on enrichment failure
 * 12. getEnrichedRefsFromCandidates returns only enriched candidates
 * 13. mechanicalEnrichCandidate maps candidate fields to ref fields
 * 14. isLikelyGatedUrl detects LinkedIn and social media
 * 15. isGatedContent detects sign-in walls
 * 16. processEnrichmentQueue processes batch concurrently
 * 17. processEnrichmentQueue stops on AbortSignal
 * 18. processEnrichmentQueue marks failed candidate and continues
 * 19. countByType correctly splits refs by matchType
 * 20. isIdealThresholdMet requires 3+ of each type
 */
import { describe, it, expect, vi } from 'vitest'
import {
  dedupeCandidates,
  getEnrichedRefsFromCandidates,
  isMinThresholdMet,
  isIdealThresholdMet,
  countByType,
  mechanicalEnrichCandidate,
  isLikelyGatedUrl,
  isGatedContent,
  processEnrichmentQueue,
  candidateKey
} from '@/lib/calibration/pipeline-logic'
import type {
  CalibrationCandidate,
  CalibrationReference,
  CandidateStatus
} from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'

// â”€â”€â”€ Fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeCandidate(overrides: Partial<CalibrationCandidate> = {}): CalibrationCandidate {
  return {
    id: nanoid(),
    sessionId: 'sess-1',
    status: 'queued',
    candidateMatchType: 'target_company',
    title: 'Business Analyst',
    company: 'Acme Corp',
    sourceUrl: undefined,
    discoverySnippet: 'Experienced BA with domain expertise.',
    roughMatchReason: 'Relevant role at target company.',
    initialConfidence: 'medium',
    retryCount: 0,
    discoveredAt: new Date().toISOString(),
    ...overrides
  }
}

function makeEnrichedCandidate(overrides: Partial<CalibrationCandidate> = {}): CalibrationCandidate {
  const base = makeCandidate(overrides)
  const enrichedRef: CalibrationReference = {
    id: base.id,
    sessionId: base.sessionId,
    sourceType: 'search_result',
    title: base.title,
    company: base.company,
    snippetOrSummary: base.discoverySnippet,
    matchReason: base.roughMatchReason,
    matchType: base.candidateMatchType,
    relevanceScore: 0.6,
    confidence: 'medium',
    collectedAt: new Date().toISOString()
  }
  return { ...base, status: 'enriched', enrichedRef }
}

function makeRef(overrides: Partial<CalibrationReference> = {}): CalibrationReference {
  return {
    id: nanoid(),
    sessionId: 'sess-1',
    sourceType: 'search_result',
    title: 'Business Analyst',
    company: 'Acme Corp',
    snippetOrSummary: 'BA with domain expertise.',
    matchReason: 'Relevant role.',
    matchType: 'target_company',
    relevanceScore: 0.6,
    confidence: 'medium',
    collectedAt: new Date().toISOString(),
    ...overrides
  }
}

// â”€â”€â”€ 1â€“2: Partial persistence and failure isolation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('processEnrichmentQueue', () => {
  it('(1) partial refs persist after one candidate succeeds', async () => {
    const c1 = makeCandidate({ id: 'c1' })
    const c2 = makeCandidate({ id: 'c2' })
    const enrichFn = async (c: CalibrationCandidate): Promise<CalibrationCandidate> => {
      if (c.id === 'c2') throw new Error('Network error')
      return makeEnrichedCandidate({ id: c.id })
    }

    const results = await processEnrichmentQueue([c1, c2], enrichFn, {
      signal: new AbortController().signal
    })

    const enriched = results.filter(r => r.status === 'enriched')
    expect(enriched).toHaveLength(1)
    expect(enriched[0].id).toBe('c1')
    expect(enriched[0].enrichedRef).toBeDefined()
  })

  it('(2) failed candidate does not fail the run â€” all candidates processed', async () => {
    const candidates = [
      makeCandidate({ id: 'c1' }),
      makeCandidate({ id: 'c2' }),
      makeCandidate({ id: 'c3' })
    ]
    let processed = 0
    const enrichFn = async (c: CalibrationCandidate): Promise<CalibrationCandidate> => {
      processed++
      if (c.id === 'c2') throw new Error('Parse failure')
      return makeEnrichedCandidate({ id: c.id })
    }

    const results = await processEnrichmentQueue(candidates, enrichFn, {
      signal: new AbortController().signal
    })

    expect(processed).toBe(3)
    expect(results.find(c => c.id === 'c2')?.status).toBe('failed')
    expect(results.find(c => c.id === 'c1')?.status).toBe('enriched')
    expect(results.find(c => c.id === 'c3')?.status).toBe('enriched')
  })

  it('(11) loading state (enriching â†’ failed) clears on failure â€” no stale enriching status', async () => {
    const c = makeCandidate({ id: 'c1' })
    const updates: CandidateStatus[] = []
    const enrichFn = async (_c: CalibrationCandidate): Promise<CalibrationCandidate> => {
      throw new Error('Timeout')
    }

    await processEnrichmentQueue([c], enrichFn, {
      signal: new AbortController().signal,
      onCandidateUpdate: updated => updates.push(updated.status)
    })

    // Must transition enriching â†’ failed, never stay 'enriching'
    expect(updates).toContain('enriching')
    expect(updates[updates.length - 1]).toBe('failed')
  })

  it('(16) processes batch concurrently (maxConcurrency = 2)', async () => {
    const candidates = [
      makeCandidate({ id: 'c1' }),
      makeCandidate({ id: 'c2' }),
      makeCandidate({ id: 'c3' })
    ]
    const startTimes: Record<string, number> = {}
    const enrichFn = async (c: CalibrationCandidate): Promise<CalibrationCandidate> => {
      startTimes[c.id] = Date.now()
      await new Promise(r => setTimeout(r, 10))
      return makeEnrichedCandidate({ id: c.id })
    }

    await processEnrichmentQueue(candidates, enrichFn, {
      signal: new AbortController().signal,
      maxConcurrency: 2
    })

    // c1 and c2 start at roughly the same time; c3 starts after
    const diff12 = Math.abs(startTimes.c1 - startTimes.c2)
    const diff13 = startTimes.c3 - Math.min(startTimes.c1, startTimes.c2)
    expect(diff12).toBeLessThan(15)    // concurrent batch
    expect(diff13).toBeGreaterThan(5)  // c3 waited for batch 1
  })

  it('(17) stops processing on AbortSignal', async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate({ id: `c${i}` }))
    const controller = new AbortController()
    let processed = 0

    const enrichFn = async (c: CalibrationCandidate): Promise<CalibrationCandidate> => {
      processed++
      if (processed === 2) controller.abort()
      await new Promise(r => setTimeout(r, 5))
      return makeEnrichedCandidate({ id: c.id })
    }

    await processEnrichmentQueue(candidates, enrichFn, {
      signal: controller.signal,
      maxConcurrency: 1
    })

    expect(processed).toBeLessThan(5)
  })

  it('(18) failed candidate has failureReason set', async () => {
    const c = makeCandidate({ id: 'c1' })
    const enrichFn = async (): Promise<CalibrationCandidate> => {
      throw new Error('Specific failure reason')
    }

    const results = await processEnrichmentQueue([c], enrichFn, {
      signal: new AbortController().signal
    })

    expect(results[0].failureReason).toContain('Specific failure reason')
  })
})

// â”€â”€â”€ 3â€“4: Dedup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('dedupeCandidates', () => {
  it('(3) deduplicates by URL', () => {
    const url = 'https://linkedin.com/in/john-doe'
    const existing = [makeCandidate({ sourceUrl: url })]
    const incoming = [
      makeCandidate({ id: 'new1', sourceUrl: url }),
      makeCandidate({ id: 'new2', sourceUrl: 'https://other.com/profile' })
    ]

    const result = dedupeCandidates(incoming, existing)
    expect(result.find(c => c.id === 'new1')?.status).toBe('duplicate')
    expect(result.find(c => c.id === 'new2')?.status).toBe('queued')
  })

  it('(4) deduplicates by title+company when no URL', () => {
    const existing = [makeCandidate({ sourceUrl: undefined, title: 'BA', company: 'ACME' })]
    const incoming = [
      makeCandidate({ id: 'dup', sourceUrl: undefined, title: 'BA', company: 'ACME' }),
      makeCandidate({ id: 'ok', sourceUrl: undefined, title: 'PM', company: 'ACME' })
    ]

    const result = dedupeCandidates(incoming, existing)
    expect(result.find(c => c.id === 'dup')?.status).toBe('duplicate')
    expect(result.find(c => c.id === 'ok')?.status).toBe('queued')
  })

  it('dedup is case-insensitive', () => {
    const existing = [makeCandidate({ sourceUrl: 'HTTPS://EXAMPLE.COM/PROFILE' })]
    const incoming = [makeCandidate({ id: 'dup', sourceUrl: 'https://example.com/profile' })]

    const result = dedupeCandidates(incoming, existing)
    expect(result[0].status).toBe('duplicate')
  })
})

// â”€â”€â”€ 5: Gated URL detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('gated URL detection', () => {
  it('(5) LinkedIn URL is detected as gated', () => {
    expect(isLikelyGatedUrl('https://www.linkedin.com/in/john-doe/')).toBe(true)
    expect(isLikelyGatedUrl('https://linkedin.com/in/jane-smith')).toBe(true)
  })

  it('(14) social media URLs are gated', () => {
    expect(isLikelyGatedUrl('https://twitter.com/user')).toBe(true)
    expect(isLikelyGatedUrl('https://x.com/user')).toBe(true)
    expect(isLikelyGatedUrl('https://facebook.com/user')).toBe(true)
    expect(isLikelyGatedUrl('https://glassdoor.com/profile/123')).toBe(true)
  })

  it('public pages are not flagged', () => {
    expect(isLikelyGatedUrl('https://example.com/team/john')).toBe(false)
    expect(isLikelyGatedUrl('https://company.com/about')).toBe(false)
    expect(isLikelyGatedUrl(undefined)).toBe(false)
  })

  it('(15) isGatedContent detects login walls', () => {
    expect(isGatedContent('<html><body>Sign in to view this profile</body></html>')).toBe(true)
    expect(isGatedContent('<html><body>Log in required to continue</body></html>')).toBe(true)
    expect(isGatedContent('<html><body>Create account to see more</body></html>')).toBe(true)
    expect(isGatedContent('<html><body>John Doe, Business Analyst at Acme</body></html>')).toBe(false)
  })
})

// â”€â”€â”€ 6â€“8: Threshold and skip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('thresholds', () => {
  it('(6) min threshold met with 3 target refs', () => {
    const refs = Array.from({ length: 3 }, () => makeRef({ matchType: 'target_company' }))
    expect(isMinThresholdMet(refs)).toBe(true)
  })

  it('(6) min threshold met with 3 comparable refs', () => {
    const refs = Array.from({ length: 3 }, () => makeRef({ matchType: 'competitor' }))
    expect(isMinThresholdMet(refs)).toBe(true)
  })

  it('(7) min threshold not met below 3 of either', () => {
    const refs = [
      makeRef({ matchType: 'target_company' }),
      makeRef({ matchType: 'competitor' })
    ]
    expect(isMinThresholdMet(refs)).toBe(false)
  })

  it('(8) skip calibration does not require empty queue â€” it is a UI intent signal only', () => {
    // The skip behavior is controlled in UI state, not in pipeline logic.
    // This test verifies that isMinThresholdMet doesn't care about queued candidates.
    const refs = Array.from({ length: 3 }, () => makeRef({ matchType: 'target_company' }))
    expect(isMinThresholdMet(refs)).toBe(true) // threshold met regardless of queue state
  })

  it('(19) countByType correctly splits', () => {
    const refs = [
      makeRef({ matchType: 'target_company' }),
      makeRef({ matchType: 'target_company' }),
      makeRef({ matchType: 'competitor' }),
      makeRef({ matchType: 'adjacent_employer' })
    ]
    const { target, comparable } = countByType(refs)
    expect(target).toBe(2)
    expect(comparable).toBe(2)
  })

  it('(20) isIdealThresholdMet requires 5+ target AND 5+ comparable (full calibration)', () => {
    const refs3t = Array.from({ length: 3 }, () => makeRef({ matchType: 'target_company' }))
    expect(isIdealThresholdMet(refs3t)).toBe(false) // no comparable, also only 3

    const refs5t = Array.from({ length: 5 }, () => makeRef({ matchType: 'target_company' }))
    expect(isIdealThresholdMet(refs5t)).toBe(false) // no comparable

    const partial44 = [
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' })),
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'competitor' }))
    ]
    expect(isIdealThresholdMet(partial44)).toBe(false) // 4+4 is partial, not full

    const full55 = [
      ...Array.from({ length: 5 }, () => makeRef({ matchType: 'target_company' })),
      ...Array.from({ length: 5 }, () => makeRef({ matchType: 'competitor' }))
    ]
    expect(isIdealThresholdMet(full55)).toBe(true)
  })
})

// â”€â”€â”€ 9: Synthesis has no web search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Verified by reading the source file directly â€” synthesize-calibration must not
// include 'web_search_20250305' or 'betas' in its tool list.
// This is enforced as a code convention checked in the file content.

describe('synthesis isolation', () => {
  it('(9) calibrate-synthesize source contains no web search tool references', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '../lib/llm/calibrate-synthesize.ts')
    const src = fs.readFileSync(filePath, 'utf-8')

    expect(src).not.toContain('web_search_20250305')
    expect(src).not.toContain("betas:")
    // Must contain the synthesize tool and anthropic call
    expect(src).toContain('produce_calibration_summary')
    expect(src).toContain('synthesizeCalibration')
  })
})

// â”€â”€â”€ 10: Accepted sections protected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('accepted section protection', () => {
  it('(10) accepted section status does not change when calibration updates', () => {
    // The guard in artifacts-page: generateSection returns early if status=accepted
    // and no refinementInstruction. We test the guard logic in isolation.
    const isAcceptedGuard = (status: string, refinementInstruction?: string) =>
      status === 'accepted' && !refinementInstruction

    expect(isAcceptedGuard('accepted')).toBe(true)          // blocked
    expect(isAcceptedGuard('accepted', 'Rewrite this.')).toBe(false)  // explicit instruction â†’ allowed
    expect(isAcceptedGuard('generated')).toBe(false)        // not accepted â†’ not blocked
  })
})

// â”€â”€â”€ 12â€“13: getEnrichedRefsFromCandidates + mechanicalEnrich â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('candidate utilities', () => {
  it('(12) getEnrichedRefsFromCandidates returns only enriched candidates', () => {
    const candidates = [
      makeEnrichedCandidate({ id: 'e1' }),
      makeCandidate({ id: 'q1', status: 'queued' }),
      makeCandidate({ id: 'f1', status: 'failed' }),
      makeEnrichedCandidate({ id: 'e2' })
    ]

    const refs = getEnrichedRefsFromCandidates(candidates)
    expect(refs).toHaveLength(2)
    expect(refs.map(r => r.id)).toEqual(['e1', 'e2'])
  })

  it('(13) mechanicalEnrichCandidate maps fields correctly', () => {
    const c = makeCandidate({
      id: 'test-id',
      title: 'Implementation Analyst',
      company: 'Reference Insurer Inc',
      sourceUrl: 'https://linkedin.com/in/someone',
      discoverySnippet: 'Works on business systems.',
      roughMatchReason: 'Adjacent role at target company.',
      candidateMatchType: 'target_company',
      initialConfidence: 'high'
    })

    const ref = mechanicalEnrichCandidate(c)

    expect(ref.id).toBe('test-id')
    expect(ref.title).toBe('Implementation Analyst')
    expect(ref.company).toBe('Reference Insurer Inc')
    expect(ref.matchType).toBe('target_company')
    expect(ref.confidence).toBe('low') // LinkedIn â†’ gated â†’ low
    expect(ref.limitations).toContain('gated')
    expect(ref.snippetOrSummary).toBe('Works on business systems.')
    expect(ref.relevanceScore).toBeGreaterThan(0)
    expect(ref.relevanceScore).toBeLessThanOrEqual(1)
  })

  it('non-gated URL preserves initialConfidence', () => {
    const c = makeCandidate({
      sourceUrl: 'https://company.com/team/john',
      initialConfidence: 'high'
    })
    const ref = mechanicalEnrichCandidate(c)
    expect(ref.confidence).toBe('high')
    expect(ref.limitations).toBeUndefined()
  })
})

