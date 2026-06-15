import { describe, expect, it } from 'vitest'
import type {
  ArtifactSection,
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeStrategyBrief,
  UserProfile,
} from '@/contracts'
import { buildResumeStrategyBrief, serializeResumeStrategyBriefForPrompt } from '@/lib/resume-strategy/resume-strategy-brief'
import { buildDefaultResumeWritingRuleset } from '@/lib/resume-strategy/resume-writing-ruleset'
import { reviewCriticalResumeArtifact } from '@/lib/stage4/critical-resume-review'
import { buildStage4RawResumeText } from '@/lib/stage4/raw-resume-text'

const jdMap: JDRequirementMap = {
  required: [
    { text: 'release readiness', category: 'process', userCoverageStatus: 'covered' },
    { text: 'backlog prioritization', category: 'process', userCoverageStatus: 'covered' },
  ],
  niceToHave: [],
  realJobFunction: 'Product Analyst',
  needsEvidenceItems: [],
  unsupportedRequirements: [],
  weaklySupportedRequirements: [],
}

const blueprint: ResumeGenerationContract = {
  targetRoleFamily: 'product_analyst',
  targetPosture: 'Product analyst posture with Experience carrying proof.',
  sectionPlan: {
    summary: { maxLines: 3 },
    skills: { maxRows: 4 },
    productOwner: { minBullets: 3, maxBullets: 5 },
    productAnalyst: { minBullets: 4, maxBullets: 5 },
    qa: { minBullets: 1, maxBullets: 2 },
    education: { maxLines: 3 },
  },
  sessionDirection: {
    representPOFrom2021: false,
    avoidFormalTitleHedging: true,
    targetPosture: 'Product analyst',
    roadmapBoundary: 'Execution and prioritization, not executive strategy ownership.',
    azureDevOpsAllowed: false,
    travelResumeAllowed: false,
    salesforcePreferredPhrase: 'CRM',
  },
  bannedPhrases: ['results-driven'],
  preferredReplacements: {},
  evidenceRouting: {},
  requiredBulletThemes: ['release readiness', 'backlog prioritization'],
}

function makeBrief(): ResumeStrategyBrief {
  return buildResumeStrategyBrief({
    jdMap,
    blueprint,
    targetRole: 'Product Analyst',
  })
}

describe('Resume strategy brief coordination', () => {
  it('converts reusable researched guidance into a compact Strategy Brief', () => {
    const ruleset = buildDefaultResumeWritingRuleset()
    const brief = makeBrief()

    expect(brief.sectionPurpose.summary).toBe(ruleset.sectionPurposeGuidance.summary)
    expect(brief.metricUseRules).toContain('Volume metrics require an outcome, decision quality, prioritization, backlog quality, or support-reduction tie.')
    expect(brief.antiPatternsToAvoid).toContain('Skills carrying the main fit argument without Experience proof.')
    expect(serializeResumeStrategyBriefForPrompt(brief)).toContain('RESUME STRATEGY BRIEF')
  })

  it('keeps the Blueprint session-specific and controlling section weighting', () => {
    const brief = makeBrief()

    expect(brief.targetRoleStrategy).toContain('Product Analyst')
    expect(brief.targetRoleStrategy).toContain('Summary max lines: 3')
    expect(brief.targetRoleStrategy).toContain('Skills max rows: 4')
  })

  it('stores the Strategy Brief with Stage 4 raw resume assembly', () => {
    const brief = makeBrief()
    const raw = buildStage4RawResumeText({
      sessionId: 's1',
      profile: makeProfile(),
      sections: makeSections(),
      allowDraft: true,
      contract: blueprint,
      strategyBrief: brief,
    })

    expect(raw.strategyBrief).toEqual(brief)
  })

  it('Critical Review uses the Strategy Brief to flag volume-led request load bullets', () => {
    const review = reviewCriticalResumeArtifact({
      ...makeReviewInput('Managed recurring request load for stakeholders.'),
      strategyBrief: makeBrief(),
    })

    expect(review.sectionFindings.flatMap(s => s.findings.map(f => f.issueType))).toContain('volume_led_bullet')
  })

  it('Critical Review uses the Strategy Brief to flag Summary proof recap', () => {
    const review = reviewCriticalResumeArtifact({
      ...makeReviewInput('Prioritized backlog to improve readiness.'),
      artifactText: `SUMMARY
Product analyst who partnered with 5 engineers to improve 25% release readiness.

SKILLS
Product: release readiness

EXPERIENCE
- Partnered with 5 engineers to improve 25% release readiness through clearer acceptance criteria.`,
      strategyBrief: makeBrief(),
    })

    expect(review.sectionFindings.flatMap(s => s.findings.map(f => f.issueType))).toContain('summary_duplicates_proof')
  })

  it('Critical Review uses Strategy Brief JD themes to require Experience proof instead of Skills-only fit', () => {
    const customBrief = {
      ...makeBrief(),
      jdCriticalThemes: [
        { theme: 'stakeholder translation', mustAppearIn: ['experience'], evidenceRequired: true },
      ],
    }

    const review = reviewCriticalResumeArtifact({
      ...makeReviewInput('Clarified release notes with engineering.'),
      artifactText: `SUMMARY
Product analyst focused on release readiness.

SKILLS
Product: stakeholder translation

EXPERIENCE
- Clarified release notes with engineering.`,
      strategyBrief: customBrief,
    })

    expect(review.sectionFindings.flatMap(s => s.findings.map(f => f.issueType))).toContain('skills_carry_fit_without_experience_proof')
  })

  it('returns no numeric score fields and keeps directives executable and evidence-bound', () => {
    const review = reviewCriticalResumeArtifact({
      ...makeReviewInput('Managed recurring request load for stakeholders.'),
      strategyBrief: makeBrief(),
    })

    expect(objectKeysDeep(review).join(' ')).not.toMatch(/score|rating|grade/i)
    const directive = review.rewriteDirectives.find(d => d.sourceIssueType === 'volume_led_bullet')
    expect(directive?.allowedEvidenceIds).toEqual(['E1', 'E2'])
    expect(directive?.successCriteria.length).toBeGreaterThan(0)
  })
})

function makeReviewInput(bullet: string) {
  return {
    targetJd: jdMap,
    resumeBlueprint: 'Summary positions; Skills supports ATS; Experience proves JD-critical themes.',
    evidenceMap: [
      { id: 'E1', text: 'Improved release readiness through acceptance criteria.', allowedSections: ['experience'] },
      { id: 'E2', text: 'Prioritized backlog requests with stakeholders.', allowedSections: ['experience'] },
    ],
    sectionStrategies: [
      {
        sectionKey: 'experience',
        sectionPurpose: 'proof' as const,
        requiredThemes: ['release readiness'],
        allowedEvidenceIds: ['E1', 'E2'],
      },
    ],
    artifactText: `SUMMARY
Product analyst focused on release readiness and backlog quality.

SKILLS
Product: release readiness

EXPERIENCE
- ${bullet}`,
    deterministicValidation: {
      pass: true,
      violations: [],
      suggestedRepairs: [],
    },
  }
}

function objectKeysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(objectKeysDeep)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...objectKeysDeep(child)])
}

function makeProfile(): UserProfile {
  return {
    id: 'p1',
    fullName: 'Test User',
    email: 'test@example.com',
    phone: '',
    location: '',
    linkedIn: '',
    summary: '',
    workHistory: [
      {
        id: 'w1',
        company: 'Example Co',
        title: 'Product Analyst',
        startDate: '2022',
        endDate: '2025',
        bullets: [],
        approvedMetrics: [],
      },
    ],
    education: [],
    skillGroups: [],
    skills: [],
    certifications: [],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: '2026-01-01',
  }
}

function makeSections(): ArtifactSection[] {
  const now = '2026-01-01T00:00:00.000Z'
  return [
    section('summary', 'Product analyst focused on release readiness.', now),
    section('skills', 'Product: release readiness', now),
    section('experience-ba', '- Improved release readiness through clearer acceptance criteria.', now),
  ]
}

function section(type: ArtifactSection['type'], content: string, now: string): ArtifactSection {
  return {
    id: type,
    sessionId: 's1',
    type,
    content,
    bullets: [],
    status: 'accepted',
    generationRationale: '',
    jdTraceability: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}
