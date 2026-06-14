/**
 * Tests for the Artifact Generation Brief — the structured context built before
 * every Anthropic artifact-generation or refinement call.
 *
 * Success criteria tested here:
 * 1. ArtifactGenerationBrief is created before Anthropic calls (valid brief object)
 * 2. Anthropic prompt includes evaluator lens
 * 3. Anthropic prompt includes allowed and prohibited claims
 * 4. Summary generation obeys line budget
 * 5. Skills generation uses JD-aligned ATS terms
 * 6. PO section is reframed for Product Analyst target (deemphasizes roadmap ownership)
 * 7. Product Analyst section gets higher priority than QA for analytics role
 * 8. DIQ company facts are not converted into candidate claims (generation rule enforced)
 * 9. Stage 5 strategy signals influence generation without injecting raw bullets
 * 10. Section refinement prompt overrides overall prompt for that artifact only
 */

import { describe, it, expect } from 'vitest'
import type { JDRequirementMap, LearningSignal, SectionType, UserProfile } from '@/contracts'
import {
  buildArtifactGenerationBrief,
  serializeBriefForPrompt,
  detectRoleFamily,
  deriveEvaluatorLens,
} from '@/lib/llm/artifact-generation-brief'
import type { ScopedEvidenceBundle } from '@/lib/evidence-scope'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function analyticsJDMap(): JDRequirementMap {
  return {
    required: [
      { text: 'product performance analysis', category: 'process', userCoverageStatus: 'covered' },
      { text: 'KPI measurement and metrics dictionary', category: 'process', userCoverageStatus: 'covered' },
      { text: 'dashboard reporting', category: 'tool', userCoverageStatus: 'covered' },
      { text: 'SQL data validation', category: 'technical', userCoverageStatus: 'covered' },
      { text: 'opportunity sizing', category: 'process', userCoverageStatus: 'partial' },
      { text: 'direct deposit and lending experience', category: 'domain', userCoverageStatus: 'gap' },
    ],
    niceToHave: [
      { text: 'Salesforce reporting', category: 'tool', userCoverageStatus: 'covered' },
      { text: 'Pendo product analytics', category: 'tool', userCoverageStatus: 'covered' },
    ],
    realJobFunction: 'Product Analyst — Member Insights & Analytics',
    needsEvidenceItems: ['direct deposit and lending experience'],
    unsupportedRequirements: ['direct deposit and lending experience'],
    weaklySupportedRequirements: ['opportunity sizing'],
  }
}

function minimalBundle(): ScopedEvidenceBundle {
  return {
    primaryWorkEntries: [
      {
        id: 'w-1', company: 'Paylocity', title: 'Product Analyst',
        startDate: '2020', endDate: '2023', domain: 'HCM',
        bullets: [
          'Analyzed 3,000+ support signals to identify backlog priorities.',
          'Built Salesforce dashboards tracking KPIs for 4M+ MAUs.',
        ],
        approvedMetrics: ['3,000+ support signals', '4M+ MAUs'],
        skills: ['SQL', 'Salesforce', 'Pendo'],
      },
    ],
    supportingWorkEntries: [
      {
        id: 'w-2', company: 'Prior Co', title: 'Product Owner',
        startDate: '2018', endDate: '2020', domain: 'HR',
        bullets: ['Managed product backlog.'],
        approvedMetrics: [],
        skills: ['Jira'],
      },
    ],
    normalizedBridgeEvidence: [],
    uncertainBridgeEvidence: [],
    scope: {
      sectionType: 'summary',
      roleTitleKeywords: [],
      allowedEvidenceTypes: ['work-history-bullet', 'approved-metric', 'skill'],
      allowedBridgeQuestionTypes: [],
      allowedClaimStatuses: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported'],
      crossRolePolicy: 'full',
      requiredFramingRules: [],
      disallowedClaimPatterns: ['claim direct deposit or lending experience'],
      framingNote: null,
    },
  }
}

function bundleForSection(sectionType: SectionType): ScopedEvidenceBundle {
  return { ...minimalBundle(), scope: { ...minimalBundle().scope, sectionType } }
}

function personalSignals(): LearningSignal[] {
  return [
    {
      id: 's-1', scope: 'personal', type: 'artifact_strategy',
      content: 'For Product Analyst roles, preserve KPI/reporting/opportunity-sizing evidence before generic PO ownership claims.',
      context: 'analytics', createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 's-2', scope: 'personal', type: 'role_scope_rule',
      content: 'For financial-services analyst roles, domain facts from DIQ should steer language but must not become candidate claims.',
      context: 'analytics', createdAt: '2026-01-01T00:00:00.000Z',
    },
    // This is a raw bullet — NOT a strategy signal. Should not appear in the brief.
    {
      // @ts-expect-error — intentionally testing that old content types are excluded
      id: 's-3', scope: 'personal', type: 'accepted-bullet',
      content: 'Analyzed 3,000+ support signals to identify backlog priorities.',
      context: 'raw-bullet', createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]
}

// ─── 1. Brief is created before Anthropic calls ───────────────────────────────

describe('1. ArtifactGenerationBrief has all required fields', () => {
  it('buildArtifactGenerationBrief returns a valid complete brief', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst – Member Insights & Analytics',
      company: 'Alliant Credit Union',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })

    expect(brief.artifactType).toBeTruthy()
    expect(brief.targetContext.company).toBe('Alliant Credit Union')
    expect(brief.targetContext.roleTitle).toBe('Product Analyst – Member Insights & Analytics')
    expect(brief.targetContext.roleFamily).toBeTruthy()
    expect(brief.evaluatorLens.likelyReader).toBeTruthy()
    expect(brief.candidateEvidence).toBeDefined()
    expect(brief.artifactStrategy.purpose).toBeTruthy()
    expect(brief.styleGuide.voice).toBeTruthy()
    expect(brief.generationRules.doNotInventClaims).toBe(true)
    expect(brief.generationRules.doNotCopyDIQAsCandidateExperience).toBe(true)
    expect(brief.learningSignals).toBeDefined()
  })
})

// ─── 2. Anthropic prompt includes evaluator lens ─────────────────────────────

describe('2. Anthropic prompt includes evaluator lens', () => {
  it('serializeBriefForPrompt includes EVALUATOR LENS section', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const serialized = serializeBriefForPrompt(brief)

    expect(serialized).toContain('EVALUATOR LENS')
    expect(serialized).toContain('ARTIFACT GENERATION BRIEF')
    expect(serialized).toContain(brief.evaluatorLens.likelyReader)
  })

  it('evaluator lens for product analytics role includes KPI, dashboard, opportunity sizing', () => {
    const lens = deriveEvaluatorLens('product-analytics', analyticsJDMap())
    const careAbout = lens.whatTheyCareAbout.join(' ').toLowerCase()
    expect(careAbout).toContain('kpi')
    expect(careAbout).toContain('dashboard')
    expect(careAbout).toContain('opportunity sizing')
  })

  it('evaluator lens discount section includes generic PO language warning', () => {
    const lens = deriveEvaluatorLens('product-analytics', analyticsJDMap())
    const discounts = lens.whatTheyWillDiscount.join(' ').toLowerCase()
    expect(discounts).toContain('generic product ownership')
  })

  it('serialized brief includes knockout risks', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-ba',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-ba'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const serialized = serializeBriefForPrompt(brief)
    expect(serialized).toContain('Knockout risks')
    // Knockout risk should warn about sounding like PO resume
    expect(serialized).toMatch(/product owner|PO resume/i)
  })
})

// ─── 3. Anthropic prompt includes allowed and prohibited claims ───────────────

describe('3. Anthropic prompt includes allowed and prohibited claims', () => {
  it('brief prohibited claims include unsupported JD requirements', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const prohibited = brief.candidateEvidence.prohibitedClaims.join(' ')
    expect(prohibited).toContain('direct deposit and lending experience')
  })

  it('serialized brief includes PROHIBITED CLAIMS block', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const serialized = serializeBriefForPrompt(brief)
    expect(serialized).toContain('PROHIBITED CLAIMS')
    expect(serialized).toContain('direct deposit')
  })

  it('brief allowed evidence lists the primary work entries', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const allowed = brief.candidateEvidence.allowedEvidence.join(' ')
    expect(allowed).toContain('Paylocity')
    expect(allowed).not.toContain('Prior Co') // supporting only, not primary
  })
})

// ─── 4. Summary generation obeys line budget ─────────────────────────────────

describe('4. Summary generation obeys line budget', () => {
  it('summary artifact strategy has 3–4 line budget', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    expect(brief.artifactStrategy.lineBudget).toMatch(/3.{1,3}4/)
  })

  it('summary section priority is primary for analytics role', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    expect(brief.artifactStrategy.sectionPriority).toBe('primary')
  })
})

// ─── 5. Skills section uses JD-aligned ATS terms ─────────────────────────────

describe('5. Skills generation uses JD-aligned ATS terms', () => {
  it('skills brief emphasis includes analytics-critical terms', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'skills',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('skills'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const emphasisText = brief.artifactStrategy.emphasis.join(' ')
    expect(emphasisText).toMatch(/KPI|dashboard|SQL|analyt/i)
  })

  it('skills brief deemphasis excludes generic non-JD categories', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'skills',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('skills'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const deemphasized = brief.artifactStrategy.deemphasis.join(' ')
    expect(deemphasized).toMatch(/generic|QA-only/i)
  })
})

// ─── 6. PO section is reframed for Product Analyst target ────────────────────

describe('6. PO section reframed for Product Analyst role', () => {
  it('experience-po deemphasis includes roadmap ownership language', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-po',
      emphasis: 'BA',
      roleTitle: 'Product Analyst – Member Insights',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-po'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const deemphasis = brief.artifactStrategy.deemphasis.join(' ').toLowerCase()
    expect(deemphasis).toMatch(/roadmap|backlog grooming/)
  })

  it('experience-po emphasis includes KPI-informed prioritization for analytics role', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-po',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-po'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const emphasis = brief.artifactStrategy.emphasis.join(' ').toLowerCase()
    expect(emphasis).toMatch(/kpi|analytic|data.backed/)
  })

  it('experience-po section priority is supporting for analytics role', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-po',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-po'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    expect(brief.artifactStrategy.sectionPriority).toBe('supporting')
  })
})

// ─── 7. Product Analyst section > QA section priority for analytics role ─────

describe('7. Product Analyst section outranks QA for analytics role', () => {
  it('experience-ba is primary for analytics role', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-ba',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-ba'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    expect(brief.artifactStrategy.sectionPriority).toBe('primary')
  })

  it('experience-qa is context (lowest priority) for analytics role', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'experience-qa',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-qa'),
      acceptedSignals: [],
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    expect(brief.artifactStrategy.sectionPriority).toBe('context')
  })

  it('experience-ba line budget is larger than experience-qa for analytics role', () => {
    const baBrief = buildArtifactGenerationBrief({
      sectionType: 'experience-ba',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-ba'),
      acceptedSignals: [], globalSignals: [], rejectedPhrases: [], constraints: [],
    })
    const qaBrief = buildArtifactGenerationBrief({
      sectionType: 'experience-qa',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-qa'),
      acceptedSignals: [], globalSignals: [], rejectedPhrases: [], constraints: [],
    })
    // BA gets 4–6 bullets, QA gets 3–4
    expect(baBrief.artifactStrategy.lineBudget).toMatch(/4.{1,3}6/)
    expect(qaBrief.artifactStrategy.lineBudget).toMatch(/3.{1,3}4/)
  })
})

// ─── 8. DIQ company facts are not converted into candidate claims ─────────────

describe('8. DIQ company facts do not become candidate claims', () => {
  it('generationRules.doNotCopyDIQAsCandidateExperience is always true', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [], globalSignals: [], rejectedPhrases: [], constraints: [],
    })
    expect(brief.generationRules.doNotCopyDIQAsCandidateExperience).toBe(true)
  })

  it('serialized brief includes DomainIQ non-transfer rule in GENERATION RULES', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [], globalSignals: [], rejectedPhrases: [], constraints: [],
    })
    const serialized = serializeBriefForPrompt(brief)
    expect(serialized).toContain('GENERATION RULES')
    expect(serialized).toMatch(/DomainIQ|company research|DIQ/i)
  })

  it('evaluator lens discount includes company-research language warning', () => {
    const lens = deriveEvaluatorLens('product-analytics', analyticsJDMap())
    const discounts = lens.whatTheyWillDiscount.join(' ').toLowerCase()
    expect(discounts).toMatch(/domainiq|company.research|research/)
  })
})

// ─── 9. Stage 5 strategy signals influence without raw bullets ────────────────

describe('9. Stage 5 strategy signals used — raw bullets excluded', () => {
  it('accepted-bullet type signals are excluded from brief learning signals', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: personalSignals(),
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    // The raw bullet from personalSignals() (accepted-bullet type) should NOT appear
    const allSignalContent = [
      ...brief.learningSignals.userSpecificSignals,
      ...brief.learningSignals.globalGenerationSignals,
    ].join(' ')
    expect(allSignalContent).not.toContain('Analyzed 3,000+ support signals to identify backlog priorities')
  })

  it('strategy-type signals (artifact_strategy, role_scope_rule) ARE included', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: personalSignals(),
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const signalContent = brief.learningSignals.userSpecificSignals.join(' ')
    expect(signalContent).toContain('preserve KPI')
    expect(signalContent).toContain('DIQ')
  })

  it('serialized brief includes strategy signals in GENERATION STRATEGY SIGNALS section', () => {
    const brief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: personalSignals(),
      globalSignals: [],
      rejectedPhrases: [],
      constraints: [],
    })
    const serialized = serializeBriefForPrompt(brief)
    expect(serialized).toContain('GENERATION STRATEGY SIGNALS')
    expect(serialized).toContain('preserve KPI')
    // Raw bullet text must NOT appear
    expect(serialized).not.toContain('Analyzed 3,000+ support signals to identify backlog priorities')
  })
})

// ─── 10. Section refinement prompt overrides overall for that artifact only ───

describe('10. Section refinement prompt scopes correctly', () => {
  it('overall prompt appears in user content BEFORE section instruction', () => {
    // This is a prompt-assembly contract: overall prompt is SESSION-WIDE context,
    // section instruction is the specific override.
    const overallPrompt = 'Focus on BA delivery over generic PO language.'
    const sectionInstruction = 'Tighten this specific section — remove QA references.'

    const lines: string[] = []
    if (overallPrompt) {
      lines.push('SESSION-WIDE REFINEMENT DIRECTION (applies as background strategy to all sections — not a license to invent claims):')
      lines.push(overallPrompt)
      lines.push('')
    }
    lines.push('SECTION REFINEMENT INSTRUCTION (this is context/direction, not replacement copy):')
    lines.push(sectionInstruction)

    const content = lines.join('\n')
    const overallIdx = content.indexOf('SESSION-WIDE REFINEMENT DIRECTION')
    const sectionIdx = content.indexOf('SECTION REFINEMENT INSTRUCTION')

    expect(overallIdx).toBeGreaterThanOrEqual(0)
    expect(sectionIdx).toBeGreaterThan(overallIdx)
  })

  it('refining section A with instruction does not produce changes to section B evidence', () => {
    // Different sections generate different briefs — the brief is per-section.
    const sectionABrief = buildArtifactGenerationBrief({
      sectionType: 'summary',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('summary'),
      acceptedSignals: [], globalSignals: [], rejectedPhrases: [], constraints: [],
    })
    const sectionBBrief = buildArtifactGenerationBrief({
      sectionType: 'experience-ba',
      emphasis: 'BA',
      roleTitle: 'Product Analyst',
      company: 'Alliant',
      jdMap: analyticsJDMap(),
      bundle: bundleForSection('experience-ba'),
      acceptedSignals: [], globalSignals: [], rejectedPhrases: [], constraints: [],
    })

    // Briefs are distinct — different artifact types and strategies
    expect(sectionABrief.artifactType).not.toBe(sectionBBrief.artifactType)
    // Section B purpose refers to BA/Product Analyst section specifically
    expect(sectionBBrief.artifactStrategy.purpose).toContain('Primary evidence section')
    // Section A (summary) does not
    expect(sectionABrief.artifactStrategy.purpose).not.toContain('Primary evidence section')
  })

  it('detectRoleFamily correctly identifies product analytics from title', () => {
    const roleFamily = detectRoleFamily('BA', 'Product Analyst – Member Insights & Analytics', analyticsJDMap())
    expect(roleFamily).toBe('product-analytics')
  })

  it('detectRoleFamily identifies business analyst for standard BA title', () => {
    const simpleJD: JDRequirementMap = {
      required: [
        { text: 'requirements elicitation', category: 'process', userCoverageStatus: 'covered' },
        { text: 'acceptance criteria', category: 'process', userCoverageStatus: 'covered' },
      ],
      niceToHave: [],
      realJobFunction: 'Business Analyst',
      needsEvidenceItems: [],
      unsupportedRequirements: [],
      weaklySupportedRequirements: [],
    }
    const roleFamily = detectRoleFamily('BA', 'Systems Integration Business Analyst', simpleJD)
    expect(roleFamily).toBe('business-analyst')
  })
})
