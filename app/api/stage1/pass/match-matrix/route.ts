import { NextRequest } from 'next/server'
import { runPassD } from '@/lib/llm/stage1/pipeline'
import type { ValidatedProfileClaims, JDRequirementMapExtended } from '@/contracts'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    validatedClaims: ValidatedProfileClaims
    jdMap: JDRequirementMapExtended
  }

  if (!body.validatedClaims || !body.jdMap) {
    return Response.json({ error: 'validatedClaims and jdMap are required' }, { status: 400 })
  }

  try {
    const output = await runPassD(body.validatedClaims, body.jdMap)
    return Response.json({ output })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pass D failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
