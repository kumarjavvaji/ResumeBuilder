import { db } from './db'
import type {
  LearningSignal, LearningSignalType, EmphasisCategory,
  SectionType, SignalScope, ProductArea
} from '@/contracts'
import { nanoid } from './nanoid'

export async function addLearningSignal(
  signal: Omit<LearningSignal, 'id' | 'createdAt'>
): Promise<LearningSignal> {
  const full: LearningSignal = {
    ...signal,
    id: nanoid(),
    createdAt: new Date().toISOString()
  }
  await db.learningSignals.add(full)
  return full
}

export async function updateLearningSignal(
  id: string,
  updates: Partial<LearningSignal>
): Promise<void> {
  await db.learningSignals.update(id, updates)
}

export async function deleteLearningSignal(id: string): Promise<void> {
  await db.learningSignals.delete(id)
}

// ── Personal signal queries ────────────────────────────────────────────────

export async function getRejectedPhrases(): Promise<string[]> {
  const signals = await db.learningSignals
    .where('type').equals('rejected-phrase')
    .toArray()
  return signals.map(s => s.content)
}

export async function getAcceptedBullets(limit = 30): Promise<LearningSignal[]> {
  return db.learningSignals
    .where('type').equals('accepted-bullet')
    .limit(limit)
    .toArray()
}

export async function getPersonalSignalsForRole(
  roleCategory: EmphasisCategory,
  limit = 20
): Promise<LearningSignal[]> {
  return db.learningSignals
    .where('roleCategory').equals(roleCategory)
    .filter(s => s.scope === 'personal' || s.scope === 'both')
    .limit(limit)
    .toArray()
}

export async function getPersonalSignalsForSection(
  sectionType: SectionType
): Promise<LearningSignal[]> {
  return db.learningSignals
    .where('sectionType').equals(sectionType)
    .filter(s => s.scope === 'personal' || s.scope === 'both')
    .toArray()
}

// ── Global signal queries ──────────────────────────────────────────────────

export async function getGlobalSignals(limit = 50): Promise<LearningSignal[]> {
  return db.learningSignals
    .where('scope').anyOf(['global', 'both'])
    .limit(limit)
    .toArray()
}

export async function getGlobalSignalsByProductArea(
  area: ProductArea,
  limit = 20
): Promise<LearningSignal[]> {
  return db.learningSignals
    .where('productArea').equals(area)
    .filter(s => s.scope === 'global' || s.scope === 'both')
    .limit(limit)
    .toArray()
}

export async function promoteToGlobal(
  id: string,
  globalContent: string,
  productArea: ProductArea
): Promise<void> {
  await db.learningSignals.update(id, {
    scope: 'both',
    globalContent,
    productArea,
    promotedToGlobal: true
  })
}

// ── Combined queries ───────────────────────────────────────────────────────

export async function getSignalsByType(type: LearningSignalType): Promise<LearningSignal[]> {
  return db.learningSignals.where('type').equals(type).toArray()
}

export async function getAllSignals(): Promise<LearningSignal[]> {
  return db.learningSignals.orderBy('createdAt').reverse().toArray()
}

export async function getSignalsByScope(scope: SignalScope): Promise<LearningSignal[]> {
  if (scope === 'personal') {
    return db.learningSignals.where('scope').equals('personal').toArray()
  }
  if (scope === 'global') {
    return db.learningSignals.where('scope').anyOf(['global', 'both']).toArray()
  }
  return db.learningSignals.toArray()
}

// Returns signals that should influence artifact generation for a given session context.
// Combines: personal role/section signals + global artifact strategy signals.
export async function getGenerationContext(opts: {
  roleCategory: EmphasisCategory
  sectionType: SectionType
  rejectedPhrasesOnly?: boolean
}): Promise<{ personalSignals: LearningSignal[]; globalSignals: LearningSignal[]; rejectedPhrases: string[] }> {
  const [personal, global, phraseSignals] = await Promise.all([
    getPersonalSignalsForSection(opts.sectionType),
    getGlobalSignalsByProductArea('artifact-strategy', 15),
    db.learningSignals.where('type').equals('rejected-phrase').toArray()
  ])

  return {
    personalSignals: personal.filter(s => s.type !== 'rejected-phrase'),
    globalSignals: global,
    rejectedPhrases: phraseSignals.map(s => s.content)
  }
}
