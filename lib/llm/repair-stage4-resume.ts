/**
 * Stage 4 bounded repair pass.
 *
 * Called ONLY when `validateResumeAgainstContract` returns failures that
 * `applyDeterministicRepairs` could not fix (semantic violations such as
 * summary_duplicates_experience or missing_jd_theme).
 *
 * Rules:
 *   - Fix only the sections named in the violations list.
 *   - Do not add new facts not in the provided evidence.
 *   - Do not rewrite sections that already pass.
 *   - Maximum one call — no loops.
 */

import { anthropic, MODEL } from './client'
import type {
  ContractViolation,
  JDRequirementMap,
  ResumeGenerationContract,
  ResumeStrategyBrief,
  RewriteDirective,
  UserProfile,
  BridgeQuestion,
} from '@/contracts'
import { serializeContractForPrompt } from '@/lib/stage4/resume-generation-contract'
import { serializeResumeStrategyBriefForPrompt } from '@/lib/resume-strategy/resume-strategy-brief'

export interface Stage4RepairOptions {
  resumeText: string
  violations: ContractViolation[]
  contract: ResumeGenerationContract
  profile: UserProfile
  jdMap: JDRequirementMap
  bridgeAnswers?: BridgeQuestion[]
  strategyBrief?: ResumeStrategyBrief
  /**
   * Rewrite directives from Critical Review. When present, directives are the primary repair
   * specification — they carry evidence IDs, mustPreserve, mustAvoid, and successCriteria.
   * Contract violations remain the hard validation context.
   */
  rewriteDirectives?: RewriteDirective[]
}

export interface Stage4RepairResult {
  repairedText: string
  repairsApplied: string[]
  unfixedViolations: string[]
}

export async function repairStage4Resume(opts: Stage4RepairOptions): Promise<Stage4RepairResult> {
  const { resumeText, violations, contract, profile, jdMap, bridgeAnswers = [], strategyBrief, rewriteDirectives = [] } = opts

  // Only pass semantic violations to the LLM — deterministic ones should have been handled already
  const semanticViolations = violations.filter(
    v => !v.canAutoRepair && v.severity === 'error'
  )
  if (semanticViolations.length === 0 && rewriteDirectives.length === 0) {
    return { repairedText: resumeText, repairsApplied: [], unfixedViolations: [] }
  }

  const systemPrompt = buildRepairSystemPrompt(contract, semanticViolations, strategyBrief, rewriteDirectives)
  const userContent = buildRepairUserContent(resumeText, semanticViolations, profile, jdMap, bridgeAnswers, rewriteDirectives)

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6144,
    tools: [REPAIR_TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'repair_resume' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Stage 4 repair: no tool_use response from model')
  }

  const raw = toolUse.input as {
    repairedText: string
    repairsApplied: string[]
    unfixedViolations: string[]
  }

  if (!raw.repairedText?.trim()) {
    throw new Error('Stage 4 repair: LLM returned empty repairedText')
  }

  return {
    repairedText: raw.repairedText,
    repairsApplied: raw.repairsApplied ?? [],
    unfixedViolations: raw.unfixedViolations ?? [],
  }
}

// ─── System prompt ─────────────────────────────────────────────────────────────

export function buildRepairSystemPrompt(
  contract: ResumeGenerationContract,
  violations: ContractViolation[],
  strategyBrief?: ResumeStrategyBrief,
  rewriteDirectives: RewriteDirective[] = [],
): string {
  const violationBlock = violations
    .map((v, i) => `  ${i + 1}. [${v.rule}] ${v.section}: ${v.detail}`)
    .join('\n')

  const contractBlock = serializeContractForPrompt(contract)
  const strategyBriefBlock = serializeResumeStrategyBriefForPrompt(strategyBrief)

  const directiveRules = rewriteDirectives.length > 0
    ? `
REWRITE DIRECTIVE RULES (strictly enforced when directives are present):
  - Treat the REWRITE DIRECTIVES block in the user message as the PRIMARY repair specification.
  - For each directive: repair only the section/scope named in targetSection and targetScope.
  - Use ONLY the allowedEvidenceIds listed for each directive — do not draw from other evidence.
  - Preserve every item in mustPreserve for that directive.
  - Avoid every item in mustAvoid for that directive.
  - The rewrite is successful when all successCriteria for that directive are satisfied.
  - Do not rewrite sections or bullets not targeted by any directive unless required for structural consistency.
  - Do not invent facts, tools, metrics, certifications, employers, or titles not in ALLOWED EVIDENCE.
  - TODO(follow-up): evidence should be filtered structurally by allowedEvidenceIds before this call,
    not only prompt-constrained. For now, use the provided IDs to scope your repairs.
`
    : ''

  return `You are a resume repair engine. Your ONLY job is to fix the specific violations listed below.

REPAIR RULES (strictly enforced):
  - Fix ONLY the section(s) named in the violations. Do not touch passing sections.
  - Do NOT add new facts, metrics, tools, certifications, or employers not in the provided evidence.
  - Do NOT rewrite bullets that are not related to the violation.
  - Do NOT invent claims to fill gaps.
  - For "summary_duplicates_experience": rewrite the Summary so it uses concept-level positioning only.
    Remove any proof-level details (metrics, team sizes, specific tools, cadence) that duplicate Experience.
    The Summary should position, not prove.
  - For "missing_jd_theme": add a brief, evidence-grounded mention in the most appropriate Experience bullet.
    Use only facts from the provided work history and bridge answers.
  - For "skills_max_rows": remove the least ATS-relevant skill groups to meet the limit.
  - Preserve all section headers exactly: SUMMARY, SKILLS, EXPERIENCE, EDUCATION (uppercase, own line).
  - Return the complete resume text (all sections), with only the failing sections changed.
  - No markdown, no explanations, no "here is the repaired version."
${directiveRules}
VIOLATIONS TO FIX:
${violationBlock}
${strategyBriefBlock}
${contractBlock}`
}

// ─── User content ─────────────────────────────────────────────────────────────

export function buildRepairUserContent(
  resumeText: string,
  violations: ContractViolation[],
  profile: UserProfile,
  jdMap: JDRequirementMap,
  bridgeAnswers: BridgeQuestion[],
  rewriteDirectives: RewriteDirective[] = [],
): string {
  const lines: string[] = []

  lines.push('RESUME TO REPAIR (fix only the failing sections):')
  lines.push(resumeText)
  lines.push('')

  lines.push('VIOLATIONS (repair exactly these, do not over-reach):')
  violations.forEach((v, i) => lines.push(`  ${i + 1}. ${v.rule} in "${v.section}": ${v.detail}`))
  lines.push('')

  if (rewriteDirectives.length > 0) {
    lines.push('REWRITE DIRECTIVES (primary repair specification — follow each directive precisely):')
    rewriteDirectives.forEach((d, i) => {
      lines.push(`  Directive ${i + 1}: ${d.directiveId}`)
      lines.push(`    targetSection: ${d.targetSection}`)
      lines.push(`    targetScope: ${d.targetScope}`)
      lines.push(`    action: ${d.action}`)
      lines.push(`    instruction: ${d.instruction}`)
      lines.push(`    allowedEvidenceIds: ${d.allowedEvidenceIds.join(', ') || '(all provided evidence)'}`)
      lines.push(`    mustPreserve: ${d.mustPreserve.join(', ') || '(none specified)'}`)
      lines.push(`    mustAvoid: ${d.mustAvoid.join(', ')}`)
      lines.push(`    successCriteria:`)
      d.successCriteria.forEach(c => lines.push(`      - ${c}`))
    })
    lines.push('')
  }

  lines.push('ALLOWED EVIDENCE (use only these facts):')
  lines.push('Work history:')
  for (const w of profile.workHistory) {
    lines.push(`  ${w.title} at ${w.company} (${w.startDate}–${w.endDate})`)
    w.bullets.slice(0, 5).forEach(b => lines.push(`    - ${b}`))
    w.approvedMetrics.slice(0, 4).forEach(m => lines.push(`    [metric] ${m}`))
  }
  lines.push('')

  const answeredBridge = bridgeAnswers.filter(q => q.status === 'answered' && q.userAnswer?.trim())
  if (answeredBridge.length > 0) {
    lines.push('Bridge evidence:')
    answeredBridge.forEach(q => lines.push(`  Q: ${q.question}`, `  A: ${q.userAnswer}`))
    lines.push('')
  }

  lines.push('JD required themes (use in Experience if missing):')
  jdMap.required.slice(0, 6).forEach(r => lines.push(`  [${r.category}] ${r.text}`))
  lines.push('')

  return lines.join('\n')
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

const REPAIR_TOOL_SCHEMA = {
  name: 'repair_resume',
  description: 'Return the complete repaired resume text with only the failing sections fixed.',
  input_schema: {
    type: 'object' as const,
    required: ['repairedText', 'repairsApplied', 'unfixedViolations'],
    properties: {
      repairedText: {
        type: 'string',
        description: 'The complete resume text. All sections included. Only failing sections changed. Plain text, no markdown.',
      },
      repairsApplied: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of repairs made, e.g. "Removed metric from Summary (moved to Experience only)".',
      },
      unfixedViolations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Violations that could not be repaired because doing so would require inventing facts. Each entry explains why.',
      },
    },
  },
}
