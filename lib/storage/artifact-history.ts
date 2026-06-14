import { db } from './db'
import type { ArtifactHistoryKind, ArtifactHistoryRecord, SectionType, EmphasisCategory } from '@/contracts'
import { nanoid } from './nanoid'

export async function addArtifactHistory(
  record: Omit<ArtifactHistoryRecord, 'id' | 'createdAt'>
): Promise<ArtifactHistoryRecord> {
  const full: ArtifactHistoryRecord = {
    ...record,
    id: nanoid(),
    createdAt: new Date().toISOString(),
  }
  await db.artifactHistory.add(full)
  return full
}

export async function getSessionArtifactHistory(sessionId: string): Promise<ArtifactHistoryRecord[]> {
  return db.artifactHistory.where('sessionId').equals(sessionId).toArray()
}

export async function getArtifactHistoryByKind(kind: ArtifactHistoryKind, limit = 50): Promise<ArtifactHistoryRecord[]> {
  return db.artifactHistory.where('kind').equals(kind).limit(limit).toArray()
}

export async function getAllArtifactHistory(): Promise<ArtifactHistoryRecord[]> {
  return db.artifactHistory.orderBy('createdAt').reverse().toArray()
}

export async function deleteArtifactHistoryRecord(id: string): Promise<void> {
  await db.artifactHistory.delete(id)
}

// Returns accepted bullet texts for a given session (used by Stage 5 facts panel).
export async function getSessionAcceptedBullets(sessionId: string): Promise<string[]> {
  const records = await db.artifactHistory
    .where('sessionId').equals(sessionId)
    .filter(r => r.kind === 'accepted-bullet')
    .toArray()
  return records.map(r => r.content)
}

// Returns rejected bullet texts for a given role category (used for generation guidance).
export async function getRejectedBulletsForRole(
  roleCategory: EmphasisCategory,
  limit = 30
): Promise<string[]> {
  const records = await db.artifactHistory
    .where('kind').equals('rejected-bullet')
    .filter(r => r.roleCategory === roleCategory)
    .limit(limit)
    .toArray()
  return records.map(r => r.content)
}
