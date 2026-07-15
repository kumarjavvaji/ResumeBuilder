import { db } from './db'
import type { BridgeQuestion } from '@/contracts'
import { nanoid } from './nanoid'

export interface BridgeQuestionProvenanceContext {
  sessionId: string
  stage1JobId: string
  jdHash: string
  activeRequirementIds: Set<string>
}

/** Returns true if the question is valid for the active session. Legacy questions (no stage1JobId) pass through. */
export function validateBridgeQuestionProvenance(
  q: BridgeQuestion,
  ctx: BridgeQuestionProvenanceContext,
): boolean {
  if (q.sessionId !== ctx.sessionId) return false
  // Legacy question without provenance — allow, but don't validate further
  if (!q.stage1JobId) return true
  if (q.stage1JobId !== ctx.stage1JobId) return false
  if (q.jdHash && q.jdHash !== ctx.jdHash) return false
  if (q.requirementIds && q.requirementIds.length > 0) {
    // Reject if all requirement IDs have been removed from the active map
    const allGone = q.requirementIds.every(id => !ctx.activeRequirementIds.has(id))
    if (allGone) return false
  }
  return true
}

export async function saveBridgeQuestions(
  questions: Omit<BridgeQuestion, 'id' | 'createdAt'>[]
): Promise<BridgeQuestion[]> {
  const now = new Date().toISOString()
  const full = questions.map(q => ({ ...q, id: nanoid(), createdAt: now }))
  await db.bridgeQuestions.bulkPut(full)
  return full
}

export async function updateBridgeQuestion(
  id: string,
  updates: Partial<Pick<BridgeQuestion, 'status' | 'userAnswer'>>
): Promise<void> {
  await db.bridgeQuestions.update(id, updates)
}

export async function getSessionBridgeQuestions(sessionId: string): Promise<BridgeQuestion[]> {
  return db.bridgeQuestions
    .where('sessionId').equals(sessionId)
    .sortBy('priority')
    .then(qs => {
      const order = { high: 0, medium: 1, low: 2 }
      return qs.sort((a, b) => order[a.priority] - order[b.priority])
    })
}

export async function getAnsweredQuestions(sessionId: string): Promise<BridgeQuestion[]> {
  return db.bridgeQuestions
    .where('sessionId').equals(sessionId)
    .and(q => q.status === 'answered')
    .toArray()
}

export async function getAllAnsweredQuestions(): Promise<BridgeQuestion[]> {
  return db.bridgeQuestions
    .where('status').equals('answered')
    .toArray()
}

/**
 * Deletes all non-answered bridge questions for a session.
 * Answered questions are preserved as profile evidence.
 * Call this when JD or Stage 1 analysis changes.
 */
export async function invalidateSessionBridgeQuestions(sessionId: string): Promise<void> {
  const stale = await db.bridgeQuestions
    .where('sessionId').equals(sessionId)
    .and(q => q.status !== 'answered')
    .primaryKeys()
  if (stale.length > 0) {
    await db.bridgeQuestions.bulkDelete(stale as string[])
  }
}
