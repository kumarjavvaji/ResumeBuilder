import { NextRequest } from 'next/server'
import { runPassE } from '@/lib/llm/stage1/pipeline'
import type { MatchMatrix, ValidatedProfileClaims } from '@/contracts'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    matchMatrix: MatchMatrix
    validatedClaims: ValidatedProfileClaims
  }

  if (!body.matchMatrix || !body.validatedClaims) {
    return Response.json({ error: 'matchMatrix and validatedClaims are required' }, { status: 400 })
  }

  try {
    const output = await runPassE(body.matchMatrix, body.validatedClaims)
    return Response.json({ output })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pass E failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
