import { anthropic, MODEL } from './client'
import type { BridgeQuestion, JDRequirementMap, UserProfile, EmphasisCategory } from '@/contracts'

interface BridgeQuestionRaw {
  question: string
  type: BridgeQuestion['type']
  priority: BridgeQuestion['priority']
  affectedArtifactSection: string
}

export async function generateBridgeQuestions(
  jdMap: JDRequirementMap,
  profile: UserProfile,
  emphasis: EmphasisCategory,
  sessionId: string
): Promise<Omit<BridgeQuestion, 'id' | 'createdAt'>[]> {
  // Build a compact profile summary for the prompt — cached prefix
  const profileText = buildProfileText(profile)

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [{
      name: 'bridge_questions',
      description: 'Generate targeted bridge questions for a resume alignment session.',
      input_schema: {
        type: 'object' as const,
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['question', 'type', 'priority', 'affectedArtifactSection'],
              properties: {
                question: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['gap', 'evidence', 'metric', 'domain-translation', 'emphasis', 'underused-experience']
                },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                affectedArtifactSection: { type: 'string' }
              }
            }
          }
        }
      }
    }],
    tool_choice: { type: 'tool', name: 'bridge_questions' },
    system: `You generate targeted bridge questions that close the gap between a job description and a candidate's resume.

Rules:
- Questions must be specific and answerable. Not "tell me about your experience" but "Can you quantify the number of user stories you managed per sprint at Paylocity?"
- Do NOT ask for facts already present in the profile provided.
- Each question must name the specific gap, skill, or evidence it targets.
- Each question must state which resume section it affects (summary, experience-po, experience-ba, experience-qa, skills, etc.).
- Generate 8–14 questions total. Prioritize gaps and evidence questions for required JD items.
- type classifications:
  - gap: a required JD skill the user has no coverage for
  - evidence: the user may have this experience but it's not documented
  - metric: a bullet exists but needs a specific number or outcome
  - domain-translation: the user has the skill in a different domain (needs framing for this industry)
  - emphasis: deciding which aspect of the user's background to lead with
  - underused-experience: something in the profile that likely maps to a JD requirement but isn't connected yet
- Do not ask about skills the profile already covers clearly.
- Emphasis context: ${emphasis}`,
    messages: [{
      role: 'user',
      content: `JD requirement map:\n${JSON.stringify(jdMap, null, 2)}\n\nUser profile:\n${profileText}`
    }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('bridge questions: no tool_use response')
  }

  const { questions } = toolUse.input as { questions: BridgeQuestionRaw[] }

  return questions.map(q => ({
    ...q,
    sessionId,
    status: 'pending' as const
  }))
}

function buildProfileText(profile: UserProfile): string {
  const lines: string[] = [
    `Name: ${profile.fullName}`,
    `Skills: ${profile.skills.join(', ')}`,
    '',
    'Work history:'
  ]
  for (const w of profile.workHistory) {
    lines.push(`  ${w.title} at ${w.company} (${w.startDate}–${w.endDate})`)
    lines.push(`  Domain: ${w.domain}`)
    lines.push(`  Skills: ${w.skills.join(', ')}`)
    for (const b of w.bullets) lines.push(`    - ${b}`)
    for (const m of w.approvedMetrics) lines.push(`    [metric] ${m}`)
  }
  if (profile.constraints.length) {
    lines.push('', 'Constraints:', ...profile.constraints.map(c => `  - ${c}`))
  }
  return lines.join('\n')
}
