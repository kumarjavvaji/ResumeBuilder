/**
 * Tests for QualifiedEvidenceCards and ClaimFidelityCheck.
 *
 * Uses purely synthetic fixtures — no company-specific or role-specific
 * hardcoding. Three role families are tested:
 *   1. Product Analytics (BA emphasis, analytics-heavy JD)
 *   2. Product Owner (PO emphasis, delivery-focused JD)
 *   3. QA/Quality (QA emphasis, testing-focused JD)
 *
 * Success criteria from the spec:
 *   SC1: Tool studied but not used professionally → learning-only
 *   SC2: Reporting via one tool → not upgraded to platform ownership
 *   SC3: Adjacent experience → adjacent card, not direct
 *   SC4: DomainIQ context → handled by generation rules, not cards
 *   SC5: Learning-only + professional verbs → fidelity violation
 *   SC6: Negative evidence → negative card, no resume claim
 *   SC7: Evaluator lens inferred at runtime
 *   SC8: Brief built from runtime data (claimGuardrails from cards)
 *   SC9: CLAIM GUARDRAILS section appears in serialized brief
 *   SC10: System works across ≥3 role families
 */

import { describe, it, expect } from 'vitest'
import {
  buildQualifiedEvidenceCards,
  deriveClaimGuardrails,
  extractEvidenceKeywords,
} from '@/lib/llm/qualified-evidence-cards'
import { runClaimFidelityCheck } from '@/lib/llm/claim-fidelity-check'
import { buildArtifactGenerationBrief, serializeBriefForPrompt } from '@/lib/llm/artifact-generation-brief'
import { buildScopedEvidenceBundle } from '@/lib/evidence-scope'
import type { UserProfile, BridgeQuestion, JDRequirementMap, WorkEntry } from '@/contracts'

// ─── Synthetic test helpers ───────────────────────────────────────────────────

function makeWork(id: string, title: string, company: string, bullets: string[], metrics: string[] = []): WorkEntry {
  return {
    id,
    title,
    company,
    startDate: '2020-01',
    endDate: 'present',
    bullets,
    approvedMetrics: metrics,
    domain: 'fintech',
    skills: [],
  }
}

function makeQuestion(id: string, answer: string, section: string, type: BridgeQuestion['type'] = 'evidence'): BridgeQuestion {
  return {
    id,
    sessionId: 'sess-test',
    question: `Question about ${id}`,
    type,
    priority: 'high',
    affectedArtifactSection: section,
    status: 'answered',
    userAnswer: answer,
    createdAt: new Date().toISOString(),
  }
}

function makeJD(terms: string[]): JDRequirementMap {
  return {
    required: terms.map(t => ({
      text: t,
      category: 'technical' as const,
      userCoverageStatus: 'covered' as const,
    })),
    niceToHave: [],
    realJobFunction: 'Analytics',
    needsEvidenceItems: [],
    unsupportedRequirements: [],
    weaklySupportedRequirements: [],
  }
}

function makeProfile(
  workHistory: WorkEntry[],
  skills: string[] = [],
  skillGroups: UserProfile['skillGroups'] = [],
): UserProfile {
  return {
    id: 'profile-test',
    fullName: 'Test User',
    email: 'test@example.com',
    phone: '',
    location: '',
    linkedIn: '',
    summary: '',
    workHistory,
    education: [],
    skills,
    skillGroups,
    constraints: [],
  }
}

// ─── Fixture 1: Product Analytics ────────────────────────────────────────────

const analyticsWork = [
  makeWork('w-pa', 'Product Analyst', 'FinCo', [
    'Queried Salesforce and Pendo data using SQL to produce weekly KPI reports',
    'Validated data quality across reporting pipeline with documented assumptions',
  ], ['Reduced report turnaround from 3 days to 1 day']),
  makeWork('w-po', 'Product Owner', 'AgileShop', [
    'Managed product backlog in Jira and ran sprint reviews with engineering',
    'Owned the calendar platform roadmap for three product quarters',
  ]),
]

const analyticsQuestions: BridgeQuestion[] = [
  makeQuestion('q-sql', 'I use SQL daily to query Salesforce and Pendo data for reports in my role', 'experience-ba'),
  makeQuestion('q-pbi', 'I learned Power BI in a course last year but haven\'t used it professionally in my role', 'experience-ba'),
  makeQuestion('q-hmda', 'I\'m not sure about HMDA compliance requirements — I don\'t have experience with that', 'experience-ba'),
  makeQuestion('q-tableau', 'I\'ve done some Tableau training on my own but it was outside my current role', 'experience-ba'),
]

const analyticsJD = makeJD(['SQL and data analysis', 'KPI measurement and dashboards', 'Salesforce CRM analytics', 'Pendo product analytics'])
const analyticsProfile = makeProfile(analyticsWork, [], [
  { id: 'sg1', heading: 'Data', skills: ['SQL', 'Salesforce', 'Pendo', 'Excel'] },
  { id: 'sg2', heading: 'Analysis', skills: ['KPI Measurement', 'Data Validation', 'Opportunity Sizing'] },
])

// ─── Fixture 2: Product Owner ─────────────────────────────────────────────────

const poWork = [
  makeWork('w-pm', 'Product Manager', 'AgileShop', [
    'Led sprint planning and backlog grooming sessions with cross-functional teams',
    'Delivered three product launches on time through dependency tracking',
  ], ['Improved sprint velocity by 22% over two quarters']),
  makeWork('w-ba', 'Business Analyst', 'OldCo', [
    'Documented requirements and gap analysis for CRM migration project',
    'Facilitated UAT sessions and produced acceptance criteria documentation',
  ]),
]

const poQuestions: BridgeQuestion[] = [
  makeQuestion('q-jira', 'I led sprint reviews and managed the product backlog in Jira as part of my daily work', 'experience-po', 'evidence'),
  makeQuestion('q-agile-cert', 'I studied for an agile certification on my own but it wasn\'t part of my core work responsibilities', 'experience-po', 'evidence'),
]

const poJD = makeJD(['Backlog management and sprint delivery', 'Stakeholder alignment', 'Roadmap ownership', 'JIRA and agile tooling'])
const poProfile = makeProfile(poWork, [], [
  { id: 'sg1', heading: 'Product', skills: ['Jira', 'Backlog Management', 'Sprint Planning', 'Roadmap'] },
  { id: 'sg2', heading: 'Delivery', skills: ['Stakeholder Alignment', 'Dependency Tracking'] },
])

// ─── Fixture 3: QA / Quality ──────────────────────────────────────────────────

const qaWork = [
  makeWork('w-qa', 'QA Lead', 'SoftwareCo', [
    'Built SpecFlow automation framework from scratch, reducing regression time by 40%',
    'Coordinated release readiness checks across three product teams',
  ], ['Zero critical defects escaped to production for eight consecutive sprints']),
  makeWork('w-po-qa', 'Product Owner', 'TechCo', [
    'Prioritized backlog and owned the roadmap for two product lines',
  ]),
]

const qaQuestions: BridgeQuestion[] = [
  makeQuestion('q-specflow', 'I built our SpecFlow automation framework from scratch in my QA Lead role', 'experience-qa', 'evidence'),
  makeQuestion('q-playwright', 'I\'ve read about Playwright but never used it professionally', 'experience-qa', 'evidence'),
]

const qaJD = makeJD(['Test automation and quality frameworks', 'SpecFlow and regression testing', 'Release readiness', 'Defect reduction metrics'])
const qaProfile = makeProfile(qaWork, [], [
  { id: 'sg1', heading: 'Testing', skills: ['SpecFlow', 'Regression Testing', 'Test Automation', 'Release Readiness'] },
])

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('buildQualifiedEvidenceCards', () => {
  // SC3 + SC10: Direct work history bullets → direct evidence card
  it('classifies primary work entry bullets as direct evidence (analytics fixture)', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const directCards = cards.filter(
      c => c.sourceType === 'work-history-bullet' && c.evidenceType === 'direct'
    )
    const paWorkCards = directCards.filter(c => c.sourceId === 'w-pa')
    expect(paWorkCards.length).toBeGreaterThanOrEqual(2)
    expect(paWorkCards[0].confidence).not.toBe('none')
    expect(paWorkCards[0].useInSections).toContain('experience-ba')
    expect(paWorkCards[0].avoidInSections).toHaveLength(0)
  })

  // SC3: Supporting work entry bullets → adjacent evidence card
  it('classifies supporting work entry bullets as adjacent with framing boundaries', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const adjacentCards = cards.filter(
      c => c.sourceType === 'work-history-bullet' && c.evidenceType === 'adjacent'
    )
    expect(adjacentCards.length).toBeGreaterThanOrEqual(1)
    const poCard = adjacentCards[0]
    expect(poCard.boundaries.length).toBeGreaterThan(0)
    expect(poCard.boundaries[0]).toMatch(/prior-background framing/i)
    expect(poCard.avoidInSections).toContain('experience-ba')
    expect(poCard.useInSections).toContain('summary')
  })

  // SC1: "I learned X in a course but haven't used it professionally" → learning-only
  it('classifies learning-only bridge answers correctly', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const pbiCard = cards.find(c => c.sourceType === 'bridge-answer' && c.sourceId === 'q-pbi')
    expect(pbiCard).toBeDefined()
    expect(pbiCard!.evidenceType).toBe('learning-only')
    expect(pbiCard!.confidence).toBe('low')
    expect(pbiCard!.avoidInSections).toContain('experience-ba')
    expect(pbiCard!.prohibitedResumeLanguage.length).toBeGreaterThan(0)
  })

  it('classifies self-taught Tableau as learning-only', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const tableauCard = cards.find(c => c.sourceType === 'bridge-answer' && c.sourceId === 'q-tableau')
    expect(tableauCard).toBeDefined()
    expect(tableauCard!.evidenceType).toBe('learning-only')
    expect(tableauCard!.safeResumeClaim).toMatch(/familiar with|developing/i)
  })

  // SC6: "I don't have experience / not sure" → learning-only, confidence: none
  it('classifies negative/uncertain bridge answers with none confidence', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const hmdaCard = cards.find(c => c.sourceType === 'bridge-answer' && c.sourceId === 'q-hmda')
    expect(hmdaCard).toBeDefined()
    expect(hmdaCard!.evidenceType).toBe('learning-only')
    expect(hmdaCard!.confidence).toBe('none')
    expect(hmdaCard!.useInSections).toHaveLength(0)
    expect(hmdaCard!.safeResumeClaim).toBe('')
  })

  // Metrics → high confidence metric cards
  it('creates high-confidence metric cards from approved metrics', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const metricCards = cards.filter(c => c.sourceType === 'work-history-metric')
    expect(metricCards.length).toBeGreaterThanOrEqual(1)
    expect(metricCards[0].confidence).toBe('high')
    expect(metricCards[0].evidenceType).toBe('metric')
    expect(metricCards[0].notesForGenerator).toMatch(/use exactly as stated/i)
  })

  // "I use SQL daily in my role" → direct, medium confidence bridge card
  it('classifies direct professional bridge answers as direct evidence', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const sqlCard = cards.find(c => c.sourceType === 'bridge-answer' && c.sourceId === 'q-sql')
    expect(sqlCard).toBeDefined()
    expect(sqlCard!.evidenceType).toBe('direct')
    expect(sqlCard!.confidence).toBe('medium')
    expect(sqlCard!.prohibitedResumeLanguage).toHaveLength(0)
  })

  // SC10: Works for PO role family
  it('classifies primary work entry as direct for PO fixture', () => {
    const bundle = buildScopedEvidenceBundle(poProfile, poQuestions, 'experience-po')
    const cards = buildQualifiedEvidenceCards(poProfile, poQuestions, poJD, bundle)

    const pmBulletCards = cards.filter(c => c.sourceType === 'work-history-bullet' && c.sourceId === 'w-pm')
    expect(pmBulletCards.length).toBeGreaterThanOrEqual(1)
    expect(pmBulletCards[0].evidenceType).toBe('direct')

    const baBulletCards = cards.filter(c => c.sourceType === 'work-history-bullet' && c.sourceId === 'w-ba')
    expect(baBulletCards.length).toBeGreaterThanOrEqual(1)
    expect(baBulletCards[0].evidenceType).toBe('adjacent')
  })

  // SC10: Works for QA role family
  it('classifies QA lead work as direct and Playwright bridge answer as learning-only', () => {
    const bundle = buildScopedEvidenceBundle(qaProfile, qaQuestions, 'experience-qa')
    const cards = buildQualifiedEvidenceCards(qaProfile, qaQuestions, qaJD, bundle)

    const qaDirectCards = cards.filter(c => c.sourceType === 'work-history-bullet' && c.sourceId === 'w-qa')
    expect(qaDirectCards.length).toBeGreaterThanOrEqual(1)
    expect(qaDirectCards[0].evidenceType).toBe('direct')

    const playwrightCard = cards.find(c => c.sourceType === 'bridge-answer' && c.sourceId === 'q-playwright')
    expect(playwrightCard).toBeDefined()
    expect(playwrightCard!.evidenceType).toBe('learning-only')
  })
})

// ─── Claim fidelity check tests ───────────────────────────────────────────────

describe('runClaimFidelityCheck', () => {
  // SC5: Professional verb + learning-only evidence → violation
  it('detects learning-only overclaim when professional verbs used', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const bullets = [
      { text: 'Led Power BI dashboard strategy and owned reporting infrastructure for the team' },
    ]
    const result = runClaimFidelityCheck(bullets, cards)

    expect(result.passed).toBe(false)
    expect(result.violations.length).toBeGreaterThanOrEqual(1)
    expect(result.violations[0].violationType).toBe('learning-only-overclaim')
    expect(result.violations[0].bulletIndex).toBe(0)
  })

  // SC5: Familiar-with framing for learning-only evidence → no violation
  it('passes clean framing for learning-only evidence', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const bullets = [
      { text: 'Familiar with Power BI — developing proficiency through online coursework' },
    ]
    const result = runClaimFidelityCheck(bullets, cards)
    expect(result.passed).toBe(true)
  })

  // SC3: Adjacent bullet without framing + professional verb → violation
  it('detects adjacent overclaim when prior-background framing is absent', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    // PO work "backlog" keyword + professional verb "managed" without framing
    const bullets = [
      { text: 'Managed product backlog and owned calendar platform roadmap for three product quarters' },
    ]
    const result = runClaimFidelityCheck(bullets, cards)
    expect(result.passed).toBe(false)
    const adj = result.violations.find(v => v.violationType === 'adjacent-overclaim')
    expect(adj).toBeDefined()
  })

  // SC3: Adjacent bullet WITH prior-background framing → no violation
  it('passes adjacent bullet when explicit prior-background framing is present', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const bullets = [
      { text: 'Prior background in backlog management and roadmap planning from an earlier Product Owner role' },
    ]
    const result = runClaimFidelityCheck(bullets, cards)
    expect(result.passed).toBe(true)
  })

  // SC6: Negative evidence used for positive claim → violation
  it('detects claim made from negative evidence', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    // HMDA is the topic user denied
    const bullets = [
      { text: 'Managed HMDA compliance reporting for the regulatory data team' },
    ]
    const result = runClaimFidelityCheck(bullets, cards)
    expect(result.passed).toBe(false)
    const neg = result.violations.find(v => v.violationType === 'negative-claim')
    expect(neg).toBeDefined()
  })

  // Clean bullets with no violations
  it('passes all bullets when no violations are present', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const bullets = [
      { text: 'Queried Salesforce and Pendo data using SQL to produce weekly KPI reports' },
      { text: 'Validated data quality across reporting pipeline with documented assumptions' },
      { text: 'Reduced report turnaround from 3 days to 1 day through query optimization' },
    ]
    const result = runClaimFidelityCheck(bullets, cards)
    expect(result.passed).toBe(true)
  })
})

// ─── Brief integration tests ──────────────────────────────────────────────────

describe('ArtifactGenerationBrief with evidence cards', () => {
  // SC8: claimGuardrails derived from runtime cards
  it('derives claimGuardrails from evidence cards and includes them in the brief', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-ba',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Target Corp',
      jdMap: analyticsJD,
      bundle,
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
      qualifiedEvidenceCards: cards,
    })

    expect(brief.claimGuardrails).toBeDefined()
    // Power BI and Tableau should appear in learningOnlyItems
    const learningItems = brief.claimGuardrails.learningOnlyItems.join(' ')
    expect(learningItems.length).toBeGreaterThan(0)
  })

  it('populates noEvidenceItems for denied/uncertain bridge answers', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)
    const guardrails = deriveClaimGuardrails(cards)

    // HMDA was denied — should not appear in learningOnly (that's for low-confidence learning)
    // but should be in noEvidenceItems
    expect(guardrails.noEvidenceItems.length).toBeGreaterThan(0)
  })

  // SC9: CLAIM GUARDRAILS block appears in serialized brief
  it('serializes CLAIM GUARDRAILS section in brief when guardrails exist', () => {
    const bundle = buildScopedEvidenceBundle(analyticsProfile, analyticsQuestions, 'experience-ba')
    const cards = buildQualifiedEvidenceCards(analyticsProfile, analyticsQuestions, analyticsJD, bundle)

    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-ba',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Target Corp',
      jdMap: analyticsJD,
      bundle,
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
      qualifiedEvidenceCards: cards,
    })

    const serialized = serializeBriefForPrompt(brief)
    expect(serialized).toContain('CLAIM GUARDRAILS')
    expect(serialized).toContain('Learning-only')
  })

  // Brief without cards still builds correctly (empty guardrails)
  it('builds brief without cards and produces empty guardrails', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-ba',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Target Corp',
      jdMap: analyticsJD,
      bundle: buildScopedEvidenceBundle(analyticsProfile, [], 'experience-ba'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })

    expect(brief.claimGuardrails.learningOnlyItems).toHaveLength(0)
    expect(brief.claimGuardrails.noEvidenceItems).toHaveLength(0)
    const serialized = serializeBriefForPrompt(brief)
    // No guardrails block when empty
    expect(serialized).not.toContain('CLAIM GUARDRAILS')
  })
})

// ─── Keyword extraction ───────────────────────────────────────────────────────

describe('extractEvidenceKeywords', () => {
  it('extracts ALLCAPS acronyms', () => {
    const kw = extractEvidenceKeywords('Managed NCUA compliance and HMDA reporting')
    expect(kw).toContain('NCUA')
    expect(kw).toContain('HMDA')
  })

  it('extracts tool names with mixed case', () => {
    const kw = extractEvidenceKeywords('Built automation using SpecFlow and Playwright for regression')
    expect(kw.some(k => /specflow|playwright/i.test(k))).toBe(true)
  })

  it('extracts title-cased platform names', () => {
    const kw = extractEvidenceKeywords('Used Power BI and Microsoft Excel for dashboard reporting')
    expect(kw.some(k => /Power BI|Microsoft Excel/i.test(k))).toBe(true)
  })
})
