import { db } from './db'
import type { Stage4RawResumeText } from '@/contracts'
import { nanoid } from './nanoid'

export async function getStage4RawResumeText(sessionId: string): Promise<Stage4RawResumeText | undefined> {
  return db.stage4RawResumeTexts
    .where('sessionId').equals(sessionId)
    .first()
}

export async function saveStage4RawResumeText(
  raw: Omit<Stage4RawResumeText, 'id' | 'generatedAt' | 'updatedAt'>
): Promise<Stage4RawResumeText> {
  const now = new Date().toISOString()
  const existing = await getStage4RawResumeText(raw.sessionId)
  const full: Stage4RawResumeText = {
    ...raw,
    id: existing?.id ?? nanoid(),
    generatedAt: existing?.generatedAt ?? now,
    updatedAt: now
  }
  await db.stage4RawResumeTexts.put(full)
  return full
}

export async function updateStage4RawResumeText(
  id: string,
  updates: Partial<Pick<Stage4RawResumeText, 'status' | 'staleReasons' | 'warnings'>>
): Promise<void> {
  await db.stage4RawResumeTexts.update(id, {
    ...updates,
    updatedAt: new Date().toISOString()
  })
}

export async function deleteStage4RawResumeText(sessionId: string): Promise<void> {
  await db.stage4RawResumeTexts.where('sessionId').equals(sessionId).delete()
}
