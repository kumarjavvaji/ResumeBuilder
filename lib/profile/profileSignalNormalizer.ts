/**
 * Client-safe types and normalizer for extracted profile signals.
 * No LLM or server-only imports — safe to use in 'use client' components.
 */
import type { ClaimCategory, ArtifactLink } from '@/contracts'
import { normalizeKey, normalizeTool, normalizeRole, normalizeDomain, normalizeMetric } from './profileNormalizer'
import { nanoid } from '@/lib/storage/nanoid'

// ─── Raw signal types (returned by API route, used client-side) ───────────────

export interface RawExtractedClaim {
  text: string
  category: ClaimCategory
  evidenceStrength: 'strong' | 'medium' | 'weak'
  sourceContext: string
}

export interface RawExtractedSkill {
  name: string
  groupingHint?: string
}

export interface RawExtractedRole {
  title: string
  company: string
  startDate: string
  endDate: string
}

export interface RawExtractedMetric {
  text: string
  context: string
}

export interface RawExtractedTool {
  name: string
  categoryHint?: string
}

export interface RawExtractedDomain {
  name: string
}

export interface ExtractedProfileSignals {
  claims: RawExtractedClaim[]
  skills: RawExtractedSkill[]
  roles: RawExtractedRole[]
  metrics: RawExtractedMetric[]
  tools: RawExtractedTool[]
  domains: RawExtractedDomain[]
  possibleConflicts: { description: string; claimTexts: string[] }[]
}

// ─── Normalize into typed objects with stable keys ────────────────────────────

export function normalizeExtractedSignals(
  raw: ExtractedProfileSignals,
  sourceId: string,
  now: string
) {
  const claims = (raw.claims ?? []).map(c => ({
    claimId: nanoid(),
    normalizedKey: normalizeKey(c.text),
    text: c.text,
    category: c.category,
    evidenceStrength: c.evidenceStrength,
    sourceIds: [sourceId],
    artifactLinks: [] as ArtifactLink[],
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'active' as const,
  }))

  const skills = (raw.skills ?? []).map(s => ({
    skillId: nanoid(),
    name: s.name,
    normalizedKey: normalizeKey(s.name),
    grouping: s.groupingHint,
    sourceIds: [sourceId],
    evidenceStrength: 'medium' as const,
  }))

  const roles = (raw.roles ?? []).map(r => ({
    roleId: nanoid(),
    title: r.title,
    normalizedKey: normalizeRole(r.title),
    company: r.company,
    startDate: r.startDate,
    endDate: r.endDate,
    sourceIds: [sourceId],
  }))

  const metrics = (raw.metrics ?? []).map(m => ({
    metricId: nanoid(),
    text: m.text,
    normalizedKey: normalizeMetric(m.text),
    context: m.context,
    sourceIds: [sourceId],
  }))

  const tools = (raw.tools ?? []).map(t => ({
    toolId: nanoid(),
    name: t.name,
    normalizedKey: normalizeTool(t.name),
    category: t.categoryHint,
    sourceIds: [sourceId],
  }))

  const domains = (raw.domains ?? []).map(d => ({
    domainId: nanoid(),
    name: d.name,
    normalizedKey: normalizeDomain(d.name),
    sourceIds: [sourceId],
  }))

  return { claims, skills, roles, metrics, tools, domains }
}
