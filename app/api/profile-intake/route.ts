import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import mammoth from 'mammoth'
import { anthropic, MODEL } from '@/lib/llm/client'
import { extractProfileSignals } from '@/lib/profile/resumeProfileExtractor'
import type { ExtractedProfileSignals } from '@/lib/profile/resumeProfileExtractor'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx', 'doc', 'txt'].includes(ext ?? '')) {
      return NextResponse.json(
        { error: 'Unsupported file type. Upload a PDF, DOCX, or TXT.' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const contentHash = createHash('sha256').update(buffer).digest('hex')

    const warnings: string[] = []
    let signals: ExtractedProfileSignals

    if (ext === 'pdf') {
      signals = await extractFromPdf(buffer, warnings)
    } else if (ext === 'txt') {
      const text = buffer.toString('utf-8').trim()
      if (!text) {
        return NextResponse.json(
          { error: 'Text file appears to be empty.' },
          { status: 400 }
        )
      }
      signals = await extractProfileSignals(text)
    } else {
      const text = await extractDocxText(buffer, warnings)
      if (!text) {
        return NextResponse.json(
          { error: 'Could not extract text from the document.' },
          { status: 400 }
        )
      }
      signals = await extractProfileSignals(text)
    }

    return NextResponse.json({
      claims: signals.claims,
      skills: signals.skills,
      roles: signals.roles,
      metrics: signals.metrics,
      tools: signals.tools,
      domains: signals.domains,
      contentHash,
      filename: file.name,
      warnings,
    })
  } catch (err) {
    console.error('profile-intake route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Profile intake failed.' },
      { status: 500 }
    )
  }
}

async function extractDocxText(buffer: Buffer, warnings: string[]): Promise<string> {
  const html = await mammoth.convertToHtml({ buffer })
  if (html.messages?.length) {
    const msgs = html.messages.filter(m => m.type === 'warning').map(m => m.message)
    warnings.push(...msgs.slice(0, 3))
  }
  return htmlToStructuredText(html.value).trim()
}

async function extractFromPdf(
  buffer: Buffer,
  warnings: string[]
): Promise<ExtractedProfileSignals> {
  const base64 = buffer.toString('base64')

  // Use Anthropic Vision to extract text from PDF, then extract signals
  const textResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'Extract the full text content of this resume PDF, preserving section headings, bullet points, dates, and job titles as plain text. Output only the extracted text.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          } as never,
          { type: 'text', text: 'Extract all text from this resume.' },
        ],
      },
    ],
  })

  const textBlock = textResponse.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text' || !textBlock.text?.trim()) {
    warnings.push('PDF text extraction produced an empty result. Some content may be missing.')
    return emptySignals()
  }

  return extractProfileSignals(textBlock.text)
}

function emptySignals(): ExtractedProfileSignals {
  return {
    claims: [],
    skills: [],
    roles: [],
    metrics: [],
    tools: [],
    domains: [],
    possibleConflicts: [],
  }
}

function htmlToStructuredText(html: string): string {
  return html
    .replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi, '\n\n$1\n')
    .replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, '\n$1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '$1')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
