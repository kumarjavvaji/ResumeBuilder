import { anthropic, MODEL } from './client'
import { isLikelyGatedUrl, isGatedContent, resolveSourceType } from '@/lib/calibration/pipeline-logic'
import type { CalibrationCandidate, CalibrationReference, CalibrationMatchType } from '@/contracts'

const FETCH_TIMEOUT_MS = 5000
const PER_SOURCE_TIMEOUT_MS = 12000

export interface EnrichOpts {
  candidate: CalibrationCandidate
  targetCompany: string
  roleTitle: string
  jdText?: string
  signal?: AbortSignal
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

const CLASSIFY_TOOL = {
  name: 'classify_reference',
  description: 'Classify and enrich the calibration reference against the target JD.',
  input_schema: {
    type: 'object' as const,
    required: ['matchReason', 'matchType', 'confidence', 'calibrationGroup', 'sourceDepth', 'useFor', 'doNotUseFor', 'jdAlignmentElements'],
    properties: {
      matchReason: {
        type: 'string',
        description: 'One sentence: why this reference relates to the target role/company.'
      },
      matchType: {
        type: 'string',
        enum: ['target_company', 'competitor', 'adjacent_employer']
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Confidence in the match based on available snippet depth.'
      },
      calibrationGroup: {
        type: 'string',
        enum: ['primary', 'supporting', 'context_only', 'rejected'],
        description: `How useful this source is for calibrating the resume against the target JD:
- primary: Directly useful for resume voice, role-level wording, keyword emphasis. Strong multi-dimensional JD alignment.
- supporting: Useful for domain vocabulary, workflow framing, or market keyword context. Use with caution.
- context_only: Useful only for company/product/domain understanding. Must NOT shape candidate seniority or specific skill claims.
- rejected: Weak match. Shared only 1-2 keywords, wrong seniority, wrong function, too generic, or content too thin.`
      },
      sourceDepth: {
        type: 'string',
        enum: ['rich', 'moderate', 'shallow'],
        description: 'Depth of available content. rich = detailed responsibilities/full JD; moderate = partial description with some context; shallow = title only or generic snippet.'
      },
      useFor: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete calibration uses. Examples: "resume voice for BA/PO analyst roles", "keyword calibration for Agile delivery framing", "domain vocabulary for insurance tech". Max 3 items.'
      },
      doNotUseFor: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit exclusions to prevent overclaiming. Examples: "do not use to claim MDM or data governance experience", "do not use to assert executive stakeholder ownership". Max 3 items.'
      },
      jdAlignmentElements: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific JD requirements or elements this source helps calibrate. Examples: "sprint delivery language", "requirements documentation style", "cross-functional alignment framing".'
      },
      riskNote: {
        type: 'string',
        description: 'Optional: seniority mismatch, overclaim risk, or source shallowness risk. Leave empty if none.'
      },
      rejectedReason: {
        type: 'string',
        description: 'Required if calibrationGroup is "rejected": specific reason why this source is not useful.'
      },
      limitations: {
        type: 'string',
        description: 'Access or content limitations (e.g. gated profile, snippet only).'
      },
      personName: {
        type: 'string',
        description: 'Person name if identifiable from the snippet.'
      }
    }
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(targetCompany: string, roleTitle: string): string {
  return `You classify a calibration reference candidate against a specific target job description.

CALIBRATION GROUPS:
- primary: Directly useful for resume voice, role-level wording, and keyword emphasis. Strong multi-dimensional JD alignment — same or close title family, believable seniority, same domain/tools/workflows.
- supporting: Useful for domain vocabulary, systems context, or market framing. Some JD alignment but not across enough dimensions for primary use.
- context_only: Useful only for company/product/domain understanding. Do NOT let these shape candidate seniority, title framing, or specific skill claims.
- rejected: Weak match. Use when source shares only 1–2 keywords, matches company but not function, is far above target seniority, is a sales/account role for a non-commercial JD, or has content too thin to calibrate from.

HARD REJECTION CRITERIA (apply any one → reject):
- Shares only one or two keywords with the JD
- Matches the company but not the role or function
- Director/VP/executive level for an IC or manager-level target role
- Sales, account management, or customer success unless the JD is explicitly commercial
- Title only with no usable responsibilities, tools, domain, or work description
- Executive "transformation" / "strategy" profile with no concrete deliverables matching the JD
- Content too thin to shape resume language without overclaiming

SOURCE DEPTH:
- rich: Detailed responsibilities, tools, domain context, or full comparable JD text
- moderate: Some useful content — partial descriptions, some domain/tool mentions
- shallow: Title + company only, or generic public snippet with no concrete content

USE / DO NOT USE:
Specify concrete, actionable uses and explicit exclusions. The exclusions are as important as the uses — they prevent the candidate from borrowing calibration language as personal evidence.

Target company: ${targetCompany}
Target role: ${roleTitle}`
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
  const { candidate, targetCompany, roleTitle, jdText, signal } = opts
  const now = new Date().toISOString()

  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), PER_SOURCE_TIMEOUT_MS)

  try {
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

    const userContent = [
      `Target company: ${targetCompany}`,
      `Target role: ${roleTitle}`,
      jdText ? `\nTarget JD (use to judge alignment):\n${jdText.slice(0, 1000)}` : '',
      ``,
      `Candidate source:`,
      `Title: ${candidate.title}`,
      `Company: ${candidate.company}`,
      candidate.sourceUrl ? `URL: ${candidate.sourceUrl}` : '',
      `Snippet: ${snippet.slice(0, 1000)}`,
      `Initial match type: ${candidate.candidateMatchType}`,
      ``,
      `Classify this calibration reference. Assign calibrationGroup based on genuine JD alignment, not prestige or company name alone.`
    ].filter(Boolean).join('\n')

    const response = await (anthropic.messages.create as Function)({
      model: MODEL,
      max_tokens: 768,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: 'classify_reference' },
      system: buildSystemPrompt(targetCompany, roleTitle),
      messages: [{ role: 'user', content: userContent }]
    }, { signal: timeoutController.signal })

    clearTimeout(timeout)

    const toolUse = response.content.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) throw new Error('No classify_reference tool use in response.')

    const raw = toolUse.input as {
      matchReason?: string
      matchType?: CalibrationMatchType
      confidence?: 'high' | 'medium' | 'low'
      calibrationGroup?: CalibrationReference['calibrationGroup']
      sourceDepth?: CalibrationReference['sourceDepth']
      useFor?: string[]
      doNotUseFor?: string[]
      jdAlignmentElements?: string[]
      riskNote?: string
      rejectedReason?: string
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
      relevanceScore: typeof raw.calibrationGroup === 'string'
        ? { primary: 0.9, supporting: 0.65, context_only: 0.4, rejected: 0.1 }[raw.calibrationGroup] ?? 0.5
        : (gated ? 0.35 : 0.6),
      confidence: raw.confidence ?? (gated ? 'low' : candidate.initialConfidence),
      limitations: raw.limitations ?? limitations,
      collectedAt: now,
      calibrationGroup: raw.calibrationGroup,
      sourceDepth: raw.sourceDepth ?? (gated ? 'shallow' : undefined),
      useFor: raw.useFor?.slice(0, 3),
      doNotUseFor: raw.doNotUseFor?.slice(0, 3),
      jdAlignmentElements: raw.jdAlignmentElements,
      riskNote: raw.riskNote || undefined,
      rejectedReason: raw.rejectedReason || undefined,
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
