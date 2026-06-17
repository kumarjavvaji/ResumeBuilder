import type { Stage1Finding, Stage1SourceTrace } from '@/contracts'

/**
 * Finds the Stage 1 findings relevant to a bridge-question topic so Stage 2 can render
 * "Why this question?" provenance without re-deriving or guessing at Stage 1 origins.
 * Pure lookup only — does not alter Stage 2 question generation.
 */
export function findRelevantStage1Findings(findings: Stage1Finding[], topicKeywords: string[]): Stage1Finding[] {
  const normalizedKeywords = topicKeywords.map(k => k.toLowerCase().trim()).filter(Boolean)
  if (!normalizedKeywords.length) return []

  return findings.filter(finding => {
    const haystack = `${finding.topic} ${finding.findingText} ${finding.sourceTrace.map(t => t.supportingText).join(' ')}`.toLowerCase()
    return normalizedKeywords.some(keyword => haystack.includes(keyword))
  })
}

export interface BridgeQuestionProvenance {
  sourceTrace: Stage1SourceTrace[]
  downstreamUse: Stage1Finding['downstreamPermission'] | 'mixed'
}

/**
 * Aggregates source traces from the relevant Stage 1 findings for display alongside a
 * Stage 2 bridge question. If findings disagree on downstream permission, reports 'mixed'
 * so the UI can surface the most restrictive interpretation rather than overclaiming.
 */
export function buildBridgeQuestionProvenance(findings: Stage1Finding[]): BridgeQuestionProvenance {
  const sourceTrace = findings.flatMap(f => f.sourceTrace)
  const permissions = new Set(findings.map(f => f.downstreamPermission))
  const downstreamUse = permissions.size === 1 ? [...permissions][0] : 'mixed'

  return { sourceTrace, downstreamUse }
}
