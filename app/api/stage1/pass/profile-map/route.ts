import { NextRequest } from 'next/server'
import { runPassA, buildStage1EvidencePayload } from '@/lib/llm/stage1/pipeline'
import type { UserProfile, ProfileEvidenceIndexItem } from '@/contracts'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    profile: UserProfile
    profileEvidenceIndex: ProfileEvidenceIndexItem[]
    bridgeAnswers?: Array<{ question: string; answer: string; questionType: string }>
    acceptedArtifacts?: Array<{ sectionType: string; content: string }>
  }

  if (!body.profile || !body.profileEvidenceIndex) {
    return Response.json({ error: 'profile and profileEvidenceIndex are required' }, { status: 400 })
  }

  try {
    const payload = buildStage1EvidencePayload(
      body.profile,
      body.profileEvidenceIndex,
      body.bridgeAnswers ?? [],
      body.acceptedArtifacts ?? [],
    )
    const output = await runPassA(payload)
    return Response.json({ output })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pass A failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
