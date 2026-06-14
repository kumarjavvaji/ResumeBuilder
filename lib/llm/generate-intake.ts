import { anthropic, MODEL } from './client'
import type { JDRequirementMap, DomainIQImport, EmphasisCategory, UserProfile } from '@/contracts'

export interface IntakeSynthesis {
  companySummary: string
  fitHypothesis: string
  /** 1-2 sentences on who evaluates this role and what they prioritize. */
  evaluatorLens: string
  riskGaps: string[]
  emphasisRecommendation: EmphasisCategory
}

export async function generateIntakeSynthesis(
  jdMap: JDRequirementMap,
  domainIQ: DomainIQImport,
  profile: UserProfile
): Promise<IntakeSynthesis> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [{
      name: 'intake_synthesis',
      description: 'Synthesize intake analysis for a job target.',
      input_schema: {
        type: 'object' as const,
        required: ['companySummary', 'fitHypothesis', 'evaluatorLens', 'riskGaps', 'emphasisRecommendation'],
        properties: {
          companySummary: { type: 'string' },
          fitHypothesis: { type: 'string' },
          evaluatorLens: {
            type: 'string',
            description: '1-2 sentences on who evaluates this role (hiring manager, eng lead, etc.) and what they will prioritize when reviewing resumes.',
          },
          riskGaps: { type: 'array', items: { type: 'string' } },
          emphasisRecommendation: {
            type: 'string',
            enum: ['PO', 'BA', 'QA', 'AI', 'data', 'operations', 'blended']
          }
        }
      }
    }],
    tool_choice: { type: 'tool', name: 'intake_synthesis' },
    system: `You are a resume strategist helping target a job application.

Emphasis categories:
- PO: Product Owner — prioritize backlog ownership, sprint delivery, stakeholder alignment, roadmap
- BA: Business Analyst — prioritize gap analysis, requirements, acceptance criteria, workflow mapping, UAT, decision clarity
- QA: QA / Lead Quality — prioritize test automation, quality frameworks, SpecFlow, release readiness
- AI: AI/ML product — prioritize data, models, AI tooling, experimentation
- data: data analyst/product — prioritize SQL, metrics, reporting, dashboards
- operations: ops-heavy roles — prioritize process improvement, cross-functional coordination
- blended: role genuinely spans two categories

Rules:
- companySummary: 2-3 sentences. What this company does and why it matters for the candidate's narrative.
- fitHypothesis: 2-3 sentences. Where the candidate's background fits strongest and what the headline story is.
- evaluatorLens: 1-2 sentences. Who will evaluate this resume (e.g. "An engineering manager who cares about delivery cadence and hands-on backlog ownership") and what they prioritize above all else. Be specific — not generic recruiter language.
- riskGaps: specific gaps, not generic. Each gap should name the missing thing precisely.
- emphasisRecommendation: pick based on the real job function, not the posted title.
- Do not use phrases like "sits at the intersection of."`,
    messages: [{
      role: 'user',
      content: JSON.stringify({ jdMap, domainIQ, profileSummary: profileToSummary(profile) })
    }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('intake synthesis: no tool_use response')
  }

  return toolUse.input as IntakeSynthesis
}

function profileToSummary(profile: UserProfile): string {
  const roles = profile.workHistory.map(w => `${w.title} at ${w.company} (${w.startDate}–${w.endDate})`).join(', ')
  const skills = profile.skills.slice(0, 20).join(', ')
  return `${profile.fullName}. Roles: ${roles}. Skills: ${skills}.`
}
