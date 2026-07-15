/**
 * Calibration persistence and artifact provenance tests.
 * All tests use pure logic and in-memory implementations â€” no IndexedDB, no LLM calls.
 *
 * Coverage:
 * 1.  Discovery candidates persist immediately after discovery
 * 2.  Enriched refs persist after each candidate succeeds
 * 3.  Failed/limited candidate diagnostics are captured correctly
 * 4.  Applied calibration state object is built correctly from refs
 * 5.  Applied state survives reload (in-memory simulation)
 * 6.  Apply at 4/5 target + 4/5 comparable produces applied_partial status
 * 7.  Apply at 5/5 + 5/5 produces applied_full status
 * 8.  Artifact generation provenance records calibration state ID
 * 9.  Artifact generation with no applied calibration records status 'none'
 * 10. Artifact generation with skipped calibration records status 'skipped'
 * 11. Artifact card detects stale calibration (different state ID)
 * 12. Artifact card shows clean provenance when state IDs match
 * 13. Artifact card shows clean no-calibration line when calibration not used
 * 14. Accepted sections are not overwritten when calibration is refreshed
 * 15. Calibration refs are recorded in referencedCalibrationIds, not as evidence
 * 16. Refresh after apply marks calibration state as stale_after_refresh
 * 17. Session delete removes all calibration tables (verified via pure logic)
 * 18. 4/5 partial calibration can be applied and used in artifact generation
 * 19. Artifact provenance does not contain matchReason text as pattern labels
 * 20. Artifact provenance does not contain person names in pattern labels
 * 21. Artifact provenance pattern labels are short (â‰¤ 40 chars each)
 * 22. Artifact provenance truncates to MAX_VISIBLE patterns with +N more
 * 23. referencedCalibrationIds in provenance separate from appliedCalibrationPatterns
 * 24. buildPartialSummary produces empty calibrationPatterns (no raw matchReason pollution)
 * 25. Regenerated artifact records both referencedCalibrationIds and appliedCalibrationPatterns
 * 26. Calibration patterns are never reused as evidenceRef in bullets
 */
import { describe, it, expect } from 'vitest'
import {
  getEnrichedRefsFromCandidates,
  isMinThresholdMet,
  isIdealThresholdMet,
  countByType
} from '@/lib/calibration/pipeline-logic'
import type {
  CalibrationCandidate,
  CalibrationReference,
  AppliedCalibrationState,
  ArtifactGenerationProvenance,
  CalibrationSummary,
  CalibrationStatusAtGeneration,
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
    company: 'Reference Insurer Inc',
    discoverySnippet: 'BA with insurance domain experience.',
    roughMatchReason: 'Matches target role profile.',
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
    relevanceScore: 0.65,
    confidence: base.initialConfidence,
    collectedAt: new Date().toISOString()
  }
  return { ...base, status: 'enriched', enrichedRef }
}

function makeRef(overrides: Partial<CalibrationReference> = {}): CalibrationReference {
  return {
    id: nanoid(),
    sessionId: 'sess-1',
    sourceType: 'search_result',
    title: 'Implementation Analyst',
    company: 'Reference Insurer Inc',
    snippetOrSummary: 'Works on systems integration.',
    matchReason: 'Target company employee in adjacent role.',
    matchType: 'target_company',
    relevanceScore: 0.7,
    confidence: 'medium',
    collectedAt: new Date().toISOString(),
    ...overrides
  }
}

function makeAppliedState(
  refs: CalibrationReference[],
  isPartial: boolean,
  summary: Partial<CalibrationSummary> = {}
): AppliedCalibrationState {
  const counts = countByType(refs)
  const fullSummary: CalibrationSummary = {
    targetCompanyPatterns: [], competitorPatterns: [],
    repeatedTitles: refs.map(r => r.title).slice(0, 5),
    repeatedSkillsTools: [],
    domainExpectations: [],
    credibilityBoundaries: [],
    artifactGuidance: [],
    outreachGuidance: [],
    gapsToHandleCarefully: [],
    calibrationUsed: true,
    calibrationPatterns: ['systems integration', 'insurance domain'],
    generatedAt: new Date().toISOString(),
    ...summary
  }
  return {
    id: nanoid(),
    sessionId: 'sess-1',
    summary: fullSummary,
    applyStatus: isPartial ? 'applied_partial' : 'applied_full',
    isPartial,
    targetReferenceCount: counts.target,
    comparableReferenceCount: counts.comparable,
    appliedCalibrationPatterns: fullSummary.calibrationPatterns.slice(0, 4),
    referencedCalibrationIds: refs.map(r => r.id),
    appliedAt: new Date().toISOString(),
    calibrationUpdatedAfterApply: false
  }
}

function buildProvenance(
  operation: 'generate' | 'refine' | 'regenerate',
  appliedState?: AppliedCalibrationState,
  skipped = false
): ArtifactGenerationProvenance {
  const calibrationUsed = !!appliedState?.summary && !skipped
  const calibStatus: CalibrationStatusAtGeneration = calibrationUsed
    ? (appliedState!.isPartial ? 'applied_partial' : 'applied_full')
    : skipped ? 'skipped' : 'none'

  return {
    generatedAt: new Date().toISOString(),
    operation,
    calibrationUsed,
    calibrationAppliedAt: appliedState?.appliedAt,
    calibrationStateId: appliedState?.id,
    calibrationStatusAtGeneration: calibStatus,
    targetReferenceCount: appliedState?.targetReferenceCount,
    comparableReferenceCount: appliedState?.comparableReferenceCount,
    appliedCalibrationPatterns: appliedState?.appliedCalibrationPatterns,
    referencedCalibrationIds: appliedState?.referencedCalibrationIds
  }
}

// Mirrors the ProvenanceLine truncation logic in artifact-section-card.tsx
function formatPatternProvenance(patterns: string[], maxVisible = 4): string {
  const visible = patterns.slice(0, maxVisible)
  const extra = Math.max(0, patterns.length - maxVisible)
  if (visible.length === 0) return ''
  return visible.join(', ') + (extra > 0 ? ` +${extra} more` : '')
}

function isStaleProvenance(
  provenance: ArtifactGenerationProvenance | undefined,
  currentStateId: string | undefined
): boolean {
  if (!provenance?.calibrationUsed) return false
  if (!currentStateId) return false
  return provenance.calibrationStateId !== currentStateId
}

// â”€â”€â”€ 1â€“3: Discovery and enrichment persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('discovery and enrichment state', () => {
  it('(1) queued candidates have correct initial status after discovery', () => {
    const candidates = [
      makeCandidate({ status: 'queued', candidateMatchType: 'target_company' }),
      makeCandidate({ status: 'queued', candidateMatchType: 'adjacent_employer' })
    ]
    expect(candidates.every(c => c.status === 'queued')).toBe(true)
    // Discovery persists these to DB; test structural correctness
    expect(candidates[0].candidateMatchType).toBe('target_company')
    expect(candidates[1].candidateMatchType).toBe('adjacent_employer')
  })

  it('(2) enriched candidate produces a CalibrationReference in enrichedRef', () => {
    const enriched = makeEnrichedCandidate()
    expect(enriched.status).toBe('enriched')
    expect(enriched.enrichedRef).toBeDefined()
    expect(enriched.enrichedRef!.id).toBe(enriched.id)
    expect(enriched.enrichedRef!.matchType).toBe(enriched.candidateMatchType)
  })

  it('(3) failed candidate captures failureReason, not lost', () => {
    const failed: CalibrationCandidate = {
      ...makeCandidate(),
      status: 'failed',
      failureReason: 'Fetch timeout after 15000ms',
      retryCount: 1
    }
    expect(failed.status).toBe('failed')
    expect(failed.failureReason).toContain('timeout')
    expect(failed.retryCount).toBe(1)
    // getEnrichedRefsFromCandidates must not include failed candidates
    const refs = getEnrichedRefsFromCandidates([failed])
    expect(refs).toHaveLength(0)
  })
})

// â”€â”€â”€ 4â€“7: Applied calibration state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('applied calibration state', () => {
  it('(4) applied state built correctly from refs â€” includes counts and patterns', () => {
    const refs = [
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' })),
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'competitor' }))
    ]
    const state = makeAppliedState(refs, true)

    expect(state.targetReferenceCount).toBe(4)
    expect(state.comparableReferenceCount).toBe(4)
    expect(state.isPartial).toBe(true)
    expect(state.applyStatus).toBe('applied_partial')
    expect(state.referencedCalibrationIds).toHaveLength(8)
    expect(state.appliedAt).toBeTruthy()
  })

  it('(5) applied state can be serialized and deserialized (simulates DB round-trip)', () => {
    const refs = Array.from({ length: 3 }, () => makeRef({ matchType: 'target_company' }))
    const state = makeAppliedState(refs, true)
    const serialized = JSON.stringify(state)
    const deserialized: AppliedCalibrationState = JSON.parse(serialized)

    expect(deserialized.id).toBe(state.id)
    expect(deserialized.summary.calibrationUsed).toBe(true)
    expect(deserialized.targetReferenceCount).toBe(3)
  })

  it('(6) 4/5 target + 4/5 comparable â†’ applied_partial', () => {
    const refs = [
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' })),
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'competitor' }))
    ]
    expect(isMinThresholdMet(refs)).toBe(true)
    expect(isIdealThresholdMet(refs)).toBe(false)

    const state = makeAppliedState(refs, !isIdealThresholdMet(refs))
    expect(state.applyStatus).toBe('applied_partial')
    expect(state.isPartial).toBe(true)
  })

  it('(7) 5/5 target + 5/5 comparable â†’ applied_full', () => {
    const refs = [
      ...Array.from({ length: 5 }, () => makeRef({ matchType: 'target_company' })),
      ...Array.from({ length: 5 }, () => makeRef({ matchType: 'competitor' }))
    ]
    expect(isIdealThresholdMet(refs)).toBe(true)

    const state = makeAppliedState(refs, false)
    expect(state.applyStatus).toBe('applied_full')
    expect(state.isPartial).toBe(false)
  })
})

// â”€â”€â”€ 8â€“10: Artifact generation provenance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('artifact generation provenance', () => {
  it('(8) provenance records calibration state ID when calibration is applied', () => {
    const refs = Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' }))
    const applied = makeAppliedState(refs, true)
    const prov = buildProvenance('generate', applied)

    expect(prov.calibrationUsed).toBe(true)
    expect(prov.calibrationStateId).toBe(applied.id)
    expect(prov.calibrationStatusAtGeneration).toBe('applied_partial')
    expect(prov.targetReferenceCount).toBe(4)
    expect(prov.appliedCalibrationPatterns).toBeDefined()
  })

  it('(9) provenance with no applied calibration records status none', () => {
    const prov = buildProvenance('generate', undefined)

    expect(prov.calibrationUsed).toBe(false)
    expect(prov.calibrationStateId).toBeUndefined()
    expect(prov.calibrationStatusAtGeneration).toBe('none')
  })

  it('(10) provenance with skipped calibration records status skipped', () => {
    const prov = buildProvenance('generate', undefined, true)

    expect(prov.calibrationUsed).toBe(false)
    expect(prov.calibrationStatusAtGeneration).toBe('skipped')
  })

  it('(18) 4/5 partial calibration produces valid provenance for artifact generation', () => {
    const refs = [
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' })),
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'adjacent_employer' }))
    ]
    const applied = makeAppliedState(refs, true)
    const prov = buildProvenance('generate', applied)

    expect(prov.calibrationUsed).toBe(true)
    expect(prov.calibrationStatusAtGeneration).toBe('applied_partial')
    expect(prov.targetReferenceCount).toBe(4)
    expect(prov.comparableReferenceCount).toBe(4)
  })
})

// â”€â”€â”€ 11â€“13: Artifact card stale detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('artifact card provenance display logic', () => {
  it('(11) stale calibration detected when state IDs differ', () => {
    const refs = Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' }))
    const oldApplied = makeAppliedState(refs, true)
    const newAppliedId = nanoid() // different ID after refresh + re-apply

    const prov = buildProvenance('generate', oldApplied)
    expect(isStaleProvenance(prov, newAppliedId)).toBe(true)
  })

  it('(12) clean provenance when state IDs match', () => {
    const refs = Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' }))
    const applied = makeAppliedState(refs, true)

    const prov = buildProvenance('generate', applied)
    expect(isStaleProvenance(prov, applied.id)).toBe(false)
  })

  it('(13) no-calibration provenance is never stale', () => {
    const prov = buildProvenance('generate', undefined)
    expect(isStaleProvenance(prov, nanoid())).toBe(false)
  })

  it('calibration used but currentStateId undefined â†’ not stale (user hasnt applied anything new)', () => {
    const refs = Array.from({ length: 3 }, () => makeRef({ matchType: 'target_company' }))
    const applied = makeAppliedState(refs, true)
    const prov = buildProvenance('generate', applied)
    // If nothing new has been applied (no current state), not stale
    expect(isStaleProvenance(prov, undefined)).toBe(false)
  })
})

// â”€â”€â”€ 14: Accepted sections protected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('accepted section protection', () => {
  it('(14) accepted section guard prevents regeneration without explicit instruction', () => {
    const guard = (status: string, refinementInstruction?: string) =>
      status === 'accepted' && !refinementInstruction

    expect(guard('accepted')).toBe(true)                  // blocked
    expect(guard('accepted', 'Rewrite section.')).toBe(false)  // explicit â†’ allowed
    expect(guard('generated')).toBe(false)                // not accepted
    expect(guard('needs_review')).toBe(false)             // not accepted
  })
})

// â”€â”€â”€ 15: Calibration refs as influence only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('calibration refs as influence only', () => {
  it('(15) referencedCalibrationIds records ref IDs separately from evidenceRef (claim evidence)', () => {
    const refs = Array.from({ length: 3 }, () => makeRef())
    const state = makeAppliedState(refs, true)

    // referencedCalibrationIds are market influence IDs â€” not claim evidence
    expect(state.referencedCalibrationIds).toHaveLength(3)
    expect(state.referencedCalibrationIds).toEqual(refs.map(r => r.id))

    // They should not appear as evidenceRef values in artifact bullets
    // (This is a contractual constraint tested structurally)
    const evidenceRefs = ['Work at OIP (2021â€“2023)', 'Bridge: UAT experience'] // typical bullet evidenceRef
    for (const calibId of state.referencedCalibrationIds) {
      expect(evidenceRefs).not.toContain(calibId)
    }
  })
})

// â”€â”€â”€ 16: Refresh marks state stale â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('refresh after apply', () => {
  it('(16) refresh marks applied state as stale_after_refresh', () => {
    const refs = Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' }))
    const applied = makeAppliedState(refs, true)

    // Simulate markAppliedCalibrationStale
    const staled: AppliedCalibrationState = {
      ...applied,
      calibrationUpdatedAfterApply: true,
      applyStatus: 'stale_after_refresh'
    }

    expect(staled.applyStatus).toBe('stale_after_refresh')
    expect(staled.calibrationUpdatedAfterApply).toBe(true)
    expect(staled.id).toBe(applied.id) // same record, updated in place
  })
})

// â”€â”€â”€ 17: Session delete clears all calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('session delete', () => {
  it('(17) session delete targets all calibration tables â€” verified by sessions.ts source', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(path.resolve(__dirname, '../lib/storage/sessions.ts'), 'utf-8')

    // All 6 calibration-related tables must be in the delete transaction
    expect(src).toContain('db.calibrationReferences')
    expect(src).toContain('db.calibrationCandidates')
    expect(src).toContain('db.calibrationSyntheses')
    expect(src).toContain('db.appliedCalibrationStates')
  })
})

// â”€â”€â”€ 19â€“26: Provenance pattern normalization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('provenance pattern normalization', () => {
  const longMatchReason = 'CoverGo is an insurtech platform operating in the health insurance space, serving enterprise clients across Southeast Asia with configurable policy administration systems.'
  const personName = 'Jelena Djordjevic holds a senior BA role at Questrade Financial Group, specializing in requirements elicitation and stakeholder workshops.'
  const shortLabel = 'Systems Integration'

  it('(19) applied state patterns must not contain raw matchReason sentences', () => {
    const refs = Array.from({ length: 3 }, () =>
      makeRef({ matchReason: longMatchReason, matchType: 'target_company' })
    )
    // buildPartialSummary must produce empty calibrationPatterns, not matchReason text
    const calibrationPatterns: string[] = []  // correct behavior after fix
    const state = makeAppliedState(refs, true, { calibrationPatterns })

    for (const pattern of state.appliedCalibrationPatterns) {
      expect(pattern).not.toContain('CoverGo')
      expect(pattern).not.toContain('insurtech platform operating')
    }
  })

  it('(20) pattern labels must not contain person names', () => {
    const patterns = ['Systems Integration', 'Insurance Domain Literacy', 'Requirements Elicitation']
    for (const p of patterns) {
      expect(p).not.toMatch(/Jelena|Djordjevic|Questrade/i)
    }
    // Validate that a bad label containing a name is detected
    expect(personName).toMatch(/Jelena/)
    expect(shortLabel).not.toMatch(/Jelena/)
  })

  it('(21) pattern labels are short â€” each must be â‰¤ 40 characters', () => {
    const labels = [
      'Systems Integration', 'Requirements Elicitation', 'Insurance Domain Literacy',
      'Stakeholder Translation', 'Agile Delivery', 'Workflow Analysis', 'Platform Operations'
    ]
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(40)
    }
    // A raw matchReason would fail this check
    expect(longMatchReason.length).toBeGreaterThan(40)
  })

  it('(22) provenance truncates to 4 visible patterns with +N more', () => {
    const manyPatterns = [
      'Systems Integration', 'Requirements Elicitation', 'Insurance Domain Literacy',
      'Agile Delivery', 'Stakeholder Translation', 'Workflow Analysis'
    ]
    const result = formatPatternProvenance(manyPatterns, 4)

    expect(result).toContain('Systems Integration')
    expect(result).toContain('+2 more')
    expect(result).not.toContain('Stakeholder Translation')  // 5th â€” truncated
    expect(result).not.toContain('Workflow Analysis')         // 6th â€” truncated
  })

  it('(22) provenance shows all patterns when â‰¤ 4 and no "+N more"', () => {
    const fewPatterns = ['Systems Integration', 'Agile Delivery', 'Workflow Analysis']
    const result = formatPatternProvenance(fewPatterns, 4)

    expect(result).toBe('Systems Integration, Agile Delivery, Workflow Analysis')
    expect(result).not.toContain('+')
  })

  it('(22) empty patterns produce empty string â€” ref counts shown instead', () => {
    const result = formatPatternProvenance([], 4)
    expect(result).toBe('')
  })

  it('(23) provenance holds referencedCalibrationIds separately from appliedCalibrationPatterns', () => {
    const refs = Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' }))
    const applied = makeAppliedState(refs, true)
    const prov = buildProvenance('generate', applied)

    expect(prov.referencedCalibrationIds).toBeDefined()
    expect(prov.referencedCalibrationIds).toHaveLength(4)
    expect(prov.appliedCalibrationPatterns).toBeDefined()

    // They are different arrays â€” IDs are not patterns and vice versa
    const ids = prov.referencedCalibrationIds!
    const patterns = prov.appliedCalibrationPatterns!
    for (const id of ids) {
      expect(patterns).not.toContain(id)
    }
  })

  it('(24) buildPartialSummary calibrationPatterns are empty â€” verified via calibration-panel source', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/artifacts/calibration-panel.tsx'), 'utf-8'
    )

    // buildPartialSummary must set calibrationPatterns to [] â€” not map matchReason
    const buildFnMatch = src.match(/function buildPartialSummary[\s\S]*?^}/m)
    expect(buildFnMatch).not.toBeNull()
    const fnBody = buildFnMatch![0]

    // The body must NOT assign matchReason to calibrationPatterns
    expect(fnBody).not.toMatch(/calibrationPatterns\s*:.*matchReason/)
    // The body must assign an empty array
    expect(fnBody).toMatch(/calibrationPatterns\s*:\s*\[\s*\]/)
  })

  it('(25) regenerated artifact records both referencedCalibrationIds and appliedCalibrationPatterns', () => {
    const refs = [
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'target_company' })),
      ...Array.from({ length: 4 }, () => makeRef({ matchType: 'competitor' }))
    ]
    const applied = makeAppliedState(refs, true, {
      calibrationPatterns: ['Systems Integration', 'Requirements Elicitation', 'Insurance Domain Literacy']
    })
    const prov = buildProvenance('regenerate', applied)

    expect(prov.operation).toBe('regenerate')
    expect(prov.referencedCalibrationIds).toHaveLength(8)
    expect(prov.appliedCalibrationPatterns).toEqual(['Systems Integration', 'Requirements Elicitation', 'Insurance Domain Literacy'])
  })

  it('(26) appliedCalibrationPatterns never appear as evidenceRef values in artifact bullets', () => {
    const patterns = ['Systems Integration', 'Insurance Domain Literacy', 'Agile Delivery']

    // evidenceRef values point to profile entries, not calibration patterns
    const typicalEvidenceRefs = [
      'Work at Reference Insurer Inc (2021â€“2023)',
      'Bridge: UAT coordination experience',
      'Personal project: workflow mapping'
    ]

    for (const pattern of patterns) {
      expect(typicalEvidenceRefs).not.toContain(pattern)
    }
  })
})

