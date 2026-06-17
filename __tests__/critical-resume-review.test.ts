import { describe, expect, it } from 'vitest'
import type { JDRequirementMap } from '@/contracts'
import {
  buildCriticalResumeReviewPrompt,
  CRITICAL_RESUME_REVIEW_JSON_SCHEMA,
  executeRewriteDirective,
  reviewCriticalResumeArtifact,
  validateCriticalResumeReviewOutput,
} from '@/lib/stage4/critical-resume-review'
import type { CriticalResumeReviewInput } from '@/lib/stage4/critical-resume-review'

const targetJd: JDRequirementMap = {
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

function makeInput(artifactText: string): CriticalResumeReviewInput {
  return {
    targetJd,
    resumeBlueprint: 'Summary positions for product analyst fit; Experience carries proof.',
    evidenceMap: [
      {
        id: 'E1',
        text: 'Reduced support tickets by clarifying release documentation and acceptance criteria.',
        allowedSections: ['experience'],
      },
      {
        id: 'E2',
        text: 'Prioritized backlog requests with stakeholders before release planning.',
        allowedSections: ['experience'],
      },
    ],
    sectionStrategies: [
      {
        sectionKey: 'experience',
        sectionPurpose: 'proof',
        requiredThemes: ['backlog prioritization', 'release readiness'],
        allowedEvidenceIds: ['E1', 'E2'],
      },
    ],
    artifactText,
    deterministicValidation: {
      pass: true,
      violations: [],
      suggestedRepairs: [],
    },
    userSessionDecisions: { acceptedPositioning: 'Product Analyst' },
    bannedPhrases: ['results-driven'],
    unsupportedClaimsOrTools: ['UnsupportedCRM'],
    acceptedCalibrationNotes: ['Lead with decision value, not activity volume.'],
  }
}

function issueTypes(input: CriticalResumeReviewInput): string[] {
  return reviewCriticalResumeArtifact(input).sectionFindings.flatMap(section =>
    section.findings.map(finding => finding.issueType),
  )
}

describe('Critical Resume Review first slice', () => {
  it('flags a volume-led bullet even when it includes a big number', () => {
    const review = reviewCriticalResumeArtifact(makeInput(`SUMMARY
Product analyst focused on backlog quality and release readiness.

SKILLS
Product: backlog prioritization, release readiness

EXPERIENCE
- Analyzed 3,000 requests from internal users each quarter.
`))

    expect(review.artifactStatus).toBe('needs_targeted_rewrite')
    expect(issueTypes(makeInput(reviewInputText('Analyzed 3,000 requests from internal users each quarter.')))).toContain('volume_led_bullet')
  })

  it('flags high volume language as still volume-led', () => {
    const types = issueTypes(makeInput(reviewInputText('Analyzed a high volume of requests from internal users.')))
    expect(types).toContain('volume_led_bullet')
  })

  it('passes support reduction bullets that use request volume only as context', () => {
    const types = issueTypes(makeInput(reviewInputText('Reduced support tickets by clarifying patterns from request intake.')))
    expect(types).not.toContain('volume_led_bullet')
  })

  it('flags Summary that recaps Experience proof', () => {
    const types = issueTypes(makeInput(`SUMMARY
Product analyst who partnered with 6 developers and 1 QA to reduce 40% of support tickets.

SKILLS
Product: backlog prioritization

EXPERIENCE
- Partnered with 6 developers and 1 QA to reduce 40% of support tickets through clearer acceptance criteria.
`))

    expect(types).toContain('summary_duplicates_proof')
  })

  it('passes Summary that stays at positioning level', () => {
    const types = issueTypes(makeInput(`SUMMARY
Product analyst focused on backlog quality, release readiness, and business-to-IT translation.

SKILLS
Product: backlog prioritization

EXPERIENCE
- Partnered with 6 developers and 1 QA to reduce 40% of support tickets through clearer acceptance criteria.
`))

    expect(types).not.toContain('summary_duplicates_proof')
    expect(types).not.toContain('summary_recap_instead_of_positioning')
  })

  it('flags Skills-only JD alignment', () => {
    const types = issueTypes(makeInput(`SUMMARY
Product analyst focused on release quality.

SKILLS
Product: backlog prioritization, release readiness

EXPERIENCE
- Clarified acceptance criteria with engineering before sprint planning.
`))

    expect(types).toContain('skills_carry_fit_without_experience_proof')
  })

  it('flags ceremony language without decision impact', () => {
    const types = issueTypes(makeInput(reviewInputText('Led ceremonies for the delivery team.')))
    expect(types).toContain('task_led_bullet')
  })

  it('returns rewrite directives with allowed evidence IDs and success criteria', () => {
    const review = reviewCriticalResumeArtifact(makeInput(reviewInputText('Handled 120 tickets per sprint.')))
    const directive = review.rewriteDirectives.find(d => d.sourceIssueType === 'volume_led_bullet')

    expect(directive).toBeDefined()
    expect(directive?.allowedEvidenceIds).toEqual(['E1', 'E2'])
    expect(directive?.successCriteria.length).toBeGreaterThan(0)
    expect(directive?.action).toBe('convert_volume_to_impact')
  })

  it('changes only the targeted section when executing a rewrite directive', () => {
    const fullText = `SUMMARY
Product analyst focused on delivery quality.

SKILLS
Product: backlog prioritization

EXPERIENCE
- Handled 120 tickets per sprint.

EDUCATION
BS Information Systems`

    const updated = executeRewriteDirective({
      fullText,
      directive: {
        directiveId: 'experience-volume-led-1',
        targetSection: 'experience',
        targetScope: 'section',
        action: 'convert_volume_to_impact',
        sourceIssueType: 'volume_led_bullet',
        instruction: 'Rewrite the section to lead with impact.',
        allowedEvidenceIds: ['E1'],
        mustPreserve: ['E1'],
        mustAvoid: ['unsupported facts'],
        successCriteria: ['Lead with impact.'],
      },
      revisedText: '- Reduced support tickets by clarifying release documentation. E1',
    })

    expect(updated).toContain('SUMMARY\nProduct analyst focused on delivery quality.')
    expect(updated).toContain('SKILLS\nProduct: backlog prioritization')
    expect(updated).toContain('EXPERIENCE\n- Reduced support tickets by clarifying release documentation. E1')
    expect(updated).toContain('EDUCATION\nBS Information Systems')
    expect(updated).not.toContain('Handled 120 tickets per sprint')
  })

  it('rejects rewrite text that references evidence outside the directive boundary', () => {
    expect(() =>
      executeRewriteDirective({
        fullText: `SUMMARY
Product analyst.

EXPERIENCE
- Handled 120 tickets per sprint.`,
        directive: {
          directiveId: 'experience-volume-led-1',
          targetSection: 'experience',
          targetScope: 'section',
          action: 'convert_volume_to_impact',
          sourceIssueType: 'volume_led_bullet',
          instruction: 'Rewrite the section to lead with impact.',
          allowedEvidenceIds: ['E1'],
          mustPreserve: ['E1'],
          mustAvoid: ['unsupported facts'],
          successCriteria: ['Lead with impact.'],
        },
        revisedText: '- Reduced support tickets by changing account routing. E99',
      }),
    ).toThrow(/outside directive boundary/)
  })

  it('validates review output shape and rejects score fields', () => {
    const review = reviewCriticalResumeArtifact(makeInput(reviewInputText('Handled 120 tickets per sprint.')))
    expect(validateCriticalResumeReviewOutput(review)).toEqual(review)
    expect(() => validateCriticalResumeReviewOutput({ ...review, score: 92 })).toThrow(/score fields/)
  })

  it('keeps numeric score fields out of the review schema and prompt contract', () => {
    const prompt = buildCriticalResumeReviewPrompt(makeInput(reviewInputText('Handled 120 tickets per sprint.')))

    expect(JSON.stringify(CRITICAL_RESUME_REVIEW_JSON_SCHEMA)).not.toMatch(/score|rating|grade/i)
    expect(JSON.stringify(prompt.jsonSchema)).not.toMatch(/score|rating|grade/i)
    expect(prompt.system.toLowerCase()).toContain('strict json')
    expect(prompt.system.toLowerCase()).toContain('do not include scores')
  })
})

function reviewInputText(bullet: string): string {
  return `SUMMARY
Product analyst focused on backlog quality and release readiness.

SKILLS
Product: release readiness

EXPERIENCE
- ${bullet}`
}
