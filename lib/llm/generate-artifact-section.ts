import { anthropic, MODEL } from './client'
import type {
  ArtifactSection,
  SectionType,
  ResumeBullet,
  JDRequirementMap,
  UserProfile,
  BridgeQuestion,
  LearningSignal,
  EmphasisCategory,
  BlockedClaimDiagnostic,
  CalibrationSummary,
  CalibrationInfluence,
  ProfileProjection
} from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'
import {
  buildScopedEvidenceBundle,
  classifyBridgeAnswerConfidence,
  isGlobalEvidenceWarning,
  type ScopedEvidenceBundle
} from '@/lib/evidence-scope'
import { validateSectionClaims, mapResultToPartition } from '@/lib/claim-validator'
import {
  normalizeCalibrationInfluence,
  sanitizeCalibrationEvidenceRefs,
  sanitizeSourceMappings
} from '@/lib/calibration/influence'
import {
  buildArtifactGenerationBrief,
  serializeBriefForPrompt,
} from './artifact-generation-brief'
import { buildQualifiedEvidenceCards } from './qualified-evidence-cards'
import { runClaimFidelityCheck } from './claim-fidelity-check'

export interface GenerateOptions {
  sessionId: string
  sectionType: SectionType
  jdMap: JDRequirementMap
  profile: UserProfile
  answeredQuestions: BridgeQuestion[]
  emphasis: EmphasisCategory
  // Session synthesis context from Stage 1
  companySummary?: string
  fitHypothesis?: string
  riskGaps?: string[]
  // Personal signals: accepted bullets and role preferences for this user
  acceptedSignals: LearningSignal[]
  // Global signals: anonymized product improvement patterns
  globalSignals?: LearningSignal[]
  rejectedPhrases: string[]
  // User-authored refinement instruction (for refine/regenerate operations)
  refinementInstruction?: string
  // Current section content when refining
  currentContent?: string
  /** 'generate' = first time, 'refine' = user provided note, 'regenerate' = fresh rewrite */
  operation?: 'generate' | 'refine' | 'regenerate'
  // Stage 3A calibration: market patterns only — not user evidence
  calibrationSummary?: CalibrationSummary
  // Stage 1 layered profile: focused evidence slice from ProfileSnapshot (optional)
  profileProjection?: ProfileProjection
  /** Target role title — used to build the evaluator lens in the Artifact Generation Brief. */
  roleTitle?: string
  /** Target company name — included in the brief for contextual framing. */
  company?: string
}

export interface GeneratedSection {
  content: string
  bullets: ResumeBullet[]
  generationRationale: string
  evidenceWarnings: string[]
  sourceMappings: string[]
  signalInfluence?: string
  jdTraceability: string[]
  blockedClaimDiagnostics: BlockedClaimDiagnostic[]
  calibrationInfluence: CalibrationInfluence
}

export async function generateArtifactSection(opts: GenerateOptions): Promise<GeneratedSection> {
  const {
    sectionType, jdMap, profile, answeredQuestions,
    emphasis, companySummary, fitHypothesis, riskGaps,
    acceptedSignals, globalSignals = [], rejectedPhrases,
    refinementInstruction, currentContent, operation = 'generate',
    calibrationSummary, profileProjection,
    roleTitle = '', company = '',
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

  const toolSchema = buildToolSchema(sectionType)
  const systemPrompt = buildSystemPrompt(
    sectionType, emphasis, rejectedPhrases, acceptedSignals, globalSignals,
    profile.constraints ?? [],
    bundle.scope.framingNote,
    bundle.scope.disallowedClaimPatterns,
    bundle.scope.requiredFramingRules,
    calibrationSummary,
    brief,
  )
  const userContent = buildUserContent({
    sectionType, jdMap, profile,
    bundle,
    companySummary, fitHypothesis, riskGaps,
    profileProjection,
    refinementInstruction, currentContent, operation
  })

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [toolSchema],
    tool_choice: { type: 'tool', name: 'generate_section' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Section generator (${sectionType}): no tool_use response`)
  }

  const raw = toolUse.input as {
    content: string
    bullets: Array<{
      text: string
      claimStatus: ResumeBullet['claimStatus']
      sourceSignal: ResumeBullet['sourceSignal']
      evidenceRef?: string
    }>
    generationRationale: string
    evidenceWarnings: string[]
    sourceMappings: string[]
    jdTraceability: string[]
    calibrationInfluence?: Partial<CalibrationInfluence>
  }

  const personalCount = acceptedSignals.length
  const globalCount = globalSignals.length
  const signalInfluence = [
    personalCount > 0 ? `${personalCount} personal signal${personalCount > 1 ? 's' : ''} applied` : null,
    globalCount > 0 ? `${globalCount} global strategy signal${globalCount > 1 ? 's' : ''} applied` : null
  ].filter(Boolean).join(', ') || undefined

  // Post-generation: deterministic claim validation — assigns partition to every bullet
  const rawBullets = sanitizeCalibrationEvidenceRefs(raw.bullets ?? [])
  const validationResults = validateSectionClaims(rawBullets, bundle)

  const blockedClaimDiagnostics: BlockedClaimDiagnostic[] = []
  const finalBullets = rawBullets.map((b, idx) => {
    const result = validationResults[idx]
    if (result.diagnostic) {
      blockedClaimDiagnostics.push({ ...result.diagnostic, attemptedSection: sectionType })
    }
    return {
      ...b,
      id: nanoid(),
      approved: null,
      claimStatus: result.correctedClaimStatus,
      partition: result.partition,
      partitionReason: result.partitionReason || undefined,
      suggestedSection: result.suggestedSection ?? undefined,
    }
  })

  // For bullet sections, reconstruct content from display-partition bullets only.
  // This ensures the stored content is export-safe and matches what the user sees.
  const isBulletSection = [
    'experience-po', 'experience-ba', 'experience-qa', 'talking-points'
  ].includes(sectionType)
  const displayBullets = finalBullets.filter(b => b.partition === 'display')
  const content = isBulletSection && displayBullets.length > 0
    ? displayBullets.map(b => `• ${b.text}`).join('\n')
    : raw.content ?? ''

  // Post-generation claim fidelity check against evidence cards — deterministic, no LLM call
  const fidelityResult = runClaimFidelityCheck(finalBullets, evidenceCards)
  if (!fidelityResult.passed) {
    for (const violation of fidelityResult.violations) {
      const bullet = finalBullets[violation.bulletIndex]
      if (bullet && bullet.partition === 'display') {
        bullet.partition = 'needs-confirmation'
        bullet.partitionReason = violation.explanation
      }
    }
  }

  // Build section-specific warnings — exclude global domain-gap warnings (shown at session level)
  const rawWarnings = raw.evidenceWarnings ?? []
  const sectionSpecificWarnings = rawWarnings.filter(w => !isGlobalEvidenceWarning(w))
  const partitionWarnings = validationResults
    .filter(r => r.partition !== 'display')
    .map(r => `Claim partitioned to "${r.partition}": ${r.partitionReason}`)
  const fidelityWarnings = fidelityResult.violations.map(
    v => `Evidence guardrail [${v.violationType}]: ${v.explanation}`
  )
  const evidenceWarnings = [...sectionSpecificWarnings, ...partitionWarnings, ...fidelityWarnings]
  const calibrationInfluence = normalizeCalibrationInfluence(raw.calibrationInfluence, {
    calibrationAvailable: calibrationSummary !== undefined,
    sectionType
  })

  return {
    content,
    bullets: finalBullets,
    generationRationale: raw.generationRationale ?? '',
    evidenceWarnings,
    sourceMappings: sanitizeSourceMappings(raw.sourceMappings ?? []),
    signalInfluence,
    jdTraceability: raw.jdTraceability ?? [],
    blockedClaimDiagnostics,
    calibrationInfluence,
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  type: SectionType,
  emphasis: EmphasisCategory,
  rejectedPhrases: string[],
  acceptedSignals: LearningSignal[],
  globalSignals: LearningSignal[],
  constraints: string[],
  framingNote: string | null,
  disallowedClaimPatterns: string[],
  requiredFramingRules: string[],
  calibrationSummary?: CalibrationSummary,
  brief?: import('./artifact-generation-brief').ArtifactGenerationBrief
): string {
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

  const framingBlock = framingNote
    ? `\n\n${framingNote}`
    : ''

  const disallowedBlock = disallowedClaimPatterns.length > 0
    ? `\n\nDisallowed claim patterns for this section (these MUST NOT appear in any bullet):\n${disallowedClaimPatterns.map(p => `- "${p}"`).join('\n')}`
    : ''

  const framingRulesBlock = requiredFramingRules.length > 0
    ? `\n\nRequired framing rules for cross-role evidence:\n${requiredFramingRules.map(r => `- ${r}`).join('\n')}`
    : ''

  const typeInstructions: Record<SectionType, string> = {
    summary: `Write a 3–4 sentence professional summary. Lead with the candidate's function and domain strength. End with what they bring to this specific role. No generic opener. No puff language.`,
    skills: `Output grouped skill lines using the candidate's skillGroups. Format each group as: HeadingWord: Skill One, Skill Two, Skill Three. One group per line. Single-word ATS headings only (e.g. Analysis, Product, Delivery, Data, Testing, Security, Tools). No star ratings. No generic soft skills. Do not invent skills not in the profile.`,
    'experience-po': `Write 3–5 impact-first bullets for a Product Owner role. Emphasize: backlog ownership, sprint delivery, stakeholder alignment, roadmap decisions, delivery outcomes. Each bullet must cite a real work entry.`,
    'experience-ba': `Write 3–5 impact-first bullets for a Business Analyst role. Emphasize: gap analysis, requirements documentation, acceptance criteria, workflow mapping, UAT, release readiness, risk, decision clarity.`,
    'experience-qa': `Write 3–5 impact-first bullets for a QA/Lead Quality role. Emphasize: test automation, quality frameworks, SpecFlow, defect reduction, release readiness.`,
    'cover-letter': `Write a cover letter that does NOT recap the resume. Explain why this specific role at this company fits the candidate's career direction. Use the company context and fit hypothesis to ground the argument. 3 short paragraphs max.`,
    'referral-message': `Write a short, direct LinkedIn message to a potential referrer. 4–5 sentences. Personal, specific, no fluff.`,
    'recruiter-message': `Write a recruiter outreach message. 3–4 sentences. State the role, the fit, and ask for a conversation.`,
    'linkedin-dm': `Write a 3-sentence LinkedIn DM to a hiring manager or team member. Brief, human, short enough for LinkedIn character limits.`,
    'talking-points': `Generate 5–7 interview talking points. Each is 2–3 sentences. Cover the most likely areas of interest from the JD. Include how to handle the risk/gap areas honestly.`
  }

  const calibrationBlock = calibrationSummary?.calibrationUsed
    ? buildCalibrationBlock(calibrationSummary)
    : ''

  const briefBlock = brief ? serializeBriefForPrompt(brief) : ''

  return `${briefBlock}You generate targeted resume artifacts for a specific job application.

Emphasis: ${emphasis}
Section type: ${type}

${typeInstructions[type]}
${framingBlock}
${disallowedBlock}
${framingRulesBlock}
${calibrationBlock}

Claim classification rules (apply to every bullet):
- "supported": directly backed by a specific entry in the user's work history or approved metrics
- "supported-with-reframing": the user has relevant experience but from a different domain or context
- "needs-user-confirmation": inferred from context — user should verify before accepting
- "unsupported": no evidence in the profile — must flag this, do not silently include

Evidence rules:
- Do not invent experience.
- Do not inflate metrics.
- Do not insert claims the profile cannot support.
- If the JD asks for something unsupported, either omit it or phrase as adjacent exposure ONLY when truthful.
- For every bullet, cite which work entry or metric justifies it in evidenceRef.
- Populate evidenceWarnings for any required JD skill that the section cannot address from profile evidence.
- Populate sourceMappings as "claim text → work entry title + company" for traceability.
- Calibration is not evidence. Never cite calibration references, companies, people, match reasons, or market patterns in evidenceRef or sourceMappings.
- Return calibrationInfluence separately from generationRationale. It must state whether calibration merely existed or concretely changed wording, emphasis, inclusion, exclusion, ordering, or gap handling.
- calibrationInfluence.artifactDecisions must be concrete artifact decisions, not generic claims. Good: "Ordered Business Analyst bullets before cross-role context because SI BA calibration patterns favored BA-specific evidence." Bad: "Used calibration to make this stronger."
- Respect two-page resume constraint for resume sections.
${rejectedBlock}
${constraintsBlock}
${personalBlock}
${globalBlock}`
}

// Calibration context injected as market-pattern guidance only.
// STRICT RULE: calibration patterns must never create new user claims.
function buildCalibrationBlock(c: CalibrationSummary): string {
  const lines = ['\n\nMarket calibration context (strategy guidance only — do NOT use as evidence for user claims):']

  if (c.repeatedTitles.length) {
    lines.push(`Typical titles in this market: ${c.repeatedTitles.join(', ')}`)
  }
  if (c.repeatedSkillsTools.length) {
    lines.push(`Repeatedly cited tools/skills: ${c.repeatedSkillsTools.join(', ')}`)
  }
  if (c.domainExpectations.length) {
    lines.push('Domain expectations:')
    for (const d of c.domainExpectations) lines.push(`  - ${d}`)
  }
  if (c.artifactGuidance.length) {
    lines.push('Artifact guidance from market calibration:')
    for (const g of c.artifactGuidance) lines.push(`  - ${g}`)
  }
  if (c.credibilityBoundaries.length) {
    lines.push('Credibility boundaries (only claim if user has evidence):')
    for (const b of c.credibilityBoundaries) lines.push(`  - ${b}`)
  }
  if (c.gapsToHandleCarefully.length) {
    lines.push('Gaps to handle carefully (acknowledge honestly, do not fabricate):')
    for (const g of c.gapsToHandleCarefully) lines.push(`  - ${g}`)
  }
  lines.push('REMINDER: The above are market observations. They tune language and emphasis only. They must not become resume claims without direct user evidence.')
  return lines.join('\n')
}

// ─── User message content ─────────────────────────────────────────────────────

interface BuildContentOpts {
  sectionType: SectionType
  jdMap: JDRequirementMap
  profile: UserProfile
  bundle: ScopedEvidenceBundle
  companySummary?: string
  fitHypothesis?: string
  riskGaps?: string[]
  refinementInstruction?: string
  currentContent?: string
  operation: 'generate' | 'refine' | 'regenerate'
  profileProjection?: ProfileProjection
}

function buildUserContent(opts: BuildContentOpts): string {
  const {
    sectionType, jdMap, profile, bundle,
    companySummary, fitHypothesis, riskGaps,
    refinementInstruction, currentContent, operation,
    profileProjection
  } = opts

  const lines: string[] = [`Generate section: ${sectionType}  [operation: ${operation}]`, '']

  // ── Company / fit context (from Stage 1 synthesis) ─────────────────────────
  if (companySummary) {
    lines.push('Company context:', `  ${companySummary}`, '')
  }
  if (fitHypothesis) {
    lines.push('Fit hypothesis:', `  ${fitHypothesis}`, '')
  }
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

  // ── Profile ────────────────────────────────────────────────────────────────
  lines.push('Candidate:', `  ${profile.fullName}`, '')
  lines.push('Skills (grouped):')
  for (const line of formatSkillsForPrompt(profile)) lines.push(line)
  lines.push('')

  // ── Work history (scoped) ──────────────────────────────────────────────────
  // primaryWorkEntries: role-matched entries — full evidence use allowed.
  // supportingWorkEntries: other-role entries — prior background framing required.
  lines.push('Work history (primary role evidence):')
  for (const w of bundle.primaryWorkEntries) {
    lines.push(`  ${w.title} at ${w.company} (${w.startDate}–${w.endDate}), domain: ${w.domain}`)
    for (const b of w.bullets) lines.push(`    - ${b}`)
    for (const m of w.approvedMetrics) lines.push(`    [metric] ${m}`)
  }
  lines.push('')

  if (bundle.supportingWorkEntries.length > 0) {
    lines.push('Prior background (supporting context only — cite role explicitly with prior-background framing if referenced):')
    for (const w of bundle.supportingWorkEntries) {
      lines.push(`  ${w.title} at ${w.company} (${w.startDate}–${w.endDate}), domain: ${w.domain}`)
      for (const b of w.bullets) lines.push(`    - ${b}`)
      for (const m of w.approvedMetrics) lines.push(`    [metric] ${m}`)
    }
    lines.push('')
  }

  // ── Bridge answers (scoped + normalized, uncertainty separated) ───────────
  if (bundle.normalizedBridgeEvidence.length > 0) {
    lines.push('Bridge question answers (scoped evidence for this section):')
    for (const n of bundle.normalizedBridgeEvidence) {
      if (n.forbiddenOverclaim.length > 0) {
        lines.push(`  Evidence: ${n.normalizedEvidenceStatement}`)
        lines.push(`  Forbidden overclaim: do NOT claim ${n.forbiddenOverclaim.join('; ')}`)
      } else {
        lines.push(`  Evidence: ${n.normalizedEvidenceStatement}`)
      }
      if (n.limitations.length > 0) {
        lines.push(`  Limitation: ${n.limitations.join('; ')}`)
      }
    }
    lines.push('')
  }

  if (bundle.uncertainBridgeEvidence.length > 0) {
    lines.push('Uncertain/negative answers (do NOT generate positive claims from these):')
    for (const n of bundle.uncertainBridgeEvidence) {
      lines.push(`  [User expressed uncertainty] ${n.normalizedEvidenceStatement}`)
    }
    lines.push('')
  }

  // ── Profile snapshot evidence (layered profile, if available) ──────────────
  if (profileProjection) {
    if (profileProjection.relevantClaims.length > 0) {
      lines.push('Additional verified claims from profile snapshot (strong evidence only):')
      for (const c of profileProjection.relevantClaims.filter(c => c.evidenceStrength !== 'weak')) {
        lines.push(`  [${c.category}] ${c.text}`)
      }
      lines.push('')
    }
    if (profileProjection.relevantMetrics.length > 0) {
      lines.push('Verified metrics from profile snapshot:')
      for (const m of profileProjection.relevantMetrics) {
        lines.push(`  ${m.text}${m.context ? ` (${m.context})` : ''}`)
      }
      lines.push('')
    }
    if (profileProjection.refinementDirections.length > 0) {
      lines.push('User refinement preferences (from prior accepted refinements):')
      for (const d of profileProjection.refinementDirections) {
        lines.push(`  ${d.text}`)
      }
      lines.push('')
    }
  }

  // ── Refine context ─────────────────────────────────────────────────────────
  if (operation === 'refine' && currentContent) {
    lines.push('Current section content (refine this, do not start from scratch):')
    lines.push(currentContent)
    lines.push('')
  }
  if (refinementInstruction) {
    lines.push(`Refinement instruction: ${refinementInstruction}`)
  }

  return lines.join('\n')
}

// Format grouped skills; falls back to flat list for legacy profiles
function formatSkillsForPrompt(profile: UserProfile): string[] {
  const groups = profile.skillGroups?.filter(g => g.skills.length > 0) ?? []
  if (groups.length > 0) {
    return groups.map(g => `  ${g.heading}: ${g.skills.join(', ')}`)
  }
  return [`  ${profile.skills.join(', ')}`]
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

function buildToolSchema(type: SectionType) {
  const hasBullets = [
    'experience-po', 'experience-ba', 'experience-qa', 'talking-points'
  ].includes(type)

  return {
    name: 'generate_section',
    description: `Generate a ${type} artifact section with claim validation and evidence warnings.`,
    input_schema: {
      type: 'object' as const,
      required: ['content', 'bullets', 'generationRationale', 'evidenceWarnings', 'sourceMappings', 'jdTraceability', 'calibrationInfluence'],
      properties: {
        content: {
          type: 'string',
          description: hasBullets
            ? 'Full section text with all bullets combined.'
            : 'The complete section text.'
        },
        bullets: {
          type: 'array',
          description: 'Each discrete claim or bullet, individually classified.',
          items: {
            type: 'object',
            required: ['text', 'claimStatus', 'sourceSignal'],
            properties: {
              text: { type: 'string' },
              claimStatus: {
                type: 'string',
                enum: ['supported', 'supported-with-reframing', 'needs-user-confirmation', 'unsupported']
              },
              sourceSignal: {
                type: 'string',
                enum: ['user-history', 'jd-alignment', 'approved-learning-signal']
              },
              evidenceRef: {
                type: 'string',
                description: 'Work entry title + company that backs this claim.'
              }
            }
          }
        },
        generationRationale: {
          type: 'string',
          description: 'Why this section was written this way — which context shaped the choices.'
        },
        evidenceWarnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Warnings for JD requirements this section cannot address from the profile. E.g. "JD requires Salesforce experience but no profile evidence found."'
        },
        sourceMappings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Traceability strings: "claim text → work entry source". One per significant claim.'
        },
        jdTraceability: {
          type: 'array',
          items: { type: 'string' },
          description: 'Which JD requirement texts this section addresses.'
        },
        calibrationInfluence: {
          type: 'object',
          required: ['calibrationAvailable', 'calibrationUsed', 'useLevel', 'influenceSummary', 'influencedPatterns', 'artifactDecisions'],
          description: 'Structured audit of market-calibration influence. Calibration is not evidence and must not appear in sourceMappings.',
          properties: {
            calibrationAvailable: {
              type: 'boolean',
              description: 'True when market calibration context was present in the prompt.'
            },
            calibrationUsed: {
              type: 'boolean',
              description: 'True only when one or more concrete artifact decisions were shaped by calibration.'
            },
            useLevel: {
              type: 'string',
              enum: ['none', 'light', 'material'],
              description: 'none=no meaningful decision changed; light=wording/emphasis changed; material=inclusion, ordering, exclusion, or major framing changed.'
            },
            influenceSummary: {
              type: 'string',
              description: 'One concise sentence summarizing calibration influence, or that no material influence was recorded.'
            },
            influencedPatterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Short pattern labels that influenced artifact decisions. No person/company matchReason text.'
            },
            ignoredPatterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Calibration patterns not used because user/JD/profile evidence did not support them.'
            },
            artifactDecisions: {
              type: 'array',
              description: 'Concrete decisions caused by calibration. Empty if calibration was merely available.',
              items: {
                type: 'object',
                required: ['pattern', 'decisionType', 'decision'],
                properties: {
                  pattern: { type: 'string' },
                  decisionType: {
                    type: 'string',
                    enum: ['wording', 'emphasis', 'inclusion', 'exclusion', 'ordering', 'gap_handling']
                  },
                  decision: {
                    type: 'string',
                    description: 'Specific artifact decision. Must not be vague or cite calibration as user evidence.'
                  },
                  affectedClaimIds: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  affectedSection: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }
}
