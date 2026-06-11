import { NextRequest, NextResponse } from 'next/server'
import { abstractSignalToGlobal } from '@/lib/llm/abstract-signal'
import type { LearningSignal } from '@/contracts'

export async function POST(req: NextRequest) {
  try {
    const { signal } = await req.json() as { signal: LearningSignal }
    const result = await abstractSignalToGlobal(signal)
    return NextResponse.json(result)
  } catch (err) {
    console.error('abstract-signal route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Abstraction failed.' },
      { status: 500 }
    )
  }
}
