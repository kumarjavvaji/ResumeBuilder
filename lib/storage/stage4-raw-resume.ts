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
  sectionBlocks?: import('@/contracts').Stage4Section[],
): Promise<Stage4RawResumeText | undefined> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return undefined
  const updated: Stage4RawResumeText = {
    ...existing,
    sections,
    ...(sectionBlocks !== undefined ? { sectionBlocks } : {}),
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

// ─── Section block (document spine) helpers ───────────────────────────────────

function patchSectionBlock<K extends keyof import('@/contracts').Stage4Section>(
  blocks: import('@/contracts').Stage4Section[],
  sectionId: string,
  patch: Pick<import('@/contracts').Stage4Section, K>,
): import('@/contracts').Stage4Section[] {
  return blocks.map(b => b.sectionId === sectionId ? { ...b, ...patch } : b)
}

/** Store an LLM-proposed revision for a section block, pending user accept/reject. */
export async function updateStage4SectionBlock(
  sessionId: string,
  sectionId: string,
  proposedText: string,
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const blocks = patchSectionBlock(existing.sectionBlocks ?? [], sectionId, {
    proposedText,
    status: 'proposed',
    lastRefinedAt: new Date().toISOString(),
  } as Pick<import('@/contracts').Stage4Section, 'proposedText' | 'status' | 'lastRefinedAt'>)
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionBlocks: blocks,
    updatedAt: new Date().toISOString(),
  })
}

/** Accept the pending proposal: promote proposedText → acceptedText. */
export async function acceptStage4SectionProposal(
  sessionId: string,
  sectionId: string,
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const block = (existing.sectionBlocks ?? []).find(b => b.sectionId === sectionId)
  if (!block?.proposedText) return
  const blocks = patchSectionBlock(existing.sectionBlocks!, sectionId, {
    acceptedText: block.proposedText,
    proposedText: undefined,
    status: 'accepted',
  } as Pick<import('@/contracts').Stage4Section, 'acceptedText' | 'proposedText' | 'status'>)
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionBlocks: blocks,
    updatedAt: new Date().toISOString(),
  })
}

/** Reject the pending proposal: discard proposedText, restore accepted state. */
export async function rejectStage4SectionProposal(
  sessionId: string,
  sectionId: string,
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const blocks = patchSectionBlock(existing.sectionBlocks ?? [], sectionId, {
    proposedText: undefined,
    status: 'accepted',
  } as Pick<import('@/contracts').Stage4Section, 'proposedText' | 'status'>)
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionBlocks: blocks,
    updatedAt: new Date().toISOString(),
  })
}

/** Apply a user's direct manual edit to a section block. */
export async function setStage4SectionManualEdit(
  sessionId: string,
  sectionId: string,
  text: string,
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const blocks = patchSectionBlock(existing.sectionBlocks ?? [], sectionId, {
    acceptedText: text,
    proposedText: undefined,
    status: 'manual',
  } as Pick<import('@/contracts').Stage4Section, 'acceptedText' | 'proposedText' | 'status'>)
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionBlocks: blocks,
    updatedAt: new Date().toISOString(),
  })
}

/** Persist a warning ID as ignored for a section block. */
export async function ignoreStage4SectionWarning(
  sessionId: string,
  sectionId: string,
  warningId: string,
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const block = (existing.sectionBlocks ?? []).find(b => b.sectionId === sectionId)
  if (!block) return
  const current = block.ignoredWarningIds ?? []
  if (current.includes(warningId)) return
  const blocks = patchSectionBlock(existing.sectionBlocks!, sectionId, {
    ignoredWarningIds: [...current, warningId],
  } as Pick<import('@/contracts').Stage4Section, 'ignoredWarningIds'>)
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionBlocks: blocks,
    updatedAt: new Date().toISOString(),
  })
}

/** Remove a warning from the ignored list for a section block. */
export async function unignoreStage4SectionWarning(
  sessionId: string,
  sectionId: string,
  warningId: string,
): Promise<void> {
  const existing = await getStage4RawResumeText(sessionId)
  if (!existing) return
  const block = (existing.sectionBlocks ?? []).find(b => b.sectionId === sectionId)
  if (!block) return
  const blocks = patchSectionBlock(existing.sectionBlocks!, sectionId, {
    ignoredWarningIds: (block.ignoredWarningIds ?? []).filter(id => id !== warningId),
  } as Pick<import('@/contracts').Stage4Section, 'ignoredWarningIds'>)
  await db.stage4RawResumeTexts.update(existing.id, {
    sectionBlocks: blocks,
    updatedAt: new Date().toISOString(),
  })
}
