import { anthropic, MODEL } from './client'
import type { DiscardedLearning, NormalizedLearning, RawLearningCandidate } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'

interface ClassifierOutput {
  normalizedLearnings: Array<Omit<NormalizedLearning, 'id' | 'savedAt'>>
  discarded: DiscardedLearning[]
}

const SYSTEM_PROMPT = `You are classifying ResumeBuilder learning candidates into the correct storage buckets.

Do not improve the resume. Do not generate new resume text.

Classify each raw learning as one of:
- artifact_fact: what is true about the candidate, resume, artifact, evidence, or accepted output
- bridge_fact: how candidate evidence connects to a JD requirement (must reference both evidence and requirement)
- personal_signal: how to write this candidate's future resumes (candidate-specific writing behavior)
- strategy_signal: how to shape artifacts for a role family or session strategy
- global_signal: a universal ResumeBuilder rule that applies across all candidates and roles
- stage_learning: what happened in a workflow stage
- discard: redundant, too vague, or not reusable

Definitions:
- Artifact fact = what is true.
- Bridge fact = how evidence maps to a JD requirement.
- Personal signal = how to write this candidate's future resumes.
- Strategy signal = how to shape artifacts for a role family or session strategy.
- Global signal = a universal ResumeBuilder rule.
- Stage learning = what happened in this workflow stage.
- Discard = redundant, too vague, or not reusable.

Rules:
1. If the text contains candidate-specific writing guidance, classify as personal_signal.
2. If it contains domain, role-family, or market-pattern guidance, classify as strategy_signal with scope role_family.
3. If it applies to all candidates and roles without exception, classify as global_signal with scope global. Remove instance-specific examples from ruleText; put them in the examples array.
4. If it only states what happened in this session, classify as stage_learning with scope session.
5. If it only states a candidate fact (what is true), classify as artifact_fact with scope candidate.
6. If it connects evidence to JD requirements and requirementIds/evidenceIds are present, classify as bridge_fact.
7. If it mixes scopes, split it into multiple normalized records.
8. If a global rule has session-specific examples embedded in the text, separate the universal rule into ruleText and put the examples in the examples array.
9. Do not store the same idea in multiple buckets unless each version has a distinct scope and rule.
10. A personal signal must answer: "How should this candidate's evidence be used, framed, placed, or bounded next time?"
11. A global signal must not depend on a specific candidate, company, role title, domain, or tool.
12. Strategy signals that mention a role family, domain name, or tool family should have scope role_family.

Scope values: candidate | role_family | session | global
Confidence: high (clear classification), medium (best guess), low (uncertain or vague)`

export async function normalizeLearningCandidates(
  candidates: RawLearningCandidate[],
  sessionId: string,
): Promise<{ normalizedLearnings: NormalizedLearning[]; discarded: DiscardedLearning[] }> {
  if (candidates.length === 0) return { normalizedLearnings: [], discarded: [] }

  const candidatesJson = JSON.stringify(
    candidates.map((c, i) => ({
      index: i,
      text: c.text,
      sourceStage: c.sourceStage,
      proposedBucket: c.proposedBucket ?? null,
      requirementIds: c.requirementIds ?? [],
      evidenceIds: c.evidenceIds ?? [],
      sourceArtifactIds: c.sourceArtifactIds ?? [],
      roleFamily: c.roleFamily ?? null,
      tags: c.tags ?? [],
    })),
    null,
    2
  )

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    tools: [{
      name: 'classify_learnings',
      description: 'Classify raw learning candidates into the correct storage buckets.',
      input_schema: {
        type: 'object' as const,
        required: ['normalizedLearnings', 'discarded'],
        properties: {
          normalizedLearnings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['bucket', 'scope', 'ruleText', 'sourceStage', 'sourceSessionId', 'confidence'],
              properties: {
                bucket: { type: 'string', enum: ['artifact_fact', 'bridge_fact', 'personal_signal', 'strategy_signal', 'global_signal', 'stage_learning'] },
                scope: { type: 'string', enum: ['candidate', 'role_family', 'session', 'global'] },
                ruleText: { type: 'string' },
                rationale: { type: 'string' },
                boundary: { type: 'string' },
                examples: { type: 'array', items: { type: 'string' } },
                sourceStage: { type: 'string' },
                sourceSessionId: { type: 'string' },
                sourceArtifactIds: { type: 'array', items: { type: 'string' } },
                evidenceIds: { type: 'array', items: { type: 'string' } },
                requirementIds: { type: 'array', items: { type: 'string' } },
                roleFamily: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              }
            }
          },
          discarded: {
            type: 'array',
            items: {
              type: 'object',
              required: ['rawText', 'reason'],
              properties: {
                rawText: { type: 'string' },
                reason: { type: 'string', enum: ['duplicate', 'too_vague', 'wrong_scope', 'pure_fact_already_saved', 'no_reuse_value'] },
              }
            }
          }
        }
      }
    }],
    tool_choice: { type: 'tool', name: 'classify_learnings' },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Classify these ${candidates.length} raw learning candidates. For each, apply the classification rules strictly. Split mixed-scope records. Remove session examples from global rule text.\n\nSession ID: ${sessionId}\n\nCandidates:\n${candidatesJson}`
    }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('normalize-learnings: no tool_use response')
  }

  const output = toolUse.input as ClassifierOutput
  const now = new Date().toISOString()

  const normalizedLearnings: NormalizedLearning[] = output.normalizedLearnings.map(l => ({
    ...l,
    id: nanoid(),
    sourceSessionId: sessionId,
    savedAt: now,
    examples: l.examples ?? [],
    sourceArtifactIds: l.sourceArtifactIds ?? [],
    evidenceIds: l.evidenceIds ?? [],
    requirementIds: l.requirementIds ?? [],
  }))

  return { normalizedLearnings, discarded: output.discarded ?? [] }
}
