import { NextRequest, NextResponse } from 'next/server'
import { refineResumeArtifact, type RefineOptions } from '@/lib/llm/refine-artifact-section'
import type {
  SectionType, JDRequirementMap, UserProfile, BridgeQuestion,
  LearningSignal, EmphasisCategory, CalibrationSummary, ArtifactVersion
} from '@/contracts'
import type { FitAnalysisContext, CalibrationRefSlim } from '@/lib/artifacts/buildArtifactRefinementContext'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessionId: string
      sectionType: SectionType
      artifactText: string
      userInstruction: string
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
      calibrationSummary?: CalibrationSummary
      priorVersions?: Pick<ArtifactVersion, 'versionNumber' | 'userInstruction' | 'revisedText'>[]
      overallRefinementPrompt?: string
      roleTitle?: string
      company?: string
      fitAnalysisContext?: FitAnalysisContext
      calibrationRefs?: CalibrationRefSlim[]
    }

    if (!body.jdMap?.required?.length) {
      return NextResponse.json(
        { error: 'Stage 1 Target Intake must be completed before refining artifacts.', code: 'STAGE1_REQUIRED' },
        { status: 422 }
      )
    }

    if (!body.artifactText?.trim()) {
      return NextResponse.json(
        { error: 'No existing artifact text to refine.', code: 'NO_ARTIFACT_TEXT' },
        { status: 422 }
      )
    }

    if (!body.userInstruction?.trim()) {
      return NextResponse.json(
        { error: 'A refinement instruction is required.', code: 'NO_INSTRUCTION' },
        { status: 422 }
      )
    }

    const result = await refineResumeArtifact({
      sessionId: body.sessionId,
      sectionType: body.sectionType,
      artifactText: body.artifactText,
      userInstruction: body.userInstruction,
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
      calibrationSummary: body.calibrationSummary,
      priorVersions: body.priorVersions ?? [],
      overallRefinementPrompt: body.overallRefinementPrompt,
      roleTitle: body.roleTitle,
      company: body.company,
      fitAnalysisContext: body.fitAnalysisContext,
      calibrationRefs: body.calibrationRefs,
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('artifact-refine route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Refinement failed.' },
      { status: 500 }
    )
  }
}
