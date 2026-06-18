/**
 * Stage 4 generation quality gate.
 *
 * Enforces role-posture quality, source relevance, and human skim quality
 * for every artifact generation and full-resume refinement call.
 *
 * Both constants and builder functions are exported so tests can verify
 * the gate is present without importing the Anthropic-dependent LLM modules.
 */

import type { SectionType } from '@/contracts'

/**
 * Runtime context derived from the active user profile and JD.
 * Replaces personal literals that were previously hardcoded in gate text —
 * PO dates, verified metrics, and unrelated employer names are now read from
 * the active profile at generation time.
 */
export interface QualityGateContext {
  /** PO date range from work history, e.g. "March 2021 – October 2024". */
  poDateRange?: string
  /** Up to 3 verified metrics from the primary PO role's approvedMetrics. */
  verifiedMetrics?: string[]
  /** Employer names to explicitly exclude from summary (older + JD-irrelevant). */
  olderEmployersToExclude?: string[]
}

// ─── Testable constants ───────────────────────────────────────────────────────

/** Phrases that must never appear in a generated Summary. */
export const SUMMARY_PROHIBITIONS = [
  'formal PO tenure',
  'early career includes',
  'grounding operational',
  'grounding data pipeline',
  'grounding supply chain',
] as const

/** Bullet quality rules enforced for all experience sections. */
export const BULLET_QUALITY_RULES = [
  '1–2 lines per bullet maximum — no paragraph-length bullets',
  'One primary claim per bullet — do not stack 4–5 concepts',
  'Use "~" for approximations — never spell out "approximately"',
] as const

/** Claims the Product Analyst section must NOT make unless directly evidenced. */
export const PA_OVERCLAIM_PROHIBITIONS = [
  'Led all Scrum ceremonies',
  'Owned product roadmap',
  'Managed sprint delivery',
] as const

// ─── Section-specific quality gate ───────────────────────────────────────────

/**
 * Returns quality gate instructions for the given section type.
 * Injected at the end of the system prompt — after all other instructions.
 */
export function buildSectionQualityGate(sectionType: SectionType, ctx?: QualityGateContext): string {
  const lines: string[] = ['', '═══ QUALITY GATE — ENFORCE BEFORE RETURNING ═══']

  switch (sectionType) {
    case 'summary':
      lines.push(
        '',
        'SUMMARY RULES (strictly enforced):',
        '- 3–4 lines maximum. This is a positioning statement, NOT a career history dump.',
        '- Lead with the target operating identity.',
        '  Good: "CSPO-certified Product Owner with [N] years leading backlog execution, sprint delivery, user story refinement, UAT readiness, and business-to-IT translation for enterprise SaaS products."',
        '- Mention CSPO only if it strengthens the JD match.',
        '- Mention QA background only as a single supporting phrase ("Brings QA-informed judgment on...") — do NOT narrate QA career history.',
        ctx?.olderEmployersToExclude?.length
          ? `- DO NOT mention ${ctx.olderEmployersToExclude.map(e => `"${e}"`).join(', ')} or other older employers unless the JD explicitly requires that domain.`
          : '- DO NOT mention older employers not required by this JD.',
        '- DO NOT use "formal PO tenure" — sounds defensive and title-anxious.',
        '- DO NOT use "early career includes..." — turns the summary into a compressed resume.',
        '- DO NOT use "grounding X context" phrasing — vague filler.',
        '- DO NOT stack tools, metrics, companies, and prior roles together. Pick the 2–3 most JD-relevant facts.',
        '- Close with a specific "brings to this role" statement.',
        '',
        'TARGET POSTURE for Associate IT PM / PO / PA / BA roles:',
        '  Sentence 1 — identity + years + primary activities',
        '  Sentence 2 — one concrete "At [Company]" evidence anchor',
        '  Sentence 3 — supporting differentiator (QA, certifications, domain knowledge)',
        '',
        'FINAL CHECK before returning summary:',
        '  □ Under 4 lines?',
        '  □ Reads as positioning, not career history?',
        ctx?.olderEmployersToExclude?.length
          ? `  □ No ${ctx.olderEmployersToExclude.map(e => `"${e}"`).join(', ')}, no "formal PO tenure", no "early career includes"?`
          : '  □ No older employers not required by this JD, no "formal PO tenure", no "early career includes"?',
        '  □ No sentence starts with "Early career...", "Background includes...", "With a decade of..."?',
      )
      break

    case 'skills':
      lines.push(
        '',
        'SKILLS RULES:',
        '- 4–5 skill groups maximum.',
        '- Single-word ATS headings only: Product, Delivery, Analysis, Stakeholders, Data, Testing, Tools.',
        '  NOT "Product Management:", "Agile Delivery:", "Analysis & Documentation:" — these are multi-word.',
        '- Do not list skills not present in the candidate profile.',
        '- Omit Azure DevOps unless it appears in the candidate profile evidence.',
        '  Jira is sufficient when the JD says "Azure DevOps or Jira."',
        '- Do not include travel willingness anywhere in resume sections.',
      )
      break

    case 'experience-po':
      lines.push(
        '',
        'PRODUCT OWNER BULLET RULES:',
        '- 1–2 lines per bullet maximum — no paragraph-length bullets.',
        '- One primary claim per bullet — do not chain 4–5 concepts with commas and dashes.',
        '- Use "~" for all approximations — never "approximately".',
        ctx?.poDateRange
          ? `- Date range: ${ctx.poDateRange}. Do not hedge as "PO-adjacent" or "acting PO".`
          : '- Use the exact date range from the candidate profile for the PO role. Do not hedge as "PO-adjacent" or "acting PO" if the profile treats this as the primary PO role.',
        '- Roadmap framing: use "executed leadership-sponsored roadmap" or "translated roadmap priorities into release-ready scope."',
        '  Do NOT use executive-strategy language that implies independent product vision ownership.',
        ctx?.verifiedMetrics?.length
          ? `- Preserve verified metrics (${ctx.verifiedMetrics.map(m => `~${m}`).join(', ')}) but compress surrounding wording.`
          : '- Preserve verified metrics from the candidate profile exactly as stated, but compress surrounding wording to stay within bullet length.',
        '',
        'FINAL CHECK:',
        '  □ Each bullet is 1–2 lines?',
        '  □ "approximately" replaced with "~"?',
        '  □ Roadmap language bounded to execution, not strategy ownership?',
      )
      break

    case 'experience-ba':
      lines.push(
        '',
        'PRODUCT ANALYST / BUSINESS ANALYST BULLET RULES:',
        '- 1–2 lines per bullet maximum.',
        '- Use "~" for approximations.',
        '- Do NOT claim "Led all Scrum ceremonies", "Owned product roadmap", or "Managed sprint delivery" unless directly evidenced.',
        '- If Scrum ceremony support is mentioned, phrase as:',
        '  "Supported backlog refinement, sprint demos, and ceremony preparation by grounding discussion in client impact and stakeholder feedback."',
        '- Preferred phrasing verbs: Partnered, Refined, Recommended, Translated, Triaged, Maintained, Analyzed.',
        '- Do NOT mirror PO framing — PA bullets should sound like analytical and requirements support, not backlog ownership.',
        '',
        'FINAL CHECK:',
        '  □ No "Led Scrum ceremonies", "Owned roadmap", "Managed sprint delivery"?',
        '  □ Each bullet is 1–2 lines?',
        '  □ "approximately" replaced with "~"?',
      )
      break

    case 'experience-qa':
      lines.push(
        '',
        'QA BULLET RULES:',
        '- 1–2 lines per bullet maximum.',
        '- Use "~" for approximations.',
        '- QA is a supporting differentiator for this role — keep it focused on UAT readiness, release validation, defect reduction.',
        '- Do not make QA the dominant identity of the resume.',
        '',
        'FINAL CHECK:',
        '  □ Each bullet is 1–2 lines?',
        '  □ "approximately" replaced with "~"?',
        '  □ QA positioned as supporting differentiator, not dominant?',
      )
      break

    default:
      lines.push(
        '',
        'FINAL CHECK:',
        '  □ No invented claims?',
        '  □ No "approximately" — use "~"?',
        '  □ Content fits the target role posture?',
      )
  }

  lines.push('═══ END QUALITY GATE ═══', '')
  return lines.join('\n')
}

// ─── Full-resume quality gate (for refine-stage4-resume.ts) ──────────────────

/**
 * Full-resume quality gate for Stage 4 full-resume refinement calls.
 * Checks the entire resume output before returning.
 */
export function buildFullResumeQualityGate(ctx?: Pick<QualityGateContext, 'olderEmployersToExclude'>): string {
  const employerCheck = ctx?.olderEmployersToExclude?.length
    ? `  □ No "formal PO tenure", "early career includes", ${ctx.olderEmployersToExclude.map(e => `"${e}"`).join(', ')}, or defensive phrasing`
    : '  □ No "formal PO tenure", "early career includes", older employers not required by this JD, or defensive phrasing'

  return `
═══ FULL-RESUME QUALITY GATE — VERIFY BEFORE RETURNING ═══

SUMMARY CHECK:
  □ Summary is 3–4 lines and reads as a positioning statement, NOT a career history dump
${employerCheck}
  □ No sentence starting with "Background includes...", "With a decade of...", "Early career..."

SKILLS CHECK:
  □ 4–5 skill groups maximum
  □ Single-word headings only (Product, Delivery, Analysis, Stakeholders, Data, Testing, Tools)
  □ Azure DevOps excluded unless directly evidenced in work history

EXPERIENCE BULLETS CHECK:
  □ All bullets are 1–2 lines — no paragraph-length bullets
  □ "approximately" replaced with "~" everywhere
  □ PA section does NOT claim "Led Scrum ceremonies", "Owned roadmap", "Managed sprint delivery"
  □ PO roadmap language bounded to execution ("executed leadership-sponsored roadmap")

CONTENT SAFETY CHECK:
  □ No travel willingness as a resume bullet
  □ No Azure DevOps unless evidenced
  □ No invented employers, tools, titles, certifications, dates, or metrics
  □ CSPO cited only if present in education or bridge answers
  □ QA is supportive, not the dominant identity

POSTURE CHECK:
  □ Tone fits Associate IT PM / tactical product delivery
  □ JD terms appear in bullets, not only in Skills
  □ Realistic for two pages

═══ END QUALITY GATE ═══
`
}
