import { NextRequest, NextResponse } from 'next/server'
import { synthesizeCalibration } from '@/lib/llm/calibrate-synthesize'
import type { CalibrationReference } from '@/contracts'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      refs: CalibrationReference[]
      targetCompany: string
      roleTitle: string
    }

    if (!body.targetCompany || !body.roleTitle) {
      return NextResponse.json(
        { error: 'targetCompany and roleTitle are required.' },
        { status: 400 }
      )
    }

    const summary = await synthesizeCalibration({
      refs: body.refs ?? [],
      targetCompany: body.targetCompany,
      roleTitle: body.roleTitle
    })

    return NextResponse.json({ summary })
  } catch (err) {
    console.error('calibration/synthesize error:', err)
    return NextResponse.json({
      summary: {
        targetCompanyPatterns: [],
        competitorPatterns: [],
        repeatedTitles: [],
        repeatedSkillsTools: [],
        domainExpectations: [],
        credibilityBoundaries: [],
        artifactGuidance: [],
        outreachGuidance: [],
        gapsToHandleCarefully: [],
        calibrationUsed: false,
        calibrationPatterns: [],
        generatedAt: new Date().toISOString()
      }
    })
  }
}
