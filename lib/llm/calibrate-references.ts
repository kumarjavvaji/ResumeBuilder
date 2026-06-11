import { anthropic, MODEL } from './client'
import { nanoid } from '@/lib/storage/nanoid'
import type {
  CalibrationReference,
  CalibrationSummary,
  CalibrationDiagnostic,
  CalibrationMatchType,
  CalibrationSourceType
} from '@/contracts'

export interface CalibrationSearchOpts {
  sessionId: string
  targetCompany: string
  roleTitle: string
  roleFunction?: string
  industry?: string
  jdSummary?: string
}

export interface CalibrationSearchResult {
  references: CalibrationReference[]
  summary?: CalibrationSummary
  diagnostics: CalibrationDiagnostic[]
  partial: boolean
}

// ─── Tool schema for structured output ───────────────────────────────────────

const COLLECT_TOOL = {
  name: 'collect_calibration_references',
  description: 'Store the calibration references and market analysis derived from search results. Call this once you have gathered sufficient calibration data.',
  input_schema: {
    type: 'object' as const,
    required: ['references', 'summary', 'diagnostics'],
    properties: {
      references: {
        type: 'array',
        description: 'Up to 10 calibration references: 3–5 target-company, 3–5 competitor/adjacent.',
        items: {
          type: 'object',
          required: ['title', 'company', 'snippetOrSummary', 'matchReason', 'matchType', 'relevanceScore', 'confidence', 'sourceType'],
          properties: {
            personName: { type: 'string' },
            title: { type: 'string', description: 'Job title or role label.' },
            company: { type: 'string' },
            sourceUrl: { type: 'string' },
            snippetOrSummary: { type: 'string', description: 'Raw snippet or summary of what was found.' },
            matchReason: { type: 'string', description: 'One sentence explaining why this reference was chosen.' },
            matchType: { type: 'string', enum: ['target_company', 'competitor', 'adjacent_employer'] },
            relevanceScore: { type: 'number', description: '0–1 relevance to target role/company.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            limitations: { type: 'string', description: 'What could not be fully accessed (e.g. gated profile).' },
            sourceType: {
              type: 'string',
              enum: ['search_result', 'public_profile', 'company_page', 'professional_bio', 'user_added_url', 'user_pasted_text']
            }
          }
        }
      },
      summary: {
        type: 'object',
        required: ['targetCompanyPatterns', 'competitorPatterns', 'repeatedTitles', 'repeatedSkillsTools', 'domainExpectations', 'credibilityBoundaries', 'artifactGuidance', 'outreachGuidance', 'gapsToHandleCarefully', 'calibrationPatterns'],
        properties: {
          targetCompanyPatterns: { type: 'array', items: { type: 'string' }, description: 'Patterns observed across target-company references.' },
          competitorPatterns: { type: 'array', items: { type: 'string' }, description: 'Patterns observed across competitor/adjacent references.' },
          repeatedTitles: { type: 'array', items: { type: 'string' } },
          repeatedSkillsTools: { type: 'array', items: { type: 'string' } },
          domainExpectations: { type: 'array', items: { type: 'string' } },
          credibilityBoundaries: { type: 'array', items: { type: 'string' }, description: 'Skill or domain areas where market expects demonstrated experience.' },
          artifactGuidance: { type: 'array', items: { type: 'string' }, description: 'How to tune resume/cover letter based on market patterns.' },
          outreachGuidance: { type: 'array', items: { type: 'string' }, description: 'How to frame outreach based on calibration patterns.' },
          gapsToHandleCarefully: { type: 'array', items: { type: 'string' }, description: 'Areas where the market expects depth that the JD may not fully reveal.' },
          calibrationPatterns: { type: 'array', items: { type: 'string' }, description: 'Key cross-cutting patterns for artifact generation.' }
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

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a market calibration agent. Your task is to gather calibration references for a job application by searching the web for:

1. Employees at the TARGET COMPANY who hold roles similar to or adjacent to the target role.
2. Employees at COMPETITOR or ADJACENT employers with similar role/function patterns.

PURPOSE: These references calibrate artifact strategy against real market patterns. They are NOT evidence for the applicant's claims. You must never suggest that the applicant has skills they have not demonstrated.

SEARCH STRATEGY:
- Target company: 3–5 references. Search for employees with similar role title/function, relevant departments, and potentially recruiting/hiring-adjacent roles.
- Competitors/adjacent: 3–5 references. Search for comparable roles at similar employers in the same industry.

SEARCH CONSTRAINTS:
- Use only public sources: search results, public profile pages, company pages, professional bios, job postings.
- Do NOT scrape or parse login-gated content. If a LinkedIn page is gated, use only the snippet shown in the search result.
- Mark any gated or inaccessible source with confidence: 'low' and note it in limitations.
- Cap searches: max 5 target-company searches, max 5 competitor searches, max 12 candidate URLs reviewed.
- If a search returns no useful results, record it as a diagnostic and move on.
- Do not fail if a source is unavailable. Partial results are acceptable.

OUTPUT:
- Call collect_calibration_references when you have sufficient data (or when you have hit the search budget).
- Always call collect_calibration_references — do not end without calling it.
- Include diagnostics for each search query you attempted.
- The summary must separate market patterns from user evidence claims.`

// ─── User prompt ──────────────────────────────────────────────────────────────

function buildUserPrompt(opts: CalibrationSearchOpts): string {
  const lines = [
    `Gather calibration references for this job application:`,
    ``,
    `Target company: ${opts.targetCompany}`,
    `Target role: ${opts.roleTitle}`,
  ]
  if (opts.roleFunction) lines.push(`Role function: ${opts.roleFunction}`)
  if (opts.industry) lines.push(`Industry: ${opts.industry}`)
  if (opts.jdSummary) {
    lines.push(``, `JD summary (for search context only):`, opts.jdSummary)
  }
  lines.push(
    ``,
    `Search for:`,
    `1. Employees at ${opts.targetCompany} in roles similar to "${opts.roleTitle}" or adjacent (business systems, implementation, recruiting, or hiring-adjacent).`,
    `2. Employees at competitor or adjacent employers in similar roles.`,
    ``,
    `When done (or at search budget), call collect_calibration_references with all references and market analysis.`
  )
  return lines.join('\n')
}

// ─── Result parser ────────────────────────────────────────────────────────────

interface RawRef {
  personName?: string
  title: string
  company: string
  sourceUrl?: string
  snippetOrSummary: string
  matchReason: string
  matchType: CalibrationMatchType
  relevanceScore: number
  confidence: 'high' | 'medium' | 'low'
  limitations?: string
  sourceType: CalibrationSourceType
}

interface RawSummary {
  targetCompanyPatterns: string[]
  competitorPatterns: string[]
  repeatedTitles: string[]
  repeatedSkillsTools: string[]
  domainExpectations: string[]
  credibilityBoundaries: string[]
  artifactGuidance: string[]
  outreachGuidance: string[]
  gapsToHandleCarefully: string[]
  calibrationPatterns: string[]
}

interface CollectInput {
  references: RawRef[]
  summary: RawSummary
  diagnostics: Array<{ query: string; outcome: string; message: string }>
}

function parseCollectResult(input: CollectInput, sessionId: string): CalibrationSearchResult {
  const now = new Date().toISOString()

  const references: CalibrationReference[] = (input.references ?? []).map(r => ({
    id: nanoid(),
    sessionId,
    sourceType: r.sourceType ?? 'search_result',
    personName: r.personName,
    title: r.title ?? '',
    company: r.company ?? '',
    sourceUrl: r.sourceUrl,
    snippetOrSummary: r.snippetOrSummary ?? '',
    matchReason: r.matchReason ?? '',
    matchType: r.matchType ?? 'adjacent_employer',
    relevanceScore: typeof r.relevanceScore === 'number' ? r.relevanceScore : 0.5,
    confidence: r.confidence ?? 'medium',
    limitations: r.limitations,
    collectedAt: now
  }))

  const raw = input.summary ?? {}
  const summary: CalibrationSummary = {
    targetCompanyPatterns: raw.targetCompanyPatterns ?? [],
    competitorPatterns: raw.competitorPatterns ?? [],
    repeatedTitles: raw.repeatedTitles ?? [],
    repeatedSkillsTools: raw.repeatedSkillsTools ?? [],
    domainExpectations: raw.domainExpectations ?? [],
    credibilityBoundaries: raw.credibilityBoundaries ?? [],
    artifactGuidance: raw.artifactGuidance ?? [],
    outreachGuidance: raw.outreachGuidance ?? [],
    gapsToHandleCarefully: raw.gapsToHandleCarefully ?? [],
    calibrationUsed: references.length > 0,
    calibrationPatterns: raw.calibrationPatterns ?? [],
    generatedAt: now
  }

  const diagnostics: CalibrationDiagnostic[] = (input.diagnostics ?? []).map(d => ({
    query: d.query ?? '',
    outcome: (['success', 'skipped', 'failed', 'limited'].includes(d.outcome) ? d.outcome : 'limited') as CalibrationDiagnostic['outcome'],
    message: d.message ?? ''
  }))

  return { references, summary, diagnostics, partial: false }
}

// ─── Agentic search loop ──────────────────────────────────────────────────────

export async function runCalibrationSearch(
  opts: CalibrationSearchOpts
): Promise<CalibrationSearchResult> {
  const userPrompt = buildUserPrompt(opts)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betaMessages = (anthropic as any).beta?.messages ?? (anthropic as any).messages
  const createFn = betaMessages.create.bind(betaMessages)

  type MsgParam = { role: 'user' | 'assistant'; content: unknown }
  const messages: MsgParam[] = [{ role: 'user', content: userPrompt }]

  const MAX_TURNS = 8

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response: {
      stop_reason: string
      content: Array<{ type: string; id?: string; name?: string; input?: unknown }>
    }

    try {
      response = await createFn({
        model: MODEL,
        max_tokens: 8192,
        betas: ['web-search-2025-03-05'],
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          COLLECT_TOOL
        ],
        tool_choice: { type: 'auto' },
        system: SYSTEM_PROMPT,
        messages
      })
    } catch (err) {
      // Beta or web search not available — attempt without web search
      try {
        response = await (anthropic.messages.create as Function)({
          model: MODEL,
          max_tokens: 8192,
          tools: [COLLECT_TOOL],
          tool_choice: { type: 'auto' },
          system: SYSTEM_PROMPT,
          messages
        })
      } catch {
        return {
          references: [],
          summary: undefined,
          diagnostics: [{
            query: 'initialization',
            outcome: 'failed',
            message: err instanceof Error ? err.message : 'Calibration search unavailable.'
          }],
          partial: true
        }
      }
    }

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')

      // Our collect tool was called — parse and return
      const collectBlock = toolUseBlocks.find(b => b.name === 'collect_calibration_references')
      if (collectBlock) {
        try {
          return parseCollectResult(collectBlock.input as CollectInput, opts.sessionId)
        } catch {
          return {
            references: [],
            summary: undefined,
            diagnostics: [{
              query: 'parse',
              outcome: 'failed',
              message: 'Failed to parse calibration result structure.'
            }],
            partial: true
          }
        }
      }

      // Web search or other server-side tool — acknowledge and continue
      const toolResults = toolUseBlocks.map(b => ({
        type: 'tool_result' as const,
        tool_use_id: b.id!,
        content: [] as never[]
      }))
      messages.push({ role: 'user', content: toolResults })
    }
  }

  // Exhausted turns without a collect call
  return {
    references: [],
    summary: undefined,
    diagnostics: [{
      query: 'search',
      outcome: 'limited',
      message: 'Search budget exhausted. Use the refresh button to try again or add sources manually.'
    }],
    partial: true
  }
}
