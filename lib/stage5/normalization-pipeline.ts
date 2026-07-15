import type { RawLearningCandidate, NormalizedLearningBucket } from '@/contracts'
import type { Stage5MetaSignal, StageLearningStage } from './session-learning'

const STAGE_LABEL_MAP: Record<StageLearningStage, string> = {
  stage1: 'stage1',
  stage2: 'stage2',
  stage3a: 'stage3a',
  stage3b: 'stage3b',
  stage4: 'stage4',
}

/**
 * Maps Stage5MetaSignal type + scope to a proposed bucket for the classifier.
 * The LLM classifier makes the final call; this is a hint only.
 */
function proposedBucket(signal: Stage5MetaSignal): NormalizedLearningBucket {
  const { scope, type } = signal
  if (scope === 'global') return 'global_signal'
  if (scope === 'personal') {
    if (type === 'artifact_strategy' || type === 'role_scope_rule') return 'personal_signal'
    if (type === 'evidence_boundary') return 'personal_signal'
    if (type === 'artifact-strategy') return 'personal_signal'
    return 'personal_signal'
  }
  // 'both' — let LLM decide whether to split
  if (type === 'jd_alignment_strategy') return 'global_signal'
  if (type === 'calibration_pattern') return 'strategy_signal'
  if (type === 'role_scope_rule') return 'global_signal'
  if (type === 'evidence_boundary') return 'stage_learning'
  return 'stage_learning'
}

/**
 * Converts Stage5MetaSignal[] to RawLearningCandidate[] for the classifier.
 * Signals with scope 'both' are expanded into two candidates (one personal, one global).
 */
export function convertSignalsToRawCandidates(
  signals: Stage5MetaSignal[],
  sessionId: string,
  requirementIdsByStage?: Map<string, string[]>,
): RawLearningCandidate[] {
  const candidates: RawLearningCandidate[] = []

  for (const signal of signals) {
    const sourceArtifactIds = signal.sourceArtifactSectionIds ?? []
    const requirementIds = requirementIdsByStage?.get(signal.stage) ?? []

    if (signal.scope === 'both' && signal.globalContent) {
      // Expand into two candidates: personal (content) + global (globalContent)
      candidates.push({
        text: signal.content,
        sourceStage: STAGE_LABEL_MAP[signal.stage],
        sourceArtifactIds,
        requirementIds,
        sessionId,
        proposedBucket: 'personal_signal',
        tags: [signal.type, signal.scope],
      })
      candidates.push({
        text: signal.globalContent,
        sourceStage: STAGE_LABEL_MAP[signal.stage],
        sourceArtifactIds,
        requirementIds,
        sessionId,
        proposedBucket: 'global_signal',
        tags: [signal.type, 'global'],
      })
    } else {
      candidates.push({
        text: signal.scope === 'global' && signal.globalContent ? signal.globalContent : signal.content,
        sourceStage: STAGE_LABEL_MAP[signal.stage],
        sourceArtifactIds,
        requirementIds,
        sessionId,
        proposedBucket: proposedBucket(signal),
        tags: [signal.type, signal.scope],
      })
    }
  }

  // Dedupe by text to avoid sending near-identical candidates to the LLM
  const seen = new Set<string>()
  return candidates.filter(c => {
    const key = c.text.slice(0, 120).toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
