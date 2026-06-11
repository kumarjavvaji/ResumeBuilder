import { anthropic, MODEL } from './client'
import type { JDRequirementMap, JDRequirement, RawJD, JDSourceType } from '@/contracts'

const TOOL_SCHEMA = {
  name: 'parse_job_description',
  description: 'Parse a job description into a structured requirement map with source provenance.',
  input_schema: {
    type: 'object' as const,
    required: ['rawJD', 'requirementMap'],
    properties: {
      rawJD: {
        type: 'object',
        required: ['summary', 'responsibilities', 'requiredSkills', 'niceToHaves', 'domainSignals'],
        properties: {
          summary: { type: 'string' },
          responsibilities: { type: 'array', items: { type: 'string' } },
          requiredSkills: { type: 'array', items: { type: 'string' } },
          niceToHaves: { type: 'array', items: { type: 'string' } },
          domainSignals: { type: 'array', items: { type: 'string' } },
        },
      },
      requirementMap: {
        type: 'object',
        required: ['required', 'niceToHave', 'realJobFunction', 'needsEvidenceItems', 'weaklySupportedRequirements'],
        properties: {
          required: {
            type: 'array',
            items: {
              type: 'object',
              required: ['text', 'category', 'userCoverageStatus'],
              properties: {
                text: { type: 'string' },
                category: {
                  type: 'string',
                  enum: ['technical', 'domain', 'soft', 'tool', 'process'],
                },
                userCoverageStatus: {
                  type: 'string',
                  enum: ['covered', 'partial', 'gap', 'unknown'],
                },
                sourceExcerpt: {
                  type: 'string',
                  description:
                    'Brief quote (≤ 15 words) from the JD that justifies this requirement being listed.',
                },
                profileEvidence: {
                  type: 'string',
                  description:
                    'Which part of the user profile supports or does not support this requirement.',
                },
              },
            },
          },
          niceToHave: {
            type: 'array',
            items: {
              type: 'object',
              required: ['text', 'category', 'userCoverageStatus'],
              properties: {
                text: { type: 'string' },
                category: {
                  type: 'string',
                  enum: ['technical', 'domain', 'soft', 'tool', 'process'],
                },
                userCoverageStatus: {
                  type: 'string',
                  enum: ['covered', 'partial', 'gap', 'unknown'],
                },
                sourceExcerpt: { type: 'string' },
                profileEvidence: { type: 'string' },
              },
            },
          },
          realJobFunction: { type: 'string' },
          needsEvidenceItems: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Requirements not found in the user profile — these are bridge-question targets, not hard disqualifiers.',
          },
          weaklySupportedRequirements: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}

export interface ParsedJD {
  rawJD: RawJD
  requirementMap: JDRequirementMap
}

export async function parseJobDescription(
  jdText: string,
  userSkillsSummary: string,
  jdSourceType: JDSourceType = 'pasted_jd'
): Promise<ParsedJD> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'parse_job_description' },
    system: `You parse job descriptions into structured requirement maps with source provenance.

Rules:
- Separate required skills from nice-to-haves precisely. Do not conflate them.
- "required" means the JD says "must have", "required", "5+ years of X", or lists under required qualifications.
- "niceToHave" means "preferred", "plus", "bonus", "familiarity with", or listed under preferred qualifications.
- userCoverageStatus: compare each requirement to the user skills summary provided.
  - "covered" = user clearly has this
  - "partial" = user has related experience but not a direct match
  - "gap" = user does not have this
  - "unknown" = not enough information
- realJobFunction: state the actual job function (e.g. "Product Owner managing a scrum team in fintech") — not just the posted title.
- needsEvidenceItems: requirements not found in the user profile. Label these as bridge-question targets, not hard disqualifiers.
- weaklySupportedRequirements: requirements where coverage is partial or thin.
- domainSignals: extract industry, company type, technology domain, and culture signals from the JD text only.
- sourceExcerpt: for each requirement, quote ≤15 words from the JD that justify it. If no direct quote exists, omit the field.
- profileEvidence: briefly note which profile element covers/gaps this requirement.
- IMPORTANT: All requirements must come from the JD text. Do not infer requirements from the company name or general industry knowledge.`,
    messages: [
      {
        role: 'user',
        content: `Job description:\n${jdText}\n\nUser skills summary:\n${userSkillsSummary}`,
      },
    ],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('JD parser: no tool_use response from model')
  }

  const input = toolUse.input as {
    rawJD: Omit<RawJD, 'fullText'>
    requirementMap: Omit<JDRequirementMap, 'unsupportedRequirements'> & {
      needsEvidenceItems: string[]
    }
  }

  // Stamp sourceType on all requirements
  function stampSource(reqs: JDRequirement[]): JDRequirement[] {
    return reqs.map(r => ({ ...r, sourceType: jdSourceType }))
  }

  const requirementMap: JDRequirementMap = {
    ...input.requirementMap,
    required: stampSource(input.requirementMap.required),
    niceToHave: stampSource(input.requirementMap.niceToHave),
    needsEvidenceItems: input.requirementMap.needsEvidenceItems ?? [],
    // Back-fill the deprecated field so existing consumers don't break
    unsupportedRequirements: input.requirementMap.needsEvidenceItems ?? [],
  }

  return {
    rawJD: { ...input.rawJD, fullText: jdText },
    requirementMap,
  }
}
