import { anthropic, MODEL } from './client'
import type { JDRequirementMap, DomainIQImport, EmphasisCategory, UserProfile, Stage1CalibrationBrief } from '@/contracts'

export interface IntakeSynthesis {
  companySummary: string
  fitHypothesis: string
  /** 1-2 sentences on who evaluates this role and what they prioritize. */
  evaluatorLens: string
  riskGaps: string[]
  emphasisRecommendation: EmphasisCategory
  /** Structured breakdown of risk/gap areas (F section of A-I output contract). */
  riskGapBreakdown?: {
    trueCandidateGaps: string[]
    weakButBridgeable: string[]
    retrievalGaps: string[]
  }
  /** Resume positioning guidance — specific, not generic (H section). */
  resumeDirection?: {
    summaryGuidance: string
    skillsGuidance: string
    experienceBulletGuidance: string[]
  }
  /** Self-audit of Stage 1 quality checks performed (I section). */
  qualityAudit?: {
    compoundRequirementsSplit: string[]
    contradictionsResolved: string[]
    retrievalGapsFlagged: string[]
    stage2QuestionsSuppressed: string[]
  }
}

export async function generateIntakeSynthesis(
  jdMap: JDRequirementMap,
  domainIQ: DomainIQImport,
  profile: UserProfile,
  calibrationBrief?: Stage1CalibrationBrief,
  contradictions?: string[]
): Promise<IntakeSynthesis> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    tools: [{
      name: 'intake_synthesis',
      description: 'Synthesize intake analysis for a job target.',
      input_schema: {
        type: 'object' as const,
        required: ['companySummary', 'fitHypothesis', 'evaluatorLens', 'riskGaps', 'emphasisRecommendation', 'riskGapBreakdown', 'resumeDirection', 'qualityAudit'],
        properties: {
          companySummary: { type: 'string', description: '2-3 sentences. What this company does and why it changes the candidate narrative.' },
          fitHypothesis: { type: 'string', description: '2-4 sentences using JD + profile evidence. No generic praise. Name the specific fit.' },
          evaluatorLens: {
            type: 'string',
            description: '1-2 sentences on who evaluates this role (e.g. engineering manager, CPO, etc.) and what they prioritize above all else when reviewing resumes.',
          },
          riskGaps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Flat list of specific gap strings for backward-compatible display. Each gap must name the missing thing precisely. When calibrationBrief is present, explain why it matters in this context.',
          },
          emphasisRecommendation: {
            type: 'string',
            description: 'Role emphasis based on real job function, not posted title. E.g. "Product Owner", "Business Analyst", "Product Analyst", "QA Lead", "Data Analyst", "Product Manager". Use the job function, not a category code.',
          },
          riskGapBreakdown: {
            type: 'object',
            required: ['trueCandidateGaps', 'weakButBridgeable', 'retrievalGaps'],
            description: 'Structured risk breakdown. Classify each gap into the correct bucket.',
            properties: {
              trueCandidateGaps: {
                type: 'array',
                items: { type: 'string' },
                description: 'Requirements the candidate genuinely lacks — no adjacent evidence in profile or evidence index.',
              },
              weakButBridgeable: {
                type: 'array',
                items: { type: 'string' },
                description: 'Requirements where adjacent evidence exists but the resume cannot claim them directly without a Stage 2 bridge answer.',
              },
              retrievalGaps: {
                type: 'array',
                items: { type: 'string' },
                description: 'Requirements where the deterministic matcher found profile evidence but the LLM assessment shows gap — likely missed by retrieval, not a true gap.',
              },
            },
          },
          resumeDirection: {
            type: 'object',
            required: ['summaryGuidance', 'skillsGuidance', 'experienceBulletGuidance'],
            description: 'Specific, non-generic resume positioning guidance derived from JD + profile evidence.',
            properties: {
              summaryGuidance: {
                type: 'string',
                description: '1-2 sentences on what the resume summary should lead with and what to avoid. Reference specific role evidence.',
              },
              skillsGuidance: {
                type: 'string',
                description: '1-2 sentences on which skill categories to prioritize in the skills section for ATS and evaluator match.',
              },
              experienceBulletGuidance: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 4,
                description: 'Up to 4 bullet directions for the most important experience evidence to surface. Each is a specific theme or proof point, not generic advice.',
              },
            },
          },
          qualityAudit: {
            type: 'object',
            required: ['compoundRequirementsSplit', 'contradictionsResolved', 'retrievalGapsFlagged', 'stage2QuestionsSuppressed'],
            description: 'Self-audit of Stage 1 quality checks. Describe what was found and corrected.',
            properties: {
              compoundRequirementsSplit: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of compound requirements that were split into separate rows for independent scoring.',
              },
              contradictionsResolved: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of internal contradictions detected and resolved (e.g., same concept covered in one row but flagged missing in another).',
              },
              retrievalGapsFlagged: {
                type: 'array',
                items: { type: 'string' },
                description: 'Requirements that were reclassified from needs_evidence/gap to retrieval_gap because deterministic matching found contradicting evidence.',
              },
              stage2QuestionsSuppressed: {
                type: 'array',
                items: { type: 'string' },
                description: 'Requirements NOT sent to Stage 2 because active profile evidence already answers them.',
              },
            },
          },
        },
      },
    }],
    tool_choice: { type: 'tool', name: 'intake_synthesis' },
    system: `You are a resume strategist synthesizing a Stage 1 target intake artifact.

Rules for each output section:
- companySummary: 2-3 sentences. What this company does and why it matters for the candidate narrative. Calibrate to this specific company/domain when calibrationBrief is provided.
- fitHypothesis: 2-4 sentences. Where the candidate's background fits strongest and what the headline story is. Use JD + profile evidence. Name specific proof points. No phrases like "sits at the intersection of."
- evaluatorLens: 1-2 sentences. Who specifically will evaluate this resume (e.g. "An engineering manager who cares about delivery cadence") and what they prioritize. Be specific.
- riskGaps: flat list for display. Each gap must name the missing thing precisely, with why it matters in this role/company if calibrationBrief is present.
- emphasisRecommendation: derive from the REAL job function, not the posted title. Return the job function label, e.g. "Product Owner", "Business Analyst", "Product Analyst", "QA Lead".
- riskGapBreakdown: REQUIRED. Classify every gap across the three buckets. trueCandidateGaps = the candidate genuinely lacks it. weakButBridgeable = adjacent evidence exists but needs bridge confirmation. retrievalGaps = deterministic matching found profile evidence that wasn't picked up — not a true gap.
- resumeDirection: specific, evidence-bound positioning guidance. summaryGuidance must reference what the JD signals need, not generic "lead with your experience." skillsGuidance must reference the JD's tool/ATS terms. experienceBulletGuidance must name specific themes or proof points from the profile.
- qualityAudit: REQUIRED. List what the system caught. If compoundRequirementsSplit is empty, say so explicitly. If no contradictions were found, say so. If retrieval gaps were flagged, list them. If any Stage 2 questions were suppressed because profile already answers them, list them here.
- Never use "results-driven", "sits at the intersection of", or generic HR filler.${contradictions && contradictions.length > 0 ? `\n\nContradictions detected by the deterministic audit pass — reference these in qualityAudit.contradictionsResolved:\n${contradictions.map(c => `- ${c}`).join('\n')}` : ''}`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        jdMap,
        domainIQ,
        calibrationBrief,
        profileSummary: profileToSummary(profile),
        retrievalGapRows: jdMap.required.filter(r => r.classification === 'retrieval_gap').map(r => r.rowLabel || r.text),
        needsEvidenceRows: jdMap.required.filter(r => r.classification === 'needs_evidence').map(r => r.rowLabel || r.text),
        coveredRows: jdMap.required.filter(r => r.classification === 'covered').map(r => r.rowLabel || r.text),
        partiallyCoveredRows: jdMap.required.filter(r => r.classification === 'partially_covered').map(r => r.rowLabel || r.text),
        weaklySupportedRows: jdMap.required.filter(r => r.classification === 'weakly_supported').map(r => r.rowLabel || r.text),
        stage2SuppressedRows: jdMap.required.filter(r => r.stage2Action === 'suppress').map(r => r.rowLabel || r.text),
      }),
    }],
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
