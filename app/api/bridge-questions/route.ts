import { NextRequest, NextResponse } from 'next/server'
import { generateBridgeQuestions } from '@/lib/llm/generate-bridge-questions'
import type { JDRequirementMap, UserProfile, EmphasisCategory, FitAnalysis } from '@/contracts'

export async function POST(req: NextRequest) {
  try {
    const { jdMap, profile, emphasis, sessionId, fitAnalysis } = await req.json() as {
      jdMap: JDRequirementMap
      profile: UserProfile
      emphasis: EmphasisCategory
      sessionId: string
      fitAnalysis?: FitAnalysis
    }

    const questions = await generateBridgeQuestions(jdMap, profile, emphasis, sessionId, fitAnalysis)
    return NextResponse.json({ questions })
  } catch (err) {
    console.error('bridge-questions route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
