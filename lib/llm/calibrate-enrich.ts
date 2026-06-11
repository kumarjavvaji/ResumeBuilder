import { anthropic, MODEL } from './client'
import { isLikelyGatedUrl, isGatedContent, resolveSourceType } from '@/lib/calibration/pipeline-logic'
import type { CalibrationCandidate, CalibrationReference, CalibrationMatchType } from '@/contracts'

const FETCH_TIMEOUT_MS = 5000
const PER_SOURCE_TIMEOUT_MS = 12000

export interface EnrichOpts {
  candidate: CalibrationCandidate
  targetCompany: string
  roleTitle: string
  signal?: AbortSignal
}

const CLASSIFY_TOOL = {
  name: 'classify_reference',
  description: 'Classify and enrich the calibration reference candidate.',
  input_schema: {
    type: 'object' as const,
    required: ['matchReason', 'matchType', 'confidence', 'relevanceScore'],
    properties: {
      matchReason: { type: 'string', description: 'One sentence: why this reference is relevant to the target role/company.' },
      matchType: { type: 'string', enum: ['target_company', 'competitor', 'adjacent_employer'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      relevanceScore: { type: 'number', description: '0–1 float.' },
      limitations: { type: 'string', description: 'Anything restricting what can be learned from this source.' },
      personName: { type: 'string', description: 'Person name if identifiable from the snippet.' }
    }
  }
}

// ─── Optional URL fetch ───────────────────────────────────────────────────────

async function tryFetchSnippet(url: string, signal?: AbortSignal): Promise<string | null> {
  if (isLikelyGatedUrl(url)) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const combinedSignal = signal
    ? AbortSignal.any ? AbortSignal.any([signal, controller.signal]) : controller.signal
    : controller.signal

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResumeBuilder/1.0)' },
      signal: combinedSignal
    })
    clearTimeout(timeout)
    if (!res.ok) return null

    const html = await res.text()
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500)

    if (isGatedContent(text)) return null
    return text
  } catch {
    clearTimeout(timeout)
    return null
  }
}

// ─── Enrichment LLM call ──────────────────────────────────────────────────────

export async function enrichCandidate(opts: EnrichOpts): Promise<CalibrationCandidate> {
  const { candidate, targetCompany, roleTitle, signal } = opts
  const now = new Date().toISOString()

  // Per-source hard timeout
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), PER_SOURCE_TIMEOUT_MS)

  try {
    // Step 1: Try to get richer snippet from URL (optional)
    let snippet = candidate.discoverySnippet
    let limitations = candidate.limitationsNote
    let gated = false

    if (candidate.sourceUrl) {
      if (isLikelyGatedUrl(candidate.sourceUrl)) {
        gated = true
        limitations = 'Source page appears gated; public snippet used only.'
      } else {
        const fetched = await tryFetchSnippet(candidate.sourceUrl, signal)
        if (fetched) snippet = fetched
      }
    }

    // Step 2: LLM classification
    const userContent = [
      `Target company: ${targetCompany}`,
      `Target role: ${roleTitle}`,
      ``,
      `Candidate:`,
      `Title: ${candidate.title}`,
      `Company: ${candidate.company}`,
      candidate.sourceUrl ? `URL: ${candidate.sourceUrl}` : '',
      `Snippet: ${snippet.slice(0, 1000)}`,
      `Initial match type: ${candidate.candidateMatchType}`,
      ``,
      `Classify this calibration reference relative to the target role and company.`
    ].filter(Boolean).join('\n')

    const response = await (anthropic.messages.create as Function)({
      model: MODEL,
      max_tokens: 512,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: 'classify_reference' },
      system: `You classify calibration reference candidates for job application strategy. Be concise.`,
      messages: [{ role: 'user', content: userContent }]
    }, { signal: timeoutController.signal })

    clearTimeout(timeout)

    const toolUse = response.content.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) throw new Error('No classify_reference tool use in response.')

    const raw = toolUse.input as {
      matchReason?: string
      matchType?: CalibrationMatchType
      confidence?: 'high' | 'medium' | 'low'
      relevanceScore?: number
      limitations?: string
      personName?: string
    }

    const enrichedRef: CalibrationReference = {
      id: candidate.id,
      sessionId: candidate.sessionId,
      sourceType: resolveSourceType(candidate.sourceUrl),
      personName: raw.personName,
      title: candidate.title,
      company: candidate.company,
      sourceUrl: candidate.sourceUrl,
      snippetOrSummary: snippet.slice(0, 800),
      matchReason: raw.matchReason ?? candidate.roughMatchReason,
      matchType: raw.matchType ?? candidate.candidateMatchType,
      relevanceScore: typeof raw.relevanceScore === 'number' ? raw.relevanceScore : (gated ? 0.35 : 0.6),
      confidence: raw.confidence ?? (gated ? 'low' : candidate.initialConfidence),
      limitations: raw.limitations ?? limitations,
      collectedAt: now
    }

    return {
      ...candidate,
      status: 'enriched',
      enrichedRef,
      limitationsNote: limitations,
      enrichedAt: now
    }
  } catch (err) {
    clearTimeout(timeout)
    return {
      ...candidate,
      status: 'failed',
      failureReason: err instanceof Error ? err.message : 'Enrichment failed.',
      retryCount: candidate.retryCount + 1
    }
  }
}
