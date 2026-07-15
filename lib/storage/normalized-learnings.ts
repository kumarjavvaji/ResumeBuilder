import { db } from './db'
import type { NormalizedLearning, NormalizedLearningBucket } from '@/contracts'

export async function saveNormalizedLearnings(learnings: NormalizedLearning[]): Promise<void> {
  if (learnings.length === 0) return
  await db.normalizedLearnings.bulkPut(learnings)
}

export async function getNormalizedLearningsForSession(sessionId: string): Promise<NormalizedLearning[]> {
  return db.normalizedLearnings
    .where('sourceSessionId').equals(sessionId)
    .toArray()
}

export async function getNormalizedLearningsByBucket(bucket: NormalizedLearningBucket): Promise<NormalizedLearning[]> {
  return db.normalizedLearnings
    .where('bucket').equals(bucket)
    .toArray()
}

export async function getAllNormalizedLearnings(): Promise<NormalizedLearning[]> {
  return db.normalizedLearnings.orderBy('savedAt').reverse().toArray()
}

export async function deleteNormalizedLearningsForSession(sessionId: string): Promise<void> {
  await db.normalizedLearnings
    .where('sourceSessionId').equals(sessionId)
    .delete()
}

/**
 * Returns normalized learnings suitable as personal/strategy context for generation.
 * Personal signals and strategy signals scoped to a role family only.
 */
export async function getNormalizedGenerationContext(opts: {
  roleFamily?: string
  buckets?: NormalizedLearningBucket[]
  limit?: number
}): Promise<NormalizedLearning[]> {
  const buckets = opts.buckets ?? ['personal_signal', 'strategy_signal', 'global_signal']
  const all = await db.normalizedLearnings.toArray()
  return all
    .filter(l => buckets.includes(l.bucket))
    .filter(l => !opts.roleFamily || !l.roleFamily || l.roleFamily === opts.roleFamily)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, opts.limit ?? 50)
}

/**
 * Word-level Jaccard similarity for deduplication screening.
 * Returns true if two rule texts are likely saying the same thing.
 */
export function areLearningsSimilar(a: string, b: string): boolean {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length > 3))
  const setA = tokenize(a)
  const setB = tokenize(b)
  const intersection = [...setA].filter(t => setB.has(t)).length
  const union = new Set([...setA, ...setB]).size
  return union > 0 && intersection / union >= 0.55
}

/**
 * Filters candidates against existing records by bucket + ruleText similarity.
 * Returns only candidates that are genuinely novel.
 */
export function filterNovelCandidates(
  incoming: NormalizedLearning[],
  existing: NormalizedLearning[],
): NormalizedLearning[] {
  return incoming.filter(candidate => {
    const sameBucket = existing.filter(e => e.bucket === candidate.bucket)
    return !sameBucket.some(e => areLearningsSimilar(e.ruleText, candidate.ruleText))
  })
}
