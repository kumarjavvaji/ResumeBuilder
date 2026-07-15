import { anthropic, MODEL } from './client'
import { nanoid } from '@/lib/storage/nanoid'
import type { CalibrationCandidate, CalibrationDiagnostic, CalibrationMatchType } from '@/contracts'

export type DiscoveryType = 'target' | 'comparable'

export interface DiscoveryOpts {
  sessionId: string
  targetCompany: string
  roleTitle: string
  jdSummary?: string
  jdText?: string
  type: DiscoveryType
  signal?: AbortSignal
}

export interface DiscoveryResult {
  candidates: CalibrationCandidate[]
  diagnostics: CalibrationDiagnostic[]
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

const SUBMIT_TOOL = {
  name: 'submit_discovery_candidates',
  description: 'Submit discovered calibration sources. Call once you have gathered up to 5 — stop searching after that.',
  input_schema: {
    type: 'object' as const,
    required: ['candidates', 'diagnostics'],
    properties: {
      candidates: {
        type: 'array',
        description: 'Up to 5 sources. Include ONLY sources with genuine JD alignment. Return fewer if fewer qualify.',
        items: {
          type: 'object',
          required: ['title', 'company', 'discoverySnippet', 'roughMatchReason', 'candidateMatchType', 'initialConfidence', 'sourceKind'],
          properties: {
            title: { type: 'string', description: 'Job title, JD title, or page label.' },
            company: { type: 'string' },
            sourceUrl: { type: 'string' },
            discoverySnippet: { type: 'string', description: 'Use the search snippet exactly — do not fabricate details.' },
            roughMatchReason: { type: 'string', description: 'One sentence: which specific JD elements this source aligns with.' },
            candidateMatchType: {
              type: 'string',
              enum: ['target_company', 'competitor', 'adjacent_employer']
            },
            initialConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            sourceKind: {
              type: 'string',
              enum: ['person_profile', 'comparable_jd', 'company_page', 'competitor_jd', 'other'],
              description: 'What type of source this is.'
            }
          }
        }
      },
      diagnostics: {
        type: 'array',
        items: {
          type: 'object',
          required: ['query', 'outcome', 'message'],
          properties: {
            query: { type: 'string' },
            outcome: { type: 'string', enum: ['success', 'skipped', 'failed', 'limited'] },
            message: { type: 'string' }
          }
        }
      }
    }
  }
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(type: DiscoveryType, targetCompany: string, roleTitle: string): string {
  const scopeIntro = type === 'target'
    ? `Find up to 5 calibration sources AT ${targetCompany} for the role "${roleTitle}".`
    : `Find up to 5 calibration sources at COMPETITORS or ADJACENT companies (not ${targetCompany}) for the role "${roleTitle}".`

  return `You are a calibration reference discovery agent for job application strategy.

${scopeIntro}

PRIMARY RULE — a source is useful ONLY if it helps answer:
"Would this source help us write a resume that sounds like a credible candidate for this exact JD?"

SOURCE TYPES (in priority order):
1. Same/near-peer seniority people profiles — same title family, same function, same domain
2. Comparable job descriptions from the same or a competitor company — when profiles are shallow
3. Company pages — ONLY when they explain the exact product/domain/problem space of the JD, not general about pages

PREFER sources that match MULTIPLE JD dimensions:
- Same or close title family (not just same company)
- Believable target seniority (not far above)
- Same product, domain, or problem space
- Same systems, tools, workflows, or processes named in the JD
- Language likely used by candidates hired for this role

HARD REJECTION — do NOT include sources that:
- Share only one or two keywords with the JD
- Match the company name but not the role or function
- Are director/VP/executive for an IC or manager-level role
- Are sales, account management, or customer success unless the JD is explicitly commercial
- Contain only a title with no usable responsibilities, tools, domain, or work description
- Are too generic ("digital transformation leader", "strategy executive") with no concrete role content

QUANTITY RULE:
Return FEWER than 5 if fewer than 5 sources genuinely qualify.
Do NOT fill the list with weak, senior, or loosely adjacent sources to reach 5.
A detailed comparable JD is better than 3 shallow LinkedIn snippets.

EXECUTION:
- Run 1–2 targeted searches.
- Use only the search snippets — do NOT fabricate profile details.
- If a page is gated (LinkedIn login wall), use the snippet shown in search results and mark confidence: "low".
- Call submit_discovery_candidates once you have found up to 5 qualifying candidates.
- Do not perform more than 3 web searches total.`
}

function buildUserPrompt(opts: DiscoveryOpts): string {
  const { type, targetCompany, roleTitle, jdSummary, jdText } = opts

  const lines = [
    type === 'target'
      ? `Find calibration sources at: ${targetCompany}`
      : `Find calibration sources at competitors / adjacent employers (not ${targetCompany})`,
    `Target role: ${roleTitle}`,
    '',
  ]

  // Pass full JD text if available (capped to avoid token waste), otherwise summary
  const jdContent = jdText?.trim()
    ? `Job description (use to judge alignment):\n${jdText.slice(0, 1200)}`
    : jdSummary
    ? `JD context: ${jdSummary.slice(0, 500)}`
    : ''

  if (jdContent) lines.push(jdContent, '')

  lines.push(`Search and call submit_discovery_candidates with qualifying sources.`)

  return lines.filter(l => l !== undefined).join('\n')
}

// ─── Agentic discovery loop ───────────────────────────────────────────────────

export async function runDiscovery(opts: DiscoveryOpts): Promise<DiscoveryResult> {
  const { sessionId, signal } = opts
  const now = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betaMessages = (anthropic as any).beta?.messages ?? (anthropic as any).messages
  const createFn = betaMessages.create.bind(betaMessages)

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: buildUserPrompt(opts) }
  ]

  const MAX_TURNS = 6

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) {
      return { candidates: [], diagnostics: [{ query: 'discovery', outcome: 'skipped', message: 'Aborted.' }] }
    }

    let response: {
      stop_reason: string
      content: Array<{ type: string; id?: string; name?: string; input?: unknown }>
    }

    try {
      response = await createFn({
        model: MODEL,
        max_tokens: 2048,
        betas: ['web-search-2025-03-05'],
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          SUBMIT_TOOL
        ],
        tool_choice: { type: 'auto' },
        system: buildSystemPrompt(opts.type, opts.targetCompany, opts.roleTitle),
        messages
      }, { signal })
    } catch {
      // Fall back to non-web-search call
      try {
        response = await (anthropic.messages.create as Function)({
          model: MODEL,
          max_tokens: 2048,
          tools: [SUBMIT_TOOL],
          tool_choice: { type: 'auto' },
          system: buildSystemPrompt(opts.type, opts.targetCompany, opts.roleTitle),
          messages
        }, { signal })
      } catch (innerErr) {
        const msg = innerErr instanceof Error ? innerErr.message : 'Discovery failed.'
        return { candidates: [], diagnostics: [{ query: 'search', outcome: 'failed', message: msg }] }
      }
    }

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')

      const submitBlock = toolUseBlocks.find(b => b.name === 'submit_discovery_candidates')
      if (submitBlock) {
        return parseSubmitResult(submitBlock.input as SubmitInput, sessionId, opts.type, now)
      }

      // Web search (server-side) — acknowledge and continue
      const toolResults = toolUseBlocks.map(b => ({
        type: 'tool_result' as const,
        tool_use_id: b.id!,
        content: [] as never[]
      }))
      messages.push({ role: 'user', content: toolResults })
    }
  }

  return {
    candidates: [],
    diagnostics: [{ query: 'discovery', outcome: 'limited', message: 'Turn budget exhausted without result.' }]
  }
}

// ─── Result parser ────────────────────────────────────────────────────────────

interface RawCandidate {
  title?: string
  company?: string
  sourceUrl?: string
  discoverySnippet?: string
  roughMatchReason?: string
  candidateMatchType?: CalibrationMatchType
  initialConfidence?: 'high' | 'medium' | 'low'
  sourceKind?: string
}

interface SubmitInput {
  candidates?: RawCandidate[]
  diagnostics?: Array<{ query?: string; outcome?: string; message?: string }>
}

function parseSubmitResult(
  input: SubmitInput,
  sessionId: string,
  type: DiscoveryType,
  discoveredAt: string
): DiscoveryResult {
  const defaultMatchType: CalibrationMatchType = type === 'target' ? 'target_company' : 'adjacent_employer'

  const candidates: CalibrationCandidate[] = (input.candidates ?? [])
    .filter(r => r.title && r.company)
    .slice(0, 5)
    .map(r => ({
      id: nanoid(),
      sessionId,
      status: 'queued' as const,
      candidateMatchType: (r.candidateMatchType ?? defaultMatchType),
      title: r.title ?? '',
      company: r.company ?? '',
      sourceUrl: r.sourceUrl,
      discoverySnippet: r.discoverySnippet ?? '',
      roughMatchReason: r.roughMatchReason ?? `Discovered for ${type} calibration.`,
      initialConfidence: r.initialConfidence ?? 'medium',
      retryCount: 0,
      discoveredAt
    }))

  const diagnostics: CalibrationDiagnostic[] = (input.diagnostics ?? []).map(d => ({
    query: d.query ?? 'search',
    outcome: (['success', 'skipped', 'failed', 'limited'].includes(d.outcome ?? '') ? d.outcome : 'limited') as CalibrationDiagnostic['outcome'],
    message: d.message ?? ''
  }))

  return { candidates, diagnostics }
}
