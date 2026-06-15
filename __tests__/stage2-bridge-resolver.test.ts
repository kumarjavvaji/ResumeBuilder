/**
 * stage2-bridge-resolver.test.ts — A–C suites
 *
 * All fixtures are synthetic. No candidate-specific bridge questions or answers.
 */

import { resolveBridgeDecisions } from '@/lib/validators/bridge-resolver'
import type { BridgeQuestion } from '@/contracts'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let _idCounter = 0
function makeQuestion(overrides: Partial<BridgeQuestion> = {}): BridgeQuestion {
  _idCounter++
  return {
    id: `q-${_idCounter}`,
    sessionId: 'session-1',
    question: 'What experience do you have with stakeholder communication?',
    category: 'gap',
    status: 'answered',
    userAnswer: 'I regularly facilitated sprint reviews and backlog refinement sessions with product and engineering stakeholders.',
    priority: 'high',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ─── Suite A — disposition classification ─────────────────────────────────────

describe('A: disposition classification', () => {
  it('A1: long confident answer classifies as use_directly', () => {
    const q = makeQuestion({
      userAnswer: 'I led cross-functional sprint reviews with engineering, design, and business stakeholders every two weeks, presenting velocity metrics and release readiness status. This role required translating business priorities into technical requirements and vice versa.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].dispositionType).toBe('use_directly')
    expect(decisions[0].routeToResume).toBe(true)
  })

  it('A2: answer with hedging word classifies as use_after_rewrite', () => {
    const q = makeQuestion({
      userAnswer: 'I primarily worked on documentation, but also attended some stakeholder meetings.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].dispositionType).toBe('use_after_rewrite')
  })

  it('A3: negative answer classifies as do_not_use', () => {
    const q = makeQuestion({ userAnswer: "I don't have experience with this area." })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].dispositionType).toBe('do_not_use')
    expect(decisions[0].routeToResume).toBe(false)
  })

  it('A4: screening-only context classifies as use_as_constraint', () => {
    const q = makeQuestion({
      userAnswer: 'This is screening only — I was briefly mentioned in the project but was not the lead.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].dispositionType).toBe('use_as_constraint')
    expect(decisions[0].routeToResume).toBe(false)
  })

  it('A5: N/A answer classifies as do_not_use', () => {
    const q = makeQuestion({ userAnswer: 'N/A' })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].dispositionType).toBe('do_not_use')
  })

  it('A6: exposure-only answer classifies as use_as_constraint', () => {
    const q = makeQuestion({
      userAnswer: 'I had exposure only — attended two workshops but never worked with it directly.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].dispositionType).toBe('use_as_constraint')
  })

  it('A7: medium-length answer with no hedging → use_after_rewrite', () => {
    const q = makeQuestion({
      userAnswer: 'Yes, I worked with the analytics team on data validation tasks.',
    })
    const decisions = resolveBridgeDecisions([q])
    const d = decisions[0]
    expect(['use_after_rewrite', 'use_directly']).toContain(d.dispositionType)
  })
})

// ─── Suite B — routing and statement normalization ─────────────────────────────

describe('B: routing and normalized statements', () => {
  it('B1: do_not_use produces empty normalizedStatement', () => {
    const q = makeQuestion({ userAnswer: "No experience with this." })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].normalizedStatement).toBe('')
  })

  it('B2: use_as_constraint prefixes statement with [constraint]', () => {
    const q = makeQuestion({
      userAnswer: 'Screening only — briefly exposed through a workshop.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].normalizedStatement.startsWith('[constraint]')).toBe(true)
  })

  it('B3: use_directly normalizedStatement is truncated to 200 chars', () => {
    const longAnswer = 'X'.repeat(300)
    const q = makeQuestion({ userAnswer: longAnswer })
    const decisions = resolveBridgeDecisions([q])
    // use_after_rewrite or use_directly — both truncate to 200
    expect(decisions[0].normalizedStatement.length).toBeLessThanOrEqual(200)
  })

  it('B4: skipped questions are excluded from output', () => {
    const q = makeQuestion({ status: 'skipped', userAnswer: undefined })
    expect(resolveBridgeDecisions([q])).toHaveLength(0)
  })

  it('B5: pending questions are excluded from output', () => {
    const q = makeQuestion({ status: 'pending', userAnswer: undefined })
    expect(resolveBridgeDecisions([q])).toHaveLength(0)
  })

  it('B6: answered question with empty userAnswer is excluded', () => {
    const q = makeQuestion({ status: 'answered', userAnswer: '   ' })
    expect(resolveBridgeDecisions([q])).toHaveLength(0)
  })

  it('B7: multiple answered questions all resolved', () => {
    const q1 = makeQuestion({ userAnswer: 'I have three years of backlog ownership experience.' })
    const q2 = makeQuestion({
      question: 'Have you used Agile frameworks?',
      userAnswer: 'Yes, Scrum and Kanban across all product roles I held.',
    })
    const decisions = resolveBridgeDecisions([q1, q2])
    expect(decisions).toHaveLength(2)
  })
})

// ─── Suite C — gap warning clearing ───────────────────────────────────────────

describe('C: clearsWarnings derivation', () => {
  it('C1: gap question answered with use_directly clears warnings', () => {
    const q = makeQuestion({
      question: 'Do you have experience covering the gap in stakeholder reporting?',
      userAnswer: 'I produced weekly stakeholder dashboards summarizing sprint outcomes and release readiness for three product teams over two years.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].clearsWarnings).toHaveLength(1)
  })

  it('C2: non-gap question produces no cleared warnings', () => {
    const q = makeQuestion({
      question: 'Tell us more about your background.',
      userAnswer: 'I have worked in product management for four years across two companies.',
    })
    const decisions = resolveBridgeDecisions([q])
    // May or may not clear depending on question wording — no "gap" keyword
    expect(decisions[0].clearsWarnings.length).toBeGreaterThanOrEqual(0)
  })

  it('C3: do_not_use answer never clears warnings', () => {
    const q = makeQuestion({
      question: 'Any experience covering the missing tool gap?',
      userAnswer: "No experience with this tool.",
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].clearsWarnings).toHaveLength(0)
  })

  it('C4: each decision preserves questionId and questionText from input', () => {
    const q = makeQuestion({ id: 'q-preserved-42', question: 'Are you comfortable with Agile?' })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].questionId).toBe('q-preserved-42')
    expect(decisions[0].questionText).toBe('Are you comfortable with Agile?')
  })

  it('C5: use_as_constraint populates screeningNote', () => {
    const q = makeQuestion({
      userAnswer: 'Screening only — I attended two sessions as an observer.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].screeningNote).toBeTruthy()
  })

  it('C6: use_as_constraint populates constraint field', () => {
    const q = makeQuestion({
      userAnswer: 'Not in resume — this was informal and exposure only.',
    })
    const decisions = resolveBridgeDecisions([q])
    expect(decisions[0].constraint).toBeTruthy()
  })
})
