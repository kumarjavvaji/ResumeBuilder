/**
 * Produces a focused ProfileProjection slice from an active ProfileSnapshot.
 * Artifact generators receive the projection — not the whole snapshot blob.
 * Relevance scoring: category match + role overlap + metric presence.
 */
import type {
  ProfileSnapshot,
  ProfileProjection,
  ProfileClaim,
  ProfileMetric,
  ProfileSkill,
  ProfileTool,
  SectionType,
  SnapshotLearningSignal,
  SnapshotRefinementDirection,
} from '@/contracts'
import { tokenOverlap } from './profileNormalizer'

// ─── Category→SectionType relevance table ─────────────────────────────────────

const CLAIM_CATEGORY_RELEVANCE: Record<string, SectionType[]> = {
  role: ['experience-po', 'experience-ba', 'experience-qa', 'summary'],
  responsibility: ['experience-po', 'experience-ba', 'experience-qa', 'summary'],
  achievement: ['experience-po', 'experience-ba', 'experience-qa', 'summary', 'skills'],
  metric: ['experience-po', 'experience-ba', 'experience-qa', 'summary'],
  domain: ['summary', 'experience-po', 'experience-ba', 'experience-qa'],
  tool: ['skills', 'experience-po', 'experience-ba', 'experience-qa'],
  method: ['skills', 'experience-po', 'experience-ba', 'experience-qa'],
  constraint: ['summary'],
  preference: ['summary'],
}

function claimRelevantToSection(claim: ProfileClaim, sectionType: SectionType): boolean {
  const relevant = CLAIM_CATEGORY_RELEVANCE[claim.category]
  return relevant ? relevant.includes(sectionType) : true
}

// ─── Role-signal scoring ──────────────────────────────────────────────────────

function scoreClaimForRole(claim: ProfileClaim, roleKeywords: string[]): number {
  if (roleKeywords.length === 0) return 1
  const normalizedText = claim.normalizedKey
  let score = 0
  for (const kw of roleKeywords) {
    const overlap = tokenOverlap(normalizedText, kw)
    if (overlap > 0.3) score += overlap
  }
  return score
}

// ─── Evidence strength filter ─────────────────────────────────────────────────

const EVIDENCE_RANK = { strong: 2, medium: 1, weak: 0 }

function minEvidenceForSection(sectionType: SectionType): 'strong' | 'medium' | 'weak' {
  if (sectionType === 'summary') return 'medium'
  return 'weak'
}

// ─── Main projection service ──────────────────────────────────────────────────

export interface ProjectionOptions {
  sectionType: SectionType
  targetRoleTitle?: string
  targetDomains?: string[]
  maxClaims?: number
  maxMetrics?: number
  maxSkills?: number
  maxTools?: number
}

export function projectSnapshot(
  snapshot: ProfileSnapshot,
  opts: ProjectionOptions
): ProfileProjection {
  const { sectionType, targetRoleTitle = '', targetDomains = [], maxClaims = 20, maxMetrics = 10, maxSkills = 30, maxTools = 30 } = opts
  const { dimensions } = snapshot

  const roleKeywords = targetRoleTitle.toLowerCase().split(/\s+/).filter(Boolean)
  const domainKeys = targetDomains.map(d => d.toLowerCase())

  // Filter claims by section relevance + evidence threshold
  const minEvidence = minEvidenceForSection(sectionType)
  const eligibleClaims = dimensions.experienceClaims.filter(
    c =>
      c.status === 'active' &&
      claimRelevantToSection(c, sectionType) &&
      EVIDENCE_RANK[c.evidenceStrength] >= EVIDENCE_RANK[minEvidence]
  )

  // Score and sort claims
  const scoredClaims = eligibleClaims.map(c => ({
    claim: c,
    score: scoreClaimForRole(c, roleKeywords) + (c.evidenceStrength === 'strong' ? 0.5 : 0),
  }))
  scoredClaims.sort((a, b) => b.score - a.score)
  const relevantClaims = scoredClaims.slice(0, maxClaims).map(s => s.claim)

  // Skills: prioritize those with strong evidence, then all others
  const sortedSkills = [...dimensions.skills].sort(
    (a, b) => EVIDENCE_RANK[b.evidenceStrength] - EVIDENCE_RANK[a.evidenceStrength]
  )
  const relevantSkills = sortedSkills.slice(0, maxSkills)

  // Tools: no scoring needed — include all up to limit
  const relevantTools = dimensions.tools.slice(0, maxTools)

  // Metrics: all metrics (always strong evidence by nature)
  const relevantMetrics = dimensions.metrics.slice(0, maxMetrics)

  // Role translation hints from learning signals
  const roleTranslationHints: SnapshotLearningSignal[] = dimensions.learningSignals.filter(
    ls => ls.appliesTo.includes(sectionType) || ls.appliesTo.includes('*')
  )

  // Refinement directions that apply to this section or are global
  const refinementDirections: SnapshotRefinementDirection[] = dimensions.refinementDirections.filter(
    rd => rd.appliesTo === sectionType || rd.appliesTo === 'global'
  )

  return {
    relevantClaims,
    relevantMetrics,
    relevantSkills,
    relevantTools,
    roleTranslationHints,
    refinementDirections,
    evidenceBoundaries: [],
    constraints: dimensions.constraints,
    unresolvedConflicts: snapshot.unresolvedConflicts,
  }
}
