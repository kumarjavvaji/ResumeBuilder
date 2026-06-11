import { NextRequest, NextResponse } from 'next/server'
import { parseResumeText, parseResumePDF } from '@/lib/llm/parse-resume'
import mammoth from 'mammoth'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx', 'doc'].includes(ext ?? '')) {
      return NextResponse.json(
        { error: 'Unsupported file type. Upload a PDF or DOCX.' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    let profile: Awaited<ReturnType<typeof parseResumeText>>

    if (ext === 'pdf') {
      profile = await parseResumePDF(buffer)
    } else {
      // DOCX/DOC — convert to markdown to preserve headings, bullets, and dates.
      // extractRawText strips structure, making Claude unable to parse field values.
      let text = ''
      // convertToHtml preserves document structure (headings, bullets, tables).
      // We then strip HTML tags while keeping structure visible as plain text,
      // which gives Claude enough context to parse section boundaries and field values.
      const html = await mammoth.convertToHtml({ buffer })
      text = htmlToStructuredText(html.value).trim()
      if (!text) {
        return NextResponse.json({ error: 'Could not extract text from the document.' }, { status: 400 })
      }
      profile = await parseResumeText(text)
    }

    return NextResponse.json({ profile })
  } catch (err) {
    console.error('parse-resume route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Parse failed.' },
      { status: 500 }
    )
  }
}

// Converts mammoth HTML output to structured plain text Claude can parse.
// Preserves headings (as UPPERCASE labels), bullets, and line breaks.
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
