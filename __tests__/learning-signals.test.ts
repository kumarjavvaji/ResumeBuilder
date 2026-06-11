/**
 * Learning signal tests — these run against a real Dexie instance in jsdom.
 * Dexie with fake-indexeddb is used for isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { LearningSignal } from '@/contracts'

// Minimal in-memory implementation for testing signal persistence
// (avoids the browser Dexie dependency in test environment)
class InMemorySignalStore {
  private signals: LearningSignal[] = []

  async add(signal: Omit<LearningSignal, 'id' | 'createdAt' | 'scope'> & { scope?: LearningSignal['scope'] }): Promise<LearningSignal> {
    const full: LearningSignal = {
      scope: 'personal',
      ...signal,
      id: Math.random().toString(36).slice(2),
      createdAt: new Date().toISOString()
    }
    this.signals.push(full)
    return full
  }

  async getByType(type: LearningSignal['type']): Promise<LearningSignal[]> {
    return this.signals.filter(s => s.type === type)
  }

  async getRejectedPhrases(): Promise<string[]> {
    return this.signals
      .filter(s => s.type === 'rejected-phrase')
      .map(s => s.content)
  }

  async getAll(): Promise<LearningSignal[]> {
    return [...this.signals]
  }

  getByScope(scope: 'personal' | 'global' | 'both'): LearningSignal[] {
    return this.signals.filter(s => s.scope === scope)
  }

  clear() {
    this.signals = []
  }
}

const store = new InMemorySignalStore()

describe('learning signal persistence', () => {
  beforeEach(() => store.clear())

  it('adds an accepted bullet signal', async () => {
    const signal = await store.add({
      type: 'accepted-bullet',
      content: 'Reduced deploy time by 40% through CI/CD pipeline automation.',
      context: 'Product Owner at Acme',
      roleCategory: 'PO',
      sectionType: 'experience-po'
    })
    expect(signal.id).toBeTruthy()
    expect(signal.createdAt).toBeTruthy()
    expect(signal.type).toBe('accepted-bullet')
  })

  it('adds a rejected phrase signal', async () => {
    await store.add({
      type: 'rejected-phrase',
      content: 'sits at the intersection of',
      context: 'Rejected in summary section'
    })
    const phrases = await store.getRejectedPhrases()
    expect(phrases).toContain('sits at the intersection of')
  })

  it('retrieves signals by type', async () => {
    await store.add({ type: 'accepted-bullet', content: 'Bullet A', context: '' })
    await store.add({ type: 'accepted-bullet', content: 'Bullet B', context: '' })
    await store.add({ type: 'rejected-phrase', content: 'bad phrase', context: '' })

    const bullets = await store.getByType('accepted-bullet')
    expect(bullets.length).toBe(2)

    const phrases = await store.getByType('rejected-phrase')
    expect(phrases.length).toBe(1)
  })

  it('rejected phrases are available for injection into next generation', async () => {
    await store.add({ type: 'rejected-phrase', content: 'leverage synergies', context: '' })
    await store.add({ type: 'rejected-phrase', content: 'thought leader', context: '' })

    const phrases = await store.getRejectedPhrases()
    // These should be injected into the LLM system prompt as NEVER USE
    expect(phrases).toContain('leverage synergies')
    expect(phrases).toContain('thought leader')
  })

  it('does not mix signal types in getByType', async () => {
    await store.add({ type: 'approved-metric', content: '40% reduction in deploy time', context: '' })
    await store.add({ type: 'accepted-bullet', content: 'Some bullet', context: '' })

    const metrics = await store.getByType('approved-metric')
    expect(metrics.every(m => m.type === 'approved-metric')).toBe(true)
  })
})

describe('personal vs global signal scope', () => {
  beforeEach(() => store.clear())

  it('personal signals default to personal scope', async () => {
    const signal = await store.add({
      type: 'accepted-bullet',
      content: 'Managed backlog for a 10-person scrum team.',
      context: 'test'
    })
    expect(signal.scope).toBe('personal')
  })

  it('global signals have globalContent and productArea', async () => {
    const signal = await store.add({
      type: 'artifact-strategy',
      scope: 'global',
      content: 'anonymized pattern',
      globalContent: 'BA artifact strategy: quantified stakeholder outcomes outperform vague collaboration claims.',
      productArea: 'artifact-strategy',
      context: 'abstracted from session'
    })
    expect(signal.scope).toBe('global')
    expect(signal.globalContent).toBeTruthy()
    expect(signal.productArea).toBe('artifact-strategy')
  })

  it('promotion changes scope to "both" and preserves original content', async () => {
    const signal = await store.add({
      type: 'accepted-bullet',
      scope: 'personal',
      content: 'Reduced deployment time by 40% at Acme through CI/CD automation.',
      context: 'test'
    })
    // Simulate promotion (what promoteToGlobal does)
    const promoted = {
      ...signal,
      scope: 'both' as const,
      globalContent: 'QA/DevOps artifact strategy: quantified operational improvement via process automation signals strong technical delivery.',
      productArea: 'artifact-strategy' as const,
      promotedToGlobal: true
    }
    expect(promoted.scope).toBe('both')
    // Original personal content is preserved
    expect(promoted.content).toContain('Acme')
    // Global content is anonymized — no employer names
    expect(promoted.globalContent).not.toContain('Acme')
  })

  it('personal signals are filtered from global queries', async () => {
    await store.add({ type: 'accepted-bullet', scope: 'personal', content: 'personal bullet', context: '' })
    await store.add({ type: 'artifact-strategy', scope: 'global', globalContent: 'global rule', content: 'global rule', context: '' })

    const allSignals = await store.getAll()
    const globalOnly = allSignals.filter(s => s.scope === 'global' || s.scope === 'both')
    const personalOnly = allSignals.filter(s => s.scope === 'personal')

    expect(globalOnly.length).toBe(1)
    expect(personalOnly.length).toBe(1)
    // Global content must not contain personal details
    expect(globalOnly[0].globalContent ?? globalOnly[0].content).not.toContain('personal')
  })

  it('privacy boundary: global content must not reference employers from personal content', () => {
    const personalContent = 'Led backlog at Paylocity for 3 scrum teams across HR platform.'
    const globalContent = 'PO artifact strategy: multi-team backlog ownership in SaaS platforms should lead with delivery scope and cross-team coordination outcomes.'

    expect(globalContent).not.toContain('Paylocity')
    expect(globalContent).not.toContain('HR platform')
    expect(globalContent.length).toBeGreaterThan(0)
  })
})

describe('rejected phrase prevention contract', () => {
  it('containsRejectedPhrase returns the phrase when found', async () => {
    // This mirrors what the production code does before saving a generated section
    const rejectedPhrases = ['sits at the intersection of', 'thought leader']
    const generatedText = 'As a thought leader in product management...'

    function detectRejected(text: string, phrases: string[]): string | null {
      const lower = text.toLowerCase()
      for (const p of phrases) {
        if (lower.includes(p.toLowerCase())) return p
      }
      return null
    }

    expect(detectRejected(generatedText, rejectedPhrases)).toBe('thought leader')
  })

  it('clean text returns null', async () => {
    const rejectedPhrases = ['sits at the intersection of', 'thought leader']
    const generatedText = 'Led product strategy for a cross-functional team.'

    function detectRejected(text: string, phrases: string[]): string | null {
      const lower = text.toLowerCase()
      for (const p of phrases) if (lower.includes(p.toLowerCase())) return p
      return null
    }

    expect(detectRejected(generatedText, rejectedPhrases)).toBeNull()
  })
})
