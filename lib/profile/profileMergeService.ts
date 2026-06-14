/**
 * Deterministic merge service for ProfileSnapshot dimensions.
 * Handles claim dedup, near-duplicate linking, and conflict flagging.
 * No LLM involved — all decisions use normalizedKey comparison.
 */
import type {
  ProfileClaim,
  ProfileSkill,
  ProfileTool,
  ProfileMetric,
  ProfileDomain,
  ProfileRoleSignal,
  ProfileSnapshotDimensions,
  ClaimOverlap,
  ProfileConflict,
  ProfileDelta,
  SnapshotRefinementDirection,
  SnapshotLearningSignal,
  ArtifactLink,
} from '@/contracts'
import { isNearDuplicate } from './profileNormalizer'
import { nanoid } from '@/lib/storage/nanoid'

// ─── Claim merge ──────────────────────────────────────────────────────────────

interface ClaimMergeResult {
  merged: ProfileClaim[]
  overlaps: ClaimOverlap[]
  conflicts: ProfileConflict[]
}

export function mergeClaims(
  existing: ProfileClaim[],
  incoming: ProfileClaim[],
  now: string
): ClaimMergeResult {
  const merged = [...existing]
  const overlaps: ClaimOverlap[] = []
  const conflicts: ProfileConflict[] = []

  for (const inc of incoming) {
    const exactMatch = merged.find(e => e.normalizedKey === inc.normalizedKey)
    if (exactMatch) {
      // Deduplicate: extend sourceIds, update lastSeenAt
      if (!exactMatch.sourceIds.includes(inc.sourceIds[0])) {
        exactMatch.sourceIds.push(...inc.sourceIds)
      }
      exactMatch.lastSeenAt = now
      overlaps.push({
        overlapId: nanoid(),
        canonicalClaimId: exactMatch.claimId,
        overlappingClaimIds: [inc.claimId],
        overlapType: 'duplicate',
        resolution: 'merged',
      })
      continue
    }

    const nearMatch = merged.find(e => isNearDuplicate(e.normalizedKey, inc.normalizedKey))
    if (nearMatch) {
      // Near-duplicate: link but keep both
      overlaps.push({
        overlapId: nanoid(),
        canonicalClaimId: nearMatch.claimId,
        overlappingClaimIds: [inc.claimId],
        overlapType: 'near_duplicate',
        resolution: 'linked',
      })
      // Still add the incoming claim as active
      merged.push({ ...inc, status: 'active' })
      continue
    }

    merged.push({ ...inc, status: 'active' })
  }

  return { merged, overlaps, conflicts }
}

// ─── Skills merge ─────────────────────────────────────────────────────────────

export function mergeSkills(existing: ProfileSkill[], incoming: ProfileSkill[]): ProfileSkill[] {
  const result = [...existing]
  for (const inc of incoming) {
    const dup = result.find(e => e.normalizedKey === inc.normalizedKey)
    if (dup) {
      if (!dup.sourceIds.includes(inc.sourceIds[0])) dup.sourceIds.push(...inc.sourceIds)
      if (!dup.grouping && inc.grouping) dup.grouping = inc.grouping
      // Promote evidenceStrength if incoming is stronger
      const rank = { strong: 2, medium: 1, weak: 0 }
      if (rank[inc.evidenceStrength] > rank[dup.evidenceStrength]) {
        dup.evidenceStrength = inc.evidenceStrength
      }
    } else {
      result.push({ ...inc })
    }
  }
  return result
}

// ─── Tools merge ──────────────────────────────────────────────────────────────

export function mergeTools(existing: ProfileTool[], incoming: ProfileTool[]): ProfileTool[] {
  const result = [...existing]
  for (const inc of incoming) {
    const dup = result.find(e => e.normalizedKey === inc.normalizedKey)
    if (dup) {
      if (!dup.sourceIds.includes(inc.sourceIds[0])) dup.sourceIds.push(...inc.sourceIds)
      if (!dup.category && inc.category) dup.category = inc.category
    } else {
      result.push({ ...inc })
    }
  }
  return result
}

// ─── Metrics merge ────────────────────────────────────────────────────────────

export function mergeMetrics(existing: ProfileMetric[], incoming: ProfileMetric[]): ProfileMetric[] {
  const result = [...existing]
  for (const inc of incoming) {
    const dup = result.find(e => e.normalizedKey === inc.normalizedKey)
    if (dup) {
      if (!dup.sourceIds.includes(inc.sourceIds[0])) dup.sourceIds.push(...inc.sourceIds)
    } else {
      result.push({ ...inc })
    }
  }
  return result
}

// ─── Domains merge ────────────────────────────────────────────────────────────

export function mergeDomains(existing: ProfileDomain[], incoming: ProfileDomain[]): ProfileDomain[] {
  const result = [...existing]
  for (const inc of incoming) {
    const dup = result.find(e => e.normalizedKey === inc.normalizedKey)
    if (dup) {
      if (!dup.sourceIds.includes(inc.sourceIds[0])) dup.sourceIds.push(...inc.sourceIds)
    } else {
      result.push({ ...inc })
    }
  }
  return result
}

// ─── Roles merge ──────────────────────────────────────────────────────────────

export function mergeRoles(
  existing: ProfileRoleSignal[],
  incoming: ProfileRoleSignal[]
): ProfileRoleSignal[] {
  const result = [...existing]
  for (const inc of incoming) {
    const dup = result.find(
      e => e.normalizedKey === inc.normalizedKey && e.company === inc.company
    )
    if (dup) {
      if (!dup.sourceIds.includes(inc.sourceIds[0])) dup.sourceIds.push(...inc.sourceIds)
    } else {
      result.push({ ...inc })
    }
  }
  return result
}

// ─── Full dimension merge ─────────────────────────────────────────────────────

export interface IncomingDimensions {
  claims: ProfileClaim[]
  skills: ProfileSkill[]
  tools: ProfileTool[]
  metrics: ProfileMetric[]
  domains: ProfileDomain[]
  roles: ProfileRoleSignal[]
}

export interface MergeResult {
  dimensions: ProfileSnapshotDimensions
  overlaps: ClaimOverlap[]
  conflicts: ProfileConflict[]
  delta: Omit<ProfileDelta, 'profileVersionBefore' | 'profileVersionAfter'>
}

export function mergeDimensions(
  existing: ProfileSnapshotDimensions,
  incoming: IncomingDimensions,
  preservedDirections: SnapshotRefinementDirection[],
  preservedLearningSignals: SnapshotLearningSignal[],
  now: string
): MergeResult {
  const claimResult = mergeClaims(existing.experienceClaims, incoming.claims, now)
  const mergedSkills = mergeSkills(existing.skills, incoming.skills)
  const mergedTools = mergeTools(existing.tools, incoming.tools)
  const mergedMetrics = mergeMetrics(existing.metrics, incoming.metrics)
  const mergedDomains = mergeDomains(existing.domains, incoming.domains)
  const mergedRoles = mergeRoles(existing.roles, incoming.roles)

  const addedClaims = incoming.claims.filter(
    ic => !existing.experienceClaims.some(ec => ec.normalizedKey === ic.normalizedKey)
  )
  const addedSkills = incoming.skills.filter(
    is => !existing.skills.some(es => es.normalizedKey === is.normalizedKey)
  )
  const addedTools = incoming.tools.filter(
    it => !existing.tools.some(et => et.normalizedKey === it.normalizedKey)
  )
  const addedMetrics = incoming.metrics.filter(
    im => !existing.metrics.some(em => em.normalizedKey === im.normalizedKey)
  )

  const dimensions: ProfileSnapshotDimensions = {
    identity: existing.identity,
    experienceClaims: claimResult.merged,
    skills: mergedSkills,
    tools: mergedTools,
    metrics: mergedMetrics,
    domains: mergedDomains,
    roles: mergedRoles,
    constraints: existing.constraints,
    artifactHistory: existing.artifactHistory,
    refinementDirections: preservedDirections,
    learningSignals: preservedLearningSignals,
  }

  return {
    dimensions,
    overlaps: claimResult.overlaps,
    conflicts: claimResult.conflicts,
    delta: {
      addedClaims,
      addedSkills,
      addedTools,
      addedMetrics,
      mergedClaims: claimResult.overlaps,
      linkedArtifacts: [] as ArtifactLink[],
      preservedDirections,
      preservedLearningSignals,
      unresolvedConflicts: claimResult.conflicts,
    },
  }
}
