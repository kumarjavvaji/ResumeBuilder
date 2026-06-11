import { NextRequest, NextResponse } from 'next/server'
import type { CalibrationReference } from '@/contracts'

// PUT /api/calibration — add a user-provided reference (URL or pasted text)
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessionId: string
      url?: string
      pastedText?: string
      title?: string
      company?: string
    }

    if (!body.sessionId || (!body.url && !body.pastedText)) {
      return NextResponse.json(
        { error: 'sessionId and either url or pastedText are required.' },
        { status: 400 }
      )
    }

    let snippetOrSummary = body.pastedText ?? ''
    let sourceType: CalibrationReference['sourceType'] = body.pastedText ? 'user_pasted_text' : 'user_added_url'
    let confidence: CalibrationReference['confidence'] = 'medium'
    let limitations: string | undefined

    if (body.url && !body.pastedText) {
      try {
        const res = await fetch(body.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResumeBuilder/1.0)' },
          signal: AbortSignal.timeout(8000)
        })
        if (res.ok) {
          const html = await res.text()
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 2000)
          snippetOrSummary = text
          sourceType = 'public_profile'
        } else {
          snippetOrSummary = body.title ? `${body.title} at ${body.company ?? 'unknown company'}.` : `HTTP ${res.status}.`
          confidence = 'low'
          limitations = `Page fetch returned HTTP ${res.status}.`
        }
      } catch (fetchErr) {
        snippetOrSummary = body.title ? `${body.title} at ${body.company ?? 'unknown company'}.` : 'Could not fetch URL.'
        confidence = 'low'
        limitations = `Page fetch failed: ${fetchErr instanceof Error ? fetchErr.message : 'network error'}.`
      }
    }

    const ref: CalibrationReference = {
      id: crypto.randomUUID(),
      sessionId: body.sessionId,
      sourceType,
      title: body.title ?? 'Unknown title',
      company: body.company ?? 'Unknown company',
      sourceUrl: body.url,
      snippetOrSummary,
      matchReason: 'User-added source.',
      matchType: 'adjacent_employer',
      relevanceScore: 0.5,
      confidence,
      limitations,
      collectedAt: new Date().toISOString()
    }

    return NextResponse.json({ reference: ref })
  } catch (err) {
    console.error('calibration PUT error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to add reference.' },
      { status: 500 }
    )
  }
}
