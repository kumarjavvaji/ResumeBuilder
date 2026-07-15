import { NextRequest, NextResponse } from 'next/server'
import { enrichCandidate } from '@/lib/llm/calibrate-enrich'
import type { CalibrationCandidate } from '@/contracts'

export async function POST(req: NextRequest) {
  let rawCandidate: CalibrationCandidate | null = null

  try {
    const body = await req.json() as {
      candidate: CalibrationCandidate
      targetCompany: string
      roleTitle: string
      jdText?: string
    }

    rawCandidate = body.candidate

    if (!rawCandidate || !body.targetCompany || !body.roleTitle) {
      return NextResponse.json(
        { error: 'candidate, targetCompany, and roleTitle are required.' },
        { status: 400 }
      )
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    let enriched: CalibrationCandidate
    try {
      enriched = await enrichCandidate({
        candidate: rawCandidate,
        targetCompany: body.targetCompany,
        roleTitle: body.roleTitle,
        jdText: body.jdText,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }

    return NextResponse.json({ candidate: enriched })
  } catch (err) {
    console.error('calibration/enrich error:', err)
    // Return failed status — never throw, never block
    const failed: Partial<CalibrationCandidate> = rawCandidate
      ? { ...rawCandidate, status: 'failed', failureReason: err instanceof Error ? err.message : 'Enrichment failed.' }
      : { status: 'failed', failureReason: 'Parse error.' }
    return NextResponse.json({ candidate: failed })
  }
}
