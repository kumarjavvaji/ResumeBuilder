import { anthropic, MODEL } from './client'
import type {
  SectionType,
  JDRequirementMap,
  UserProfile,
  BridgeQuestion,
  LearningSignal,
  EmphasisCategory,
  CalibrationSummary,
  ArtifactVersion,
  RefinementLearningSignal,
  RefinementEvidenceBoundary,
} from '@/contracts'
import type { FitAnalysisContext, CalibrationRefSlim } from '@/lib/artifacts/buildArtifactRefinementContext'
import { nanoid } from '@/lib/storage/nanoid'
import { buildScopedEvidenceBundle } from '@/lib/evidence-scope'
import {
  sanitizeCalibrationEvidenceRefs,
  sanitizeSourceMappings,
} from '@/lib/calibration/influence'
import {
  buildArtifactGenerationBrief,
  serializeBriefForPrompt,
} from './artifact-generation-brief'
import { buildQualifiedEvidenceCards } from './qualified-evidence-cards'

export interface RefineOptions {
  sessionId: string
  sectionType: SectionType
  /** The current artifact text the user wants refined. */
  artifactText: string
  /** The user's refinement instruction. Must not be used as replacement copy. */
  userInstruction: string
  jdMap: JDRequirementMap
  profile: UserProfile
  answeredQuestions: BridgeQuestion[]
  emphasis: EmphasisCategory
  companySummary?: string
  fitHypothesis?: string
  riskGaps?: string[]
  acceptedSignals: LearningSignal[]
  globalSignals?: LearningSignal[]
  rejectedPhrases: string[]
  calibrationSummary?: CalibrationSummary
  /** Prior version history — sent as context so the LLM sees the full revision arc. */
  priorVersions?: Pick<ArtifactVersion, 'versionNumber' | 'userInstruction' | 'revisedText'>[]
  /** Session-wide refinement direction — background strategy that applies to all sections. */
  overallRefinementPrompt?: string
  /** Target role title — used to build the evaluator lens in the Artifact Generation Brief. */
  roleTitle?: string
  /** Target company name — included in the brief for contextual framing. */
  company?: string
  // Stage 3B enrichment: fit intelligence and calibration context assembled client-side
  fitAnalysisContext?: FitAnalysisContext
  calibrationRefs?: CalibrationRefSlim[]
}

export interface RefinementResult {
  revisedText: string
  changeSummary: string[]
  evidenceBoundary: RefinementEvidenceBoundary
  confidence: 'high' | 'medium' | 'low'
  learningSignals: RefinementLearningSignal[]
  /** The ArtifactVersion record to append to versions[]. */
  version: ArtifactVersion
}

export async function refineResumeArtifact(opts: RefineOptions): Promise<RefinementResult> {
  const {
    sectionType, artifactText, userInstruction,
    jdMap, profile, answeredQuestions, emphasis,
    companySummary, fitHypothesis, riskGaps,
    acceptedSignals, globalSignals = [], rejectedPhrases,
    calibrationSummary, priorVersions = [],
    overallRefinementPrompt,
    roleTitle = '', company = '',
    fitAnalysisContext, calibrationRefs,
  } = opts

  const bundle = buildScopedEvidenceBundle(profile, answeredQuestions, sectionType)

  const evidenceCards = buildQualifiedEvidenceCards(profile, answeredQuestions, jdMap, bundle)

  const brief = buildArtifactGenerationBrief({
    sectionType, emphasis, roleTitle, company, jdMap, bundle,
    acceptedSignals, globalSignals, rejectedPhrases,
    constraints: profile.constraints ?? [],
    calibrationSummary, companySummary,
    qualifiedEvidenceCards: evidenceCards,
  })

  const systemPrompt = buildRefineSystemPrompt({
    sectionType, emphasis, rejectedPhrases,
    acceptedSignals, globalSignals,
    constraints: profile.constraints ?? [],
    framingNote: bundle.scope.framingNote,
    disallowedClaimPatterns: bundle.scope.disallowedClaimPatterns,
    calibrationSummary,
    brief,
  })
  const userContent = buildRefineUserContent({
    sectionType, artifactText, userInstruction,
    jdMap, profile, bundle,
    companySummary, fitHypothesis, riskGaps,
    priorVersions,
    overallRefinementPrompt,
    fitAnalysisContext, calibrationRefs,
  })

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [REFINE_TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'refine_section' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Refine section (${sectionType}): no tool_use response`)
  }

  const raw = toolUse.input as {
    revisedText: string
    changeSummary: string[]
    evidenceBoundary: RefinementEvidenceBoundary
    confidence: 'high' | 'medium' | 'low'
    learningSignals: RefinementLearningSignal[]
  }

  if (!raw.revisedText?.trim()) {
    throw new Error(`Refine section (${sectionType}): LLM returned empty revisedText`)
  }

  const priorVersionCount = priorVersions.length
  const versionNumber = priorVersionCount + 2 // version 1 = initial, +1 per refine

  const version: ArtifactVersion = {
    versionId: nanoid(),
    versionNumber,
    createdAt: new Date().toISOString(),
    source: 'llm_refinement',
    userInstruction,
    previousText: artifactText,
    revisedText: raw.revisedText,
    changeSummary: raw.changeSummary ?? [],
    evidenceBoundary: raw.evidenceBoundary ?? { preservedClaims: [], removedOrSoftenedClaims: [], unsupportedRequests: [] },
    confidence: raw.confidence ?? 'medium',
    learningSignals: raw.learningSignals ?? [],
  }

  return {
    revisedText: raw.revisedText,
    changeSummary: raw.changeSummary ?? [],
    evidenceBoundary: raw.evidenceBoundary ?? { preservedClaims: [], removedOrSoftenedClaims: [], unsupportedRequests: [] },
    confidence: raw.confidence ?? 'medium',
    learningSignals: raw.learningSignals ?? [],
    version,
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

interface BuildSystemOpts {
  sectionType: SectionType
  emphasis: EmphasisCategory
  rejectedPhrases: string[]
  acceptedSignals: LearningSignal[]
  globalSignals: LearningSignal[]
  constraints: string[]
  framingNote: string | null
  disallowedClaimPatterns: string[]
  calibrationSummary?: CalibrationSummary
  brief?: import('./artifact-generation-brief').ArtifactGenerationBrief
}

function buildRefineSystemPrompt(opts: BuildSystemOpts): string {
  const {
    sectionType, emphasis, rejectedPhrases, acceptedSignals,
    globalSignals, constraints, framingNote, disallowedClaimPatterns,
    calibrationSummary, brief,
  } = opts

  const rejectedBlock = rejectedPhrases.length
    ? `\nNEVER use these phrases (user-rejected): ${rejectedPhrases.map(p => `"${p}"`).join(', ')}`
    : ''

  const constraintsBlock = constraints.length
    ? `\nUser constraints (must follow):\n${constraints.map(c => `- ${c}`).join('\n')}`
    : ''

  const personalBlock = acceptedSignals.length
    ? `\nPersonal signals (this user's approved examples — reuse tone, structure, and framing patterns):\n${acceptedSignals.slice(0, 10).map(s => `- ${s.content}`).join('\n')}`
    : ''

  const globalBlock = globalSignals.length
    ? `\nGlobal strategy signals (product-level guidance):\n${globalSignals.slice(0, 8).map(s => `- ${s.globalContent ?? s.content}`).join('\n')}`
    : ''

  const framingBlock = framingNote ? `\n\n${framingNote}` : ''

  const disallowedBlock = disallowedClaimPatterns.length > 0
    ? `\n\nDisallowed claim patterns for this section (must NOT appear in any bullet):\n${disallowedClaimPatterns.map(p => `- "${p}"`).join('\n')}`
    : ''

  const calibrationBlock = calibrationSummary?.calibrationUsed
    ? buildCalibrationBlock(calibrationSummary)
    : ''

  const briefBlock = brief ? serializeBriefForPrompt(brief) : ''

  return `${briefBlock}You refine existing resume artifact sections for a specific job application.

Emphasis: ${emphasis}
Section type: ${sectionType}

YOUR TASK: Revise the existing section text. Do NOT merely comment on it. Produce improved output.

Refinement rules (strictly enforced):
- The user's refinement note is INSTRUCTION, not replacement copy. Do not paste it into the artifact.
- Revise the artifact to be: more aligned to the JD, more concise, more evidence-grounded, or more role-specific.
- If none of these goals is achievable with the provided evidence, explain why in changeSummary and return the original text unchanged.
- Preserve only defensible, evidence-backed claims. Remove or soften anything that cannot be proven from the work history.
- Prefer concrete role/JD alignment over generic resume polish.
- Do not invent experience, metrics, employers, tools, certifications, titles, or outcomes.
- Do not use puff language ("passionate", "dynamic", "results-driven", "thought leader", "synergize", "leverage", etc.).
- Preserve ATS-friendly formatting unless the user explicitly asks otherwise.
- Do not invent skills, tools, or accomplishments not present in the work history or bridge answers.
${framingBlock}
${disallowedBlock}
${calibrationBlock}

Evidence rules:
- Every claim must be traceable to a work entry, metric, or bridge answer in the evidence below.
- If the user's instruction asks for a claim that cannot be evidenced, add it to unsupportedRequests and do not include it.
- Removing unsupported claims is safer than softening them. Soft phrasing can still mislead.
- Do not use calibration references as user evidence.
${rejectedBlock}
${constraintsBlock}
${personalBlock}
${globalBlock}

Response format: return only the JSON tool call. No prose before or after.`
}

function buildCalibrationBlock(c: CalibrationSummary): string {
  const lines = ['\n\nMarket calibration context (strategy guidance only — do NOT use as evidence for user claims):']
  if (c.repeatedTitles.length) lines.push(`Typical titles in this market: ${c.repeatedTitles.join(', ')}`)
  if (c.repeatedSkillsTools.length) lines.push(`Repeatedly cited tools/skills: ${c.repeatedSkillsTools.join(', ')}`)
  if (c.artifactGuidance.length) {
    lines.push('Artifact guidance from market calibration:')
    for (const g of c.artifactGuidance) lines.push(`  - ${g}`)
  }
  if (c.credibilityBoundaries.length) {
    lines.push('Credibility boundaries (only claim if user has evidence):')
    for (const b of c.credibilityBoundaries) lines.push(`  - ${b}`)
  }
  lines.push('REMINDER: The above are market observations, not user evidence.')
  return lines.join('\n')
}

// ─── User message content ─────────────────────────────────────────────────────

interface BuildContentOpts {
  sectionType: SectionType
  artifactText: string
  userInstruction: string
  jdMap: JDRequirementMap
  profile: UserProfile
  bundle: ReturnType<typeof buildScopedEvidenceBundle>
  companySummary?: string
  fitHypothesis?: string
  riskGaps?: string[]
  priorVersions: Pick<ArtifactVersion, 'versionNumber' | 'userInstruction' | 'revisedText'>[]
  overallRefinementPrompt?: string
  fitAnalysisContext?: FitAnalysisContext
  calibrationRefs?: CalibrationRefSlim[]
}

function buildRefineUserContent(opts: BuildContentOpts): string {
  const {
    sectionType, artifactText, userInstruction,
    jdMap, profile, bundle,
    companySummary, fitHypothesis, riskGaps,
    priorVersions,
    overallRefinementPrompt,
    fitAnalysisContext, calibrationRefs,
  } = opts

  const lines: string[] = [`Refine section: ${sectionType}`, '']

  // ── Session-wide refinement direction (background strategy, not section-specific) ──
  if (overallRefinementPrompt?.trim()) {
    lines.push('SESSION-WIDE REFINEMENT DIRECTION (applies as background strategy to all sections — not a license to invent claims):')
    lines.push(overallRefinementPrompt.trim())
    lines.push('')
  }

  // ── Refinement instruction (must come first — it is the user's goal) ─────────
  lines.push('SECTION REFINEMENT INSTRUCTION (this is context/direction, not replacement copy):')
  lines.push(userInstruction)
  lines.push('')

  // ── Current artifact text (to be refined) ────────────────────────────────────
  lines.push('CURRENT ARTIFACT TEXT (revise this):')
  lines.push(artifactText)
  lines.push('')

  // ── Prior revision history (context only, not targets) ───────────────────────
  if (priorVersions.length > 0) {
    lines.push('Prior revision history (context — shows what was already tried):')
    for (const v of priorVersions.slice(-3)) {
      lines.push(`  v${v.versionNumber}: instruction="${v.userInstruction ?? 'none'}"`)
    }
    lines.push('')
  }

  // ── Company / fit context ─────────────────────────────────────────────────────
  if (companySummary) lines.push('Company context:', `  ${companySummary}`, '')
  if (fitHypothesis) lines.push('Fit hypothesis:', `  ${fitHypothesis}`, '')
  if (riskGaps?.length) {
    lines.push('Risk / gap areas (must address or flag):')
    for (const g of riskGaps) lines.push(`  - ${g}`)
    lines.push('')
  }

  // ── JD requirements ────────────────────────────────────────────────────────
  lines.push('JD required skills:')
  for (const r of jdMap.required) {
    lines.push(`  [${r.category}] ${r.text} (coverage: ${r.userCoverageStatus})`)
  }
  if (jdMap.niceToHave?.length) {
    lines.push('', 'JD nice to have:')
    for (const r of jdMap.niceToHave) {
      lines.push(`  [${r.category}] ${r.text} (coverage: ${r.userCoverageStatus})`)
    }
  }
  lines.push('')

  // ── Work history (scoped) ──────────────────────────────────────────────────
  lines.push('Work history (primary role evidence):')
  for (const w of bundle.primaryWorkEntries) {
    lines.push(`  ${w.title} at ${w.company} (${w.startDate}–${w.endDate})`)
    for (const b of w.bullets) lines.push(`    - ${b}`)
    for (const m of w.approvedMetrics) lines.push(`    [metric] ${m}`)
  }
  lines.push('')

  if (bundle.supportingWorkEntries.length > 0) {
    lines.push('Prior background (supporting context only — must cite role explicitly if referenced):')
    for (const w of bundle.supportingWorkEntries) {
      lines.push(`  ${w.title} at ${w.company} (${w.startDate}–${w.endDate})`)
      for (const b of w.bullets) lines.push(`    - ${b}`)
      for (const m of w.approvedMetrics) lines.push(`    [metric] ${m}`)
    }
    lines.push('')
  }

  // ── Bridge evidence ────────────────────────────────────────────────────────
  if (bundle.normalizedBridgeEvidence.length > 0) {
    lines.push('Bridge evidence (scoped for this section):')
    for (const n of bundle.normalizedBridgeEvidence) {
      lines.push(`  Q [${n.questionType}]: "${n.originalQuestion}"`)
      lines.push(`  Evidence: ${n.normalizedEvidenceStatement}`)
      if (n.forbiddenOverclaim.length > 0) {
        lines.push(`  Forbidden overclaim: do NOT claim ${n.forbiddenOverclaim.join('; ')}`)
      }
      if (n.limitations.length > 0) {
        lines.push(`  Limitation: ${n.limitations.join('; ')}`)
      }
    }
    lines.push('')
  }

  if (bundle.uncertainBridgeEvidence.length > 0) {
    lines.push('Uncertain answers (do NOT generate positive claims from these):')
    for (const n of bundle.uncertainBridgeEvidence) {
      lines.push(`  [User expressed uncertainty] ${n.normalizedEvidenceStatement}`)
    }
    lines.push('')
  }

  // ── Fit analysis context (per-requirement assessment from Stage 1) ─────────
  if (fitAnalysisContext) {
    if (fitAnalysisContext.requirements.length > 0) {
      lines.push('Fit analysis per requirement (Stage 1 assessment — use to prioritize and calibrate framing):')
      for (const r of fitAnalysisContext.requirements) {
        lines.push(`  Requirement: ${r.requirementText}`)
        if (r.classification) lines.push(`    Classification: ${r.classification}`)
        if (r.profileEvidenceStrength) lines.push(`    Evidence strength: ${r.profileEvidenceStrength}`)
        if (r.quickDiqGrounding) lines.push(`    Quick-DIQ grounding: ${r.quickDiqGrounding}`)
        if (r.calibratedFitInterpretation) lines.push(`    Calibrated interpretation: ${r.calibratedFitInterpretation}`)
      }
      lines.push('')
    }

    const gs = fitAnalysisContext.gapSummary
    if (gs) {
      if (gs.trueGaps.length) {
        lines.push('True gaps (no evidence — handle honestly, do not fabricate):')
        for (const g of gs.trueGaps) lines.push(`  - ${g}`)
        lines.push('')
      }
      if (gs.needsConfirmation.length) {
        lines.push('Needs confirmation (weak or inferred evidence):')
        for (const g of gs.needsConfirmation) lines.push(`  - ${g}`)
        lines.push('')
      }
      if (gs.wordingOrMapping.length) {
        lines.push('Wording/mapping gaps (candidate has the experience but terms differ):')
        for (const g of gs.wordingOrMapping) lines.push(`  - ${g}`)
        lines.push('')
      }
    }

    const cb = fitAnalysisContext.calibrationBrief
    if (cb) {
      lines.push('Quick-DIQ context (company/domain signals from Stage 1):')
      if (cb.companyContext) lines.push(`  Company context: ${cb.companyContext}`)
      if (cb.domainContext) lines.push(`  Domain context: ${cb.domainContext}`)
      if (cb.roleProblemSpace) lines.push(`  Role problem space: ${cb.roleProblemSpace}`)
      if (cb.likelyHiringPriorities?.length) lines.push(`  Hiring priorities: ${cb.likelyHiringPriorities.join(', ')}`)
      if (cb.deliverySignals?.length) {
        lines.push('  Delivery signals:')
        for (const s of cb.deliverySignals) lines.push(`    - ${s}`)
      }
      if (cb.stakeholderSignals?.length) {
        lines.push('  Stakeholder signals:')
        for (const s of cb.stakeholderSignals) lines.push(`    - ${s}`)
      }
      if (cb.analyticsReportingSignals?.length) {
        lines.push('  Analytics/reporting signals:')
        for (const s of cb.analyticsReportingSignals) lines.push(`    - ${s}`)
      }
      if (cb.resumeCalibrationImplications?.length) {
        lines.push('  Resume calibration implications:')
        for (const s of cb.resumeCalibrationImplications) lines.push(`    - ${s}`)
      }
      lines.push('')
    }
  }

  // ── Applied calibration refs (individual market peers, strategy only) ───────
  if (calibrationRefs && calibrationRefs.length > 0) {
    const activeRefs = calibrationRefs.filter(r => r.calibrationGroup !== 'rejected')
    if (activeRefs.length > 0) {
      lines.push('Applied calibration references (market benchmarks — NOT user evidence; never cite in the artifact):')
      for (const ref of activeRefs) {
        const refType = ref.matchType === 'target_company' ? 'target company' : 'comparable'
        const group = ref.calibrationGroup ?? 'supporting'
        lines.push(`  [${refType}/${group}] ${ref.title} at ${ref.company} (confidence: ${ref.confidence})`)
        lines.push(`    Match reason: ${ref.matchReason}`)
        if (ref.limitations) lines.push(`    Limitation: ${ref.limitations}`)
        if (ref.manualContext) {
          lines.push(`    Manually enriched profile context (calibration reference only — do NOT treat as user evidence):`)
          lines.push(`      ${ref.manualContext.slice(0, 600)}${ref.manualContext.length > 600 ? '…' : ''}`)
        }
        if (group === 'primary') {
          lines.push(`    Calibration use: voice/framing, keyword emphasis, and seniority language — full calibration use permitted.`)
        } else if (group === 'supporting') {
          lines.push(`    Calibration use: domain vocabulary and workflow framing only — do NOT use for title or seniority claims.`)
        } else if (group === 'context_only') {
          lines.push(`    Calibration use: company/domain background only — do NOT use to shape candidate seniority, title wording, or skill claims.`)
        }
      }
      lines.push('BOUNDARY: Use these only to calibrate language, emphasis, and role framing. Never cite company names, people, or match reasons inside the artifact.')
      lines.push('')
    }
  }

  return lines.join('\n')
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

const REFINE_TOOL_SCHEMA = {
  name: 'refine_section',
  description: 'Revise an existing resume artifact section with evidence-bounded changes, a change summary, and learning signals.',
  input_schema: {
    type: 'object' as const,
    required: ['revisedText', 'changeSummary', 'evidenceBoundary', 'confidence', 'learningSignals'],
    properties: {
      revisedText: {
        type: 'string',
        description: 'The complete revised section text. Must be a proper resume artifact, NOT a paraphrase of the user\'s instruction. If no improvement is possible without inventing claims, return the original text and explain in changeSummary.',
      },
      changeSummary: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bullet-list of concrete changes made: what was added, removed, reframed, or tightened, and why each change serves JD alignment or evidence grounding. If no changes were made, explain why.',
      },
      evidenceBoundary: {
        type: 'object',
        required: ['preservedClaims', 'removedOrSoftenedClaims', 'unsupportedRequests'],
        properties: {
          preservedClaims: {
            type: 'array',
            items: { type: 'string' },
            description: 'Claims that were kept because they are directly backed by work history or metrics.',
          },
          removedOrSoftenedClaims: {
            type: 'array',
            items: { type: 'string' },
            description: 'Claims that were removed or weakened because evidence was insufficient or absent.',
          },
          unsupportedRequests: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific user instructions that were NOT applied because they would require inventing unsupported claims. Explain each refusal briefly.',
          },
        },
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'high=all retained claims fully backed; medium=some reframing needed; low=significant evidence gaps remain after revision.',
      },
      learningSignals: {
        type: 'array',
        description: 'Insights this refinement reveals that should be remembered for future generations or product improvement.',
        items: {
          type: 'object',
          required: ['type', 'scope', 'signal', 'appliesTo'],
          properties: {
            type: {
              type: 'string',
              enum: ['jd_alignment_strategy', 'evidence_boundary', 'artifact_strategy', 'calibration_pattern', 'reusable_prompt_heuristic'],
            },
            scope: {
              type: 'string',
              enum: ['user_specific', 'global_product'],
            },
            signal: {
              type: 'string',
              description: 'Concrete, actionable insight. Bad: "use better language". Good: "For BA resumes targeting credit-union roles, translate stakeholder alignment work into gap analysis and release readiness framing."',
            },
            appliesTo: {
              type: 'array',
              items: { type: 'string' },
              description: 'Section types this signal applies to.',
            },
          },
        },
      },
    },
  },
}
