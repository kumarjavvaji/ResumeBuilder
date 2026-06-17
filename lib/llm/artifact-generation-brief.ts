/**
 * ArtifactGenerationBrief
 *
 * Structured strategic context built before every Anthropic artifact-generation
 * or refinement call. The brief tells the LLM:
 *   1. What artifact is being generated (artifactType)
 *   2. Who the evaluator is (evaluatorLens)
 *   3. What the target job values (targetContext)
 *   4. What candidate evidence is allowed (candidateEvidence)
 *   5. What to emphasize / deemphasize (artifactStrategy)
 *   6. Style the artifact must use (styleGuide)
 *   7. Non-negotiable generation rules (generationRules)
 *   8. Stage 5 learning signals — strategy only, no raw bullets (learningSignals)
 */

import type {
  SectionType, EmphasisCategory, JDRequirementMap,
  LearningSignal, CalibrationSummary
} from '@/contracts'
import type { ScopedEvidenceBundle } from '@/lib/evidence-scope'
import type { QualifiedEvidenceCard, ClaimGuardrails } from './qualified-evidence-cards'
import { deriveClaimGuardrails } from './qualified-evidence-cards'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvaluatorLens {
  likelyReader: string
  whatTheyCareAbout: string[]
  whatTheyWillDiscount: string[]
  knockoutRisks: string[]
  languageTheyExpect: string[]
}

export interface ArtifactGenerationBrief {
  artifactType: string
  targetContext: {
    company: string
    roleTitle: string
    roleFamily: string
    jdPriorities: string[]
    domainBasis: string
    calibrationNotes: string[]
  }
  evaluatorLens: EvaluatorLens
  candidateEvidence: {
    allowedEvidence: string[]
    strongestEvidence: string[]
    adjacentEvidence: string[]
    weakEvidence: string[]
    prohibitedClaims: string[]
  }
  artifactStrategy: {
    purpose: string
    sectionPriority: 'primary' | 'supporting' | 'context'
    lineBudget: string
    emphasis: string[]
    deemphasis: string[]
    mustInclude: string[]
    mustAvoid: string[]
  }
  styleGuide: {
    voice: string
    bulletShape: string
    bannedPhrases: string[]
    preferredFraming: string[]
  }
  generationRules: {
    doNotInventClaims: true
    doNotCopyDIQAsCandidateExperience: true
    preserveMetricsWhenSupported: true
    preferRoleSpecificLanguageOverGenericLanguage: true
    generateOnlyThisArtifact: true
  }
  learningSignals: {
    userSpecificSignals: string[]
    globalGenerationSignals: string[]
    acceptedPatterns: string[]
    rejectedPatterns: string[]
  }
  /** Compact guardrails derived from QualifiedEvidenceCards — injected into prompt. */
  claimGuardrails: ClaimGuardrails
}

export interface BriefBuildOpts {
  sectionType: SectionType
  emphasis: EmphasisCategory
  roleTitle: string
  company: string
  jdMap: JDRequirementMap
  bundle: ScopedEvidenceBundle
  acceptedSignals: LearningSignal[]
  globalSignals: LearningSignal[]
  rejectedPhrases: string[]
  constraints: string[]
  calibrationSummary?: CalibrationSummary
  companySummary?: string
  /** Evidence cards built from profile + bridge answers. Used to derive claimGuardrails. */
  qualifiedEvidenceCards?: QualifiedEvidenceCard[]
}

// ─── Role family detection ────────────────────────────────────────────────────

/** Detects the evaluator's mental model from emphasis + roleTitle + JD signals. */
export function detectRoleFamily(
  emphasis: EmphasisCategory,
  roleTitle: string,
  jdMap: JDRequirementMap
): string {
  const title = roleTitle.toLowerCase()
  const jdText = jdMap.required.map(r => r.text.toLowerCase()).join(' ')

  // Explicit data emphasis always → product analytics
  if (emphasis === 'data') return 'product-analytics'

  // AI/ML roles
  if (emphasis === 'AI' || /\bai\b|machine learning|ml\b/i.test(title)) return 'ai'

  // Analytics / reporting / insights in title → product analytics
  if (/analyt|insight|reporting|metrics?\b|kpi|dashboard/i.test(title)) return 'product-analytics'

  // BA with analytics-heavy JD
  if (emphasis === 'BA') {
    const analyticsKeywords = ['dashboard', 'kpi', 'sql', 'reporting', 'analytics', 'data validation', 'opportunity sizing', 'metrics', 'data quality']
    const hitCount = analyticsKeywords.filter(k => jdText.includes(k)).length
    if (hitCount >= 2) return 'product-analytics'
    return 'business-analyst'
  }

  if (emphasis === 'PO') return 'product-owner'
  if (emphasis === 'QA') return 'quality'
  if (emphasis === 'operations') return 'operations'

  return 'generic'
}

// ─── Evaluator lens derivation ────────────────────────────────────────────────

/** Returns the evaluator lens for the detected role family. */
export function deriveEvaluatorLens(
  roleFamily: string,
  jdMap: JDRequirementMap
): EvaluatorLens {
  switch (roleFamily) {
    case 'product-analytics':
      return {
        likelyReader: 'Product analytics lead, product manager, or business stakeholder evaluating ability to translate product and member data into decisions.',
        whatTheyCareAbout: [
          'member and product performance analysis',
          'KPI definition and metrics dictionary ownership',
          'dashboards and recurring reporting',
          'opportunity sizing across volumes, funnel steps, and portfolio impact',
          'launch impact analysis, pre/post measurement, and early indicators',
          'data quality validation and documented assumptions',
          'clear recommendations to Product, Engineering, UX, and Operations',
        ],
        whatTheyWillDiscount: [
          'generic product ownership language without analytics substance',
          'roadmap authority without data-backed decision evidence',
          'QA history unless tied to validation, data quality, release readiness, or product risk',
          'domain claims not supported by candidate evidence',
          'company-research language that reads like DomainIQ output, not candidate experience',
        ],
        knockoutRisks: [
          'claiming domain-specific platform or regulatory experience (direct deposit, lending, NCUA, CFPB, Symitar, Backbase) without profile evidence',
          'sounding like a Product Owner resume instead of a Product Analyst resume',
          'burying SQL, KPI, dashboard, reporting, opportunity sizing, and stakeholder recommendation evidence',
        ],
        languageTheyExpect: [
          'product performance', 'member outcomes', 'KPI measurement',
          'dashboard reporting', 'opportunity sizing', 'data quality',
          'source documentation', 'assumptions and methods',
          'launch impact', 'cross-functional recommendations',
        ],
      }

    case 'business-analyst':
      return {
        likelyReader: 'Delivery lead, product manager, or domain SME evaluating requirements elicitation, stakeholder facilitation, and release readiness.',
        whatTheyCareAbout: [
          'requirements elicitation and documentation',
          'gap analysis and acceptance criteria',
          'UAT coordination and release readiness',
          'workflow mapping and process improvement',
          'stakeholder alignment across business and technical teams',
        ],
        whatTheyWillDiscount: [
          'pure product ownership without analytical or requirements substance',
          'QA history not tied to acceptance criteria or validation',
          'generic delivery framing without specific requirements evidence',
        ],
        knockoutRisks: [
          'missing requirements elicitation and documentation evidence',
          'no acceptance criteria or UAT experience visible',
        ],
        languageTheyExpect: [
          'requirements elicitation', 'acceptance criteria', 'gap analysis',
          'UAT', 'workflow mapping', 'release readiness', 'stakeholder alignment',
        ],
      }

    case 'product-owner':
      return {
        likelyReader: 'Engineering manager, VP product, or product director evaluating backlog ownership, delivery authority, and roadmap decision quality.',
        whatTheyCareAbout: [
          'backlog ownership and sprint delivery',
          'roadmap decisions and stakeholder alignment',
          'delivery outcomes and launch metrics',
          'prioritization frameworks',
          'cross-functional leadership',
        ],
        whatTheyWillDiscount: [
          'pure analyst or BA framing without delivery ownership',
          'QA experience unless tied to release quality or launch readiness',
        ],
        knockoutRisks: [
          'no evidence of backlog ownership or sprint delivery',
          'missing launch outcomes or stakeholder alignment examples',
        ],
        languageTheyExpect: [
          'backlog', 'sprint', 'roadmap', 'stakeholders', 'delivery',
          'prioritization', 'acceptance criteria', 'launch',
        ],
      }

    case 'quality':
      return {
        likelyReader: 'QA lead, engineering manager, or delivery director evaluating test automation, quality frameworks, and release readiness.',
        whatTheyCareAbout: [
          'test automation and quality frameworks',
          'defect prevention and release readiness',
          'regression coverage and CI/CD integration',
          'access control and security testing',
        ],
        whatTheyWillDiscount: [
          'pure product framing without quality substance',
          'generic delivery language without test evidence',
        ],
        knockoutRisks: [
          'no test automation or quality framework evidence',
          'missing defect reduction or release readiness metrics',
        ],
        languageTheyExpect: [
          'test automation', 'regression', 'defect reduction', 'release readiness',
          'quality framework', 'CI/CD', 'access control',
        ],
      }

    default:
      return {
        likelyReader: 'Hiring manager evaluating cross-functional delivery, collaboration, and business impact.',
        whatTheyCareAbout: jdMap.required.slice(0, 5).map(r => r.text),
        whatTheyWillDiscount: ['generic resume language without specific evidence'],
        knockoutRisks: (jdMap.unsupportedRequirements ?? []).slice(0, 3),
        languageTheyExpect: jdMap.required.slice(0, 5).map(r => r.text),
      }
  }
}

// ─── Artifact strategy per section ───────────────────────────────────────────

const ARTIFACT_TYPE_LABELS: Record<SectionType, string> = {
  summary: 'Professional Summary',
  skills: 'Skills Section',
  'experience-po': 'Experience — Product Owner',
  'experience-ba': 'Experience — Business Analyst / Product Analyst',
  'experience-qa': 'Experience — QA / Quality',
  'cover-letter': 'Cover Letter',
  'referral-message': 'Referral Message',
  'recruiter-message': 'Recruiter Message',
  'linkedin-dm': 'LinkedIn DM',
  'talking-points': 'Interview Talking Points',
}

function deriveArtifactStrategy(
  sectionType: SectionType,
  roleFamily: string,
  jdMap: JDRequirementMap,
  bundle: ScopedEvidenceBundle
): ArtifactGenerationBrief['artifactStrategy'] {
  // JD-covered required skills — ATS-critical terms
  const coveredJDTerms = jdMap.required
    .filter(r => r.userCoverageStatus === 'covered' || r.userCoverageStatus === 'partial')
    .map(r => r.text)

  // Unsupported gaps — must not become claims
  const unsupportedGaps = [
    ...(jdMap.unsupportedRequirements ?? []),
    ...bundle.scope.disallowedClaimPatterns,
  ]

  switch (sectionType) {
    case 'summary': {
      const isAnalytics = roleFamily === 'product-analytics'
      return {
        purpose: isAnalytics
          ? 'Establish Product Analyst positioning in 3–4 lines. Lead with analytics depth and data-to-decision capability. End with what the candidate brings to this specific analytics function.'
          : 'Establish candidate positioning in 3–4 lines. Lead with the primary function and domain strength. End with what they bring to this specific role.',
        sectionPriority: 'primary',
        lineBudget: '3–4 lines MAXIMUM — positioning statement only, not a career history dump',
        emphasis: isAnalytics
          ? ['product analytics and data-backed decisions', 'KPI definition and metrics ownership', 'SQL/data validation', 'cross-functional reporting and stakeholder recommendations', 'opportunity sizing']
          : ['primary role function', 'domain strength', 'core JD-aligned capability'],
        deemphasis: isAnalytics
          ? ['generic PO language', 'roadmap authority without analytics substance', 'company-research terms that sound like DomainIQ output']
          : ['puff language', 'generic openers', 'career history narration', 'older employers irrelevant to this JD'],
        mustInclude: coveredJDTerms.slice(0, 3),
        mustAvoid: [
          'results-driven', 'dynamic', 'passionate', 'thought leader', 'synergize', 'leverage',
          '"formal PO tenure"',
          '"early career includes"',
          '"grounding operational context"',
          '"grounding data pipeline context"',
          'GAINSystems (exclude unless JD requires supply chain/CPG/operations domain)',
          '"With a decade of..."',
          '"Background includes..."',
          ...unsupportedGaps.slice(0, 3),
        ],
      }
    }

    case 'skills': {
      return {
        purpose: 'ATS-aligned skills list organized by functional area. Use JD-required terms the candidate actually has. No invented skills.',
        sectionPriority: 'primary',
        lineBudget: '6–8 skill group lines',
        emphasis: roleFamily === 'product-analytics'
          ? ['Product Analytics', 'KPI Measurement', 'Data Analysis', 'SQL', 'Dashboard Reporting', 'Data Validation', 'Opportunity Sizing', 'Stakeholder Communication', ...coveredJDTerms.slice(0, 4)]
          : coveredJDTerms.slice(0, 8),
        deemphasis: ['generic soft skills', 'QA-only terms unless JD requires them', 'Authentication', 'HR', 'Documentation as a standalone category'],
        mustInclude: coveredJDTerms.filter(t => /sql|analyt|dashboard|kpi|pendo|salesforce|report|data/i.test(t)),
        mustAvoid: ['skills not present in the candidate profile', 'one-word generic headings with no JD alignment'],
      }
    }

    case 'experience-po': {
      const isAnalytics = roleFamily === 'product-analytics'
      return {
        purpose: isAnalytics
          ? 'Recent Product Owner context — reframe as analytics-informed delivery. Translate roadmap work into KPI-informed prioritization, usage signal analysis, and data-backed decisions.'
          : 'Product Owner evidence — backlog ownership, sprint delivery, stakeholder alignment, delivery outcomes.',
        sectionPriority: isAnalytics ? 'supporting' : 'primary',
        lineBudget: '3–5 bullets',
        emphasis: isAnalytics
          ? ['KPI-informed prioritization', 'usage signals and acceptance criteria', 'stakeholder alignment', 'dependency tracking and launch readiness', 'data-backed delivery decisions']
          : ['backlog ownership', 'sprint delivery', 'roadmap decisions', 'stakeholder alignment', 'launch outcomes'],
        deemphasis: isAnalytics
          ? ['pure roadmap ownership language', 'backlog grooming without analytical substance', 'generic delivery framing']
          : ['pure BA framing', 'requirement documentation without delivery ownership'],
        mustInclude: [],
        mustAvoid: ['unsupported domain claims', ...unsupportedGaps.slice(0, 2)],
      }
    }

    case 'experience-ba': {
      const isAnalytics = roleFamily === 'product-analytics'
      return {
        purpose: isAnalytics
          ? 'Primary evidence section — strongest fit for analytics and product analyst roles. Emphasize SQL-supported analysis, Salesforce/Pendo signal synthesis, reporting, data validation, workflow trends, and stakeholder recommendations.'
          : 'Business Analyst evidence — requirements elicitation, gap analysis, acceptance criteria, UAT, workflow mapping, stakeholder alignment.',
        sectionPriority: 'primary',
        lineBudget: isAnalytics ? '4–6 bullets (primary section — give it full room)' : '3–5 bullets',
        emphasis: isAnalytics
          ? ['SQL-supported analysis', 'Salesforce/Pendo signal synthesis', 'backlog prioritization grounded in data', 'recurring reporting and dashboards', 'data validation and documented assumptions', 'workflow trends and opportunity sizing', 'stakeholder recommendations']
          : ['requirements elicitation', 'gap analysis', 'acceptance criteria', 'UAT coordination', 'workflow mapping', 'release readiness'],
        deemphasis: isAnalytics
          ? ['generic delivery framing', 'PO language without analytical backing', 'QA history unless tied to data quality']
          : ['generic product ownership', 'roadmap language without requirements substance'],
        mustInclude: bundle.primaryWorkEntries
          .filter(e => /analyst|ba\b|business/i.test(e.title))
          .flatMap(e => e.approvedMetrics)
          .slice(0, 3),
        mustAvoid: [
          ...unsupportedGaps.slice(0, 3),
          '"Led all Scrum ceremonies" (use "Supported backlog refinement, sprint demos, and ceremony preparation..." instead)',
          '"Owned product roadmap" (PA does not own the roadmap)',
          '"Managed sprint delivery" (that is PO/PM framing)',
        ],
      }
    }

    case 'experience-qa': {
      const isAnalytics = roleFamily === 'product-analytics'
      return {
        purpose: isAnalytics
          ? 'Supporting section — validation discipline and data integrity. Emphasize how QA experience reinforces data quality, release readiness, and risk prevention.'
          : 'QA / Quality evidence — test automation, quality frameworks, defect reduction, release readiness.',
        sectionPriority: isAnalytics ? 'context' : 'primary',
        lineBudget: isAnalytics ? '3–4 bullets (supporting section — keep concise)' : '3–5 bullets',
        emphasis: isAnalytics
          ? ['validation discipline', 'data integrity and access-control risk', 'release readiness', 'defect prevention']
          : ['test automation', 'quality frameworks', 'SpecFlow/regression', 'defect reduction', 'release readiness'],
        deemphasis: isAnalytics
          ? ['QA-targeted resume framing', 'automation toolchain details irrelevant to analytics role', 'testing vocabulary without validation or data-quality framing']
          : ['generic delivery language without quality focus'],
        mustInclude: [],
        mustAvoid: isAnalytics
          ? ['making this section feel like a QA resume', ...unsupportedGaps.slice(0, 2)]
          : unsupportedGaps.slice(0, 2),
      }
    }

    case 'cover-letter':
      return {
        purpose: 'Cover letter that does NOT recap the resume. Explains why this role at this company fits the candidate\'s career direction. 3 short paragraphs.',
        sectionPriority: 'primary',
        lineBudget: '3 short paragraphs',
        emphasis: ['career direction fit', 'specific role-company alignment', 'one or two concrete evidence anchors'],
        deemphasis: ['resume recap', 'generic interest statements', 'puff language'],
        mustInclude: [],
        mustAvoid: ['"I am excited to apply"', 'generic opener', 'unsupported domain claims'],
      }

    case 'talking-points':
      return {
        purpose: '5–7 interview talking points, each 2–3 sentences. Cover likely JD areas of interest and include honest handling of gap areas.',
        sectionPriority: 'primary',
        lineBudget: '5–7 points, 2–3 sentences each',
        emphasis: ['JD-priority areas', 'evidence-anchored stories', 'honest gap framing'],
        deemphasis: ['generic talking points without specifics'],
        mustInclude: [],
        mustAvoid: ['inventing domain claims not supported by profile'],
      }

    default:
      return {
        purpose: `Generate a focused ${sectionType} artifact for this role.`,
        sectionPriority: 'context',
        lineBudget: 'concise',
        emphasis: coveredJDTerms.slice(0, 4),
        deemphasis: ['puff language', 'generic filler'],
        mustInclude: [],
        mustAvoid: unsupportedGaps.slice(0, 2),
      }
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildArtifactGenerationBrief(opts: BriefBuildOpts): ArtifactGenerationBrief {
  const {
    sectionType, emphasis, roleTitle, company, jdMap, bundle,
    acceptedSignals, globalSignals, rejectedPhrases, constraints,
    calibrationSummary, companySummary, qualifiedEvidenceCards,
  } = opts

  const roleFamily = detectRoleFamily(emphasis, roleTitle, jdMap)
  const evaluatorLens = deriveEvaluatorLens(roleFamily, jdMap)
  const artifactStrategy = deriveArtifactStrategy(sectionType, roleFamily, jdMap, bundle)

  // Strong evidence: primary entries with metrics or many bullets
  const strongestEvidence = bundle.primaryWorkEntries
    .sort((a, b) => (b.approvedMetrics.length + b.bullets.length) - (a.approvedMetrics.length + a.bullets.length))
    .slice(0, 3)
    .map(e => `${e.title} at ${e.company}${e.approvedMetrics.length ? ` (metrics: ${e.approvedMetrics.slice(0, 2).join(', ')})` : ''}`)

  const adjacentEvidence = bundle.supportingWorkEntries
    .slice(0, 2)
    .map(e => `${e.title} at ${e.company} — prior background framing required`)

  const weakEvidence = bundle.uncertainBridgeEvidence
    .slice(0, 3)
    .map(e => `[uncertain] ${e.normalizedEvidenceStatement.slice(0, 80)}`)

  const prohibitedClaims = [
    ...bundle.scope.disallowedClaimPatterns,
    ...(jdMap.unsupportedRequirements ?? []).map(r => `Do not claim: ${r}`),
  ]

  const allowedEvidence = bundle.primaryWorkEntries.map(e => `${e.title} at ${e.company}`)

  // Stage 5 signals: only strategy-type signals, never raw bullet content
  const strategySignalTypes = new Set([
    'role-preference', 'jd-pattern', 'style-constraint', 'artifact-strategy',
    'jd_alignment_strategy', 'evidence_boundary', 'role_scope_rule',
    'reusable_prompt_heuristic', 'artifact_strategy', 'personal_positioning_rule',
    'calibration_pattern',
  ])
  const userSpecificSignals = acceptedSignals
    .filter(s => strategySignalTypes.has(s.type))
    .slice(0, 6)
    .map(s => s.content)
  const globalGenerationSignals = globalSignals
    .filter(s => strategySignalTypes.has(s.type))
    .slice(0, 4)
    .map(s => s.globalContent ?? s.content)

  // Style
  const bannedPhrases = [
    ...rejectedPhrases,
    ...constraints.filter(c => c.startsWith('Do not use') || c.startsWith('Avoid')),
    'passionate', 'dynamic', 'results-driven', 'thought leader', 'synergize', 'leverage synergies',
  ]
  const preferredFraming = bundle.scope.requiredFramingRules.slice(0, 4)

  const claimGuardrails = deriveClaimGuardrails(qualifiedEvidenceCards ?? [])

  return {
    artifactType: ARTIFACT_TYPE_LABELS[sectionType] ?? sectionType,
    targetContext: {
      company,
      roleTitle,
      roleFamily,
      jdPriorities: jdMap.required.slice(0, 6).map(r => r.text),
      domainBasis: companySummary ?? '',
      calibrationNotes: calibrationSummary?.artifactGuidance?.slice(0, 4) ?? [],
    },
    evaluatorLens,
    candidateEvidence: {
      allowedEvidence,
      strongestEvidence,
      adjacentEvidence,
      weakEvidence,
      prohibitedClaims,
    },
    artifactStrategy,
    styleGuide: {
      voice: 'concise, evidence-grounded, first-person implied — no subject pronoun at start of bullets',
      bulletShape: 'impact-first, specific metric or context second, role/company attribution third if needed',
      bannedPhrases: [...new Set(bannedPhrases)],
      preferredFraming,
    },
    generationRules: {
      doNotInventClaims: true,
      doNotCopyDIQAsCandidateExperience: true,
      preserveMetricsWhenSupported: true,
      preferRoleSpecificLanguageOverGenericLanguage: true,
      generateOnlyThisArtifact: true,
    },
    learningSignals: {
      userSpecificSignals,
      globalGenerationSignals,
      acceptedPatterns: [],
      rejectedPatterns: rejectedPhrases.slice(0, 6),
    },
    claimGuardrails,
  }
}

// ─── Serializer ───────────────────────────────────────────────────────────────

/** Converts a brief to prompt text. Injected at the start of the system prompt. */
export function serializeBriefForPrompt(brief: ArtifactGenerationBrief): string {
  const lines: string[] = [
    '╔══ ARTIFACT GENERATION BRIEF ══╗',
    '',
    `ARTIFACT: ${brief.artifactType}`,
    `TARGET: ${brief.targetContext.roleTitle} at ${brief.targetContext.company}`,
    `ROLE FAMILY: ${brief.targetContext.roleFamily}`,
    `SECTION PRIORITY: ${brief.artifactStrategy.sectionPriority}  |  LINE BUDGET: ${brief.artifactStrategy.lineBudget}`,
  ]

  // Target context
  if (brief.targetContext.jdPriorities.length) {
    lines.push('', 'JD PRIORITIES (what this role actually needs):')
    for (const p of brief.targetContext.jdPriorities) lines.push(`  · ${p}`)
  }

  // Evaluator lens
  const lens = brief.evaluatorLens
  lines.push(
    '',
    'EVALUATOR LENS:',
    `  Reader: ${lens.likelyReader}`,
    `  Values: ${lens.whatTheyCareAbout.join(', ')}`,
    `  Will discount: ${lens.whatTheyWillDiscount.join('; ')}`,
  )
  if (lens.knockoutRisks.length) {
    lines.push('  Knockout risks (DO NOT trigger these):')
    for (const r of lens.knockoutRisks) lines.push(`    ✗ ${r}`)
  }
  if (lens.languageTheyExpect.length) {
    lines.push(`  Expected language: ${lens.languageTheyExpect.join(', ')}`)
  }

  // Candidate evidence
  const ev = brief.candidateEvidence
  if (ev.strongestEvidence.length) {
    lines.push('', 'STRONGEST CANDIDATE EVIDENCE FOR THIS SECTION:')
    for (const e of ev.strongestEvidence) lines.push(`  ✓ ${e}`)
  }
  if (ev.adjacentEvidence.length) {
    lines.push('ADJACENT CONTEXT (prior-background framing required if referenced):')
    for (const e of ev.adjacentEvidence) lines.push(`  ~ ${e}`)
  }
  if (ev.prohibitedClaims.length) {
    lines.push('PROHIBITED CLAIMS (do not generate these regardless of JD demand):')
    for (const c of ev.prohibitedClaims) lines.push(`  ✗ ${c}`)
  }

  // Artifact strategy
  const strat = brief.artifactStrategy
  lines.push('', 'ARTIFACT STRATEGY:')
  lines.push(`  Purpose: ${strat.purpose}`)
  if (strat.emphasis.length) lines.push(`  Emphasize: ${strat.emphasis.join(', ')}`)
  if (strat.deemphasis.length) lines.push(`  Deemphasize: ${strat.deemphasis.join(', ')}`)
  if (strat.mustInclude.length) lines.push(`  Must include: ${strat.mustInclude.join(', ')}`)
  if (strat.mustAvoid.length) lines.push(`  Must avoid: ${strat.mustAvoid.join(', ')}`)

  // Style
  const style = brief.styleGuide
  lines.push('', 'STYLE:')
  lines.push(`  Voice: ${style.voice}`)
  if (style.bulletShape) lines.push(`  Bullet shape: ${style.bulletShape}`)
  if (style.bannedPhrases.length) lines.push(`  Banned phrases: ${style.bannedPhrases.slice(0, 8).join(', ')}`)
  if (style.preferredFraming.length) {
    lines.push('  Preferred framing:')
    for (const f of style.preferredFraming) lines.push(`    - ${f}`)
  }

  // Claim guardrails (derived from evidence cards)
  const guardrails = brief.claimGuardrails
  const hasGuardrails = guardrails.learningOnlyItems.length > 0
    || guardrails.adjacentItems.length > 0
    || guardrails.noEvidenceItems.length > 0

  if (hasGuardrails) {
    lines.push('', 'CLAIM GUARDRAILS (enforce before generating each bullet):')
    if (guardrails.learningOnlyItems.length > 0) {
      lines.push(`  Learning-only (no professional experience claims): ${guardrails.learningOnlyItems.join(', ')}`)
    }
    if (guardrails.adjacentItems.length > 0) {
      lines.push(`  Adjacent only (prior-background framing required): ${guardrails.adjacentItems.join(', ')}`)
    }
    if (guardrails.noEvidenceItems.length > 0) {
      lines.push(`  No evidence — generate nothing for: ${guardrails.noEvidenceItems.join(', ')}`)
    }
  }

  // Generation rules
  lines.push(
    '',
    'GENERATION RULES (non-negotiable):',
    '  · Do not invent claims — every claim must trace to work history or bridge answers.',
    '  · Do not copy DomainIQ / company research facts as candidate experience.',
    '  · Preserve metrics when supported by profile.',
    '  · Prefer role-specific language over generic resume polish.',
    '  · Generate only this artifact section.',
  )

  // Calibration notes (brief summary — full block in main prompt)
  if (brief.targetContext.calibrationNotes.length) {
    lines.push('', 'CALIBRATION GUIDANCE (strategy only — not candidate evidence):')
    for (const n of brief.targetContext.calibrationNotes.slice(0, 3)) lines.push(`  · ${n}`)
  }

  // Learning signals (strategy only)
  const ls = brief.learningSignals
  const allSignals = [...ls.userSpecificSignals, ...ls.globalGenerationSignals]
  if (allSignals.length) {
    lines.push('', 'GENERATION STRATEGY SIGNALS (from Stage 5 — rules, not resume content):')
    for (const s of allSignals) lines.push(`  · ${s}`)
  }
  if (ls.rejectedPatterns.length) {
    lines.push(`  Rejected patterns (never use): ${ls.rejectedPatterns.slice(0, 5).join(', ')}`)
  }

  lines.push('', '╚══ END BRIEF ══╝', '')
  return lines.join('\n')
}
