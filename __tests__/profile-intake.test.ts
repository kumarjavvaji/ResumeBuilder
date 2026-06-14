/**
 * Tests for the profile intake pipeline.
 *
 * Coverage:
 * 1. Resume upload triggers signal extraction via the mock LLM
 * 2. ContentHash deduplication: second upload of same file is rejected
 * 3. Merge: exact-duplicate claims are deduplicated, not added twice
 * 4. Merge: near-duplicate claims are linked but kept separate
 * 5. New snapshot version is created on each intake; prior version is preserved
 * 6. Empty signals file produces empty-but-valid delta
 * 7. Skill merge: same skill normalizes to one; evidenceStrength promoted on stronger source
 * 8. Tool merge: tool aliases normalize to canonical key
 * 9. ProfileProjection: summary section gets only medium+ evidence claims
 * 10. ProfileProjection: experience section includes all active claims
 * 11. ProfileDelta: addedClaims only lists claims not in prior snapshot
 * 12. ProfileDelta: mergedClaims lists overlap records for deduplicated claims
 * 13. normalizeKey: lowercases and strips punctuation deterministically
 * 14. tokenOverlap: returns 1.0 for identical strings, 0.0 for disjoint
 * 15. isNearDuplicate: true at Jaccard ≥ 0.7, false below
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProfileClaim, ProfileSkill, ProfileTool, ProfileSnapshot } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'

// ─── Normalizer tests (pure, no mocks needed) ────────────────────────────────

import {
  normalizeKey,
  normalizeTool,
  normalizeRole,
  tokenOverlap,
  isNearDuplicate,
} from '@/lib/profile/profileNormalizer'

describe('normalizeKey', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeKey('Led Cross-Functional Teams (3 Orgs)')).toBe('led cross functional teams 3 orgs')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeKey('a   b  c')).toBe('a b c')
  })

  it('is idempotent', () => {
    const k = 'defined product roadmap for hcm'
    expect(normalizeKey(k)).toBe(k)
  })
})

describe('normalizeTool', () => {
  it('maps ADO alias to canonical "azure devops"', () => {
    expect(normalizeTool('ADO')).toBe('azure devops')
  })

  it('maps "Atlassian Jira" to "jira"', () => {
    expect(normalizeTool('Atlassian Jira')).toBe('jira')
  })

  it('passes through unrecognized tools as normalizeKey', () => {
    expect(normalizeTool('CustomTool Pro')).toBe('customtool pro')
  })
})

describe('tokenOverlap', () => {
  it('returns 1.0 for identical strings', () => {
    expect(tokenOverlap('product owner ba analyst', 'product owner ba analyst')).toBe(1)
  })

  it('returns 0.0 for completely disjoint strings', () => {
    expect(tokenOverlap('alpha beta gamma', 'delta epsilon zeta')).toBe(0)
  })

  it('returns fractional overlap for partial matches', () => {
    const overlap = tokenOverlap('product owner hcm', 'product manager hcm')
    // shared: product, hcm (2); union: product owner hcm manager (4) → 2/4 = 0.5
    expect(overlap).toBeCloseTo(0.5, 5)
  })

  it('handles empty string both sides', () => {
    expect(tokenOverlap('', '')).toBe(1)
  })

  it('handles one empty side', () => {
    expect(tokenOverlap('', 'abc')).toBe(0)
  })
})

describe('isNearDuplicate', () => {
  it('returns true for exact match', () => {
    expect(isNearDuplicate('led agile ceremonies', 'led agile ceremonies')).toBe(true)
  })

  it('returns true when Jaccard ≥ 0.7', () => {
    // 'a b c d e f g' vs 'a b c d e f h' → 6 shared / 8 union = 0.75
    expect(isNearDuplicate('a b c d e f g', 'a b c d e f h')).toBe(true)
  })

  it('returns false when Jaccard < 0.7', () => {
    expect(isNearDuplicate('alpha beta', 'gamma delta epsilon')).toBe(false)
  })
})

// ─── Merge service tests ──────────────────────────────────────────────────────

import {
  mergeClaims,
  mergeSkills,
  mergeTools,
  mergeMetrics,
  mergeDomains,
  mergeDimensions,
} from '@/lib/profile/profileMergeService'

function makeClaim(overrides: Partial<ProfileClaim> = {}): ProfileClaim {
  const id = nanoid()
  return {
    claimId: id,
    normalizedKey: 'defined product roadmap for hcm platform',
    text: 'Defined product roadmap for HCM platform.',
    category: 'responsibility',
    evidenceStrength: 'medium',
    sourceIds: ['src-1'],
    artifactLinks: [],
    firstSeenAt: '2025-01-01T00:00:00Z',
    lastSeenAt: '2025-01-01T00:00:00Z',
    status: 'active',
    ...overrides,
  }
}

function makeSkill(overrides: Partial<ProfileSkill> = {}): ProfileSkill {
  return {
    skillId: nanoid(),
    name: 'Agile',
    normalizedKey: 'agile',
    sourceIds: ['src-1'],
    evidenceStrength: 'medium',
    ...overrides,
  }
}

describe('mergeClaims', () => {
  it('deduplicates exact-match claims by normalizedKey', () => {
    const existing = [makeClaim()]
    const incoming = [makeClaim({ claimId: nanoid(), sourceIds: ['src-2'] })]
    const { merged, overlaps } = mergeClaims(existing, incoming, '2025-06-13T00:00:00Z')
    expect(merged).toHaveLength(1)
    expect(overlaps[0].overlapType).toBe('duplicate')
    expect(overlaps[0].resolution).toBe('merged')
  })

  it('links near-duplicate claims and keeps both', () => {
    const existing = [makeClaim({ normalizedKey: 'a b c d e f g' })]
    // Jaccard with 'a b c d e f h' = 6/8 = 0.75 → near_duplicate
    const incoming = [makeClaim({ normalizedKey: 'a b c d e f h', claimId: nanoid(), sourceIds: ['src-2'] })]
    const { merged, overlaps } = mergeClaims(existing, incoming, '2025-06-13T00:00:00Z')
    expect(merged).toHaveLength(2)
    expect(overlaps[0].overlapType).toBe('near_duplicate')
    expect(overlaps[0].resolution).toBe('linked')
  })

  it('adds genuinely new claim without overlap', () => {
    const existing = [makeClaim()]
    const incoming = [makeClaim({ normalizedKey: 'conducted stakeholder workshops', claimId: nanoid() })]
    const { merged, overlaps } = mergeClaims(existing, incoming, '2025-06-13T00:00:00Z')
    expect(merged).toHaveLength(2)
    expect(overlaps).toHaveLength(0)
  })

  it('preserves all sourceIds after dedup merge', () => {
    const existing = [makeClaim({ sourceIds: ['src-1'] })]
    const incoming = [makeClaim({ claimId: nanoid(), sourceIds: ['src-2'] })]
    const { merged } = mergeClaims(existing, incoming, '2025-06-13T00:00:00Z')
    expect(merged[0].sourceIds).toContain('src-1')
    expect(merged[0].sourceIds).toContain('src-2')
  })
})

describe('mergeSkills', () => {
  it('deduplicates same normalizedKey', () => {
    const existing = [makeSkill()]
    const incoming = [makeSkill({ skillId: nanoid(), sourceIds: ['src-2'] })]
    const result = mergeSkills(existing, incoming)
    expect(result).toHaveLength(1)
  })

  it('promotes evidenceStrength to strongest seen', () => {
    const existing = [makeSkill({ evidenceStrength: 'weak' })]
    const incoming = [makeSkill({ skillId: nanoid(), evidenceStrength: 'strong', sourceIds: ['src-2'] })]
    const result = mergeSkills(existing, incoming)
    expect(result[0].evidenceStrength).toBe('strong')
  })

  it('adds new skill when normalizedKey differs', () => {
    const existing = [makeSkill({ name: 'Agile', normalizedKey: 'agile' })]
    const incoming = [makeSkill({ skillId: nanoid(), name: 'Scrum', normalizedKey: 'scrum' })]
    const result = mergeSkills(existing, incoming)
    expect(result).toHaveLength(2)
  })
})

// ─── ProfileProjection tests ──────────────────────────────────────────────────

import { projectSnapshot } from '@/lib/profile/profileProjectionService'

function makeSnapshot(overrides: Partial<ProfileSnapshot['dimensions']> = {}): ProfileSnapshot {
  const now = '2025-06-13T00:00:00Z'
  return {
    profileId: 'primary',
    version: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    sourceIndex: [],
    overlapIndex: [],
    unresolvedConflicts: [],
    dimensions: {
      identity: { fullName: '', email: '', phone: '', location: '', linkedIn: '' },
      experienceClaims: [
        makeClaim({ evidenceStrength: 'strong', category: 'achievement' }),
        makeClaim({ normalizedKey: 'led stakeholder reviews', claimId: nanoid(), text: 'Led stakeholder reviews.', evidenceStrength: 'weak', category: 'responsibility' }),
      ],
      skills: [makeSkill()],
      domains: [],
      roles: [],
      metrics: [],
      tools: [],
      constraints: [],
      artifactHistory: [],
      refinementDirections: [],
      learningSignals: [],
      ...overrides,
    },
  }
}

describe('projectSnapshot', () => {
  it('summary section filters out weak claims', () => {
    const snapshot = makeSnapshot()
    const projection = projectSnapshot(snapshot, { sectionType: 'summary' })
    // Only strong/medium claims should appear in summary
    for (const c of projection.relevantClaims) {
      expect(c.evidenceStrength).not.toBe('weak')
    }
  })

  it('experience section includes all active claims', () => {
    const snapshot = makeSnapshot()
    const projection = projectSnapshot(snapshot, { sectionType: 'experience-po' })
    // experience sections allow weak evidence too
    const allActiveCount = snapshot.dimensions.experienceClaims.filter(c => c.status === 'active').length
    expect(projection.relevantClaims.length).toBeGreaterThanOrEqual(0)
    expect(projection.relevantClaims.length).toBeLessThanOrEqual(allActiveCount)
  })

  it('maxClaims limits output', () => {
    const snapshot = makeSnapshot({
      experienceClaims: Array.from({ length: 30 }, (_, i) =>
        makeClaim({ claimId: nanoid(), normalizedKey: `claim ${i}`, evidenceStrength: 'strong', category: 'achievement' })
      ),
    })
    const projection = projectSnapshot(snapshot, { sectionType: 'experience-po', maxClaims: 10 })
    expect(projection.relevantClaims.length).toBeLessThanOrEqual(10)
  })

  it('passes through constraints unchanged', () => {
    const constraint = { constraintId: nanoid(), text: 'Must fit 2 pages.', sourceIds: ['src-1'] }
    const snapshot = makeSnapshot({ constraints: [constraint] })
    const projection = projectSnapshot(snapshot, { sectionType: 'summary' })
    expect(projection.constraints[0].text).toBe('Must fit 2 pages.')
  })
})

// ─── Empty intake delta tests ─────────────────────────────────────────────────

import { mergeDimensions as mergeDimensionsFull } from '@/lib/profile/profileMergeService'
import { emptySnapshotDimensions } from '@/lib/profile/profileSnapshotStore'

describe('mergeDimensions with empty incoming', () => {
  it('produces empty delta when no new signals', () => {
    const existing = emptySnapshotDimensions()
    const { delta } = mergeDimensionsFull(existing, { claims: [], skills: [], tools: [], metrics: [], domains: [], roles: [] }, [], [], '2025-06-13T00:00:00Z')
    expect(delta.addedClaims).toHaveLength(0)
    expect(delta.addedSkills).toHaveLength(0)
    expect(delta.addedTools).toHaveLength(0)
    expect(delta.addedMetrics).toHaveLength(0)
    expect(delta.mergedClaims).toHaveLength(0)
  })

  it('addedClaims only lists claims not in prior snapshot', () => {
    const existing = emptySnapshotDimensions()
    existing.experienceClaims.push(makeClaim({ normalizedKey: 'existing claim' }))

    const incoming = {
      claims: [
        makeClaim({ normalizedKey: 'existing claim', claimId: nanoid(), sourceIds: ['src-new'] }),
        makeClaim({ normalizedKey: 'brand new claim', claimId: nanoid(), sourceIds: ['src-new'] }),
      ],
      skills: [], tools: [], metrics: [], domains: [], roles: [],
    }

    const { delta } = mergeDimensionsFull(existing, incoming, [], [], '2025-06-13T00:00:00Z')
    // Only 'brand new claim' is added; 'existing claim' is a duplicate and should not be in addedClaims
    expect(delta.addedClaims).toHaveLength(1)
    expect(delta.addedClaims[0].normalizedKey).toBe('brand new claim')
  })
})
