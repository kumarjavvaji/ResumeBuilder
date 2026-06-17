import { anthropic, MODEL } from './client'
import type {
  JDRequirementMap,
  JDRequirement,
  RawJD,
  JDSourceType,
  GapClassification,
  Stage1CalibrationBrief,
  JDExtractItem,
  CompactJDExtract,
} from '@/contracts'

// Hard caps on the compact extraction pass. The resume-calibration pass is bounded by these
// counts in turn, so Stage 1 output size never scales with how many requirements a JD contains.
const CAPS = {
  responsibilities: 10,
  qualifications: 10,
  niceToHaves: 8,
  tools: 12,
  domainSignals: 8,
  resumeProofThemes: 8,
  bridgeQuestionSeeds: 8,
  risks: 6,
} as const

const EXTRACT_ITEM_SCHEMA = (maxItems: number) => ({
  type: 'array',
  maxItems,
  items: {
    type: 'object',
    required: ['title', 'normalizedText', 'priority', 'confidence'],
    properties: {
      title: { type: 'string', description: 'Short label, ≤6 words.' },
      normalizedText: { type: 'string', description: 'Concise restatement, ≤15 words.' },
      sourceQuote: { type: 'string', description: '≤12 word quote from the JD, only if directly quotable.' },
      sourceBasis: { type: 'string', description: 'If not a direct quote, a brief basis for why this was extracted.' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  },
})

const EXTRACT_TOOL = {
  name: 'extract_compact_jd',
  description: 'Extract a compact, hard-capped, structured summary of a job description.',
  input_schema: {
    type: 'object' as const,
    required: [
      'summary', 'responsibilities', 'qualifications', 'niceToHaves', 'tools',
      'domainSignals', 'resumeProofThemes', 'bridgeQuestionSeeds', 'risks',
    ],
    properties: {
      summary: { type: 'string', description: '1-2 sentence summary of the role.' },
      responsibilities: EXTRACT_ITEM_SCHEMA(CAPS.responsibilities),
      qualifications: EXTRACT_ITEM_SCHEMA(CAPS.qualifications),
      niceToHaves: EXTRACT_ITEM_SCHEMA(CAPS.niceToHaves),
      tools: EXTRACT_ITEM_SCHEMA(CAPS.tools),
      domainSignals: EXTRACT_ITEM_SCHEMA(CAPS.domainSignals),
      resumeProofThemes: EXTRACT_ITEM_SCHEMA(CAPS.resumeProofThemes),
      bridgeQuestionSeeds: EXTRACT_ITEM_SCHEMA(CAPS.bridgeQuestionSeeds),
      risks: EXTRACT_ITEM_SCHEMA(CAPS.risks),
    },
  },
}

const EXTRACT_SYSTEM = `You compress a job description into a compact, bounded, structured extract. This is NOT a final analysis — it is a deduplicated, prioritized shortlist that a later pass will calibrate against a candidate profile.

Rules:
- Every array has a hard cap. If the JD has more items than the cap, keep only the most resume-relevant, highest-priority ones and drop the rest. Never try to fit more in by shortening items — drop low-value items instead.
- Deduplicate overlapping or restated duties before returning: if two responsibilities describe the same underlying activity, merge them into one item.
- responsibilities: the actual day-to-day duties (max ${CAPS.responsibilities}).
- qualifications: required skills/experience/credentials, "must have" / "required" language (max ${CAPS.qualifications}).
- niceToHaves: "preferred" / "plus" / "bonus" language (max ${CAPS.niceToHaves}).
- tools: named tools, platforms, or technologies (max ${CAPS.tools}).
- domainSignals: industry, company type, technology domain, culture signals (max ${CAPS.domainSignals}).
- resumeProofThemes: short positioning angles a resume could lead with to match this role (max ${CAPS.resumeProofThemes}).
- bridgeQuestionSeeds: short gap/evidence prompts worth asking the candidate about later (max ${CAPS.bridgeQuestionSeeds}).
- risks: unsupported or ambiguous claims in the JD itself, or things that look like over-detection (max ${CAPS.risks}).
- title ≤6 words, normalizedText ≤15 words, sourceQuote ≤12 words. Never write multi-sentence prose in any field.
- Only extract what's actually in the JD text. Never invent requirements.`

const EXTRACT_STRICT_SUFFIX = `Your previous attempt may have exceeded the output budget or caps. This time, be stricter: titles ≤5 words, normalizedText ≤10 words, omit sourceQuote/sourceBasis unless essential, and respect every array cap exactly — truncate to the highest-priority items rather than including everything.`

function dedupeItems(items: JDExtractItem[]): JDExtractItem[] {
  const seen: string[] = []
  const out: JDExtractItem[] = []
  for (const item of items) {
    const norm = (item.normalizedText || item.title || '').toLowerCase().trim()
    if (!norm) continue
    const isDup = seen.some(s => s === norm || s.includes(norm) || norm.includes(s))
    if (!isDup) {
      seen.push(norm)
      out.push(item)
    }
  }
  return out
}

function capItems(items: JDExtractItem[], max: number): JDExtractItem[] {
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
  return [...items]
    .sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1))
    .slice(0, max)
}

function dedupeAndCap(items: JDExtractItem[] | undefined, max: number): JDExtractItem[] {
  return capItems(dedupeItems(items ?? []), max)
}

/** Calls a tool-use endpoint, retrying once with a stricter prompt if output is missing/invalid. Never raises max_tokens. */
async function callToolWithRetry<T>(opts: {
  toolName: string
  tools: any[]
  system: string
  strictSuffix: string
  userContent: string
  maxTokens: number
  validate: (input: any) => T | undefined
}): Promise<T> {
  let lastTruncated = false
  for (let attempt = 0; attempt < 2; attempt++) {
    const strict = attempt === 1
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens,
      tools: opts.tools,
      tool_choice: { type: 'tool', name: opts.toolName },
      system: strict ? `${opts.system}\n\n${opts.strictSuffix}` : opts.system,
      messages: [{ role: 'user', content: opts.userContent }],
    })
    lastTruncated = response.stop_reason === 'max_tokens'
    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      const result = opts.validate(toolUse.input)
      if (result) return result
    }
  }
  throw new Error(
    `JD parser: ${opts.toolName} produced no valid output after a compact retry${lastTruncated ? ' (response was truncated)' : ''}.`
  )
}

// Bounded by the schema, not by JD length: up to 70 items across 8 arrays, each with a
// title/normalizedText/sourceQuote/priority/confidence. ~4500 tokens covers that worst case
// with headroom, well under the old unbounded-growth budget this replaces.
const EXTRACT_MAX_TOKENS = 4500
const EXTRACT_ARRAY_KEYS = [
  'responsibilities', 'qualifications', 'niceToHaves', 'tools',
  'domainSignals', 'resumeProofThemes', 'bridgeQuestionSeeds', 'risks',
] as const

async function extractCompactJD(jdText: string): Promise<CompactJDExtract> {
  const raw = await callToolWithRetry<Omit<CompactJDExtract, 'summary'> & { summary: string }>({
    toolName: 'extract_compact_jd',
    tools: [EXTRACT_TOOL],
    system: EXTRACT_SYSTEM,
    strictSuffix: EXTRACT_STRICT_SUFFIX,
    maxTokens: EXTRACT_MAX_TOKENS,
    userContent: `Job description:\n${jdText}`,
    // All 8 arrays must be present (even if legitimately empty for a sparse JD) — catches the
    // model silently dropping trailing arrays when it runs low on budget mid-generation.
    validate: (input) =>
      input?.summary && EXTRACT_ARRAY_KEYS.every(k => Array.isArray(input[k])) ? input : undefined,
  })

  return {
    summary: raw.summary,
    responsibilities: dedupeAndCap(raw.responsibilities, CAPS.responsibilities),
    qualifications: dedupeAndCap(raw.qualifications, CAPS.qualifications),
    niceToHaves: dedupeAndCap(raw.niceToHaves, CAPS.niceToHaves),
    tools: dedupeAndCap(raw.tools, CAPS.tools),
    domainSignals: dedupeAndCap(raw.domainSignals, CAPS.domainSignals),
    resumeProofThemes: dedupeAndCap(raw.resumeProofThemes, CAPS.resumeProofThemes),
    bridgeQuestionSeeds: dedupeAndCap(raw.bridgeQuestionSeeds, CAPS.bridgeQuestionSeeds),
    risks: dedupeAndCap(raw.risks, CAPS.risks),
  }
}

function requirementSchema() {
  return {
    type: 'object',
    required: ['text', 'category', 'userCoverageStatus'],
    properties: {
      text: { type: 'string' },
      category: { type: 'string', enum: ['technical', 'domain', 'soft', 'tool', 'process'] },
      userCoverageStatus: { type: 'string', enum: ['covered', 'partial', 'gap', 'unknown'] },
      gapClassification: {
        type: 'string',
        enum: ['true_gap', 'profile_missing', 'parser_missing', 'mapping_gap', 'wording_gap', 'needs_confirmation', 'not_required'],
        description: 'Only set when userCoverageStatus is gap or partial.',
      },
      sourceExcerpt: { type: 'string', description: '≤15 words, carried from the compact extract sourceQuote if present.' },
      profileEvidence: { type: 'string', description: '≤20 words.' },
      rowLabel: { type: 'string', description: '≤8 words.' },
      jdSignal: { type: 'string', description: '≤15 words.' },
      quickDiqGrounding: { type: 'string', description: '≤25 words. "No material DIQ calibration for this row." if none.' },
      profileGrounding: { type: 'string', description: '≤25 words.' },
      calibratedFitInterpretation: { type: 'string', description: '≤30 words, one synthesis sentence.' },
      classification: { type: 'string', enum: ['covered', 'partial', 'gap', 'needs_evidence', 'weakly_supported'] },
      evidenceNeeded: { type: 'string', description: '≤20 words.' },
      resumeImplication: { type: 'string', description: '≤20 words.' },
      stage2Implication: { type: 'string', description: '≤20 words, phrased as a single question prompt.' },
    },
  }
}

/**
 * One calibration call per row-kind (required vs. niceToHave) instead of a single combined call.
 * A combined call's output scales with required+niceToHave together (up to 18 rows x 15 fields each),
 * which can overflow even a generous token budget. Splitting keeps each call's output bounded by its
 * own cap alone, so calibration never truncates regardless of how many requirements the JD has.
 */
function calibrateRowTool(kind: 'required' | 'niceToHave') {
  const isRequired = kind === 'required'
  return {
    name: isRequired ? 'calibrate_required' : 'calibrate_nice_to_have',
    description: `Calibrate a bounded set of ${kind} JD requirements against Quick-DIQ and the candidate profile.`,
    input_schema: {
      type: 'object' as const,
      required: isRequired ? ['rows', 'realJobFunction'] : ['rows'],
      properties: {
        rows: { type: 'array', maxItems: isRequired ? CAPS.qualifications : CAPS.niceToHaves, items: requirementSchema() },
        ...(isRequired ? { realJobFunction: { type: 'string', description: '≤20 words.' } } : {}),
      },
    },
  }
}

const CALIBRATE_STRICT_SUFFIX = `Your previous attempt may have exceeded the output budget. This time, be stricter: every prose field ≤12 words, one short clause only, no exceptions. Respect array caps exactly.`

interface CalibrateRowOutput {
  rows: JDRequirement[]
  realJobFunction?: string
}

function calibrationFraming(calibrationBrief?: Stage1CalibrationBrief): string {
  return calibrationBrief
    ? `

You are generating a calibrated Stage 1 target artifact, not a JD/profile matching report. For every row, ground your analysis in three inputs: 1. the JD extract, 2. the normalized Quick-DIQ company/domain analysis, 3. the saved candidate profile.

Use Quick-DIQ to interpret the JD's company/domain meaning, priority, delivery context, stakeholder context, tool context, and evidence expectations. Do not use Quick-DIQ as candidate evidence. Quick-DIQ can calibrate what matters, but candidate claims require saved profile evidence or user confirmation — never mark a requirement "covered" on the basis of Quick-DIQ alone.

Each row must include jdSignal, quickDiqGrounding, profileGrounding, calibratedFitInterpretation, classification, evidenceNeeded, resumeImplication, and stage2Implication, each within its word cap. If Quick-DIQ does not affect a row, set quickDiqGrounding to "No material DIQ calibration for this row."

Quick-DIQ company/domain analysis:
${JSON.stringify(calibrationBrief, null, 2)}`
    : ''
}

async function calibrateRowSet(
  kind: 'required' | 'niceToHave',
  items: JDExtractItem[],
  extract: CompactJDExtract,
  userSkillsSummary: string,
  calibrationBrief?: Stage1CalibrationBrief
): Promise<CalibrateRowOutput> {
  const isRequired = kind === 'required'
  const system = `You calibrate a bounded, pre-extracted set of ${isRequired ? 'required' : 'nice-to-have'} JD requirements against a candidate profile. The requirement set is already deduplicated and capped — produce exactly one row per item below, do not invent additional rows.

Rules:
- One row per item in the list below, in the same order. Do not add or drop rows.
- userCoverageStatus: compare each requirement to the user skills summary.
  - "covered" = user clearly has this
  - "partial" = user has related experience but not a direct match
  - "gap" = user does not have this
  - "unknown" = not enough information
- classification: "needs_evidence" if the requirement isn't found in the user profile (a bridge-question target, not a hard disqualifier); "weakly_supported" if coverage is partial or thin; otherwise "covered" or "gap" to match userCoverageStatus.
${isRequired ? '- realJobFunction: the actual job function in plain terms, ≤20 words.\n' : ''}- sourceExcerpt: carry over the item's sourceQuote/sourceBasis if present, else omit.
- gapClassification: for rows with gap/partial coverage, classify true_gap / profile_missing / parser_missing / mapping_gap / wording_gap / needs_confirmation. Omit for covered/unknown.
- Every prose field has a word cap stated in its schema description — respect it. Keep to one concise clause, not multi-sentence prose.
- Never invent a requirement that isn't in the list below.${calibrationFraming(calibrationBrief)}`

  const userContent = `${isRequired ? 'Required' : 'Nice-to-have'} items to calibrate:\n${JSON.stringify(items, null, 2)}\n\nJD context (for grounding only — do not add rows from this):\n${JSON.stringify(
    {
      summary: extract.summary,
      tools: extract.tools,
      domainSignals: extract.domainSignals,
      responsibilities: extract.responsibilities,
    },
    null,
    2
  )}\n\nUser skills summary:\n${userSkillsSummary}`

  const tool = calibrateRowTool(kind)
  return callToolWithRetry<CalibrateRowOutput>({
    toolName: tool.name,
    tools: [tool],
    system,
    strictSuffix: CALIBRATE_STRICT_SUFFIX,
    maxTokens: 3500,
    userContent,
    validate: (input) => (input?.rows ? input : undefined),
  })
}

interface CalibrateOutput {
  required: JDRequirement[]
  niceToHave: JDRequirement[]
  realJobFunction: string
  needsEvidenceItems: string[]
  weaklySupportedRequirements: string[]
}

async function calibrateRequirements(
  extract: CompactJDExtract,
  userSkillsSummary: string,
  calibrationBrief?: Stage1CalibrationBrief
): Promise<CalibrateOutput> {
  const [requiredOut, niceToHaveOut] = await Promise.all([
    calibrateRowSet('required', extract.qualifications, extract, userSkillsSummary, calibrationBrief),
    calibrateRowSet('niceToHave', extract.niceToHaves, extract, userSkillsSummary, calibrationBrief),
  ])

  const allRows = [...requiredOut.rows, ...niceToHaveOut.rows]
  const needsEvidenceItems = allRows
    .filter(r => r.classification === 'needs_evidence')
    .map(r => r.evidenceNeeded || r.text)
  const weaklySupportedRequirements = allRows
    .filter(r => r.classification === 'weakly_supported' || r.userCoverageStatus === 'partial')
    .map(r => r.text)

  return {
    required: requiredOut.rows,
    niceToHave: niceToHaveOut.rows,
    realJobFunction: requiredOut.realJobFunction ?? '',
    needsEvidenceItems,
    weaklySupportedRequirements,
  }
}

export interface ParsedJD {
  rawJD: RawJD
  requirementMap: JDRequirementMap
}

export async function parseJobDescription(
  jdText: string,
  userSkillsSummary: string,
  jdSourceType: JDSourceType = 'pasted_jd',
  calibrationBrief?: Stage1CalibrationBrief
): Promise<ParsedJD> {
  const compactExtract = await extractCompactJD(jdText)
  const calibrated = await calibrateRequirements(compactExtract, userSkillsSummary, calibrationBrief)

  function stampSource(reqs: JDRequirement[], forceGap?: GapClassification): JDRequirement[] {
    return reqs.map(r => ({
      ...r,
      sourceType: jdSourceType,
      ...(forceGap !== undefined ? { gapClassification: forceGap } : {}),
    }))
  }

  const requirementMap: JDRequirementMap = {
    required: stampSource(calibrated.required),
    niceToHave: stampSource(calibrated.niceToHave, 'not_required'),
    realJobFunction: calibrated.realJobFunction,
    needsEvidenceItems: calibrated.needsEvidenceItems ?? [],
    // Back-fill the deprecated field so existing consumers don't break
    unsupportedRequirements: calibrated.needsEvidenceItems ?? [],
    weaklySupportedRequirements: calibrated.weaklySupportedRequirements ?? [],
  }

  const rawJD: RawJD = {
    fullText: jdText,
    summary: compactExtract.summary,
    responsibilities: compactExtract.responsibilities.map(i => i.normalizedText),
    requiredSkills: compactExtract.qualifications.map(i => i.normalizedText),
    niceToHaves: compactExtract.niceToHaves.map(i => i.normalizedText),
    domainSignals: compactExtract.domainSignals.map(i => i.normalizedText),
    compactExtract,
  }

  return { rawJD, requirementMap }
}
