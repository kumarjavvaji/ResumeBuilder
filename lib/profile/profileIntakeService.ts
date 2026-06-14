/**
 * Client-side orchestration for profile intake.
 * Calls /api/profile-intake → normalizes → merges → saves new snapshot.
 * Returns ProfileDelta for UI display. Never replaces the existing UserProfile singleton.
 */
import type {
  ProfileDelta,
  ProfileSource,
  ProfileSnapshot,
  SnapshotRefinementDirection,
  SnapshotLearningSignal,
} from '@/contracts'
import { normalizeExtractedSignals } from './profileSignalNormalizer'
import { mergeDimensions } from './profileMergeService'
import {
  getActiveSnapshot,
  saveNewSnapshot,
  isDuplicateUpload,
  emptySnapshotDimensions,
  PRIMARY_PROFILE_ID,
} from './profileSnapshotStore'
import { nanoid } from '@/lib/storage/nanoid'

export interface IntakeFileResult {
  claims: import('./profileSignalNormalizer').RawExtractedClaim[]
  skills: import('./profileSignalNormalizer').RawExtractedSkill[]
  roles: import('./profileSignalNormalizer').RawExtractedRole[]
  metrics: import('./profileSignalNormalizer').RawExtractedMetric[]
  tools: import('./profileSignalNormalizer').RawExtractedTool[]
  domains: import('./profileSignalNormalizer').RawExtractedDomain[]
  contentHash: string
  filename: string
  warnings: string[]
}

export interface IntakeResult {
  snapshot: ProfileSnapshot
  delta: ProfileDelta
  warnings: string[]
  isDuplicate: boolean
}

/**
 * Main entry point called from the Stage 1 UI file upload handler.
 * Sends the file to /api/profile-intake for extraction, then merges locally.
 */
export async function processResumeUpload(file: File): Promise<IntakeResult> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/profile-intake', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? `Profile intake failed: ${response.status}`)
  }

  const result: IntakeFileResult = await response.json()

  // Check for duplicate upload before proceeding
  const duplicate = await isDuplicateUpload(result.contentHash)
  if (duplicate) {
    const active = (await getActiveSnapshot())!
    return {
      snapshot: active,
      delta: emptyDelta(active.version, active.version),
      warnings: [`This file was already processed (${result.filename}). No changes made.`],
      isDuplicate: true,
    }
  }

  return mergeIntakeResult(result)
}

async function mergeIntakeResult(result: IntakeFileResult): Promise<IntakeResult> {
  const now = new Date().toISOString()
  const sourceId = nanoid()

  const source: ProfileSource = {
    sourceId,
    sourceType: 'resume_upload',
    filename: result.filename,
    contentHash: result.contentHash,
    extractedAt: now,
  }

  // Normalize all extracted signals into typed objects with stable keys
  const normalized = normalizeExtractedSignals(
    {
      claims: result.claims,
      skills: result.skills,
      roles: result.roles,
      metrics: result.metrics,
      tools: result.tools,
      domains: result.domains,
      possibleConflicts: [],
    },
    sourceId,
    now
  )

  // Load existing snapshot or bootstrap empty dimensions
  const existing = await getActiveSnapshot()
  const existingDimensions = existing?.dimensions ?? emptySnapshotDimensions()
  const existingSourceIndex = existing?.sourceIndex ?? []
  const existingOverlapIndex = existing?.overlapIndex ?? []
  const existingConflicts = existing?.unresolvedConflicts ?? []

  // Preserve refinement directions and learning signals across intake
  const preservedDirections: SnapshotRefinementDirection[] = existingDimensions.refinementDirections
  const preservedLearningSignals: SnapshotLearningSignal[] = existingDimensions.learningSignals

  const mergeResult = mergeDimensions(
    existingDimensions,
    normalized,
    preservedDirections,
    preservedLearningSignals,
    now
  )

  const newSnapshot = await saveNewSnapshot({
    dimensions: mergeResult.dimensions,
    sourceIndex: [...existingSourceIndex, source],
    overlapIndex: [...existingOverlapIndex, ...mergeResult.overlaps],
    unresolvedConflicts: [...existingConflicts, ...mergeResult.conflicts],
  })

  const versionBefore = existing?.version ?? 0
  const delta: ProfileDelta = {
    ...mergeResult.delta,
    profileVersionBefore: versionBefore,
    profileVersionAfter: newSnapshot.version,
  }

  return {
    snapshot: newSnapshot,
    delta,
    warnings: result.warnings,
    isDuplicate: false,
  }
}

function emptyDelta(before: number, after: number): ProfileDelta {
  return {
    addedClaims: [],
    addedSkills: [],
    addedTools: [],
    addedMetrics: [],
    mergedClaims: [],
    linkedArtifacts: [],
    preservedDirections: [],
    preservedLearningSignals: [],
    unresolvedConflicts: [],
    profileVersionBefore: before,
    profileVersionAfter: after,
  }
}
