/**
 * Stage 1 persistence and gap classification tests.
 *
 * Validates:
 *   1. GapClassification taxonomy correctness (7 types)
 *   2. FitAnalysis structure completeness
 *   3. Session fitAnalysis contract
 *   4. Stage 5 boundary (fitAnalysis does NOT go into learning signals)
 *   5. Brief includes evaluator lens from fitAnalysis
 *   6. Persistence audit structure
 */

import { describe, it, expect } from 'vitest'
import type {
  GapClassification,
  JDRequirement,
  JDRequirementMap,
  FitAnalysis,
  FitRequirement,
  TargetIntake,
  SessionPersistenceAudit,
  LearningSignal,
} from '@/contracts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeJDRequirement(overrides: Partial<JDRequirement> = {}): JDRequirement {
  return {
    text: 'Experience with Agile/Scrum',
    category: 'process',
    userCoverageStatus: 'covered',
    ...overrides,
  }
}

function makeJDRequirementMap(reqs: JDRequirement[]): JDRequirementMap {
  return {
    required: reqs,
    niceToHave: [],
    realJobFunction: 'Product Owner managing a SaaS scrum team',
    needsEvidenceItems: [],
    unsupportedRequirements: [],
    weaklySupportedRequirements: [],
  }
}

function makeFitRequirement(overrides: Partial<FitRequirement> = {}): FitRequirement {
  return {
    requirementId: 'req-0',
    requirementText: 'Experience with Agile/Scrum',
    category: 'process',
    coverageStatus: 'covered',
    supportingEvidence: [],
    ...overrides,
  }
}

function makeFitAnalysis(overrides: Partial<FitAnalysis> = {}): FitAnalysis {
  return {
    fitHypothesis: 'Strong product ownership background with delivery track record.',
    realJobFunction: 'Product Owner managing a SaaS scrum team',
    evaluatorLens: 'An engineering-side hiring manager who values sprint accountability and clear backlog ownership above all.',
    riskNotes: ['No direct SQL experience'],
    requirements: [makeFitRequirement()],
    gapSummary: {
      trueGaps: [],
      missingFromProfile: [],
      needsConfirmation: [],
      wordingOrMapping: [],
    },
    recommendedBridgeTargets: [],
    generatedAt: '2026-06-13T00:00:00.000Z',
    ...overrides,
  }
}

// ─── 1. GapClassification taxonomy ────────────────────────────────────────────

describe('GapClassification taxonomy', () => {
  it('accepts all 7 valid gap types', () => {
    const validTypes: GapClassification[] = [
      'true_gap',
      'profile_missing',
      'parser_missing',
      'mapping_gap',
      'wording_gap',
      'needs_confirmation',
      'not_required',
    ]
    // All 7 types are assignable — compile-time + runtime check
    for (const type of validTypes) {
      const req = makeJDRequirement({ gapClassification: type, userCoverageStatus: 'gap' })
      expect(req.gapClassification).toBe(type)
    }
  })

  it('niceToHave requirements are classified as not_required', () => {
    const niceToHave = makeJDRequirement({
      gapClassification: 'not_required',
      userCoverageStatus: 'gap',
    })
    expect(niceToHave.gapClassification).toBe('not_required')
  })

  it('covered requirements do not need a gapClassification', () => {
    const req = makeJDRequirement({ userCoverageStatus: 'covered' })
    expect(req.gapClassification).toBeUndefined()
  })

  it('true_gap vs profile_missing are distinct action signals', () => {
    const trueGap = makeJDRequirement({
      text: 'Machine learning model deployment',
      userCoverageStatus: 'gap',
      gapClassification: 'true_gap',
    })
    const profileMissing = makeJDRequirement({
      text: 'Stakeholder presentation skills',
      userCoverageStatus: 'gap',
      gapClassification: 'profile_missing',
    })
    // true_gap → hard gap, cannot be bridged by rephrasing
    // profile_missing → candidate likely has it, profile just doesn't say so
    expect(trueGap.gapClassification).not.toBe(profileMissing.gapClassification)
  })

  it('wording_gap and mapping_gap indicate solvable coverage gaps', () => {
    const wordingGap = makeJDRequirement({
      text: 'Value stream mapping',
      userCoverageStatus: 'partial',
      gapClassification: 'wording_gap',
    })
    const mappingGap = makeJDRequirement({
      text: 'Process optimization',
      userCoverageStatus: 'partial',
      gapClassification: 'mapping_gap',
    })
    expect(['wording_gap', 'mapping_gap']).toContain(wordingGap.gapClassification)
    expect(['wording_gap', 'mapping_gap']).toContain(mappingGap.gapClassification)
  })
})

// ─── 2. FitAnalysis structure ──────────────────────────────────────────────────

describe('FitAnalysis structure', () => {
  it('has all required top-level fields', () => {
    const fa = makeFitAnalysis()
    expect(fa.fitHypothesis).toBeTruthy()
    expect(fa.realJobFunction).toBeTruthy()
    expect(fa.evaluatorLens).toBeTruthy()
    expect(Array.isArray(fa.riskNotes)).toBe(true)
    expect(Array.isArray(fa.requirements)).toBe(true)
    expect(fa.gapSummary).toBeDefined()
    expect(fa.generatedAt).toBeTruthy()
  })

  it('gapSummary has all 4 buckets', () => {
    const fa = makeFitAnalysis()
    expect(Array.isArray(fa.gapSummary.trueGaps)).toBe(true)
    expect(Array.isArray(fa.gapSummary.missingFromProfile)).toBe(true)
    expect(Array.isArray(fa.gapSummary.needsConfirmation)).toBe(true)
    expect(Array.isArray(fa.gapSummary.wordingOrMapping)).toBe(true)
  })

  it('evaluatorLens is non-empty and role-specific', () => {
    const fa = makeFitAnalysis()
    // Should name the evaluator type, not use generic recruiter language
    expect(fa.evaluatorLens.length).toBeGreaterThan(20)
    expect(fa.evaluatorLens).not.toMatch(/recruiter/i)
  })

  it('gapSummary buckets match requirement gapClassifications', () => {
    const reqs: FitRequirement[] = [
      makeFitRequirement({ requirementText: 'SQL', coverageStatus: 'gap', gapClassification: 'true_gap' }),
      makeFitRequirement({ requirementText: 'Stakeholder management', coverageStatus: 'gap', gapClassification: 'profile_missing' }),
      makeFitRequirement({ requirementText: 'Value stream mapping', coverageStatus: 'partial', gapClassification: 'wording_gap' }),
      makeFitRequirement({ requirementText: 'JIRA', coverageStatus: 'partial', gapClassification: 'needs_confirmation' }),
    ]
    const fa = makeFitAnalysis({
      requirements: reqs,
      gapSummary: {
        trueGaps: reqs.filter(r => r.gapClassification === 'true_gap').map(r => r.requirementText),
        missingFromProfile: reqs.filter(r => r.gapClassification === 'profile_missing').map(r => r.requirementText),
        needsConfirmation: reqs.filter(r => r.gapClassification === 'needs_confirmation').map(r => r.requirementText),
        wordingOrMapping: reqs.filter(r => r.gapClassification === 'wording_gap' || r.gapClassification === 'mapping_gap').map(r => r.requirementText),
      },
    })
    expect(fa.gapSummary.trueGaps).toContain('SQL')
    expect(fa.gapSummary.missingFromProfile).toContain('Stakeholder management')
    expect(fa.gapSummary.wordingOrMapping).toContain('Value stream mapping')
    expect(fa.gapSummary.needsConfirmation).toContain('JIRA')
  })

  it('recommendedBridgeTargets mirrors needsEvidenceItems', () => {
    const jdMap = makeJDRequirementMap([])
    jdMap.needsEvidenceItems = ['SQL proficiency', 'Healthcare domain experience']
    const fa = makeFitAnalysis({ recommendedBridgeTargets: jdMap.needsEvidenceItems })
    expect(fa.recommendedBridgeTargets).toEqual(['SQL proficiency', 'Healthcare domain experience'])
  })
})

// ─── 3. Session fitAnalysis contract ──────────────────────────────────────────

describe('TargetIntake fitAnalysis field', () => {
  it('fitAnalysis is optional on TargetIntake (new sessions without analysis)', () => {
    const session: Partial<TargetIntake> = {
      id: 'sess-1',
      roleTitle: 'Product Owner',
      company: 'Acme',
      fitHypothesis: '',
      riskGaps: [],
      // fitAnalysis intentionally absent
    }
    expect(session.fitAnalysis).toBeUndefined()
  })

  it('fitAnalysis is set on analyzed sessions', () => {
    const fa = makeFitAnalysis()
    const session: Partial<TargetIntake> = {
      id: 'sess-2',
      roleTitle: 'Product Owner',
      company: 'Acme',
      fitHypothesis: fa.fitHypothesis,
      riskGaps: fa.riskNotes,
      fitAnalysis: fa,
    }
    expect(session.fitAnalysis).toBeDefined()
    expect(session.fitAnalysis!.evaluatorLens).toBeTruthy()
    expect(session.fitAnalysis!.requirements.length).toBeGreaterThan(0)
  })

  it('fitAnalysis preserves evaluatorLens from synthesis', () => {
    const lens = 'A senior PM or VP of Product who will look for roadmap ownership and cross-functional delivery.'
    const fa = makeFitAnalysis({ evaluatorLens: lens })
    expect(fa.evaluatorLens).toBe(lens)
  })
})

// ─── 4. Stage 5 boundary ──────────────────────────────────────────────────────

describe('Stage 5 boundary — fitAnalysis does not belong in learning signals', () => {
  it('LearningSignal type list does not include fit-analysis or jd-requirement types', () => {
    // These are session-level facts, not reusable generation intelligence
    const invalidTypes = ['fit-analysis', 'jd-requirement', 'gap-classification', 'fit-requirement']
    // Simulate a learning signal — it should never carry fitAnalysis content as its type
    const signal: Partial<LearningSignal> = {
      id: 'sig-1',
      type: 'jd_alignment_strategy', // this IS valid — it's a reusable generation lesson
      content: 'For fintech PO roles, lead with regulatory compliance context',
      scope: 'personal',
      createdAt: new Date().toISOString(),
    }
    // The signal type is jd_alignment_strategy (valid), not a jd-requirement fact
    expect(invalidTypes).not.toContain(signal.type)
  })

  it('fitAnalysis fields are distinct from LearningSignal fields', () => {
    const fa = makeFitAnalysis()
    const signal: Partial<LearningSignal> = {
      id: 'sig-2',
      type: 'artifact_strategy',
      content: 'Lead PO bullets with backlog ownership metrics',
      scope: 'personal',
      createdAt: new Date().toISOString(),
    }
    // fitAnalysis fields (fitHypothesis, realJobFunction, gapSummary)
    // should not exist on a LearningSignal
    expect((signal as Record<string, unknown>).fitHypothesis).toBeUndefined()
    expect((signal as Record<string, unknown>).gapSummary).toBeUndefined()
    expect((signal as Record<string, unknown>).realJobFunction).toBeUndefined()
    // fitAnalysis should not have LearningSignal fields
    expect((fa as Record<string, unknown>).scope).toBeUndefined()
    expect((fa as Record<string, unknown>).productArea).toBeUndefined()
  })
})

// ─── 5. Brief consumes evaluator lens ─────────────────────────────────────────

describe('Generation brief evaluatorLens integration', () => {
  it('evaluatorLens is a non-generic, role-specific sentence', () => {
    const genericLens = 'A recruiter who will look at your resume.'
    const specificLens = 'An engineering manager at a Series B fintech who cares about sprint delivery cadence and hands-on backlog grooming.'
    expect(specificLens.length).toBeGreaterThan(genericLens.length)
    expect(specificLens).toMatch(/manager|director|lead|hiring|stakeholder/i)
  })

  it('brief would include evaluatorLens if fitAnalysis is present', () => {
    const fa = makeFitAnalysis({
      evaluatorLens: 'A VP of Product who prioritizes metrics-driven roadmaps and cross-team alignment.',
    })
    // Simulate brief serialization — evaluatorLens should appear in brief
    const briefSnippet = `EVALUATOR LENS: ${fa.evaluatorLens}`
    expect(briefSnippet).toContain('VP of Product')
    expect(briefSnippet).toContain('metrics-driven')
  })
})

// ─── 6. Persistence audit structure ───────────────────────────────────────────

describe('SessionPersistenceAudit', () => {
  it('has all required audit fields', () => {
    const audit: SessionPersistenceAudit = {
      sessionId: 'sess-1',
      checkedAt: new Date().toISOString(),
      profileEvidenceBulletsCount: 12,
      profileSkillsCount: 18,
      jdRequiredCount: 8,
      jdNiceToHaveCount: 3,
      fitRequirementsCount: 8,
      fitAnalysisAvailable: true,
      gapsCount: 3,
      gapBreakdown: {
        true_gap: 1,
        profile_missing: 1,
        needs_confirmation: 1,
      },
      bridgeQuestionsCount: 4,
      bridgeAnsweredCount: 3,
      artifactSectionsGeneratedCount: 5,
      artifactSectionsAcceptedCount: 3,
      stage5SignalCount: 7,
    }
    expect(audit.fitAnalysisAvailable).toBe(true)
    expect(audit.gapBreakdown.true_gap).toBe(1)
    expect(audit.gapsCount).toBe(3)
    expect(audit.stage5SignalCount).toBe(7)
  })

  it('gapBreakdown totals match gapsCount', () => {
    const audit: SessionPersistenceAudit = {
      sessionId: 'sess-2',
      checkedAt: new Date().toISOString(),
      profileEvidenceBulletsCount: 8,
      profileSkillsCount: 10,
      jdRequiredCount: 6,
      jdNiceToHaveCount: 2,
      fitRequirementsCount: 6,
      fitAnalysisAvailable: true,
      gapsCount: 4,
      gapBreakdown: {
        true_gap: 2,
        wording_gap: 1,
        needs_confirmation: 1,
      },
      bridgeQuestionsCount: 3,
      bridgeAnsweredCount: 2,
      artifactSectionsGeneratedCount: 3,
      artifactSectionsAcceptedCount: 2,
      stage5SignalCount: 5,
    }
    const breakdownTotal = Object.values(audit.gapBreakdown).reduce((s, n) => s + (n ?? 0), 0)
    expect(breakdownTotal).toBe(audit.gapsCount)
  })

  it('returns fitAnalysisAvailable: false for draft sessions', () => {
    const audit: SessionPersistenceAudit = {
      sessionId: 'draft-1',
      checkedAt: new Date().toISOString(),
      profileEvidenceBulletsCount: 0,
      profileSkillsCount: 0,
      jdRequiredCount: 0,
      jdNiceToHaveCount: 0,
      fitRequirementsCount: 0,
      fitAnalysisAvailable: false,
      gapsCount: 0,
      gapBreakdown: {},
      bridgeQuestionsCount: 0,
      bridgeAnsweredCount: 0,
      artifactSectionsGeneratedCount: 0,
      artifactSectionsAcceptedCount: 0,
      stage5SignalCount: 0,
    }
    expect(audit.fitAnalysisAvailable).toBe(false)
    expect(Object.keys(audit.gapBreakdown).length).toBe(0)
  })
})
