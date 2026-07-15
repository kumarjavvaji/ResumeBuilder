import { NextRequest } from 'next/server'
import { runPassC } from '@/lib/llm/stage1/pipeline'
import { extractCompanyIndustryBasisFromDomainIQText, buildCalibrationBrief } from '@/lib/stage1/calibration-brief'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    jdText: string
    domainIQText?: string
  }

  if (!body.jdText?.trim()) {
    return Response.json({ error: 'jdText is required' }, { status: 400 })
  }

  try {
    const companyIndustryBasis = extractCompanyIndustryBasisFromDomainIQText(body.domainIQText ?? '')
    const calibrationBrief = companyIndustryBasis ? buildCalibrationBrief(companyIndustryBasis) : undefined
    const output = await runPassC(body.jdText, calibrationBrief)
    return Response.json({ output })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pass C failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
