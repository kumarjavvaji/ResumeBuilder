import { NextRequest, NextResponse } from 'next/server'
import { generateArtifactSection, type GenerateOptions } from '@/lib/llm/generate-artifact-section'
import type { SectionType, JDRequirementMap, UserProfile, BridgeQuestion, LearningSignal, EmphasisCategory, CalibrationSummary, ProfileProjection } from '@/contracts'
import type { FitAnalysisContext, CalibrationRefSlim } from '@/lib/artifacts/buildArtifactRefinementContext'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessionId: string
      sectionType: SectionType
      jdMap: JDRequirementMap
      profile: UserProfile
      answeredQuestions: BridgeQuestion[]
      emphasis: EmphasisCategory
      companySummary?: string
      fitHypothesis?: string
      riskGaps?: string[]
      acceptedSignals: LearningSignal[]
      globalSignals?: LearningSignal[]
      rejectedPhrases: string[]
      refinementInstruction?: string
      currentContent?: string
      operation?: GenerateOptions['operation']
      calibrationSummary?: CalibrationSummary
      profileProjection?: ProfileProjection
      roleTitle?: string
      company?: string
      fitAnalysisContext?: FitAnalysisContext
      calibrationRefs?: CalibrationRefSlim[]
    }

    // ── Stage 1 prerequisite guard ───────────────────────────────────────────
    // The JD requirement map must have been analyzed before artifacts can be generated.
    // An empty required array means Stage 1 was not completed or saved as a draft.
    if (!body.jdMap?.required?.length) {
      return NextResponse.json(
        {
          error: 'Stage 1 Target Intake must be completed before generating artifacts.',
          code: 'STAGE1_REQUIRED'
        },
        { status: 422 }
      )
    }

    const result = await generateArtifactSection({
      sessionId: body.sessionId,
      sectionType: body.sectionType,
      jdMap: body.jdMap,
      profile: body.profile,
      answeredQuestions: body.answeredQuestions ?? [],
      emphasis: body.emphasis,
      companySummary: body.companySummary,
      fitHypothesis: body.fitHypothesis,
      riskGaps: body.riskGaps,
      acceptedSignals: body.acceptedSignals ?? [],
      globalSignals: body.globalSignals,
      rejectedPhrases: body.rejectedPhrases ?? [],
      refinementInstruction: body.refinementInstruction,
      currentContent: body.currentContent,
      operation: body.operation ?? 'generate',
      calibrationSummary: body.calibrationSummary,
      profileProjection: body.profileProjection,
      roleTitle: body.roleTitle,
      company: body.company,
      fitAnalysisContext: body.fitAnalysisContext,
      calibrationRefs: body.calibrationRefs,
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('artifact-section route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
