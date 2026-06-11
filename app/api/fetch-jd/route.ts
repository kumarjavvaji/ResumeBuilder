import { NextRequest, NextResponse } from 'next/server'
import { validateJDContent } from '@/lib/validators/jd-content'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { url, roleTitle, company } = await req.json() as {
      url: string
      roleTitle?: string
      company?: string
    }

    if (!url?.trim()) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 })
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http/https URLs are supported.' }, { status: 400 })
    }

    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      })
    } catch (networkErr) {
      return NextResponse.json(
        {
          text: '',
          valid: false,
          reason: 'network_error',
          message: 'Could not reach the URL. Check your connection or paste the JD text directly.',
        },
        { status: 200 }
      )
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          text: '',
          valid: false,
          reason: 'http_error',
          message: `The page returned HTTP ${response.status}. Paste the job description text directly.`,
        },
        { status: 200 }
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) {
      return NextResponse.json(
        {
          text: '',
          valid: false,
          reason: 'not_html',
          message: 'The URL did not return an HTML page. Paste the job description text directly.',
        },
        { status: 200 }
      )
    }

    const html = await response.text()
    const text = extractJobText(html)

    // Validate content quality — returns 200 with valid:false so client can handle gracefully
    const validation = validateJDContent(text, { roleTitle, company })
    if (!validation.valid) {
      return NextResponse.json(
        {
          text,           // give the client the raw text even if invalid — user can review/paste manually
          valid: false,
          reason: validation.reason,
          message: validation.message,
        },
        { status: 200 }
      )
    }

    return NextResponse.json({ text, valid: true })
  } catch (err) {
    console.error('fetch-jd route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fetch failed.' },
      { status: 500 }
    )
  }
}

/**
 * Strips HTML to plain text suitable for JD validation and analysis.
 * Prefers article/main content over full page to reduce nav noise.
 */
function extractJobText(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')

  // Try to isolate main job content block
  const contentMatch =
    /<(?:article|main|section)[^>]*>([\s\S]*?)<\/(?:article|main|section)>/i.exec(cleaned)
  if (contentMatch) {
    cleaned = contentMatch[1]
  }

  return cleaned
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n• $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
