/**
 * Deterministic matching of parsed JD requirements against a compact profile
 * evidence index. No LLM involved.
 *
 * Uses containment (what fraction of the evidence item's tokens appear in the
 * requirement's token set) rather than symmetric Jaccard overlap — requirement
 * sentences are long and evidence items (esp. single-word skills like "Jira")
 * are short, so symmetric overlap unfairly penalizes short, exact matches.
 *
 * Synonym expansion: before checking containment, each item token is also matched
 * against a curated set of domain-equivalent terms. This prevents "agile ceremonies"
 * (JD) from missing "Scrum ceremonies" (profile) due to vocabulary mismatch.
 */
import type { GapClassification, JDRequirement, ProfileEvidenceIndexItem } from '@/contracts'
import { normalizeKey } from '@/lib/profile/profileNormalizer'

const STRENGTH_RANK = { strong: 2, medium: 1, weak: 0 }
const RANK_TO_LABEL = ['none', 'weak', 'moderate', 'strong'] as const

function strengthForMatches(
  matched: ProfileEvidenceIndexItem[]
): 'strong' | 'moderate' | 'weak' | 'none' {
  if (matched.length === 0) return 'none'
  const maxRank = Math.max(...matched.map(m => STRENGTH_RANK[m.evidenceStrength])) + 1
  return RANK_TO_LABEL[maxRank]
}

/**
 * Curated synonym groups for domain-equivalent terms.
 * An item token counts as a hit if the row contains the token OR any of its synonyms.
 * Bidirectional: "scrum" in the profile matches "agile" in the JD, and vice versa.
 */
const TOKEN_SYNONYMS: Record<string, string[]> = {
  // Agile / delivery
  scrum:         ['agile', 'sprint', 'ceremony', 'ceremonies', 'iteration', 'standup'],
  agile:         ['scrum', 'sprint', 'ceremony', 'ceremonies', 'kanban', 'iteration'],
  ceremony:      ['ceremonies', 'scrum', 'agile', 'sprint', 'standup', 'retrospective', 'planning'],
  ceremonies:    ['ceremony', 'scrum', 'agile', 'sprint', 'standup', 'retrospective', 'planning'],
  sprint:        ['scrum', 'agile', 'ceremony', 'iteration', 'planning'],
  standup:       ['ceremony', 'ceremonies', 'scrum', 'agile', 'daily'],
  retrospective: ['ceremony', 'ceremonies', 'scrum', 'agile', 'retro'],
  retro:         ['retrospective', 'ceremony', 'ceremonies', 'scrum'],
  grooming:      ['backlog', 'scrum', 'agile', 'ceremony', 'planning', 'refinement'],
  refinement:    ['grooming', 'backlog', 'scrum', 'agile'],
  backlog:       ['grooming', 'scrum', 'agile', 'planning', 'refinement'],
  kanban:        ['agile', 'scrum', 'sprint', 'board', 'iteration'],
  facilitation:  ['ceremony', 'ceremonies', 'scrum', 'agile', 'standup', 'workshop'],
  facilitating:  ['ceremony', 'ceremonies', 'scrum', 'agile', 'standup', 'workshop'],
  // AI / ML
  ai:            ['artificial', 'intelligence', 'machine', 'ml', 'llm', 'automation', 'generative', 'gpt', 'copilot'],
  artificial:    ['ai', 'intelligence', 'machine', 'ml'],
  intelligence:  ['ai', 'artificial', 'machine', 'ml'],
  machine:       ['ai', 'learning', 'ml', 'artificial', 'intelligence'],
  ml:            ['ai', 'machine', 'learning', 'artificial', 'intelligence'],
  llm:           ['ai', 'language', 'model', 'generative', 'gpt'],
  generative:    ['ai', 'llm', 'gpt', 'language', 'model'],
  gpt:           ['ai', 'llm', 'generative', 'language', 'model'],
  copilot:       ['ai', 'llm', 'automation', 'generative'],
  automation:    ['ai', 'ml', 'workflow', 'scripting'],
  // Healthcare / regulated
  healthcare:    ['health', 'hipaa', 'pharmacy', 'pharma', 'clinical', 'medical', 'regulated', 'rx'],
  health:        ['healthcare', 'hipaa', 'pharmacy', 'clinical', 'medical'],
  hipaa:         ['healthcare', 'health', 'compliance', 'regulated', 'pharmacy', 'clinical', 'privacy'],
  pharmacy:      ['healthcare', 'health', 'hipaa', 'pharma', 'clinical', 'rx'],
  pharma:        ['pharmacy', 'healthcare', 'health', 'clinical', 'rx', 'drug'],
  clinical:      ['healthcare', 'health', 'hipaa', 'medical', 'pharmacy'],
  medical:       ['healthcare', 'health', 'clinical', 'hipaa', 'pharmacy'],
  regulated:     ['compliance', 'hipaa', 'healthcare', 'regulatory', 'audit', 'governance'],
  compliance:    ['regulated', 'hipaa', 'regulatory', 'governance', 'audit', 'privacy'],
  regulatory:    ['compliance', 'regulated', 'hipaa', 'governance', 'audit'],
  // Documentation / spec
  documentation: ['document', 'docs', 'spec', 'specification', 'requirements', 'brd', 'prd', 'writing'],
  document:      ['documentation', 'docs', 'spec', 'requirements', 'writing'],
  docs:          ['documentation', 'document', 'spec', 'requirements'],
  specification: ['spec', 'documentation', 'requirements', 'document', 'prd'],
  spec:          ['specification', 'documentation', 'requirements', 'prd', 'brd'],
  prd:           ['spec', 'specification', 'requirements', 'document', 'roadmap'],
  brd:           ['spec', 'specification', 'requirements', 'document'],
  // API / integration
  api:           ['integration', 'interface', 'endpoint', 'webhook', 'rest', 'service', 'connector'],
  integration:   ['api', 'interface', 'endpoint', 'connector', 'service', 'rest', 'webhook'],
  endpoint:      ['api', 'integration', 'interface', 'rest', 'service'],
  webhook:       ['api', 'integration', 'endpoint', 'connector'],
  rest:          ['api', 'integration', 'endpoint', 'interface'],
  // SaaS / delivery
  saas:          ['platform', 'cloud', 'software', 'subscription', 'enterprise'],
  platform:      ['saas', 'cloud', 'software', 'product', 'system'],
  // Role / function
  analyst:       ['ba', 'analysis', 'business', 'product', 'requirements', 'research'],
  ba:            ['analyst', 'business', 'analysis', 'requirements'],
  stakeholder:   ['business', 'client', 'customer', 'executive', 'owner', 'sponsor'],
  owner:         ['po', 'product', 'scrum', 'stakeholder', 'responsible'],
  po:            ['owner', 'product', 'scrum'],
}

/**
 * Fraction of itemTokens present in rowTokens, with synonym expansion.
 * Short items need full containment; longer ones need a majority.
 */
function containment(rowTokens: Set<string>, itemKey: string): number {
  const itemTokens = itemKey.split(' ').filter(Boolean)
  if (itemTokens.length === 0) return 0
  const hits = itemTokens.filter(t => {
    if (rowTokens.has(t)) return true
    const synonyms = TOKEN_SYNONYMS[t]
    return synonyms ? synonyms.some(s => rowTokens.has(s)) : false
  }).length
  return hits / itemTokens.length
}

export function matchRow(row: JDRequirement, index: ProfileEvidenceIndexItem[]): JDRequirement {
  // Match against the requirement text only. profileGrounding is the LLM's narrative
  // explanation and often names skills in a *contrastive* sense (e.g. "profile shows
  // Scrum but no Salesforce" for a gap row) — including it caused false-positive matches.
  const rowKey = normalizeKey(row.text)
  const rowTokens = new Set(rowKey.split(' ').filter(Boolean))

  const matched = index.filter(item => {
    const threshold = item.normalizedKey.split(' ').filter(Boolean).length <= 2 ? 1.0 : 0.5
    return containment(rowTokens, item.normalizedKey) >= threshold
  })

  if (matched.length === 0) {
    return { ...row, matchedClaimIds: [], profileEvidenceStrength: 'none', matchedEvidenceTexts: [] }
  }
  return {
    ...row,
    matchedClaimIds: matched.map(m => m.claimId),
    matchedEvidenceTexts: matched.slice(0, 3).map(m => m.text),
    profileEvidenceStrength: strengthForMatches(matched),
  }
}

/** Enriches required/niceToHave rows with matchedClaimIds + profileEvidenceStrength. Pure, deterministic. */
export function matchRequirementsToEvidence(
  requirements: JDRequirement[],
  index: ProfileEvidenceIndexItem[]
): JDRequirement[] {
  if (index.length === 0) return requirements
  return requirements.map(r => matchRow(r, index))
}

/**
 * Post-match reconciliation: if the LLM classified a row as needs_evidence or gap but
 * the deterministic matcher found strong/moderate profile evidence, the LLM missed
 * existing evidence. Promote to retrieval_gap so Stage 2 treats it as low-priority
 * confirmation rather than a true unknown.
 *
 * Strong evidence match + LLM said gap → retrieval_gap (matcher likely found the answer)
 * Moderate evidence match + LLM said needs_evidence → retrieval_gap (worth confirming)
 */
export function reconcileRetrievalGaps(rows: JDRequirement[]): JDRequirement[] {
  return rows.map(row => {
    const llmSaidGap =
      row.classification === 'needs_evidence' ||
      row.classification === 'gap' ||
      row.userCoverageStatus === 'gap'
    const strength = row.profileEvidenceStrength
    if (!llmSaidGap || !strength) return row

    if (strength === 'strong' || strength === 'moderate') {
      return {
        ...row,
        classification: 'retrieval_gap' as const,
        gapClassification: 'retrieval_gap' as GapClassification,
        // Promote userCoverageStatus to partial so UI doesn't show 'gap' badge for retrieval gaps
        userCoverageStatus: 'partial' as const,
        profileGrounding: row.profileGrounding
          ? `[Retrieval gap — matcher found ${strength} evidence] ${row.profileGrounding}`
          : `Retrieval gap: deterministic matcher found ${strength} evidence not reflected in LLM assessment.`,
      }
    }
    return row
  })
}
