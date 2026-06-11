import { db } from './db'
import type { BridgeQuestion } from '@/contracts'
import { nanoid } from './nanoid'

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
