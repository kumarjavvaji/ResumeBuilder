import { db } from './db'
import type { CalibrationReference } from '@/contracts'

export async function saveCalibrationReferences(refs: CalibrationReference[]): Promise<void> {
  await db.calibrationReferences.bulkPut(refs)
}

export async function getSessionCalibrationRefs(sessionId: string): Promise<CalibrationReference[]> {
  return db.calibrationReferences.where('sessionId').equals(sessionId).toArray()
}

export async function deleteSessionCalibrationRefs(sessionId: string): Promise<void> {
  await db.calibrationReferences.where('sessionId').equals(sessionId).delete()
}

export async function upsertCalibrationReference(ref: CalibrationReference): Promise<void> {
  await db.calibrationReferences.put(ref)
}

export async function deleteCalibrationReference(id: string): Promise<void> {
  await db.calibrationReferences.delete(id)
}
