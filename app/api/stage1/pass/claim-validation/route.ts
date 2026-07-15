import { NextRequest } from 'next/server'
import { runPassB } from '@/lib/llm/stage1/pipeline'
import type { CandidateProfileMap } from '@/contracts'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    profileMap: CandidateProfileMap
    skills: string[]
    certifications: string[]
  }

  if (!body.profileMap) {
    return Response.json({ error: 'profileMap is required' }, { status: 400 })
  }

  // Build a minimal payload object for runPassB (only skills/certs are used beyond profileMap)
  const minimalPayload = {
    workHistory: [],
    profileClaims: [],
    bridgeAnswers: [],
    acceptedArtifacts: [],
    skills: body.skills ?? [],
    certifications: body.certifications ?? [],
  } as any

  try {
    const output = await runPassB(body.profileMap, minimalPayload)
    return Response.json({ output })
  } catch (err: any) {
    const message = err instanceof Error ? err.message : 'Pass B failed'
    return Response.json(
      {
        error: message,
        rawOutput: err.rawOutput,
        validationErrors: err.validationIssues,
      },
      { status: 422 }
    )
  }
}
