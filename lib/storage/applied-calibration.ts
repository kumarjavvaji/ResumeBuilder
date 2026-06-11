import { db } from './db'
import type { CalibrationSynthesisRecord, AppliedCalibrationState } from '@/contracts'
import { nanoid } from './nanoid'

// ─── Synthesis record ─────────────────────────────────────────────────────────

/** Upsert by sessionId — one synthesis record per session (most recent). */
export async function saveCalibrationSynthesis(
  record: Omit<CalibrationSynthesisRecord, 'id'>
): Promise<CalibrationSynthesisRecord> {
  const existing = await db.calibrationSyntheses
    .where('sessionId').equals(record.sessionId)
    .first()
  const full: CalibrationSynthesisRecord = {
    ...record,
    id: existing?.id ?? nanoid()
  }
  await db.calibrationSyntheses.put(full)
  return full
}

export async function getCalibrationSynthesis(sessionId: string): Promise<CalibrationSynthesisRecord | undefined> {
  return db.calibrationSyntheses
    .where('sessionId').equals(sessionId)
    .first()
}

export async function deleteCalibrationSynthesis(sessionId: string): Promise<void> {
  await db.calibrationSyntheses.where('sessionId').equals(sessionId).delete()
}

// ─── Applied calibration state ────────────────────────────────────────────────

/** Upsert by sessionId — one applied state per session (most recent). */
export async function saveAppliedCalibrationState(
  state: AppliedCalibrationState
): Promise<void> {
  await db.appliedCalibrationStates.put(state)
}

export async function getAppliedCalibrationState(sessionId: string): Promise<AppliedCalibrationState | undefined> {
  // Most recent apply for this session
  const all = await db.appliedCalibrationStates
    .where('sessionId').equals(sessionId)
    .toArray()
  if (!all.length) return undefined
  return all.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))[0]
}

export async function markAppliedCalibrationStale(sessionId: string): Promise<void> {
  const existing = await getAppliedCalibrationState(sessionId)
  if (!existing) return
  await db.appliedCalibrationStates.update(existing.id, {
    calibrationUpdatedAfterApply: true,
    applyStatus: 'stale_after_refresh'
  })
}

export async function deleteAppliedCalibrationStates(sessionId: string): Promise<void> {
  await db.appliedCalibrationStates.where('sessionId').equals(sessionId).delete()
}
