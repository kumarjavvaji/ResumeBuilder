/**
 * stage4-repair-directives.test.ts
 *
 * Proves that RewriteDirective[] from Critical Review is wired into the Stage 4
 * repair call and surfaces in the repair prompt as the primary repair specification.
 *
 * Suites:
 *  A — Stage4RepairOptions accepts rewriteDirectives
 *  B — Directive fields surface in the repair user content
 *  C — Directives control system prompt behavior
 *  D — No broad side effects: existing repair behavior when no directives
 */

import { describe, it, expect, vi } from 'vitest'

// Stub the Anthropic client so importing repair-stage4-resume doesn't throw in test environment.
vi.mock('@/lib/llm/client', () => ({
  anthropic: { messages: { create: vi.fn() } },
  MODEL: 'claude-test',
}))

import {
  buildRepairSystemPrompt,
  buildRepairUserContent,
} from '@/lib/llm/repair-stage4-resume'
import type { Stage4RepairOptions } from '@/lib/llm/repair-stage4-resume'
import type {
  ContractViolation,
  JDRequirementMap,
  ResumeGenerationContract,
  RewriteDirective,
  UserProfile,
  WorkEntry,
  SkillGroup,
} from '@/contracts'
import { buildResumeGenerationContract } from '@/lib/stage4/resume-generation-contract'
import { reviewCriticalResumeArtifact } from '@/lib/stage4/critical-resume-review'
import type { CriticalResumeReviewInput } from '@/lib/stage4/critical-resume-review'
import { buildStage4QualityTrace } from '@/lib/stage4/quality-trace'
import type { ContractValidationResult, CriticalResumeReview } from '@/contracts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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
        company: 'Acme Corp',
        title: 'Product Owner',
        startDate: 'Mar 2021',
        endDate: 'Oct 2024',
        bullets: [
          'Led backlog prioritization for 8-person squad.',
          'Reduced support escalations by 30% through clearer acceptance criteria.',
        ],
        approvedMetrics: ['~30% reduction in support escalations'],
        domain: 'Software',
        skills: ['Jira', 'Confluence'],
      } as WorkEntry,
    ],
    education: [],
    skillGroups: [
      { id: 'sg1', heading: 'Product', skills: ['Jira', 'Confluence'] } as SkillGroup,
    ],
    skills: ['Jira', 'Confluence'],
    certifications: [],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: '2026-01-01',
  }
}

function makeJDMap(): JDRequirementMap {
  return {
    required: [
      { text: 'Backlog prioritization', category: 'process', userCoverageStatus: 'covered' },
      { text: 'Stakeholder management', category: 'soft', userCoverageStatus: 'covered' },
    ],
    niceToHave: [],
    realJobFunction: 'Product Owner',
    needsEvidenceItems: [],
    unsupportedRequirements: [],
    weaklySupportedRequirements: [],
  }
}

function makeContract(): ResumeGenerationContract {
  return buildResumeGenerationContract({
    emphasisRecommendation: 'PO',
    roleTitle: 'Product Owner',
    jdMap: makeJDMap(),
    profile: makeProfile(),
  })
}

function makeViolation(overrides: Partial<ContractViolation> = {}): ContractViolation {
  return {
    rule: 'summary_duplicates_experience',
    section: 'summary',
    detail: 'Summary repeats proof-level metric from Experience.',
    canAutoRepair: false,
    severity: 'error',
    ...overrides,
  }
}

function makeDirective(overrides: Partial<RewriteDirective> = {}): RewriteDirective {
  return {
    directiveId: 'summary-summary_duplicates_proof-1',
    targetSection: 'summary',
    targetScope: 'section',
    action: 'rewrite',
    sourceIssueType: 'summary_duplicates_proof',
    instruction: 'Remove repeated proof details and replace with high-level positioning.',
    allowedEvidenceIds: ['E1', 'E2'],
    mustPreserve: ['E1', 'E2'],
    mustAvoid: ['unsupported facts', 'generic praise', 'numeric scores'],
    successCriteria: [
      'Keep Summary at role identity, target fit, and differentiator level.',
      'Use only allowed evidence IDs.',
      'Do not rewrite sections already marked ready.',
    ],
    ...overrides,
  }
}

const RESUME_TEXT = `SUMMARY
Product Owner who led a 6-person team and drove 30% adoption.

SKILLS
Product: Jira | Confluence

EXPERIENCE
Product Owner
Acme Corp | Mar 2021–Oct 2024
- Led backlog prioritization for 8-person squad.
- Reduced support escalations by 30% through clearer acceptance criteria.

EDUCATION
B.Sc Computer Science | Example University | 2018`

// ─── Suite A: Stage4RepairOptions type accepts rewriteDirectives ───────────────

describe('A: Stage4RepairOptions accepts rewriteDirectives', () => {
  it('A1: options object with rewriteDirectives compiles without type error', () => {
    const opts: Stage4RepairOptions = {
      resumeText: RESUME_TEXT,
      violations: [makeViolation()],
      contract: makeContract(),
      profile: makeProfile(),
      jdMap: makeJDMap(),
      rewriteDirectives: [makeDirective()],
    }
    expect(opts.rewriteDirectives).toHaveLength(1)
  })

  it('A2: rewriteDirectives is optional — options without it still satisfies the type', () => {
    const opts: Stage4RepairOptions = {
      resumeText: RESUME_TEXT,
      violations: [makeViolation()],
      contract: makeContract(),
      profile: makeProfile(),
      jdMap: makeJDMap(),
    }
    expect(opts.rewriteDirectives).toBeUndefined()
  })

  it('A3: Critical Review produces rewriteDirectives accessible from review output', () => {
    const reviewInput: CriticalResumeReviewInput = {
      targetJd: makeJDMap(),
      resumeBlueprint: 'Product Owner focused on delivery.',
      evidenceMap: [
        { id: 'E1', text: 'Led backlog prioritization for 8-person squad.', allowedSections: ['experience'] },
        { id: 'E2', text: 'Reduced support escalations by 30%.', allowedSections: ['experience'] },
      ],
      sectionStrategies: [
        {
          sectionKey: 'experience',
          sectionPurpose: 'proof',
          requiredThemes: ['backlog prioritization'],
          allowedEvidenceIds: ['E1', 'E2'],
        },
      ],
      artifactText: RESUME_TEXT,
    }
    const review = reviewCriticalResumeArtifact(reviewInput)
    // The review may or may not have directives depending on the text; what matters is the shape
    expect(Array.isArray(review.rewriteDirectives)).toBe(true)
    const opts: Stage4RepairOptions = {
      resumeText: RESUME_TEXT,
      violations: [makeViolation()],
      contract: makeContract(),
      profile: makeProfile(),
      jdMap: makeJDMap(),
      rewriteDirectives: review.rewriteDirectives,
    }
    expect(opts.rewriteDirectives).toEqual(review.rewriteDirectives)
  })

  it('A4: quality trace reviewTrace stores rewriteDirectives when review produces them', () => {
    const review: CriticalResumeReview = {
      artifactStatus: 'needs_targeted_rewrite',
      reviewSummary: { decision: 'needs_targeted_rewrite', primaryReason: '1 must-fix.' },
      sectionFindings: [],
      rewriteDirectives: [makeDirective()],
      blockedQuestions: [],
    }
    const validation: ContractValidationResult = { pass: true, violations: [], suggestedRepairs: [] }
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      validation,
      review,
      deterministicRepairsApplied: 0,
    })
    expect(trace.reviewTrace.rewriteDirectiveCount).toBe(1)
    expect(trace.reviewTrace.rewriteDirectives).toHaveLength(1)
    expect(trace.reviewTrace.rewriteDirectives?.[0].directiveId).toBe('summary-summary_duplicates_proof-1')
  })

  it('A5: quality trace reviewTrace omits rewriteDirectives when review has none', () => {
    const review: CriticalResumeReview = {
      artifactStatus: 'ready',
      reviewSummary: { decision: 'ready', primaryReason: 'No issues.' },
      sectionFindings: [],
      rewriteDirectives: [],
      blockedQuestions: [],
    }
    const validation: ContractValidationResult = { pass: true, violations: [], suggestedRepairs: [] }
    const trace = buildStage4QualityTrace({
      sessionId: 's1',
      validation,
      review,
      deterministicRepairsApplied: 0,
    })
    expect(trace.reviewTrace.rewriteDirectiveCount).toBe(0)
    expect(trace.reviewTrace.rewriteDirectives).toBeUndefined()
  })
})

// ─── Suite B: Directive fields appear in user content ─────────────────────────

describe('B: Directive details surface in repair user content', () => {
  const directive = makeDirective()
  const content = buildRepairUserContent(
    RESUME_TEXT,
    [makeViolation()],
    makeProfile(),
    makeJDMap(),
    [],
    [directive],
  )

  it('B1: user content includes REWRITE DIRECTIVES section header', () => {
    expect(content).toContain('REWRITE DIRECTIVES')
  })

  it('B2: user content includes the directiveId', () => {
    expect(content).toContain(directive.directiveId)
  })

  it('B3: user content includes the targetSection', () => {
    expect(content).toContain(`targetSection: ${directive.targetSection}`)
  })

  it('B4: user content includes the targetScope', () => {
    expect(content).toContain(`targetScope: ${directive.targetScope}`)
  })

  it('B5: user content includes the action', () => {
    expect(content).toContain(`action: ${directive.action}`)
  })

  it('B6: user content includes the instruction', () => {
    expect(content).toContain(directive.instruction)
  })

  it('B7: user content includes allowedEvidenceIds', () => {
    expect(content).toContain('allowedEvidenceIds:')
    expect(content).toContain('E1')
    expect(content).toContain('E2')
  })

  it('B8: user content includes mustPreserve', () => {
    expect(content).toContain('mustPreserve:')
  })

  it('B9: user content includes mustAvoid items', () => {
    expect(content).toContain('mustAvoid:')
    expect(content).toContain('unsupported facts')
  })

  it('B10: user content includes successCriteria', () => {
    expect(content).toContain('successCriteria:')
    expect(content).toContain('Keep Summary at role identity')
  })

  it('B11: user content with multiple directives includes all of them', () => {
    const d2 = makeDirective({
      directiveId: 'experience-volume_led_bullet-1',
      targetSection: 'experience',
      action: 'convert_volume_to_impact',
      instruction: 'Convert the volume statement into an impact-led bullet.',
      allowedEvidenceIds: ['E1'],
    })
    const multi = buildRepairUserContent(RESUME_TEXT, [makeViolation()], makeProfile(), makeJDMap(), [], [directive, d2])
    expect(multi).toContain('Directive 1:')
    expect(multi).toContain('Directive 2:')
    expect(multi).toContain('summary-summary_duplicates_proof-1')
    expect(multi).toContain('experience-volume_led_bullet-1')
  })
})

// ─── Suite C: Directives control system prompt behavior ───────────────────────

describe('C: Directives surface in system prompt as primary repair specification', () => {
  it('C1: system prompt with directives says directives are primary repair plan', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt.toLowerCase()).toContain('primary repair')
  })

  it('C2: system prompt with directives includes REWRITE DIRECTIVE RULES block', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt).toContain('REWRITE DIRECTIVE RULES')
  })

  it('C3: system prompt with directives instructs to use only allowedEvidenceIds', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt).toContain('allowedEvidenceIds')
  })

  it('C4: system prompt with directives instructs to preserve mustPreserve', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt.toLowerCase()).toContain('mustpreserve')
  })

  it('C5: system prompt with directives instructs to avoid mustAvoid', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt.toLowerCase()).toContain('mustAvoid'.toLowerCase())
  })

  it('C6: system prompt with directives instructs to satisfy successCriteria', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt.toLowerCase()).toContain('successcriteria')
  })

  it('C7: system prompt with directives instructs not to rewrite non-targeted sections', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt.toLowerCase()).toContain('not targeted')
  })

  it('C8: system prompt with directives still contains base REPAIR RULES block', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [makeDirective()])
    expect(prompt).toContain('REPAIR RULES (strictly enforced)')
    expect(prompt.toLowerCase()).toContain('do not add new facts')
  })
})

// ─── Suite D: No directives — existing violation-only behavior preserved ───────

describe('D: No directives — existing behavior unchanged', () => {
  it('D1: system prompt without directives does NOT include REWRITE DIRECTIVE RULES block', () => {
    const prompt = buildRepairSystemPrompt(makeContract(), [makeViolation()], undefined, [])
    expect(prompt).not.toContain('REWRITE DIRECTIVE RULES')
  })

  it('D2: user content without directives does NOT include REWRITE DIRECTIVES section', () => {
    const content = buildRepairUserContent(RESUME_TEXT, [makeViolation()], makeProfile(), makeJDMap(), [], [])
    expect(content).not.toContain('REWRITE DIRECTIVES')
  })

  it('D3: user content without directives still includes violations block', () => {
    const content = buildRepairUserContent(RESUME_TEXT, [makeViolation()], makeProfile(), makeJDMap(), [], [])
    expect(content).toContain('VIOLATIONS')
    expect(content).toContain('summary_duplicates_experience')
  })

  it('D4: user content without directives still includes ALLOWED EVIDENCE section', () => {
    const content = buildRepairUserContent(RESUME_TEXT, [makeViolation()], makeProfile(), makeJDMap(), [], [])
    expect(content).toContain('ALLOWED EVIDENCE')
    expect(content).toContain('Product Owner')
    expect(content).toContain('Acme Corp')
  })

  it('D5: system prompt without directives still includes VIOLATIONS TO FIX block', () => {
    const v = makeViolation({ rule: 'skills_max_rows', section: 'skills', detail: 'Skills has 7 rows; max is 5' })
    const prompt = buildRepairSystemPrompt(makeContract(), [v])
    expect(prompt).toContain('VIOLATIONS TO FIX')
    expect(prompt).toContain('skills_max_rows')
  })

  it('D6: Stage4RepairOptions.rewriteDirectives is optional — omitting it does not break type', () => {
    // Verified at compile time; this test documents the contract in runtime form
    const opts: Partial<Stage4RepairOptions> = {
      resumeText: RESUME_TEXT,
      violations: [makeViolation()],
    }
    expect(opts.rewriteDirectives).toBeUndefined()
  })

  it('D7: repair API route source passes rewriteDirectives from body to repairStage4Resume', () => {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const src = readFileSync(join(__dirname, '../app/api/stage4-repair/route.ts'), 'utf-8')
    expect(src).toContain('rewriteDirectives: body.rewriteDirectives')
  })

  it('D8: UI source reads rewriteDirectives from qualityTrace.reviewTrace', () => {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const src = readFileSync(join(__dirname, '../components/export/raw-resume-text-page.tsx'), 'utf-8')
    expect(src).toContain('qualityTrace?.reviewTrace?.rewriteDirectives')
  })
})
