/**
 * stage4-quality-trace.test.ts — A–E suites
 *
 * Proves that existing resume-writing guidance flows into Stage 4 generation,
 * review, and repair. All fixtures are synthetic.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type {
  ArtifactSection,
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeStrategyBrief,
  UserProfile,
} from '@/contracts'
import { buildResumeStrategyBrief } from '@/lib/resume-strategy/resume-strategy-brief'
import { buildStage4RawResumeText } from '@/lib/stage4/raw-resume-text'
import {
  buildPromptMetadata,
  buildStage4QualityTrace,
  buildRepairTrace,
  buildEmptyRepairTrace,
} from '@/lib/stage4/quality-trace'

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const jdMap: JDRequirementMap = {
  required: [
    { text: 'backlog prioritization', category: 'process', userCoverageStatus: 'covered' },
    { text: 'release readiness', category: 'process', userCoverageStatus: 'covered' },
  ],
  niceToHave: [],
  realJobFunction: 'Product Analyst',
  needsEvidenceItems: [],
  unsupportedRequirements: [],
  weaklySupportedRequirements: [],
}

const blueprint: ResumeGenerationContract = {
  targetRoleFamily: 'secondary',
  targetPosture: 'Product analyst posture.',
  sectionPlan: {
    summary: { maxLines: 3 },
    skills: { maxRows: 4 },
    primaryRole: { minBullets: 3, maxBullets: 5 },
    secondaryRole: { minBullets: 4, maxBullets: 5 },
    supportingRole: { minBullets: 1, maxBullets: 2 },
    education: { maxLines: 3 },
  },
  sessionDirection: {
    representPrimaryRole: false,
    avoidFormalTitleHedging: true,
    targetPosture: 'Product analyst',
    roadmapBoundary: 'Execution and prioritization.',
    azureDevOpsAllowed: false,
    travelResumeAllowed: false,
    salesforcePreferredPhrase: 'CRM',
  },
  bannedPhrases: ['results-driven'],
  preferredReplacements: {},
  evidenceRouting: {},
  requiredBulletThemes: ['release readiness'],
}

function makeBrief(): ResumeStrategyBrief {
  return buildResumeStrategyBrief({ jdMap, blueprint, targetRole: 'Product Analyst' })
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
        domain: '',
        skills: [],
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

function makeSection(type: ArtifactSection['type'], content: string): ArtifactSection {
  const now = '2026-01-01T00:00:00.000Z'
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

function makeSections(): ArtifactSection[] {
  return [
    makeSection('summary', 'Product analyst focused on release readiness.'),
    makeSection('skills', 'Product: backlog prioritization, release readiness'),
    makeSection('experience-primary', '- Led backlog prioritization with stakeholders.'),
    makeSection('experience-secondary', '- Improved release readiness through acceptance criteria.'),
    makeSection('experience-supporting', '- Validated scope before sprint commitment.'),
  ]
}

// ─── Suite A: Ruleset → Strategy Brief ───────────────────────────────────────

describe('A: Ruleset → Strategy Brief', () => {
  it('A1: rulesetTrace.rulesetLoaded is true when strategy brief is present', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      strategyBrief: makeBrief(),
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.rulesetTrace.rulesetLoaded).toBe(true)
  })

  it('A2: rulesetTrace.rulesetLoaded is false when no strategy brief', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.rulesetTrace.rulesetLoaded).toBe(false)
    expect(trace.rulesetTrace.activeRuleIds).toHaveLength(0)
    expect(trace.rulesetTrace.antiPatternIds).toHaveLength(0)
  })

  it('A3: activeRuleIds uses source-backed rule IDs when present', () => {
    const brief = makeBrief()
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      strategyBrief: brief,
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.rulesetTrace.activeRuleIds).toEqual(brief.activeRuleIds)
    expect(trace.rulesetTrace.activeRuleIds).toContain('scrum-po-value-delivery')
  })

  it('A4: antiPatternIds count matches antiPatternsToAvoid in the brief', () => {
    const brief = makeBrief()
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      strategyBrief: brief,
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.rulesetTrace.antiPatternIds).toHaveLength(brief.antiPatternsToAvoid.length)
  })
})

// ─── Suite B: Strategy Brief → Generation Prompt (prompt metadata) ───────────

describe('B: Strategy Brief → Generation Prompt metadata', () => {
  it('B1: strategyBriefIncluded is true when brief is provided', () => {
    const meta = buildPromptMetadata({ strategyBrief: makeBrief(), contract: blueprint })
    expect(meta.strategyBriefIncluded).toBe(true)
  })

  it('B2: strategyBriefIncluded is false when brief is absent', () => {
    const meta = buildPromptMetadata({ contract: blueprint })
    expect(meta.strategyBriefIncluded).toBe(false)
  })

  it('B3: blueprintIncluded is true when contract is provided', () => {
    const meta = buildPromptMetadata({ strategyBrief: makeBrief(), contract: blueprint })
    expect(meta.blueprintIncluded).toBe(true)
  })

  it('B4: bannedPhrasesIncluded is true when contract has banned phrases', () => {
    const meta = buildPromptMetadata({ contract: blueprint })
    expect(meta.bannedPhrasesIncluded).toBe(true)
  })

  it('B5: antiPatternsIncluded is true when brief has anti-patterns', () => {
    const brief = makeBrief()
    expect(brief.antiPatternsToAvoid.length).toBeGreaterThan(0)
    const meta = buildPromptMetadata({ strategyBrief: brief })
    expect(meta.antiPatternsIncluded).toBe(true)
  })

  it('B6: rewritePreferencesIncluded is true when brief has rewrite preferences', () => {
    const brief = makeBrief()
    expect(brief.rewritePreferences.length).toBeGreaterThan(0)
    const meta = buildPromptMetadata({ strategyBrief: brief })
    expect(meta.rewritePreferencesIncluded).toBe(true)
  })

  it('B7: evidenceMapIncluded true when jdMap provided', () => {
    const meta = buildPromptMetadata({ jdMap })
    expect(meta.evidenceMapIncluded).toBe(true)
  })

  it('B8: strategyBriefTrace reflects JD critical themes', () => {
    const brief = makeBrief()
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      strategyBrief: brief,
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.strategyBriefTrace.built).toBe(true)
    expect(trace.strategyBriefTrace.jdCriticalThemes.length).toBeGreaterThan(0)
    expect(trace.strategyBriefTrace.jdCriticalThemes).toContain('backlog prioritization')
  })
})

// ─── Suite C: Blueprint → Generation trace fields ────────────────────────────

describe('C: Blueprint → Generation trace fields', () => {
  it('C1: blueprintTrace.built is true when contract is provided', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.blueprintTrace.built).toBe(true)
  })

  it('C2: blueprintTrace.built is false when no contract', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.blueprintTrace.built).toBe(false)
    expect(trace.blueprintTrace.sectionKeys).toHaveLength(0)
  })

  it('C3: blueprintTrace.bulletIntentCount reflects sectionPlan bullets', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    const expected =
      blueprint.sectionPlan.primaryRole.minBullets +
      blueprint.sectionPlan.secondaryRole.minBullets +
      blueprint.sectionPlan.supportingRole.minBullets
    expect(trace.blueprintTrace.bulletIntentCount).toBe(expected)
  })

  it('C4: generationTrace.promptIncludesStrategyBrief matches brief presence', () => {
    const withBrief = buildStage4QualityTrace({
      sessionId: 's1',
      strategyBrief: makeBrief(),
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    const withoutBrief = buildStage4QualityTrace({
      sessionId: 's1',
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(withBrief.generationTrace.promptIncludesStrategyBrief).toBe(true)
    expect(withoutBrief.generationTrace.promptIncludesStrategyBrief).toBe(false)
  })

  it('C5: generationTrace.promptIncludesBannedPhrases is true when contract has phrases', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      contract: blueprint,
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.generationTrace.promptIncludesBannedPhrases).toBe(true)
  })

  it('C6: raw resume output stores qualityTrace when built with contract + brief', () => {
    const raw = buildStage4RawResumeText({
      sessionId: 's1',
      profile: makeProfile(),
      sections: makeSections(),
      allowDraft: true,
      contract: blueprint,
      strategyBrief: makeBrief(),
    })
    expect(raw.qualityTrace).toBeDefined()
    expect(raw.qualityTrace?.rulesetTrace.rulesetLoaded).toBe(true)
    expect(raw.qualityTrace?.blueprintTrace.built).toBe(true)
  })
})

// ─── Suite D: Generated Output → Critical Review ─────────────────────────────

describe('D: Generated Output → Critical Review', () => {
  it('D1: reviewTrace.ranCriticalReview is false when jdMap is absent', () => {
    const raw = buildStage4RawResumeText({
      sessionId: 's1',
      profile: makeProfile(),
      sections: makeSections(),
      allowDraft: true,
      contract: blueprint,
      strategyBrief: makeBrief(),
      // no jdMap → review skipped
    })
    expect(raw.qualityTrace?.reviewTrace.ranCriticalReview).toBe(false)
  })

  it('D2: reviewTrace.ranCriticalReview is true when strategyBrief + jdMap both provided', () => {
    const raw = buildStage4RawResumeText({
      sessionId: 's1',
      profile: makeProfile(),
      sections: makeSections(),
      allowDraft: true,
      contract: blueprint,
      strategyBrief: makeBrief(),
      jdMap,
    })
    expect(raw.qualityTrace?.reviewTrace.ranCriticalReview).toBe(true)
  })

  it('D2b: live Stage 4 generate call passes jdMap into raw assembly', () => {
    const src = readFileSync(
      join(__dirname, '../components/export/raw-resume-text-page.tsx'),
      'utf-8',
    )
    const buildCall = src.slice(
      src.indexOf('const assembled = buildStage4RawResumeText({'),
      src.indexOf('const saved = await saveStage4RawResumeText(assembled)'),
    )
    expect(buildCall).toContain('strategyBrief')
    expect(buildCall).toContain('jdMap')
    expect(buildCall).toContain('jdRequirementMap')
  })

  it('D3: reviewTrace includes artifactStatus when review ran', () => {
    const raw = buildStage4RawResumeText({
      sessionId: 's1',
      profile: makeProfile(),
      sections: makeSections(),
      allowDraft: true,
      contract: blueprint,
      strategyBrief: makeBrief(),
      jdMap,
    })
    expect(raw.qualityTrace?.reviewTrace.artifactStatus).toBeDefined()
  })

  it('D4: reviewTrace.rewriteDirectiveCount is a non-negative number', () => {
    const raw = buildStage4RawResumeText({
      sessionId: 's1',
      profile: makeProfile(),
      sections: makeSections(),
      allowDraft: true,
      contract: blueprint,
      strategyBrief: makeBrief(),
      jdMap,
    })
    expect(raw.qualityTrace?.reviewTrace.rewriteDirectiveCount).toBeGreaterThanOrEqual(0)
  })
})

// ─── Suite E: Trace Object integrity ─────────────────────────────────────────

describe('E: Trace Object integrity', () => {
  it('E1: trace has sessionId and generatedAt', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 'session-abc',
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.sessionId).toBe('session-abc')
    expect(trace.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('E2: empty repair trace has all false fields', () => {
    const repair = buildEmptyRepairTrace()
    expect(repair.repairAttempted).toBe(false)
    expect(repair.deterministicRepairApplied).toBe(false)
    expect(repair.llmRepairApplied).toBe(false)
    expect(repair.finalValidationPassed).toBe(false)
  })

  it('E3: buildRepairTrace marks deterministicRepairApplied when repairs > 0', () => {
    const repair = buildRepairTrace({
      repairAttempted: true,
      deterministicRepairsApplied: 2,
      llmRepairApplied: false,
      finalValidationPassed: true,
    })
    expect(repair.deterministicRepairApplied).toBe(true)
    expect(repair.finalValidationPassed).toBe(true)
  })

  it('E4: validationTrace.ranDeterministicValidation is false when no contract', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      validation: null,
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.validationTrace.ranDeterministicValidation).toBe(false)
    expect(trace.validationTrace.violationCount).toBe(0)
  })

  it('E5: validationTrace.ranDeterministicValidation is true when contract + validation provided', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      contract: blueprint,
      validation: { pass: true, violations: [], suggestedRepairs: [] },
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.validationTrace.ranDeterministicValidation).toBe(true)
    expect(trace.validationTrace.violationCount).toBe(0)
  })

  it('E6: validationTrace.violationRules lists unique rule ids from violations', () => {
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      contract: blueprint,
      validation: {
        pass: false,
        violations: [
          { rule: 'banned_phrase', section: 'summary', detail: '', canAutoRepair: true, severity: 'warning' },
          { rule: 'banned_phrase', section: 'experience', detail: '', canAutoRepair: true, severity: 'warning' },
          { rule: 'skills_overloaded', section: 'skills', detail: '', canAutoRepair: false, severity: 'error' },
        ],
        suggestedRepairs: [],
      },
      review: null,
      deterministicRepairsApplied: 0,
    })
    expect(trace.validationTrace.violationRules).toEqual(['banned_phrase', 'skills_overloaded'])
    expect(trace.validationTrace.violationCount).toBe(3)
  })

  it('E7: qualityTrace is stored on Stage 4 raw resume output', () => {
    const raw = buildStage4RawResumeText({
      sessionId: 's2',
      profile: makeProfile(),
      sections: makeSections(),
      allowDraft: true,
    })
    // Even with no guidance, trace is still built (all false)
    expect(raw.qualityTrace).toBeDefined()
    expect(raw.qualityTrace?.rulesetTrace.rulesetLoaded).toBe(false)
    expect(raw.qualityTrace?.blueprintTrace.built).toBe(false)
  })

  it('E8: trace contains no private resume text fields', () => {
    const brief = makeBrief()
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      strategyBrief: brief,
      contract: blueprint,
      validation: { pass: true, violations: [], suggestedRepairs: [] },
      review: null,
      deterministicRepairsApplied: 0,
    })
    const json = JSON.stringify(trace)
    // These strings should only appear as rule names, not content
    expect(json).not.toMatch(/"fullText"/)
    expect(json).not.toMatch(/"summary":"[A-Z]/)
    expect(json).not.toMatch(/"content":/)
  })
})
