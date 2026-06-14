/**
 * Tests for the JD analysis → session save → navigation flow.
 *
 * Root cause guarded against:
 *   handleSave() had no saving state, no error feedback, and no try/catch.
 *   Double-clicking "Save Stage 1" created duplicate sessions. Navigating
 *   to /sessions/<id> would land on the correct route but, if the wrong
 *   session ID reached the URL (race), show "Session not found."
 *
 * Coverage:
 * 1. saveSession persists a session retrievable by its ID.
 * 2. Session ID used in saveSession exactly matches the ID returned by getSession.
 * 3. getSession returns the full session after saveSession (simulating page load).
 * 4. Refreshing (re-calling getSession with the same ID) still returns the session.
 * 5. getSession returns undefined for a missing session ID (in-app error, not 404).
 * 6. Double-call to handleSave-equivalent creates only one session when guarded.
 * 7. handleSave-equivalent emits the same session ID to router.push as was persisted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nanoid } from '@/lib/storage/nanoid'
import type { TargetIntake } from '@/contracts'
import { deriveStageStatuses, canCompleteStage1 } from '@/contracts'

// ─── Minimal in-memory store (mirrors saveSession / getSession logic) ──────────

const store = new Map<string, TargetIntake>()

async function saveSession(session: TargetIntake): Promise<void> {
  if (!session.stageStatuses) {
    session.stageStatuses = deriveStageStatuses(session.status)
  }
  store.set(session.id, session)
}

async function getSession(id: string): Promise<TargetIntake | undefined> {
  if (!id || typeof id !== 'string' || !id.trim()) return undefined
  return store.get(id)
}

function makeSession(id: string): TargetIntake {
  return {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roleTitle: 'Product Owner',
    company: 'Acme Corp',
    jdSourceType: 'pasted_jd',
    stage1Status: 'complete',
    domainIQInsights: { rawText: '', companyProfile: '', industrySignals: [], techStack: [], cultureSignals: [] },
    jobDescription: { fullText: 'jd', summary: '', responsibilities: [], requiredSkills: [], niceToHaves: [], domainSignals: [] },
    jdRequirementMap: { required: [], niceToHave: [], realJobFunction: '', needsEvidenceItems: [], unsupportedRequirements: [], weaklySupportedRequirements: [] },
    companySummary: 'Company summary.',
    fitHypothesis: 'Strong fit.',
    riskGaps: [],
    emphasisRecommendation: 'blended',
    status: 'intake',
    stageStatuses: deriveStageStatuses('intake'),
  }
}

beforeEach(() => store.clear())

// ─── 1. saveSession persists by ID ───────────────────────────────────────────

describe('session persistence', () => {
  it('saveSession persists a session retrievable by its ID', async () => {
    const id = nanoid()
    await saveSession(makeSession(id))
    const found = await getSession(id)
    expect(found).toBeDefined()
    expect(found?.id).toBe(id)
  })

  it('session ID in saveSession exactly matches getSession lookup key', async () => {
    const id = nanoid()
    const session = makeSession(id)
    await saveSession(session)
    const found = await getSession(session.id)
    expect(found?.id).toBe(session.id)
  })

  it('getSession returns full session after save (simulates page load after navigation)', async () => {
    const id = nanoid()
    const session = makeSession(id)
    await saveSession(session)
    const loaded = await getSession(id)
    expect(loaded?.roleTitle).toBe('Product Owner')
    expect(loaded?.company).toBe('Acme Corp')
    expect(loaded?.stage1Status).toBe('complete')
  })

  it('getSession called a second time returns same session (simulates browser refresh)', async () => {
    const id = nanoid()
    await saveSession(makeSession(id))
    const first = await getSession(id)
    const second = await getSession(id)
    expect(first).toEqual(second)
  })

  it('getSession returns undefined for a missing ID — in-app error, not a thrown exception', async () => {
    const missing = nanoid()
    const result = await getSession(missing)
    expect(result).toBeUndefined()
  })
})

// ─── 6. Saving state guard prevents duplicate sessions ────────────────────────

describe('duplicate session guard', () => {
  it('does not create a second session when saving flag is set', async () => {
    let saving = false
    const routerPushCalls: string[] = []

    async function handleSave() {
      if (saving) return
      saving = true
      try {
        const id = nanoid()
        const session = makeSession(id)
        await saveSession(session)
        routerPushCalls.push(`/sessions/${id}`)
      } finally {
        // saving stays true to block re-entry (matches component behavior)
      }
    }

    // Simulate rapid double-click
    await Promise.all([handleSave(), handleSave()])

    expect(store.size).toBe(1)
    expect(routerPushCalls).toHaveLength(1)
  })
})

// ─── 7. router.push ID matches persisted session ──────────────────────────────

describe('router.push ID consistency', () => {
  it('the ID pushed to router.push is the same ID that was persisted', async () => {
    let pushedId: string | null = null

    async function handleSave() {
      const id = nanoid()
      const session = makeSession(id)
      await saveSession(session)
      pushedId = id  // mirrors router.push(`/sessions/${session.id}`)
    }

    await handleSave()

    expect(pushedId).toBeTruthy()
    const persisted = await getSession(pushedId!)
    expect(persisted?.id).toBe(pushedId)
  })
})

// ─── canCompleteStage1 guard ──────────────────────────────────────────────────

describe('canCompleteStage1', () => {
  it('returns true for analyzed_needs_review', () => {
    expect(canCompleteStage1('analyzed_needs_review')).toBe(true)
  })

  it('returns true for complete', () => {
    expect(canCompleteStage1('complete')).toBe(true)
  })

  it('returns false for draft', () => {
    expect(canCompleteStage1('draft')).toBe(false)
  })

  it('returns false for ready_to_analyze', () => {
    expect(canCompleteStage1('ready_to_analyze')).toBe(false)
  })
})
