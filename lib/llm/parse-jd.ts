import { anthropic, MODEL } from './client'
import type {
  JDRequirementMap,
  JDRequirement,
  RawJD,
  JDSourceType,
  GapClassification,
  CalibratedFitClassification,
  Stage1CalibrationBrief,
  JDExtractItem,
  CompactJDExtract,
  ProfileEvidenceIndexItem,
} from '@/contracts'
import { matchRow } from '@/lib/stage1/evidence-match'

// Hard caps on the compact extraction pass. The Evidence Bridge pass is bounded by these
// counts, so Stage 1 output size never scales with JD length.
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

// ─── JD Extraction pass ───────────────────────────────────────────────────────

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

const EXTRACT_SYSTEM = `You compress a job description into a compact, bounded, structured extract. This is NOT a final analysis — it is a deduplicated, prioritized shortlist that a later Evidence Bridge pass will calibrate against candidate evidence.

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
- Only extract what's actually in the JD text. Never invent requirements.
- COMPOUND REQUIREMENT RULE: If a qualification or domain signal combines two or more independently evaluatable dimensions (e.g. "healthcare SaaS experience", "Python and SQL proficiency", "agile delivery and stakeholder communication"), extract each dimension as a SEPARATE item. A candidate can be strong in one dimension and weak in another — they must be scored independently. "Healthcare SaaS" → two items: "SaaS product delivery" and "healthcare / regulated-data domain". Never pack two distinct skills or domains into a single row.`

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

// ─── Evidence Bridge ──────────────────────────────────────────────────────────
// Replaces the flat calibration pass. The LLM now receives structured per-requirement
// evidence groups (with IDs, texts, strength, and source type) and returns a bridge
// assessment per row. Classification is then derived deterministically from the assessment.

type BridgeAssessment = 'direct' | 'adjacent' | 'proxy' | 'insufficient' | 'likely_retrieval_gap'

interface BridgeResult {
  rowIndex: number
  rowLabel?: string
  category?: JDRequirement['category']
  jdSignal?: string
  quickDiqGrounding?: string
  profileGrounding?: string
  calibratedFitInterpretation?: string
  bridgeAssessment: BridgeAssessment
  evidenceIdsUsed: string[]
  sourceTypesUsed: string[]
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  evidenceNeeded?: string
  resumeImplication: string
  stage2Action: 'suppress' | 'ask_bridge_question' | 'retrieve_more_evidence'
  bridgeQuestion?: string
  stage2Implication?: string
}

interface BridgeRowOutput {
  bridges: BridgeResult[]
  realJobFunction?: string
}

function buildBridgeTool(kind: 'required' | 'niceToHave') {
  const isRequired = kind === 'required'
  const bridgeItem = {
    type: 'object',
    required: ['rowIndex', 'rowLabel', 'category', 'bridgeAssessment', 'evidenceIdsUsed', 'sourceTypesUsed', 'confidence', 'reasoning', 'resumeImplication', 'stage2Action'],
    properties: {
      rowIndex: { type: 'number', description: 'Index of the requirement in the input list (0-based). Must match exactly.' },
      rowLabel: { type: 'string', description: '≤8 words. Short label for this requirement.' },
      category: { type: 'string', enum: ['technical', 'domain', 'soft', 'tool', 'process'] },
      jdSignal: { type: 'string', description: '≤12 words. Key phrase from JD requirement.' },
      quickDiqGrounding: { type: 'string', description: '≤25 words from DIQ context. "No material DIQ calibration." if DIQ is not provided or not relevant.' },
      profileGrounding: { type: 'string', description: '≤20 words. What in the retrieved evidence covers or fails to cover this requirement.' },
      calibratedFitInterpretation: { type: 'string', description: '≤30 words. Synthesis of JD signal + DIQ context + evidence bridge.' },
      bridgeAssessment: {
        type: 'string',
        enum: ['direct', 'adjacent', 'proxy', 'insufficient', 'likely_retrieval_gap'],
        description: 'direct=evidence clearly covers it with specific IDs; adjacent=related but needs more specificity; proxy=nearby domain/role, would overreach to claim directly; insufficient=no evidence found after checking all retrieved candidates; likely_retrieval_gap=evidence should exist in this profile but was not retrieved.',
      },
      evidenceIdsUsed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Claim/skill/tool IDs from the retrieved evidence that support this assessment. REQUIRED for direct, adjacent, proxy. Must be empty for insufficient.',
      },
      sourceTypesUsed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Source types of the evidence used (e.g. manual_profile, bridge_answer).',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence in this bridge assessment.' },
      reasoning: { type: 'string', description: '≤25 words explaining the bridge assessment.' },
      evidenceNeeded: { type: 'string', description: '≤20 words. Describe what specific evidence would fill this gap. Only when stage2Action is ask_bridge_question.' },
      resumeImplication: { type: 'string', description: '≤20 words. What this means for how the resume should present or avoid this requirement.' },
      stage2Action: {
        type: 'string',
        enum: ['suppress', 'ask_bridge_question', 'retrieve_more_evidence'],
        description: 'suppress=evidence exists, no Stage 2 question needed; ask_bridge_question=targeted question for the specific missing element; retrieve_more_evidence=retrieval gap, do NOT ask the user a question.',
      },
      bridgeQuestion: { type: 'string', description: '≤25 words. Only when stage2Action is ask_bridge_question. Must target the SPECIFIC MISSING ELEMENT, not restate the full requirement.' },
      stage2Implication: { type: 'string', description: '≤20 words phrased as a question prompt. Only when bridgeQuestion is set.' },
    },
  }

  return {
    name: isRequired ? 'bridge_required' : 'bridge_nice_to_have',
    description: `Evidence bridge assessment for ${isRequired ? 'required' : 'nice-to-have'} JD requirements against retrieved profile evidence.`,
    input_schema: {
      type: 'object' as const,
      required: isRequired ? ['bridges', 'realJobFunction'] : ['bridges'],
      properties: {
        bridges: {
          type: 'array',
          maxItems: isRequired ? CAPS.qualifications : CAPS.niceToHaves,
          items: bridgeItem,
        },
        ...(isRequired ? { realJobFunction: { type: 'string', description: '≤20 words. What this role actually does, based on the requirements.' } } : {}),
      },
    },
  }
}

const BRIDGE_SYSTEM = `You assess whether retrieved candidate profile evidence bridges to JD requirements.

For each requirement in the input, you receive:
- The requirement text and importance
- Retrieved evidence candidates — each has an ID, text, evidence strength (strong/medium/weak), and source type
- Quick-DIQ company/domain context (if provided)

Assess the bridge for each requirement:

"direct"
The retrieved evidence clearly and specifically covers the requirement. You can cite evidence IDs without overinterpretation. Set stage2Action to "suppress" — the resume can use this evidence.

"adjacent"
The retrieved evidence is related but incomplete. It covers the concept but lacks required specificity (domain match, volume, tool name, role level, artifact type, or wording alignment). Set stage2Action to "ask_bridge_question" targeting ONLY the missing specificity — not the full requirement.

"proxy"
The retrieved evidence is from a nearby domain or role. Claiming the requirement directly would overreach without further confirmation. Set stage2Action to "ask_bridge_question" with a question about the specific interpretive gap.

"insufficient"
No retrieved evidence supports the requirement after checking all provided candidates. The candidate may genuinely lack this. Set stage2Action to "ask_bridge_question" with a direct evidence question. Use this ONLY when all evidence has "weak" or "none" strength.

"likely_retrieval_gap"
The evidence retrieval appears to have missed relevant content. Use when: (a) the profile clearly operates in the domain or skill area but no specific evidence was retrieved for this requirement, or (b) a related requirement in the same set is covered by strong evidence but this one is not, suggesting a vocabulary mismatch rather than a true gap. Set stage2Action to "retrieve_more_evidence" — do NOT generate a bridgeQuestion.

Hard rules:
- Do NOT invent evidence IDs. Use only IDs provided in the retrieved evidence for this requirement.
- Do NOT assign "direct" without at least one evidence ID.
- Do NOT assign "insufficient" when any retrieved evidence has strong or moderate strength — that is a retrieval gap, not a true absence.
- Evidence IDs are required for direct, adjacent, and proxy assessments.
- Bridge questions must target the SPECIFIC MISSING ELEMENT, not restate the full requirement.
- One output row per input requirement, in the same order. Count must match exactly.
- For "likely_retrieval_gap": do not set bridgeQuestion, do not ask the user anything.`

const BRIDGE_STRICT_SUFFIX = `Your previous attempt may have exceeded the output budget. This time: rowLabel ≤5 words, reasoning ≤12 words, resumeImplication ≤10 words, all other prose ≤15 words. Respect array caps exactly. One bridge result per input requirement — no more, no less.`

/**
 * Derives userCoverageStatus from classification so the two fields are never inconsistent.
 * The bridge determines classification; userCoverageStatus is always derived from it.
 */
function deriveUserCoverageStatus(
  classification: string | undefined,
  fallback: JDRequirement['userCoverageStatus']
): JDRequirement['userCoverageStatus'] {
  switch (classification) {
    case 'covered':           return 'covered'
    case 'partially_covered': return 'partial'
    case 'partial':           return 'partial'
    case 'weakly_supported':  return 'partial'
    case 'needs_evidence':    return 'gap'
    case 'gap':               return 'gap'
    case 'retrieval_gap':     return 'partial'
    default:                  return fallback
  }
}

function syncCoverageStatus(row: JDRequirement): JDRequirement {
  if (!row.classification) return row
  return { ...row, userCoverageStatus: deriveUserCoverageStatus(row.classification, row.userCoverageStatus) }
}

/**
 * Deterministic classification from LLM bridge assessment.
 * The LLM determines bridge type; the application enforces the final classification.
 */
function classifyFromBridgeAssessment(
  assessment: BridgeAssessment,
  evidenceIdsUsed: string[],
  confidence: 'high' | 'medium' | 'low',
  matcherStrength: 'strong' | 'moderate' | 'weak' | 'none'
): CalibratedFitClassification {
  if (assessment === 'likely_retrieval_gap') return 'retrieval_gap'

  if (assessment === 'insufficient') {
    // Matcher found strong/moderate evidence despite LLM saying insufficient → retrieval gap
    if (matcherStrength === 'strong' || matcherStrength === 'moderate') return 'retrieval_gap'
    return 'needs_evidence'
  }

  if (assessment === 'proxy') return 'weakly_supported'

  if (assessment === 'adjacent') {
    return confidence === 'high' ? 'partially_covered' : 'weakly_supported'
  }

  if (assessment === 'direct') {
    // Direct without evidence IDs means the LLM was overconfident — treat as retrieval gap
    if (evidenceIdsUsed.length === 0) return 'retrieval_gap'
    return 'covered'
  }

  return 'needs_evidence'
}

/**
 * Derives GapClassification from the final classification and bridge assessment.
 */
function deriveGapClassification(
  classification: CalibratedFitClassification,
  assessment: BridgeAssessment
): GapClassification | undefined {
  switch (classification) {
    case 'covered':           return undefined
    case 'partially_covered': return 'needs_confirmation'
    case 'partial':           return 'needs_confirmation'
    case 'weakly_supported':  return assessment === 'proxy' ? 'mapping_gap' : 'wording_gap'
    case 'needs_evidence':    return 'profile_missing'
    case 'retrieval_gap':     return 'retrieval_gap'
    case 'gap':               return 'true_gap'
    default:                  return undefined
  }
}

/**
 * Deterministic consistency audit. Enforces the hard classification rules before the
 * artifact is surfaced. Called after the bridge LLM pass.
 *
 * Rules enforced:
 * - Every row must have an allowed classification.
 * - covered / partially_covered / weakly_supported must have evidence IDs.
 * - retrieval_gap must not have a Stage 2 question.
 * - needs_evidence must not be assigned when the matcher found strong/moderate evidence.
 */
function runConsistencyAudit(rows: JDRequirement[]): { rows: JDRequirement[]; violations: string[] } {
  const ALLOWED = new Set<string>(['covered', 'partially_covered', 'weakly_supported', 'needs_evidence', 'retrieval_gap'])
  const violations: string[] = []

  const fixed = rows.map(row => {
    let r = { ...row }
    const label = r.rowLabel || r.text.slice(0, 40)

    // Enforce allowed taxonomy
    if (!r.classification || !ALLOWED.has(r.classification)) {
      violations.push(`"${label}": classification "${r.classification}" not in allowed set → needs_evidence`)
      r = { ...r, classification: 'needs_evidence' as const, gapClassification: 'profile_missing' as GapClassification }
    }

    // covered/partially_covered/weakly_supported require evidence IDs
    if (['covered', 'partially_covered', 'weakly_supported'].includes(r.classification as string)) {
      if (!r.matchedClaimIds?.length) {
        violations.push(`"${label}": "${r.classification}" without evidence IDs → retrieval_gap`)
        r = {
          ...r,
          classification: 'retrieval_gap' as const,
          gapClassification: 'retrieval_gap' as GapClassification,
          userCoverageStatus: 'partial' as const,
          stage2Action: 'retrieve_more_evidence' as const,
          stage2Implication: undefined,
        }
      }
    }

    // retrieval_gap must not generate Stage 2 questions
    if (r.classification === 'retrieval_gap') {
      if (r.stage2Action === 'ask_bridge_question' || r.stage2Implication) {
        violations.push(`"${label}": retrieval_gap must not have Stage 2 question → suppressed`)
        r = { ...r, stage2Action: 'retrieve_more_evidence' as const, stage2Implication: undefined }
      }
    }

    // needs_evidence must not be set when matcher found strong/moderate evidence
    if (
      r.classification === 'needs_evidence' &&
      (r.profileEvidenceStrength === 'strong' || r.profileEvidenceStrength === 'moderate')
    ) {
      violations.push(`"${label}": needs_evidence contradicts ${r.profileEvidenceStrength} matcher evidence → retrieval_gap`)
      r = {
        ...r,
        classification: 'retrieval_gap' as const,
        gapClassification: 'retrieval_gap' as GapClassification,
        userCoverageStatus: 'partial' as const,
        stage2Action: 'retrieve_more_evidence' as const,
        stage2Implication: undefined,
      }
    }

    return r
  })

  return { rows: fixed, violations }
}

/**
 * Runs the Evidence Bridge for one row-set (required or nice-to-have).
 *
 * Each requirement gets its matched evidence candidates injected as structured objects
 * with IDs, texts, strength, and source type. The LLM returns a bridge assessment per
 * requirement instead of a flat coverage score, enabling deterministic classification.
 */
async function bridgeRowSet(
  kind: 'required' | 'niceToHave',
  items: JDExtractItem[],
  evidenceIndex: ProfileEvidenceIndexItem[],
  userSkillsSummary: string,
  calibrationBrief?: Stage1CalibrationBrief,
): Promise<BridgeRowOutput> {
  const isRequired = kind === 'required'

  // Build per-requirement evidence groups from deterministic pre-match
  const evidenceGroups = items.map((item, i) => {
    const tempRow: JDRequirement = {
      text: item.normalizedText || item.title,
      category: 'technical',
      userCoverageStatus: 'unknown',
    }
    const matched = matchRow(tempRow, evidenceIndex)
    const matchedItems = (matched.matchedClaimIds ?? [])
      .map(id => evidenceIndex.find(e => e.claimId === id))
      .filter((e): e is ProfileEvidenceIndexItem => e != null)

    return {
      rowIndex: i,
      label: item.title,
      text: item.normalizedText || item.title,
      importance: item.priority,
      sourceQuote: item.sourceQuote || item.sourceBasis,
      retrievedEvidence: matchedItems.map(e => ({
        id: e.claimId,
        text: e.text,
        category: e.category,
        strength: e.evidenceStrength,
        sourceType: (e as any).sourceType ?? 'manual_profile',
      })),
    }
  })

  const diqContext = calibrationBrief
    ? JSON.stringify({
        companyContext: calibrationBrief.companyContext,
        domainContext: calibrationBrief.domainContext,
        likelyHiringPriorities: calibrationBrief.likelyHiringPriorities,
        deliverySignals: calibrationBrief.deliverySignals,
        stakeholderSignals: calibrationBrief.stakeholderSignals,
      }, null, 2)
    : null

  const userContent = [
    `${isRequired ? 'Required' : 'Nice-to-have'} requirements to bridge (one bridge result per requirement, same order):`,
    JSON.stringify(evidenceGroups, null, 2),
    userSkillsSummary
      ? `\nCandidate skills context (for orientation only — cite evidence IDs from the retrieved evidence above, not from this list):\n${userSkillsSummary.slice(0, 500)}`
      : null,
    diqContext ? `\nQuick-DIQ company/domain context:\n${diqContext}` : null,
  ].filter(Boolean).join('\n')

  const tool = buildBridgeTool(kind)

  return callToolWithRetry<BridgeRowOutput>({
    toolName: tool.name,
    tools: [tool],
    system: BRIDGE_SYSTEM,
    strictSuffix: BRIDGE_STRICT_SUFFIX,
    maxTokens: 4500,
    userContent,
    validate: (input) => (input?.bridges && Array.isArray(input.bridges) ? input : undefined),
  })
}

// ─── Internal pipeline output type ───────────────────────────────────────────

interface BridgeOutput {
  required: JDRequirement[]
  niceToHave: JDRequirement[]
  realJobFunction: string
  needsEvidenceItems: string[]
  weaklySupportedRequirements: string[]
  violations: string[]
}

/**
 * Applies bridge results to extracted items, derives classification deterministically,
 * and runs the consistency audit. Returns fully-classified JD rows.
 */
async function bridgeRequirements(
  extract: CompactJDExtract,
  userSkillsSummary: string,
  evidenceIndex: ProfileEvidenceIndexItem[],
  calibrationBrief?: Stage1CalibrationBrief,
): Promise<BridgeOutput> {
  // Pre-match all items first to get matcher strength (used in classifyFromBridgeAssessment
  // and as a safety net when the bridge LLM under-reports evidence IDs).
  const preMatchRequired = extract.qualifications.map(item => {
    const row: JDRequirement = { text: item.normalizedText || item.title, category: 'technical', userCoverageStatus: 'unknown' }
    return matchRow(row, evidenceIndex)
  })
  const preMatchNiceToHave = extract.niceToHaves.map(item => {
    const row: JDRequirement = { text: item.normalizedText || item.title, category: 'technical', userCoverageStatus: 'unknown' }
    return matchRow(row, evidenceIndex)
  })

  // Run bridge LLM calls in parallel (one per row-set)
  const [requiredOut, niceToHaveOut] = await Promise.all([
    bridgeRowSet('required', extract.qualifications, evidenceIndex, userSkillsSummary, calibrationBrief),
    bridgeRowSet('niceToHave', extract.niceToHaves, evidenceIndex, userSkillsSummary, calibrationBrief),
  ])

  function applyBridgeResults(
    items: JDExtractItem[],
    bridges: BridgeResult[],
    preMatches: JDRequirement[],
  ): JDRequirement[] {
    return items.map((item, i) => {
      const bridge = bridges.find(b => b.rowIndex === i) ?? bridges[i]
      const preMatch = preMatches[i]
      const matcherStrength = (preMatch?.profileEvidenceStrength ?? 'none') as 'strong' | 'moderate' | 'weak' | 'none'

      if (!bridge) {
        // Fallback: bridge result missing for this index
        return {
          text: item.normalizedText || item.title,
          category: 'technical' as const,
          userCoverageStatus: 'partial' as const,
          rowLabel: item.title,
          sourceExcerpt: item.sourceQuote,
          classification: 'retrieval_gap' as const,
          gapClassification: 'retrieval_gap' as GapClassification,
          bridgeAssessment: 'likely_retrieval_gap' as BridgeAssessment,
          bridgeConfidence: 'low' as const,
          matchedClaimIds: preMatch?.matchedClaimIds ?? [],
          matchedEvidenceTexts: preMatch?.matchedEvidenceTexts ?? [],
          profileEvidenceStrength: matcherStrength,
          stage2Action: 'retrieve_more_evidence' as const,
          quickDiqGrounding: 'No material DIQ calibration.',
          resumeImplication: 'Cannot make a resume claim without evidence.',
        }
      }

      const classification = classifyFromBridgeAssessment(
        bridge.bridgeAssessment,
        bridge.evidenceIdsUsed,
        bridge.confidence,
        matcherStrength,
      )

      const gapClassification = deriveGapClassification(classification, bridge.bridgeAssessment)

      // Use bridge-provided evidence IDs. If LLM said direct/adjacent/proxy but forgot IDs,
      // fall back to matcher IDs so the consistency audit can validate rather than demote.
      const claimIds = bridge.evidenceIdsUsed.length > 0
        ? bridge.evidenceIdsUsed
        : (preMatch?.matchedClaimIds ?? [])

      return {
        text: item.normalizedText || item.title,
        category: (bridge.category ?? 'technical') as JDRequirement['category'],
        userCoverageStatus: 'unknown' as const, // synced below
        sourceExcerpt: item.sourceQuote,
        rowLabel: bridge.rowLabel || item.title,
        jdSignal: bridge.jdSignal || item.sourceQuote || '',
        quickDiqGrounding: bridge.quickDiqGrounding || 'No material DIQ calibration.',
        profileGrounding: bridge.profileGrounding || '',
        calibratedFitInterpretation: bridge.calibratedFitInterpretation || '',
        classification,
        gapClassification,
        bridgeAssessment: bridge.bridgeAssessment,
        bridgeConfidence: bridge.confidence,
        bridgeReasoning: bridge.reasoning,
        evidenceNeeded: bridge.evidenceNeeded,
        resumeImplication: bridge.resumeImplication,
        stage2Action: bridge.stage2Action,
        stage2Implication: bridge.stage2Implication || bridge.bridgeQuestion,
        matchedClaimIds: claimIds,
        matchedEvidenceTexts: preMatch?.matchedEvidenceTexts ?? [],
        profileEvidenceStrength: matcherStrength,
      }
    })
  }

  const required = applyBridgeResults(extract.qualifications, requiredOut.bridges, preMatchRequired)
  const niceToHave = applyBridgeResults(extract.niceToHaves, niceToHaveOut.bridges, preMatchNiceToHave)

  // Deterministic consistency audit
  const { rows: auditedRequired, violations: reqViolations } = runConsistencyAudit(required)
  const { rows: auditedNiceToHave, violations: nthViolations } = runConsistencyAudit(niceToHave)
  const violations = [...reqViolations, ...nthViolations]

  // Sync userCoverageStatus from classification — single source of truth
  const syncedRequired = auditedRequired.map(syncCoverageStatus)
  const syncedNiceToHave = auditedNiceToHave.map(syncCoverageStatus)

  const allRows = [...syncedRequired, ...syncedNiceToHave]

  // Stage 2 targeting: only ask_bridge_question rows (not retrieve_more_evidence, not suppress)
  const needsEvidenceItems = allRows
    .filter(r => r.stage2Action === 'ask_bridge_question')
    .map(r => r.evidenceNeeded || r.stage2Implication || r.text)

  // Weakly supported = partially_covered + weakly_supported (for UI display)
  const weaklySupportedRequirements = allRows
    .filter(r => r.classification === 'weakly_supported' || r.classification === 'partially_covered')
    .map(r => r.rowLabel || r.text)

  return {
    required: syncedRequired,
    niceToHave: syncedNiceToHave,
    realJobFunction: requiredOut.realJobFunction ?? '',
    needsEvidenceItems,
    weaklySupportedRequirements,
    violations,
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export interface ParsedJD {
  rawJD: RawJD
  requirementMap: JDRequirementMap
  contradictions: string[]
}

export async function parseJobDescription(
  jdText: string,
  userSkillsSummary: string,
  jdSourceType: JDSourceType = 'pasted_jd',
  calibrationBrief?: Stage1CalibrationBrief,
  evidenceIndex?: ProfileEvidenceIndexItem[]
): Promise<ParsedJD> {
  const compactExtract = await extractCompactJD(jdText)
  const index = evidenceIndex ?? []
  const bridged = await bridgeRequirements(compactExtract, userSkillsSummary, index, calibrationBrief)

  function stampSource(reqs: JDRequirement[], forceGap?: GapClassification): JDRequirement[] {
    return reqs.map(r => ({
      ...r,
      sourceType: jdSourceType,
      ...(forceGap !== undefined && !r.gapClassification ? { gapClassification: forceGap } : {}),
    }))
  }

  const requirementMap: JDRequirementMap = {
    required: stampSource(bridged.required),
    niceToHave: stampSource(bridged.niceToHave, 'not_required'),
    realJobFunction: bridged.realJobFunction,
    needsEvidenceItems: bridged.needsEvidenceItems ?? [],
    // Back-fill deprecated field so existing consumers don't break
    unsupportedRequirements: bridged.needsEvidenceItems ?? [],
    weaklySupportedRequirements: bridged.weaklySupportedRequirements ?? [],
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

  return { rawJD, requirementMap, contradictions: bridged.violations }
}
