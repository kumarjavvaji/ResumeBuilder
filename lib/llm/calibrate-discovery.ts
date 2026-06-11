import { anthropic, MODEL } from './client'
import { nanoid } from '@/lib/storage/nanoid'
import type { CalibrationCandidate, CalibrationDiagnostic, CalibrationMatchType } from '@/contracts'

export type DiscoveryType = 'target' | 'comparable'

export interface DiscoveryOpts {
  sessionId: string
  targetCompany: string
  roleTitle: string
  jdSummary?: string
  type: DiscoveryType
  signal?: AbortSignal
}

export interface DiscoveryResult {
  candidates: CalibrationCandidate[]
  diagnostics: CalibrationDiagnostic[]
}

// ─── Structured output tool ───────────────────────────────────────────────────

const SUBMIT_TOOL = {
  name: 'submit_discovery_candidates',
  description: 'Submit the discovered candidates. Call this immediately once you have found up to 5 candidates — do not wait for more searches.',
  input_schema: {
    type: 'object' as const,
    required: ['candidates', 'diagnostics'],
    properties: {
      candidates: {
        type: 'array',
        description: 'Up to 5 candidates found.',
        items: {
          type: 'object',
          required: ['title', 'company', 'discoverySnippet', 'roughMatchReason', 'candidateMatchType', 'initialConfidence'],
          properties: {
            title: { type: 'string' },
            company: { type: 'string' },
            sourceUrl: { type: 'string' },
            discoverySnippet: { type: 'string', description: 'Use the search snippet exactly — do not fabricate.' },
            roughMatchReason: { type: 'string', description: 'One sentence: why this person/profile is relevant.' },
            candidateMatchType: {
              type: 'string',
              enum: ['target_company', 'competitor', 'adjacent_employer']
            },
            initialConfidence: { type: 'string', enum: ['high', 'medium', 'low'] }
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
  const intro = type === 'target'
    ? `Find up to 5 people currently working at ${targetCompany} whose role is similar to or adjacent to "${roleTitle}". Include implementation, systems, business analysis, recruiting, or hiring-adjacent roles.`
    : `Find up to 5 people at companies that are competitors or adjacent employers to ${targetCompany} who have roles similar to "${roleTitle}". Look at insurtech, healthtech, or other relevant employers in the same industry.`

  return `You are a calibration reference discovery agent.

${intro}

RULES:
- Run 1–2 targeted searches.
- Use only the search snippets. Do NOT fabricate profile details.
- If a page is gated (LinkedIn login wall), use the snippet shown in search results and mark confidence: "low".
- Call submit_discovery_candidates as soon as you have found up to 5 candidates — stop searching after that.
- If searches return nothing useful, call submit_discovery_candidates with empty candidates and a diagnostic.
- Do not perform more than 3 web searches total.`
}

function buildUserPrompt(opts: DiscoveryOpts): string {
  const { type, targetCompany, roleTitle, jdSummary } = opts
  const lines = [
    type === 'target'
      ? `Discover calibration references at: ${targetCompany}`
      : `Discover calibration references at competitors / adjacent employers (not ${targetCompany})`,
    `Target role: ${roleTitle}`,
    jdSummary ? `Context: ${jdSummary.slice(0, 300)}` : '',
    '',
    `Search and call submit_discovery_candidates when done.`
  ].filter(Boolean)
  return lines.join('\n')
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
    } catch (err) {
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

      // Our submit tool was called
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
