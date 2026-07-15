import { NextRequest } from 'next/server'
import { assembleStage1Result } from '@/lib/llm/stage1/pipeline'
import type {
  CandidateProfileMap,
  ValidatedProfileClaims,
  JDRequirementMapExtended,
  MatchMatrix,
  GapFitAnalysis,
  Stage2QuestionCandidate,
  UserProfile,
  JDSourceType,
  ProfileEvidenceIndexItem,
} from '@/contracts'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    profileMap: CandidateProfileMap
    validatedClaims: ValidatedProfileClaims
    jdMapExtended: JDRequirementMapExtended
    matchMatrix: MatchMatrix
    gapFitAnalysis: GapFitAnalysis
    bridgeQuestions: Stage2QuestionCandidate[]
    jdText: string
    domainIQText: string
    profile: UserProfile
    jdSourceType: JDSourceType
    evidenceIndex: ProfileEvidenceIndexItem[]
  }

  const required = ['profileMap', 'validatedClaims', 'jdMapExtended', 'matchMatrix', 'gapFitAnalysis', 'bridgeQuestions', 'jdText', 'profile']
  const missing = required.filter(k => !(body as any)[k])
  if (missing.length) {
    return Response.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 })
  }

  try {
    const output = await assembleStage1Result({
      profileMap: body.profileMap,
      validatedClaims: body.validatedClaims,
      jdMapExtended: body.jdMapExtended,
      matchMatrix: body.matchMatrix,
      gapFitAnalysis: body.gapFitAnalysis,
      bridgeQuestions: body.bridgeQuestions ?? [],
      jdText: body.jdText,
      domainIQText: body.domainIQText ?? '',
      profile: body.profile,
      jdSourceType: body.jdSourceType ?? 'pasted_jd',
      evidenceIndex: body.evidenceIndex ?? [],
    })
    return Response.json({ output })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Assembly failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
