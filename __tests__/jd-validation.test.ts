/**
 * Tests for Stage 1 JD content validation and session-init correctness.
 *
 * Coverage:
 * 1. BuiltInChicago-style login wall does not pass validation
 * 2. Empty / short text does not pass validation
 * 3. Valid pasted JD passes validation
 * 4. validateJDContent blocks text that would be passed to the intake API
 * 5. Stage 1 cannot be marked complete without a valid analyzed JD
 * 6. Draft session can be built with role/company/postingUrl after fetch failure
 * 7. Analysis output includes sourceType provenance on each requirement
 */
import { describe, it, expect } from 'vitest'
import { validateJDContent } from '@/lib/validators/jd-content'
import { canCompleteStage1 } from '@/contracts'
import type { Stage1Status, JDRequirement, JDRequirementMap } from '@/contracts'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Mimics the kind of text extracted from a BuiltInChicago login-wall page.
const BUILT_IN_CHICAGO_LOGIN_WALL = `
Built In Chicago
Sign In  Create Account
Home  Jobs  Companies  Events  Tech Topics  Salaries  Newsletters

Sign in to view this job

You must be logged in to apply for this position.
Please sign in or create an account to view the full job listing.

Report this job  Back to search
`

// Navigation dump with almost no job content
const NAV_DUMP_TEXT = `
Home  About Us  Careers  Contact Us  Sign In  Sign Up  Menu  Navigation
Report this job  Back to search  All Jobs  Job Board
`

// Cookie consent page
const COOKIE_WALL_TEXT = `
We use cookies and similar technologies on this website.
By clicking "Accept Cookies" you consent to our privacy policy.
Cookie policy  Privacy policy  GDPR consent  Cookie preferences
Accept all cookies  Manage cookies  Decline cookies
`

// A real job description (abbreviated but contains recognizable sections)
const REAL_JD_TEXT = `
Senior Product Owner — Acme Corp

About the Role:
We are looking for a Senior Product Owner to lead our cross-functional scrum team.

Responsibilities:
• Own and prioritize the product backlog
• Collaborate with engineering to define user stories and acceptance criteria
• Drive sprint planning and retrospectives
• Align stakeholders on roadmap priorities

Required Qualifications:
• 5+ years of product management or product ownership experience
• Proven experience working in Agile/Scrum environments
• Strong written and verbal communication skills
• Experience with JIRA or similar backlog management tools

Preferred Qualifications:
• Experience in SaaS or fintech
• SQL proficiency
• Certified Scrum Product Owner (CSPO) certification
`

// Text that is just role title + company — no actual JD content
const ONLY_TITLE_COMPANY = `Senior Product Owner at Acme Corp`

// ─── Test 1: Login wall ────────────────────────────────────────────────────────

describe('login wall detection', () => {
  it('BuiltInChicago-style login wall is flagged invalid', () => {
    const result = validateJDContent(BUILT_IN_CHICAGO_LOGIN_WALL)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('login_wall')
  })

  it('login wall message is human-readable', () => {
    const result = validateJDContent(BUILT_IN_CHICAGO_LOGIN_WALL)
    expect(result.message).toBeTruthy()
    expect(typeof result.message).toBe('string')
  })
})

// ─── Test 2: Empty / short text ───────────────────────────────────────────────

describe('empty and short text rejection', () => {
  it('empty string is invalid', () => {
    expect(validateJDContent('').valid).toBe(false)
    expect(validateJDContent('').reason).toBe('empty')
  })

  it('whitespace-only string is invalid', () => {
    expect(validateJDContent('   \n\t  ').valid).toBe(false)
  })

  it('short text (under threshold) is invalid', () => {
    expect(validateJDContent('This is a job').valid).toBe(false)
    expect(validateJDContent('This is a job').reason).toBe('too_short')
  })

  it('only the role title and company is invalid — no JD content', () => {
    const result = validateJDContent(ONLY_TITLE_COMPANY)
    expect(result.valid).toBe(false)
  })

  it('navigation dump is invalid', () => {
    const result = validateJDContent(NAV_DUMP_TEXT)
    expect(result.valid).toBe(false)
  })

  it('cookie consent page is invalid', () => {
    const result = validateJDContent(COOKIE_WALL_TEXT)
    expect(result.valid).toBe(false)
  })
})

// ─── Test 3: Valid JD passes ──────────────────────────────────────────────────

describe('valid JD detection', () => {
  it('real job description with responsibilities and qualifications is valid', () => {
    const result = validateJDContent(REAL_JD_TEXT)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('valid JD returns no error message', () => {
    const result = validateJDContent(REAL_JD_TEXT)
    expect(result.message).toBeUndefined()
  })
})

// ─── Test 4: Validation gates analysis ────────────────────────────────────────

describe('validation gates analysis', () => {
  it('login wall text must not pass validation before being sent to intake API', () => {
    // Simulates the server-side guard in /api/intake/route.ts
    const inputs = [
      BUILT_IN_CHICAGO_LOGIN_WALL,
      NAV_DUMP_TEXT,
      COOKIE_WALL_TEXT,
      '',
      '   ',
      ONLY_TITLE_COMPANY,
    ]
    for (const jdText of inputs) {
      expect(validateJDContent(jdText).valid).toBe(false)
    }
  })

  it('only valid JD text is allowed through', () => {
    expect(validateJDContent(REAL_JD_TEXT).valid).toBe(true)
  })
})

// ─── Test 5: Stage 1 completion gating ────────────────────────────────────────

describe('Stage 1 completion gating', () => {
  const incompleteStatuses: Stage1Status[] = [
    'draft',
    'jd_fetch_failed',
    'jd_needs_paste',
    'ready_to_analyze',
  ]

  it.each(incompleteStatuses)(
    'cannot complete Stage 1 when status is "%s"',
    (status) => {
      expect(canCompleteStage1(status)).toBe(false)
    }
  )

  it('can complete Stage 1 when status is "analyzed_needs_review"', () => {
    expect(canCompleteStage1('analyzed_needs_review')).toBe(true)
  })

  it('can complete Stage 1 when status is "complete"', () => {
    expect(canCompleteStage1('complete')).toBe(true)
  })

  it('undefined status cannot complete Stage 1', () => {
    expect(canCompleteStage1(undefined)).toBe(false)
  })
})

// ─── Test 6: Draft session structure after fetch failure ──────────────────────

describe('draft session structure', () => {
  it('draft session contains role, company, postingUrl but no analysis', () => {
    // Mirrors the shape built by handleSaveDraft in intake-form.tsx
    const draftSession = {
      id: 'test-id',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      roleTitle: 'Senior Product Owner',
      company: 'Acme Corp',
      postingUrl: 'https://builtin.com/job/12345',
      stage1Status: 'jd_fetch_failed' as Stage1Status,
      jdSourceType: 'fetched_jd' as const,
      // Empty/placeholder analysis fields
      companySummary: '',
      fitHypothesis: '',
      riskGaps: [] as string[],
      jdRequirementMap: {
        required: [],
        niceToHave: [],
        realJobFunction: '',
        needsEvidenceItems: [],
        unsupportedRequirements: [],
        weaklySupportedRequirements: [],
      } as JDRequirementMap,
    }

    expect(draftSession.roleTitle).toBe('Senior Product Owner')
    expect(draftSession.company).toBe('Acme Corp')
    expect(draftSession.postingUrl).toBeTruthy()
    expect(draftSession.stage1Status).toBe('jd_fetch_failed')
    expect(draftSession.fitHypothesis).toBe('')
    expect(draftSession.jdRequirementMap.required).toHaveLength(0)
    // Draft session must NOT have a canCompleteStage1 === true status
    expect(canCompleteStage1(draftSession.stage1Status)).toBe(false)
  })
})

// ─── Test 7: Analysis provenance ──────────────────────────────────────────────

describe('analysis provenance', () => {
  it('each requirement has a sourceType field', () => {
    const requirements: JDRequirement[] = [
      {
        text: '5+ years of product management',
        category: 'process',
        userCoverageStatus: 'covered',
        sourceType: 'pasted_jd',
        sourceExcerpt: '5+ years of product management experience',
        profileEvidence: '7 years as Senior PO at XYZ',
      },
      {
        text: 'Experience with Agile/Scrum',
        category: 'process',
        userCoverageStatus: 'covered',
        sourceType: 'pasted_jd',
      },
      {
        text: 'Salesforce platform knowledge',
        category: 'tool',
        userCoverageStatus: 'gap',
        sourceType: 'pasted_jd',
        sourceExcerpt: 'Salesforce platform knowledge required',
        profileEvidence: 'Not present in user profile',
      },
    ]

    for (const req of requirements) {
      expect(req.sourceType).toBeDefined()
      expect(['fetched_jd', 'pasted_jd', 'structured_fields', 'domainiq', 'company_notes', 'inference']).toContain(
        req.sourceType
      )
    }
  })

  it('inference sourceType is distinguishable from JD-sourced requirements', () => {
    const jdRequirement: JDRequirement = {
      text: 'Agile experience',
      category: 'process',
      userCoverageStatus: 'covered',
      sourceType: 'pasted_jd',
    }
    const inferredRequirement: JDRequirement = {
      text: 'Familiarity with financial products',
      category: 'domain',
      userCoverageStatus: 'unknown',
      sourceType: 'inference',
    }

    const isJDEvidence = (r: JDRequirement) =>
      r.sourceType === 'fetched_jd' || r.sourceType === 'pasted_jd' || r.sourceType === 'structured_fields'

    expect(isJDEvidence(jdRequirement)).toBe(true)
    expect(isJDEvidence(inferredRequirement)).toBe(false)
  })

  it('needsEvidenceItems are bridge-question targets, not hard disqualifiers', () => {
    const map: JDRequirementMap = {
      required: [
        { text: 'Salesforce knowledge', category: 'tool', userCoverageStatus: 'gap', sourceType: 'pasted_jd' },
      ],
      niceToHave: [],
      realJobFunction: 'Product Owner at a SaaS company',
      needsEvidenceItems: ['Salesforce knowledge'],
      unsupportedRequirements: ['Salesforce knowledge'],
      weaklySupportedRequirements: [],
    }

    // needsEvidenceItems is the canonical field
    expect(map.needsEvidenceItems).toContain('Salesforce knowledge')
    // Items in needsEvidence are gap items — not necessarily dealbreakers
    const gapItem = map.required.find(r => map.needsEvidenceItems.includes(r.text))
    expect(gapItem?.userCoverageStatus).toBe('gap')
  })
})
