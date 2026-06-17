/**
 * Idempotent backfill: promotes any previously-answered bridge questions that
 * are not yet reflected in the active ProfileSnapshot. Safe to call on every
 * Profile page load — it checks for duplicates before writing anything.
 */
import { getAllAnsweredQuestions } from '@/lib/storage/bridge-questions'
import { getActiveSnapshot, saveNewSnapshot, emptySnapshotDimensions } from './profileSnapshotStore'
import { mergeClaims } from './profileMergeService'
import { normalizeKey } from './profileNormalizer'
import { nanoid } from '@/lib/storage/nanoid'
import type { BridgeQuestion, ProfileClaim, ProfileSource, ClaimCategory } from '@/contracts'

const CATEGORY_BY_QUESTION_TYPE: Record<BridgeQuestion['type'], ClaimCategory> = {
  gap: 'achievement',
  evidence: 'achievement',
  metric: 'metric',
  'domain-translation': 'domain',
  emphasis: 'preference',
  'underused-experience': 'achievement',
}

export async function backfillBridgeAnswersToProfile(): Promise<void> {
  const answered = await getAllAnsweredQuestions()
  if (answered.length === 0) return

  const snapshot = await getActiveSnapshot()
  const existingSourceIndex = snapshot?.sourceIndex ?? []

  // Build a set of already-promoted bridgeQuestionIds from the source index
  const promotedIds = new Set(
    existingSourceIndex
      .filter(s => s.sourceType === 'bridge_answer' && s.bridgeQuestionId)
      .map(s => s.bridgeQuestionId!)
  )

  const missing = answered.filter(
    q => q.userAnswer?.trim() && !promotedIds.has(q.id)
  )
  if (missing.length === 0) return

  const now = new Date().toISOString()
  const newSources: ProfileSource[] = []
  const newClaims: ProfileClaim[] = []

  for (const q of missing) {
    const text = q.userAnswer!.trim()
    const sourceId = nanoid()
    newSources.push({
      sourceId,
      sourceType: 'bridge_answer',
      sessionId: q.sessionId,
      extractedAt: q.createdAt ?? now,
      bridgeQuestionId: q.id,
      questionText: q.question,
      questionType: q.type,
      answerSnippet: text.length > 120 ? text.slice(0, 117) + '…' : text,
    })
    newClaims.push({
      claimId: nanoid(),
      normalizedKey: normalizeKey(text),
      text,
      category: CATEGORY_BY_QUESTION_TYPE[q.type] ?? 'achievement',
      evidenceStrength: 'medium',
      sourceIds: [sourceId],
      artifactLinks: [],
      firstSeenAt: now,
      lastSeenAt: now,
      status: 'active',
    })
  }

  const existingDimensions = snapshot?.dimensions ?? emptySnapshotDimensions()
  const existingOverlapIndex = snapshot?.overlapIndex ?? []
  const existingConflicts = snapshot?.unresolvedConflicts ?? []

  const claimResult = mergeClaims(existingDimensions.experienceClaims, newClaims, now)

  await saveNewSnapshot({
    dimensions: { ...existingDimensions, experienceClaims: claimResult.merged },
    sourceIndex: [...existingSourceIndex, ...newSources],
    overlapIndex: [...existingOverlapIndex, ...claimResult.overlaps],
    unresolvedConflicts: [...existingConflicts, ...claimResult.conflicts],
  })
}
