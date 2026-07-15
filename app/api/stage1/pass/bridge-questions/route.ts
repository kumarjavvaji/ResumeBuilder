import { NextRequest } from 'next/server'
import { runPassF } from '@/lib/llm/stage1/pipeline'
import type { GapFitAnalysis, ValidatedProfileClaims } from '@/contracts'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    gapFitAnalysis: GapFitAnalysis
    validatedClaims: ValidatedProfileClaims
  }

  if (!body.gapFitAnalysis || !body.validatedClaims) {
    return Response.json({ error: 'gapFitAnalysis and validatedClaims are required' }, { status: 400 })
  }

  try {
    const output = await runPassF(body.gapFitAnalysis, body.validatedClaims)
    return Response.json({ output })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pass F failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
