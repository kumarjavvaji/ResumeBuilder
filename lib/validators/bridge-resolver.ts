import type { BridgeDispositionType, BridgeQuestion, ResolvedBridgeDecision } from '@/contracts'
import { classifyBridgeAnswerConfidence } from '@/lib/evidence-scope'

// Phrases that strongly suggest the answer should NOT go into the resume body
const CONSTRAINT_PHRASES = [
  'only for screening',
  'not in resume',
  'screening only',
  'informal',
  'not official',
  'briefly mentioned',
  'exposure only',
  'minor exposure',
  'tangentially',
]

// Phrases that suggest the answer needs rewriting before use
const REWRITE_PHRASES = [
  ' but ',
  ' however ',
  ' although ',
  'technically',
  'sort of',
  'kind of',
  'mostly',
  'primarily',
  'to some extent',
  'in a limited way',
]

// Phrases that indicate the answer explicitly has nothing to offer
const NEGATIVE_PHRASES = [
  "don't have",
  'do not have',
  "didn't",
  'no experience',
  'not applicable',
  'n/a',
  'skip this',
  'not relevant',
  'zero experience',
  'never used',
  'never worked',
]

export function resolveBridgeDecisions(
  questions: BridgeQuestion[],
): ResolvedBridgeDecision[] {
  return questions
    .filter(q => q.status === 'answered' && q.userAnswer?.trim())
    .map(resolveOne)
}

function resolveOne(q: BridgeQuestion): ResolvedBridgeDecision {
  const answer = (q.userAnswer ?? '').trim()
  const answerLower = answer.toLowerCase()
  const confidence = classifyBridgeAnswerConfidence(answerLower)

  let dispositionType: BridgeDispositionType
  let routeToResume = true
  let constraint: string | undefined
  let screeningNote: string | undefined

  if (NEGATIVE_PHRASES.some(p => answerLower.includes(p)) || confidence === 'none') {
    dispositionType = 'do_not_use'
    routeToResume = false
  } else if (CONSTRAINT_PHRASES.some(p => answerLower.includes(p))) {
    dispositionType = 'use_as_constraint'
    routeToResume = false
    constraint = `Screening context only: ${answer.slice(0, 120)}`
    screeningNote = answer
  } else if (confidence === 'low' && REWRITE_PHRASES.some(p => answerLower.includes(p))) {
    dispositionType = 'needs_clarification'
    routeToResume = false
  } else if (REWRITE_PHRASES.some(p => answerLower.includes(p)) || confidence === 'medium') {
    dispositionType = 'use_after_rewrite'
    routeToResume = true
  } else if (confidence === 'high') {
    dispositionType = 'use_directly'
    routeToResume = true
  } else {
    dispositionType = 'use_after_rewrite'
    routeToResume = true
  }

  return {
    questionId: q.id,
    questionText: q.question,
    userAnswer: answer,
    dispositionType,
    normalizedStatement: normalizeStatement(answer, dispositionType),
    clearsWarnings: deriveClearedWarnings(q, dispositionType),
    constraint,
    screeningNote,
    routeToResume,
  }
}

function deriveClearedWarnings(
  q: BridgeQuestion,
  disposition: BridgeDispositionType,
): string[] {
  if (disposition === 'do_not_use' || disposition === 'needs_clarification') return []
  // A confident answer to a gap/coverage question clears that gap warning
  if (/gap|missing|cover|experience with|background in/i.test(q.question)) {
    return [q.question.slice(0, 80)]
  }
  return []
}

function normalizeStatement(answer: string, disposition: BridgeDispositionType): string {
  if (disposition === 'do_not_use') return ''
  if (disposition === 'use_as_constraint') return `[constraint] ${answer.slice(0, 120)}`
  if (disposition === 'needs_clarification') return `[needs_clarification] ${answer.slice(0, 80)}`
  // Truncate to 200 chars for downstream prompt injection
  return answer.slice(0, 200)
}
