/**
 * Full-resume Stage 4 LLM refinement.
 *
 * Revises the complete assembled resume text in response to a user instruction.
 * Distinct from section refinement (refine-artifact-section.ts) because:
 *   - Input is the full assembled resume, not a single section
 *   - Output must preserve section structure (SUMMARY / SKILLS / EXPERIENCE / EDUCATION headers)
 *   - Evidence scope covers the entire profile, not one role family
 *   - No ScopedEvidenceBundle — all profile work history is available as context
 */

import { anthropic, MODEL } from './client'
import type {
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeStrategyBrief,
  UserProfile,
  BridgeQuestion,
  LearningSignal,
  EmphasisCategory,
  CalibrationSummary,
} from '@/contracts'
import { buildFullResumeQualityGate } from './generation-quality-gate'
import { serializeContractForPrompt } from '@/lib/stage4/resume-generation-contract'
import { serializeResumeStrategyBriefForPrompt } from '@/lib/resume-strategy/resume-strategy-brief'

export interface FullResumeRefineOptions {
  fullResumeText: string
  userInstruction: string
  jdMap: JDRequirementMap
  profile: UserProfile
  answeredQuestions: BridgeQuestion[]
  emphasis: EmphasisCategory
  companySummary?: string
  fitHypothesis?: string
  riskGaps?: string[]
  acceptedSignals?: LearningSignal[]
  globalSignals?: LearningSignal[]
  rejectedPhrases?: string[]
  calibrationSummary?: CalibrationSummary
  roleTitle?: string
  company?: string
  contract?: ResumeGenerationContract
  strategyBrief?: ResumeStrategyBrief
}

export interface FullResumeRefineResult {
  revisedText: string
  changeSummary: string[]
  warnings: string[]
}

export async function refineFullResumeExport(opts: FullResumeRefineOptions): Promise<FullResumeRefineResult> {
  const {
    fullResumeText, userInstruction,
    jdMap, profile, answeredQuestions, emphasis,
    companySummary, fitHypothesis, riskGaps,
    acceptedSignals = [], globalSignals = [], rejectedPhrases = [],
    calibrationSummary,
    roleTitle = '', company = '',
    contract,
    strategyBrief,
  } = opts

  // Derive older/irrelevant employers from profile — replaces hardcoded employer names in gate
  const primaryKeywords = ['product owner', 'product manager', 'business analyst',
    'product analyst', 'systems analyst', 'data analyst', 'supporting', 'quality']
  const jdText = [...jdMap.required, ...jdMap.niceToHave].map(r => r.text).join(' ').toLowerCase()
  const seen = new Set<string>()
  const olderEmployersToExclude: string[] = []
  for (const w of profile.workHistory) {
    if (seen.has(w.company)) continue
    const isPrimary = primaryKeywords.some(kw => w.title.toLowerCase().includes(kw))
    if (isPrimary) { seen.add(w.company); continue }
    const domain = (w.domain ?? '').toLowerCase()
    const domainWords = domain.split(/\W+/).filter(word => word.length > 3)
    if (!domainWords.some(word => jdText.includes(word))) {
      olderEmployersToExclude.push(w.company)
      seen.add(w.company)
    }
  }

  const systemPrompt = buildFullRefineSystemPrompt({
    emphasis, roleTitle, company,
    rejectedPhrases, acceptedSignals, globalSignals,
    constraints: profile.constraints ?? [],
    calibrationSummary,
    contract,
    strategyBrief,
    olderEmployersToExclude,
  })

  const userContent = buildFullRefineUserContent({
    fullResumeText, userInstruction,
    jdMap, profile, answeredQuestions,
    companySummary, fitHypothesis, riskGaps,
  })

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6144,
    tools: [FULL_REFINE_TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'refine_full_resume' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Full resume refine: no tool_use response from model')
  }

  const raw = toolUse.input as {
    revisedText: string
    changeSummary: string[]
    warnings: string[]
  }

  if (!raw.revisedText?.trim()) {
    throw new Error('Full resume refine: LLM returned empty revisedText')
  }

  return {
    revisedText: raw.revisedText,
    changeSummary: raw.changeSummary ?? [],
    warnings: raw.warnings ?? [],
  }
}

// ─── System prompt ─────────────────────────────────────────────────────────────

interface SystemOpts {
  emphasis: EmphasisCategory
  roleTitle: string
  company: string
  rejectedPhrases: string[]
  acceptedSignals: LearningSignal[]
  globalSignals: LearningSignal[]
  constraints: string[]
  calibrationSummary?: CalibrationSummary
  contract?: ResumeGenerationContract
  strategyBrief?: ResumeStrategyBrief
  olderEmployersToExclude?: string[]
}

function buildFullRefineSystemPrompt(opts: SystemOpts): string {
  const { emphasis, roleTitle, company, rejectedPhrases, acceptedSignals, globalSignals, constraints, calibrationSummary, contract, strategyBrief, olderEmployersToExclude } = opts

  const targetLine = [roleTitle, company].filter(Boolean).join(' at ')

  const rejectedBlock = rejectedPhrases.length
    ? `\nNEVER use these phrases (user-rejected): ${rejectedPhrases.map(p => `"${p}"`).join(', ')}`
    : ''

  const constraintsBlock = constraints.length
    ? `\nUser constraints:\n${constraints.map(c => `- ${c}`).join('\n')}`
    : ''

  const personalBlock = acceptedSignals.length
    ? `\nPersonal strategy signals:\n${acceptedSignals.slice(0, 8).map(s => `- ${s.content}`).join('\n')}`
    : ''

  const globalBlock = globalSignals.length
    ? `\nGlobal strategy signals:\n${globalSignals.slice(0, 6).map(s => `- ${s.globalContent ?? s.content}`).join('\n')}`
    : ''

  const calibBlock = calibrationSummary?.calibrationUsed
    ? `\nMarket calibration context (strategy guidance only — not user evidence):\n${
        [
          calibrationSummary.repeatedSkillsTools.length
            ? `Repeatedly cited tools: ${calibrationSummary.repeatedSkillsTools.join(', ')}`
            : '',
          ...calibrationSummary.artifactGuidance.slice(0, 4).map(g => `  - ${g}`),
        ].filter(Boolean).join('\n')
      }`
    : ''

  const qualityGate = buildFullResumeQualityGate(olderEmployersToExclude?.length ? { olderEmployersToExclude } : undefined)
  const contractBlock = contract ? serializeContractForPrompt(contract) : ''
  const strategyBriefBlock = serializeResumeStrategyBriefForPrompt(strategyBrief)

  return `You revise a complete resume for a specific job application.

Target: ${targetLine || 'role not specified'}
Emphasis: ${emphasis}

EVIDENCE RULES (strictly enforced):
- Every claim must be traceable to the work history, metrics, or bridge answers provided.
- Do NOT invent employers, tools, titles, certifications, dates, or quantified outcomes.
- Do NOT add Azure DevOps unless it appears in the provided work history or bridge answers. Jira is sufficient when the JD says "Azure DevOps or Jira."
- Do NOT convert travel willingness or intent into a resume bullet — that belongs in cover letter only.
- Preserve all verified metrics exactly. Do not inflate, deflate, or paraphrase numbers.
- Treat CSPO as validated only if "Certified Scrum Product Owner" or "CSPO" appears in education, certifications, or bridge answers.
- Treat Bachelor's degree as validated only if it appears in the education section or bridge answers.
- Preserve date ranges (e.g. 2021–2024 for Product Owner) exactly as provided. Do not adjust unless the user explicitly instructs.
- Preserve roadmap ownership framing: leadership-sponsored roadmap execution, dependency sequencing, KPI-informed pivots. Do not claim executive product strategy ownership.
- Removing an unsupported claim is always safer than softening it.

FORMAT RULES:
- Return the full revised resume text only.
- Preserve section headers exactly: SUMMARY, SKILLS, EXPERIENCE, EDUCATION (uppercase, on their own line).
- Within EXPERIENCE, preserve the role heading format: Title \\n Company | Dates.
- No markdown tables, no markdown bold/italic, no explanations, no "here is the revised version."
- Use plain text bullet format: a dash followed by a space ("- ").
- No invented placeholders (e.g. "[Add metric here]").

INSTRUCTION PRIORITY:
- The user's refinement instruction is the highest-priority style/content direction.
- Apply it fully unless doing so would require inventing unsupported claims.
- If you cannot fully apply an instruction, note it in warnings.
${rejectedBlock}
${constraintsBlock}
${personalBlock}
${globalBlock}
${calibBlock}
${strategyBriefBlock}

Response format: return only the JSON tool call. No prose before or after.
${contractBlock}
${qualityGate}`
}

// ─── User content ─────────────────────────────────────────────────────────────

interface ContentOpts {
  fullResumeText: string
  userInstruction: string
  jdMap: JDRequirementMap
  profile: UserProfile
  answeredQuestions: BridgeQuestion[]
  companySummary?: string
  fitHypothesis?: string
  riskGaps?: string[]
}

function buildFullRefineUserContent(opts: ContentOpts): string {
  const { fullResumeText, userInstruction, jdMap, profile, answeredQuestions, companySummary, fitHypothesis, riskGaps } = opts

  const lines: string[] = []

  lines.push('REFINEMENT INSTRUCTION (this is direction, not replacement copy):')
  lines.push(userInstruction)
  lines.push('')

  lines.push('CURRENT RESUME TEXT (revise this):')
  lines.push(fullResumeText)
  lines.push('')

  if (companySummary) { lines.push('Company context:', `  ${companySummary}`, '') }
  if (fitHypothesis) { lines.push('Fit hypothesis:', `  ${fitHypothesis}`, '') }
  if (riskGaps?.length) {
    lines.push('Risk / gap areas:')
    riskGaps.forEach(g => lines.push(`  - ${g}`))
    lines.push('')
  }

  lines.push('JD required skills:')
  jdMap.required.forEach(r => lines.push(`  [${r.category}] ${r.text} (coverage: ${r.userCoverageStatus})`))
  lines.push('')

  lines.push('Work history (source of truth for all experience claims):')
  for (const w of profile.workHistory) {
    lines.push(`  ${w.title} at ${w.company} (${w.startDate}–${w.endDate})`)
    w.bullets.forEach(b => lines.push(`    - ${b}`))
    w.approvedMetrics.forEach(m => lines.push(`    [metric] ${m}`))
  }
  lines.push('')

  const answeredBridge = answeredQuestions.filter(q => q.status === 'answered' && q.userAnswer?.trim())
  if (answeredBridge.length > 0) {
    lines.push('Bridge evidence (user answers to gap questions):')
    answeredBridge.forEach(q => lines.push(`  Q: ${q.question}`, `  A: ${q.userAnswer}`))
    lines.push('')
  }

  if (profile.education.length > 0 || profile.certifications?.length) {
    lines.push('Validated education and certifications:')
    profile.education.forEach(e => {
      lines.push(`  ${[e.degree, e.field, e.institution, e.graduationYear].filter(Boolean).join(' | ')}`)
    })
    ;(profile.certifications ?? []).forEach(c => lines.push(`  ${c}`))
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

const FULL_REFINE_TOOL_SCHEMA = {
  name: 'refine_full_resume',
  description: 'Revise the complete resume text according to the user\'s instruction, preserving section structure and evidence bounds.',
  input_schema: {
    type: 'object' as const,
    required: ['revisedText', 'changeSummary', 'warnings'],
    properties: {
      revisedText: {
        type: 'string',
        description: 'The complete revised resume text. Preserve SUMMARY / SKILLS / EXPERIENCE / EDUCATION section headers. Plain text only — no markdown, no explanations.',
      },
      changeSummary: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bullet list of changes made: what was added, removed, or reframed, and why. Be specific.',
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Instructions that could not be applied because they required fabrication or unsupported claims. Each entry names the instruction and explains why it was declined.',
      },
    },
  },
}
