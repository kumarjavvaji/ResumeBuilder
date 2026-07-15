import { anthropic, MODEL } from './client'
import type { BridgeQuestion, JDRequirement, JDRequirementMap, UserProfile, EmphasisCategory, FitAnalysis } from '@/contracts'
export { convertCandidatesToBridgeQuestions } from './convert-bridge-candidates'

interface BridgeQuestionRaw {
  question: string
  type: BridgeQuestion['type']
  priority: BridgeQuestion['priority']
  affectedArtifactSection: string
}

// ─── Deterministic candidate filtering ─────────────────────────────────────────
// Excludes rows that are clearly covered with grounded evidence, so the LLM is never
// relied on (via prompt instruction alone) to avoid redundant questions.

const GAP_PRIORITY: Record<string, number> = {
  true_gap: 0,
  profile_missing: 1,
  needs_confirmation: 1,
  mapping_gap: 2,
  wording_gap: 2,
  parser_missing: 3,
  not_required: 4,
}

function isCoveredAndGrounded(r: JDRequirement): boolean {
  const classCovered =
    r.classification === 'covered' ||
    (!r.classification && r.userCoverageStatus === 'covered' && (!r.gapClassification || r.gapClassification === 'not_required'))
  if (!classCovered) return false
  // 'none' just means the deterministic matcher found no overlapping evidence item —
  // it does not mean the LLM's covered/grounded classification was wrong. Only an
  // explicit 'weak' reading should override the classification and keep the row in play.
  if (r.profileEvidenceStrength === 'weak') return false
  return true
}

function rowPriorityRank(r: JDRequirement): number {
  if (r.classification === 'gap' || r.classification === 'needs_evidence') return 0
  if (r.classification === 'weakly_supported') return 1
  if (r.userCoverageStatus === 'gap') return 0
  if (r.userCoverageStatus === 'partial') return 1
  if (r.gapClassification) return GAP_PRIORITY[r.gapClassification] ?? 2
  if (r.profileEvidenceStrength === 'weak' || r.profileEvidenceStrength === 'none') return 2
  return 3
}

/**
 * Filters the JD map down to rows worth asking about, before the LLM ever sees them.
 * Excludes clearly covered + grounded rows; prioritizes gap/partial/needs-evidence/
 * weakly-supported rows and rows with low profile evidence strength.
 */
function selectBridgeCandidates(jdMap: JDRequirementMap): JDRequirement[] {
  const all = [...jdMap.required, ...jdMap.niceToHave]
  return all
    .filter(r => !isCoveredAndGrounded(r))
    .sort((a, b) => rowPriorityRank(a) - rowPriorityRank(b))
}

export async function generateBridgeQuestions(
  jdMap: JDRequirementMap,
  profile: UserProfile,
  emphasis: EmphasisCategory,
  sessionId: string,
  fitAnalysis?: FitAnalysis
): Promise<Omit<BridgeQuestion, 'id' | 'createdAt'>[]> {
  // Build a compact profile summary for the prompt — cached prefix
  const profileText = buildProfileText(profile)
  const candidates = selectBridgeCandidates(jdMap)

  if (candidates.length === 0) {
    return []
  }

  const calibratedFraming = fitAnalysis
    ? `

You have a calibrated Stage 1 artifact below — it already reflects the company/domain context (Quick-DIQ), not just the raw JD. Generate questions from this calibrated artifact, not from the raw JD requirement map: ask what fit questions or evidence gaps need to be resolved given this calibrated read, including the diqCalibration/resumeImplication notes on each requirement.

Calibrated Stage 1 artifact:
${JSON.stringify(fitAnalysis, null, 2)}`
    : ''

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
- Questions must be specific and answerable. Not "tell me about your experience" but "Can you quantify the number of user stories you managed per sprint at your current employer?"
- Do NOT ask for facts already present in the profile provided.
- Each question must name the specific gap, skill, or evidence it targets.
- Each question must state which resume section it affects (summary, experience-primary, experience-secondary, experience-supporting, skills, etc.).
- Generate up to 14 questions total, one per candidate row at most — fewer is fine if the candidate list is short. Prioritize rows earlier in the candidate list (they are already sorted gap-first).
- type classifications:
  - gap: a required JD skill the user has no coverage for
  - evidence: the user may have this experience but it's not documented
  - metric: a bullet exists but needs a specific number or outcome
  - domain-translation: the user has the skill in a different domain (needs framing for this industry)
  - emphasis: deciding which aspect of the user's background to lead with
  - underused-experience: something in the profile that likely maps to a JD requirement but isn't connected yet
- The candidate list below has already been deterministically filtered to exclude requirements that are clearly covered with grounded profile evidence. Only generate questions for rows in this candidate list — do not generate questions for any other requirement, even if mentioned elsewhere (e.g. in the calibrated artifact).
- Emphasis context: ${emphasis}${calibratedFraming}`,
    messages: [{
      role: 'user',
      content: `Candidate rows for bridge questions (pre-filtered, gap-first order):\n${JSON.stringify(candidates, null, 2)}\n\nUser profile:\n${profileText}`
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
