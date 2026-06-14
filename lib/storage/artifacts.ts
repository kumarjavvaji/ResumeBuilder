import { db } from './db'
import type { ArtifactSection, ArtifactVersion, ResumeArtifact, SectionType } from '@/contracts'
import { nanoid } from './nanoid'

export async function saveArtifactSection(
  section: Omit<ArtifactSection, 'id' | 'createdAt' | 'updatedAt' | 'version'>
): Promise<ArtifactSection> {
  const now = new Date().toISOString()
  const existing = await db.artifactSections
    .where('sessionId').equals(section.sessionId)
    .and(s => s.type === section.type)
    .first()

  const full: ArtifactSection = {
    ...section,
    id: existing?.id ?? nanoid(),
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await db.artifactSections.put(full)
  return full
}

/**
 * Saves a refined artifact section, preserving the previous content in versions[].
 * The new ArtifactVersion is appended to the front of the list (newest-first).
 * Old artifacts without versions[] are treated as version 1 for backward compat.
 */
export async function saveRefinedArtifactSection(
  section: Omit<ArtifactSection, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
  newVersion: ArtifactVersion
): Promise<ArtifactSection> {
  const now = new Date().toISOString()
  const existing = await db.artifactSections
    .where('sessionId').equals(section.sessionId)
    .and(s => s.type === section.type)
    .first()

  // Preserve existing version history; add the new version entry
  const existingVersions: ArtifactVersion[] = existing?.versions ?? []
  const versions: ArtifactVersion[] = [newVersion, ...existingVersions]

  const full: ArtifactSection = {
    ...section,
    id: existing?.id ?? nanoid(),
    version: (existing?.version ?? 0) + 1,
    versions,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await db.artifactSections.put(full)
  return full
}

export async function getArtifactSection(
  sessionId: string,
  type: SectionType
): Promise<ArtifactSection | undefined> {
  return db.artifactSections
    .where('sessionId').equals(sessionId)
    .and(s => s.type === type)
    .first()
}

export async function getSessionSections(sessionId: string): Promise<ArtifactSection[]> {
  return db.artifactSections.where('sessionId').equals(sessionId).toArray()
}

export async function updateSectionStatus(
  id: string,
  status: ArtifactSection['status']
): Promise<void> {
  await db.artifactSections.update(id, { status, updatedAt: new Date().toISOString() })
}

/**
 * Accepts a section: stamps acceptedAt and sets status to 'accepted'.
 * Does NOT use saveArtifactSection so it doesn't increment version on a pure status change.
 */
export async function acceptSection(id: string): Promise<void> {
  await db.artifactSections.update(id, {
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
}

/** Saves a manual edit from the user without changing status. */
export async function saveManualEdit(
  id: string,
  content: string,
  userNote?: string
): Promise<void> {
  const existing = await db.artifactSections.get(id)
  if (!existing) return
  await db.artifactSections.update(id, {
    content,
    userNote,
    version: (existing.version ?? 0) + 1,
    updatedAt: new Date().toISOString()
  })
}

// Accepted sections must not be regenerated unless explicitly requested.
export async function getAcceptedSections(sessionId: string): Promise<ArtifactSection[]> {
  return db.artifactSections
    .where('sessionId').equals(sessionId)
    .and(s => s.status === 'accepted')
    .toArray()
}

/** Returns true if a section status counts as "accepted" for export purposes. */
export function isAccepted(section: ArtifactSection): boolean {
  return section.status === 'accepted'
}

/** Returns true if a section was rejected and should not appear in exports. */
export function isRejected(section: ArtifactSection): boolean {
  return section.status === 'rejected'
}
