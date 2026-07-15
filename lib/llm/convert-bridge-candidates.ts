import type { BridgeQuestion, BridgeEvidenceStatus, Stage2QuestionCandidate } from '@/contracts'

const CLASSIFICATION_TO_EVIDENCE: Record<string, BridgeEvidenceStatus> = {
  weakly_supported: 'weak',
  true_gap: 'gap',
}

/**
 * Converts Stage 1 Pass F candidates to BridgeQuestions with full provenance.
 * Pure function — no Anthropic client, safe to import in client components.
 */
export function convertCandidatesToBridgeQuestions(
  candidates: Stage2QuestionCandidate[],
  sessionId: string,
  stage1JobId: string,
  jdHash: string,
): Omit<BridgeQuestion, 'id' | 'createdAt'>[] {
  return candidates.map(c => ({
    sessionId,
    stage1JobId,
    jdHash,
    requirementIds: [c.requirementId].filter(Boolean),
    evidenceStatus: c.evidenceStatus ?? (CLASSIFICATION_TO_EVIDENCE[c.currentClassification] ?? 'gap'),
    requirementLabel: c.requirement.slice(0, 120),
    whyAsking: c.whyEvidenceIsMissing,
    question: c.question,
    type: classifyQuestionType(c),
    priority: c.priority,
    affectedArtifactSection: c.affectedSection,
    status: 'pending' as const,
  }))
}

function classifyQuestionType(c: Stage2QuestionCandidate): BridgeQuestion['type'] {
  if (c.evidenceStatus === 'gap') return 'gap'
  const why = c.whyEvidenceIsMissing.toLowerCase()
  if (why.includes('metric') || why.includes('quantif')) return 'metric'
  if (why.includes('domain') || why.includes('translat')) return 'domain-translation'
  return 'evidence'
}
