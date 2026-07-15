import { anthropic, MODEL } from './client'
import type { CalibrationReference, CalibrationSummary } from '@/contracts'

export interface SynthesizeOpts {
  refs: CalibrationReference[]
  targetCompany: string
  roleTitle: string
  signal?: AbortSignal
}

const SYNTHESIZE_TOOL = {
  name: 'produce_calibration_summary',
  description: 'Produce a calibration summary from the provided references. No web search — analyze only what is provided.',
  input_schema: {
    type: 'object' as const,
    required: [
      'targetCompanyPatterns', 'competitorPatterns', 'repeatedTitles',
      'repeatedSkillsTools', 'domainExpectations', 'credibilityBoundaries',
      'artifactGuidance', 'outreachGuidance', 'gapsToHandleCarefully', 'calibrationPatterns'
    ],
    properties: {
      targetCompanyPatterns: { type: 'array', items: { type: 'string' } },
      competitorPatterns: { type: 'array', items: { type: 'string' } },
      repeatedTitles: { type: 'array', items: { type: 'string' } },
      repeatedSkillsTools: { type: 'array', items: { type: 'string' } },
      domainExpectations: { type: 'array', items: { type: 'string' } },
      credibilityBoundaries: { type: 'array', items: { type: 'string' } },
      artifactGuidance: { type: 'array', items: { type: 'string' }, description: 'How to tune resume/cover letter language based on these patterns.' },
      outreachGuidance: { type: 'array', items: { type: 'string' } },
      gapsToHandleCarefully: { type: 'array', items: { type: 'string' } },
      calibrationPatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short normalized thematic labels (2–4 words each) suitable for compact artifact-card provenance display. Examples: "Systems Integration", "Requirements Elicitation", "Insurance Domain Literacy", "Agile Delivery", "Stakeholder Translation", "Workflow Analysis", "Platform Operations". MUST NOT contain person names, company names, URLs, or full match-reason sentences. Each label must stand alone as a market theme category.'
      }
    }
  }
}

const SYSTEM_PROMPT = `You produce calibration summaries for job applications.

You will receive a list of calibration references (real profiles/snippets found online).
Analyze patterns across them to produce market guidance for artifact strategy.

STRICT RULE: This summary is strategy context only. It must NOT assert that the applicant has any skill or experience. It describes what the market looks like, not what the applicant has done.

PATTERN LABELS RULE: calibrationPatterns must be short normalized thematic labels (2–4 words). They appear verbatim in compact UI provenance lines. Do NOT use person names, company names, URLs, or sentences from matchReason. Derive categories from repeated themes across the references, not from individual reference text.

Do NOT perform web searches. Analyze only the provided references.`

export async function synthesizeCalibration(opts: SynthesizeOpts): Promise<CalibrationSummary> {
  const { refs, targetCompany, roleTitle, signal } = opts
  const now = new Date().toISOString()

  if (refs.length === 0) {
    return emptyCalibrationSummary(now)
  }

  // Only synthesize from active refs — rejected refs must not influence the summary
  const activeRefs = refs.filter(r => r.calibrationGroup !== 'rejected')
  if (activeRefs.length === 0) return emptyCalibrationSummary(now)

  const refLines = activeRefs.map((r, i) => {
    const groupLabel = r.calibrationGroup ? ` [${r.calibrationGroup}]` : ''
    const depthLabel = r.sourceDepth ? ` depth:${r.sourceDepth}` : ''
    const snippet = r.manualContext
      ? `${r.snippetOrSummary.slice(0, 200)}\n  [Manual context]: ${r.manualContext.slice(0, 400)}`
      : r.snippetOrSummary.slice(0, 400)
    return [
      `[${i + 1}] ${r.title} at ${r.company} (${r.matchType}${groupLabel}${depthLabel})`,
      `  Match reason: ${r.matchReason}`,
      r.jdAlignmentElements?.length ? `  Aligns with JD: ${r.jdAlignmentElements.join(', ')}` : '',
      `  Snippet: ${snippet}`,
      r.useFor?.length ? `  Use for: ${r.useFor.join('; ')}` : '',
      r.limitations ? `  Limitations: ${r.limitations}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const userContent = [
    `Target company: ${targetCompany}`,
    `Target role: ${roleTitle}`,
    ``,
    `Calibration references (${refs.length} total):`,
    refLines,
    ``,
    `Produce the calibration summary for these references.`
  ].join('\n')

  try {
    const response = await (anthropic.messages.create as Function)({
      model: MODEL,
      max_tokens: 2048,
      tools: [SYNTHESIZE_TOOL],
      tool_choice: { type: 'tool', name: 'produce_calibration_summary' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    }, { signal })

    const toolUse = response.content.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) throw new Error('No tool use in synthesis response.')

    const raw = toolUse.input as Partial<CalibrationSummary>

    return {
      targetCompanyPatterns: raw.targetCompanyPatterns ?? [],
      competitorPatterns: raw.competitorPatterns ?? [],
      repeatedTitles: raw.repeatedTitles ?? [],
      repeatedSkillsTools: raw.repeatedSkillsTools ?? [],
      domainExpectations: raw.domainExpectations ?? [],
      credibilityBoundaries: raw.credibilityBoundaries ?? [],
      artifactGuidance: raw.artifactGuidance ?? [],
      outreachGuidance: raw.outreachGuidance ?? [],
      gapsToHandleCarefully: raw.gapsToHandleCarefully ?? [],
      calibrationUsed: true,
      calibrationPatterns: raw.calibrationPatterns ?? [],
      generatedAt: now
    }
  } catch {
    return emptyCalibrationSummary(now)
  }
}

function emptyCalibrationSummary(generatedAt: string): CalibrationSummary {
  return {
    targetCompanyPatterns: [],
    competitorPatterns: [],
    repeatedTitles: [],
    repeatedSkillsTools: [],
    domainExpectations: [],
    credibilityBoundaries: [],
    artifactGuidance: [],
    outreachGuidance: [],
    gapsToHandleCarefully: [],
    calibrationUsed: false,
    calibrationPatterns: [],
    generatedAt
  }
}
