import { db } from './db'
import type { Stage4RawResumeText, Stage4SectionRefinement } from '@/contracts'
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

/**
 * Updates the sections field of the raw resume record in-place.
 * Used exclusively by auto-repair to store the repaired text back into
 * sections.* without touching refinementOutput or refinementAccepted.
 * The refinement* fields must only be written by explicit user refinement flows.
 */
export async function updateStage4RawResumeTextSections(
  sessionId: string,
  sections: import('@/contracts').Stage4RawResumeSections,
): Promise<Stage4RawResumeText | undefined> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return undefined
  const updated: Stage4RawResumeText = {
    ...existing,
    sections,
    updatedAt: new Date().toISOString(),
  }
  await db.stage4RawResumeTexts.put(updated)
  return updated
}

// ─── Full-resume refinement helpers ──────────────────────────────────────────

export async function saveStage4FullRefinement(
  sessionId: string,
  instruction: string,
  output: string
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  await db.stage4RawResumeTexts.update(existing.id, {
    refinementInstruction: instruction,
    refinementOutput: output,
    refinementAccepted: false,
    refinementRefinedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

export async function acceptStage4FullRefinement(sessionId: string): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  await db.stage4RawResumeTexts.update(existing.id, {
    refinementAccepted: true,
    updatedAt: new Date().toISOString(),
  })
}

export async function rejectStage4FullRefinement(sessionId: string): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  await db.stage4RawResumeTexts.update(existing.id, {
    refinementOutput: undefined,
    refinementInstruction: undefined,
    refinementAccepted: false,
    refinementRefinedAt: undefined,
    updatedAt: new Date().toISOString(),
  })
}

// ─── Per-section refinement helpers ──────────────────────────────────────────

export async function saveStage4SectionRefinement(
  sessionId: string,
  sectionKey: string,
  instruction: string,
  output: string
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const current = existing.sectionRefinements ?? {}
  const updated: Record<string, Stage4SectionRefinement> = {
    ...current,
    [sectionKey]: {
      instruction,
      output,
      accepted: false,
      generatedAt: new Date().toISOString(),
    },
  }
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionRefinements: updated,
    updatedAt: new Date().toISOString(),
  })
}

export async function acceptStage4SectionRefinement(
  sessionId: string,
  sectionKey: string
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const current = existing.sectionRefinements ?? {}
  if (!current[sectionKey]) return
  const updated = {
    ...current,
    [sectionKey]: { ...current[sectionKey], accepted: true },
  }
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionRefinements: updated,
    updatedAt: new Date().toISOString(),
  })
}

export async function rejectStage4SectionRefinement(
  sessionId: string,
  sectionKey: string
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const current = { ...(existing.sectionRefinements ?? {}) }
  delete current[sectionKey]
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionRefinements: current,
    updatedAt: new Date().toISOString(),
  })
}
