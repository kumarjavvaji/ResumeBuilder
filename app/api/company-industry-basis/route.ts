import { NextRequest, NextResponse } from 'next/server'
import { generateCompanyIndustryBasis } from '@/lib/stage2/generate-company-industry-basis'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      targetCompany: string
      targetRoleTitle: string
      jobDescription: string
      industry?: string
      userNotes?: string
      profileEvidenceSummary?: string
      mockMode?: boolean
    }

    if (!body.targetCompany?.trim() || !body.targetRoleTitle?.trim() || !body.jobDescription?.trim()) {
      return NextResponse.json(
        { error: 'targetCompany, targetRoleTitle, and jobDescription are required.' },
        { status: 422 },
      )
    }

    const result = await generateCompanyIndustryBasis(body)
    const diagnostic = {
      ...result.diagnostic,
      apiRouteReached: true,
    }
    console.info('company-industry-basis diagnostic:', diagnostic)
    return NextResponse.json({
      ...result,
      diagnostic,
    })
  } catch (err) {
    console.error('company-industry-basis route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Company / industry basis generation failed.' },
      { status: 500 },
    )
  }
}
