import { db } from './db'
import type { CalibrationCandidate, CalibrationReference } from '@/contracts'

export async function saveCalibrationCandidates(candidates: CalibrationCandidate[]): Promise<void> {
  await db.calibrationCandidates.bulkPut(candidates)
}

export async function updateCalibrationCandidate(candidate: CalibrationCandidate): Promise<void> {
  await db.calibrationCandidates.put(candidate)
}

export async function getSessionCandidates(sessionId: string): Promise<CalibrationCandidate[]> {
  return db.calibrationCandidates.where('sessionId').equals(sessionId).toArray()
}

// Returns enrichedRef from every enriched candidate for a session.
export async function getEnrichedRefs(sessionId: string): Promise<CalibrationReference[]> {
  const candidates = await db.calibrationCandidates
    .where('sessionId').equals(sessionId)
    .filter(c => c.status === 'enriched' && c.enrichedRef != null)
    .toArray()
  return candidates.map(c => c.enrichedRef!)
}

export async function deleteSessionCandidates(sessionId: string): Promise<void> {
  await db.calibrationCandidates.where('sessionId').equals(sessionId).delete()
}
