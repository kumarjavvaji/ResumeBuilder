import { NextRequest, NextResponse } from 'next/server'
import { normalizeLearningCandidates } from '@/lib/llm/normalize-learnings'
import type { RawLearningCandidate } from '@/contracts'

export async function POST(req: NextRequest) {
  try {
    const { candidates, sessionId } = await req.json() as {
      candidates: RawLearningCandidate[]
      sessionId: string
    }
    if (!candidates?.length) {
      return NextResponse.json({ normalizedLearnings: [], discarded: [] })
    }
    const result = await normalizeLearningCandidates(candidates, sessionId)
    return NextResponse.json(result)
  } catch (err) {
    console.error('normalize-learnings route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Normalization failed.' },
      { status: 500 }
    )
  }
}
