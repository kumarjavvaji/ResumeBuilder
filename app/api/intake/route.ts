import { NextRequest } from 'next/server'
import { runStage1Pipeline, type Stage1PipelineEvent } from '@/lib/llm/stage1/pipeline'
import { validateJDContent } from '@/lib/validators/jd-content'
import type { UserProfile, JDSourceType, ProfileEvidenceIndexItem } from '@/contracts'

const INSTRUCTION_CONTAMINATION = [
  'Stage 1 Analyze JD Button Status Tracking',
  'Stage 1 Refactor',
  'Refactor ResumeBuilder',
  'Implementation Boundary',
  'ResumeBuilder source logic owns',
  'Anthropic LLM does not own status state',
  'Acceptance Criteria',
  'Multi-Pass Architecture',
  'Pass A – Candidate Profile Map',
  'Pass B – Claim Validation',
  'Pass C – JD Requirement Map',
]

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    jdText: string
    domainIQText: string
    profile: UserProfile
    jdSourceType?: JDSourceType
    roleTitle?: string
    company?: string
    profileEvidenceIndex?: ProfileEvidenceIndexItem[]
    bridgeAnswers?: Array<{ question: string; answer: string; questionType: string }>
    acceptedArtifacts?: Array<{ sectionType: string; content: string }>
  }

  const { jdText, domainIQText, profile, roleTitle, company } = body

  if (!jdText?.trim()) {
    return Response.json({ error: 'jdText is required' }, { status: 400 })
  }

  if (INSTRUCTION_CONTAMINATION.some(m => jdText.includes(m))) {
    return Response.json(
      { error: 'JD text contains implementation instructions, not a job description. Clear the JD field and paste the actual job posting.' },
      { status: 400 }
    )
  }

  const validation = validateJDContent(jdText, { roleTitle, company })
  if (!validation.valid) {
    return Response.json(
      { error: 'The job description content is not valid for analysis.', reason: validation.reason, message: validation.message },
      { status: 422 }
    )
  }

  const evidenceIndex = body.profileEvidenceIndex ?? []
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: Stage1PipelineEvent) {
        const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(line))
      }

      try {
        await runStage1Pipeline({
          jdText,
          domainIQText: domainIQText ?? '',
          profile,
          jdSourceType: body.jdSourceType ?? 'pasted_jd',
          roleTitle: roleTitle ?? '',
          company: company ?? '',
          evidenceIndex,
          bridgeAnswers: body.bridgeAnswers ?? [],
          acceptedArtifacts: body.acceptedArtifacts ?? [],
          onEvent: emit,
        })
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : 'Pipeline failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
