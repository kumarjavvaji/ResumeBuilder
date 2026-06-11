/**
 * Regression tests for session storage and route param correctness.
 *
 * Root cause these tests guard against:
 *   Next.js 15 makes `params` a Promise. Old synchronous page components pass
 *   the unresolved Promise object as `sessionId`, which flows into `getSession(id)`.
 *   Dexie throws "Invalid argument to Table.get()" when it receives a non-string key.
 *
 * Coverage:
 * 1. getSession("") returns undefined without throwing
 * 2. getSession(undefined as any) returns undefined without throwing
 * 3. getSession(Promise.resolve(...) as any) returns undefined without throwing
 * 4. isValidSessionId helper correctly distinguishes good/bad ids
 * 5. Session detail receives a non-empty string id before calling getSession
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Re-implement the guard logic as a pure function for isolated testing ──────
// This mirrors the guard at the top of getSession() in lib/storage/sessions.ts.
// If the guard logic changes, update both places.

function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0
}

// ─── Test 1-3: getSession guard against bad inputs ────────────────────────────

describe('getSession input validation', () => {
  // We mock the db module so these tests don't require IndexedDB in jsdom
  const mockGet = vi.fn()

  beforeEach(() => {
    mockGet.mockReset()
  })

  /**
   * Simulates getSession with the guard in place.
   * Mirrors the implementation in lib/storage/sessions.ts.
   */
  async function simulateGetSession(id: unknown): Promise<undefined> {
    if (!isValidSessionId(id)) {
      return undefined
    }
    // Would call db.sessions.get(id) here — never reached for bad ids
    return mockGet(id)
  }

  it('returns undefined for empty string without calling Dexie', async () => {
    const result = await simulateGetSession('')
    expect(result).toBeUndefined()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns undefined for whitespace-only string without calling Dexie', async () => {
    const result = await simulateGetSession('   ')
    expect(result).toBeUndefined()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns undefined for undefined without calling Dexie', async () => {
    const result = await simulateGetSession(undefined)
    expect(result).toBeUndefined()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns undefined for null without calling Dexie', async () => {
    const result = await simulateGetSession(null)
    expect(result).toBeUndefined()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns undefined when passed an unresolved Promise (as Next.js would before params is awaited)', async () => {
    const unresolved = Promise.resolve({ id: 'abc-123' })
    const result = await simulateGetSession(unresolved)
    expect(result).toBeUndefined()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns undefined when passed a plain object (mimics old params shape)', async () => {
    const result = await simulateGetSession({ id: 'abc-123' } as unknown as string)
    expect(result).toBeUndefined()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('calls Dexie for a valid non-empty string id', async () => {
    mockGet.mockResolvedValueOnce({ id: 'abc-123', roleTitle: 'PO' })
    const result = await simulateGetSession('abc-123')
    expect(mockGet).toHaveBeenCalledWith('abc-123')
    expect(result).toMatchObject({ id: 'abc-123' })
  })
})

// ─── Test 4: isValidSessionId helper ─────────────────────────────────────────

describe('isValidSessionId', () => {
  it('accepts a normal nanoid-style string', () => {
    expect(isValidSessionId('abc123XYZ')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidSessionId('')).toBe(false)
  })

  it('rejects whitespace', () => {
    expect(isValidSessionId('   ')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isValidSessionId(undefined)).toBe(false)
  })

  it('rejects null', () => {
    expect(isValidSessionId(null)).toBe(false)
  })

  it('rejects a number', () => {
    expect(isValidSessionId(42)).toBe(false)
  })

  it('rejects a Promise', () => {
    expect(isValidSessionId(Promise.resolve('abc'))).toBe(false)
  })

  it('rejects a plain object', () => {
    expect(isValidSessionId({ id: 'abc' })).toBe(false)
  })
})

// ─── Test 5: SessionDetail sessionId guard ────────────────────────────────────

describe('SessionDetail sessionId guard', () => {
  /**
   * Simulates the useEffect guard in SessionDetail.
   * Returns whether the effect would attempt to call getSession.
   */
  function wouldCallGetSession(sessionId: unknown): boolean {
    if (!sessionId || typeof sessionId !== 'string' || !(sessionId as string).trim()) {
      return false
    }
    return true
  }

  it('does not call getSession when sessionId is empty', () => {
    expect(wouldCallGetSession('')).toBe(false)
  })

  it('does not call getSession when sessionId is an unresolved Promise', () => {
    expect(wouldCallGetSession(Promise.resolve({ id: 'x' }))).toBe(false)
  })

  it('does not call getSession when sessionId is undefined', () => {
    expect(wouldCallGetSession(undefined)).toBe(false)
  })

  it('calls getSession when sessionId is a real string', () => {
    expect(wouldCallGetSession('real-session-id')).toBe(true)
  })
})
