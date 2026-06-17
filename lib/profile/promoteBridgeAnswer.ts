/**
 * Promotes an answered bridge question into the active ProfileSnapshot as a
 * reusable ProfileClaim, so later sessions can recall it. Smallest viable path —
 * reuses existing merge/store services, no new persistence model or table.
 */
import type { BridgeQuestion, ProfileClaim, ProfileSource, ClaimCategory } from '@/contracts'
import { normalizeKey } from './profileNormalizer'
import { mergeClaims } from './profileMergeService'
import { getActiveSnapshot, saveNewSnapshot, emptySnapshotDimensions } from './profileSnapshotStore'
import { nanoid } from '@/lib/storage/nanoid'

const CATEGORY_BY_QUESTION_TYPE: Record<BridgeQuestion['type'], ClaimCategory> = {
  gap: 'achievement',
  evidence: 'achievement',
  metric: 'metric',
  'domain-translation': 'domain',
  emphasis: 'preference',
  'underused-experience': 'achievement',
}

export async function promoteBridgeAnswerToProfile(
  question: BridgeQuestion,
  answerText: string,
  sessionId: string
): Promise<void> {
  const text = answerText.trim()
  if (!text) return

  const now = new Date().toISOString()
  const sourceId = nanoid()
  const source: ProfileSource = {
    sourceId,
    sourceType: 'bridge_answer',
    sessionId,
    extractedAt: now,
    bridgeQuestionId: question.id,
    questionText: question.question,
    questionType: question.type,
    answerSnippet: text.length > 120 ? text.slice(0, 117) + '…' : text,
  }

  const claim: ProfileClaim = {
    claimId: nanoid(),
    normalizedKey: normalizeKey(text),
    text,
    category: CATEGORY_BY_QUESTION_TYPE[question.type] ?? 'achievement',
    evidenceStrength: 'medium',
    sourceIds: [sourceId],
    artifactLinks: [],
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'active',
  }

  const existing = await getActiveSnapshot()
  const existingDimensions = existing?.dimensions ?? emptySnapshotDimensions()
  const existingSourceIndex = existing?.sourceIndex ?? []
  const existingOverlapIndex = existing?.overlapIndex ?? []
  const existingConflicts = existing?.unresolvedConflicts ?? []

  const claimResult = mergeClaims(existingDimensions.experienceClaims, [claim], now)

  await saveNewSnapshot({
    dimensions: { ...existingDimensions, experienceClaims: claimResult.merged },
    sourceIndex: [...existingSourceIndex, source],
    overlapIndex: [...existingOverlapIndex, ...claimResult.overlaps],
    unresolvedConflicts: [...existingConflicts, ...claimResult.conflicts],
  })
}
