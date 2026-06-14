/**
 * CRUD for versioned ProfileSnapshot records in IndexedDB.
 * Each intake produces a new version; prior versions are preserved.
 * profileId is always 'primary' (singleton user profile).
 */
import { db } from '@/lib/storage/db'
import type { ProfileSnapshot, ProfileSnapshotDimensions, ProfileSource, ClaimOverlap, ProfileConflict } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'

export const PRIMARY_PROFILE_ID = 'primary'

export async function getActiveSnapshot(): Promise<ProfileSnapshot | undefined> {
  return db.profileSnapshots
    .where('profileId')
    .equals(PRIMARY_PROFILE_ID)
    .and(s => s.isActive)
    .first()
}

export async function getAllSnapshots(): Promise<ProfileSnapshot[]> {
  return db.profileSnapshots
    .where('profileId')
    .equals(PRIMARY_PROFILE_ID)
    .sortBy('version')
}

export async function getSnapshotByVersion(version: number): Promise<ProfileSnapshot | undefined> {
  return db.profileSnapshots
    .where('[profileId+version]')
    .equals([PRIMARY_PROFILE_ID, version])
    .first()
}

export async function saveNewSnapshot(opts: {
  dimensions: ProfileSnapshotDimensions
  sourceIndex: ProfileSource[]
  overlapIndex: ClaimOverlap[]
  unresolvedConflicts: ProfileConflict[]
}): Promise<ProfileSnapshot> {
  const now = new Date().toISOString()

  // Deactivate all prior active snapshots
  await db.profileSnapshots
    .where('profileId')
    .equals(PRIMARY_PROFILE_ID)
    .and(s => s.isActive)
    .modify({ isActive: false })

  const snapshots = await db.profileSnapshots
    .where('profileId')
    .equals(PRIMARY_PROFILE_ID)
    .toArray()
  const nextVersion = snapshots.length > 0
    ? Math.max(...snapshots.map(s => s.version)) + 1
    : 1

  const snapshot: ProfileSnapshot = {
    profileId: PRIMARY_PROFILE_ID,
    version: nextVersion,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    dimensions: opts.dimensions,
    sourceIndex: opts.sourceIndex,
    overlapIndex: opts.overlapIndex,
    unresolvedConflicts: opts.unresolvedConflicts,
  }

  await db.profileSnapshots.put(snapshot)
  return snapshot
}

/** Returns true if any snapshot already has a source with the given contentHash. */
export async function isDuplicateUpload(contentHash: string): Promise<boolean> {
  const active = await getActiveSnapshot()
  if (!active) return false
  return active.sourceIndex.some(s => s.contentHash === contentHash)
}

/** Builds an empty snapshot (for first-time users). */
export function emptySnapshotDimensions(): ProfileSnapshotDimensions {
  return {
    identity: { fullName: '', email: '', phone: '', location: '', linkedIn: '' },
    experienceClaims: [],
    skills: [],
    domains: [],
    roles: [],
    metrics: [],
    tools: [],
    constraints: [],
    artifactHistory: [],
    refinementDirections: [],
    learningSignals: [],
  }
}
