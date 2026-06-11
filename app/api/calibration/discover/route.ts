import { NextRequest, NextResponse } from 'next/server'
import { runDiscovery } from '@/lib/llm/calibrate-discovery'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessionId: string
      targetCompany: string
      roleTitle: string
      type: 'target' | 'comparable'
      jdSummary?: string
    }

    if (!body.sessionId || !body.targetCompany || !body.roleTitle || !body.type) {
      return NextResponse.json(
        { error: 'sessionId, targetCompany, roleTitle, and type are required.' },
        { status: 400 }
      )
    }

    const result = await runDiscovery({
      sessionId: body.sessionId,
      targetCompany: body.targetCompany,
      roleTitle: body.roleTitle,
      type: body.type,
      jdSummary: body.jdSummary
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('calibration/discover error:', err)
    // Non-blocking: always return 200 with partial result
    return NextResponse.json({
      candidates: [],
      diagnostics: [{
        query: 'server',
        outcome: 'failed',
        message: err instanceof Error ? err.message : 'Discovery failed.'
      }]
    })
  }
}
