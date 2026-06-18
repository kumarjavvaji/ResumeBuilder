/**
 * Server-only: LLM extraction of structured profile signals from resume text.
 * Import only from API routes — never from 'use client' components.
 * Types and normalizer live in profileSignalNormalizer.ts (client-safe).
 */
import { anthropic, MODEL } from '@/lib/llm/client'
import type { ExtractedProfileSignals } from './profileSignalNormalizer'

export type { ExtractedProfileSignals } from './profileSignalNormalizer'
export type {
  RawExtractedClaim,
  RawExtractedSkill,
  RawExtractedRole,
  RawExtractedMetric,
  RawExtractedTool,
  RawExtractedDomain,
} from './profileSignalNormalizer'

const EXTRACT_TOOL_SCHEMA = {
  name: 'extract_profile_signals',
  description: 'Extract structured profile signals from resume text. Produce claims, skills, roles, tools, metrics, and domains. Do not rewrite bullets — preserve the original wording.',
  input_schema: {
    type: 'object' as const,
    required: ['claims', 'skills', 'roles', 'metrics', 'tools', 'domains', 'possibleConflicts'],
    properties: {
      claims: {
        type: 'array',
        description: 'Discrete professional claims. Each claim is one atomic fact, responsibility, or achievement. Do not aggregate multiple bullets into one claim.',
        items: {
          type: 'object',
          required: ['text', 'category', 'evidenceStrength', 'sourceContext'],
          properties: {
            text: {
              type: 'string',
              description: 'The claim in concise form, preserving original wording where possible. Max 200 chars.',
            },
            category: {
              type: 'string',
              enum: ['role', 'responsibility', 'achievement', 'metric', 'domain', 'tool', 'method', 'constraint', 'preference'],
            },
            evidenceStrength: {
              type: 'string',
              enum: ['strong', 'medium', 'weak'],
              description: 'strong=specific metric or named project; medium=clear responsibility; weak=inferred or vague.',
            },
            sourceContext: {
              type: 'string',
              description: 'Brief note on where this came from (e.g. "Current employer PO role, 2021–2024").',
            },
          },
        },
      },
      skills: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            groupingHint: {
              type: 'string',
              description: 'ATS category hint: Analysis, Product, Delivery, Data, Testing, Security, or Tools.',
            },
          },
        },
      },
      roles: {
        type: 'array',
        description: 'Work history role entries.',
        items: {
          type: 'object',
          required: ['title', 'company', 'startDate', 'endDate'],
          properties: {
            title: { type: 'string' },
            company: { type: 'string' },
            startDate: { type: 'string', description: 'Preserve format from resume (e.g. "Jan 2021", "2019").' },
            endDate: { type: 'string', description: 'Preserve format from resume or "Present".' },
          },
        },
      },
      metrics: {
        type: 'array',
        description: 'Specific numeric or measurable claims (percentages, dollar amounts, counts, time periods).',
        items: {
          type: 'object',
          required: ['text', 'context'],
          properties: {
            text: { type: 'string', description: 'The metric as stated in the resume.' },
            context: { type: 'string', description: 'Role or project this metric belongs to.' },
          },
        },
      },
      tools: {
        type: 'array',
        description: 'All tools, platforms, and software mentioned.',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            categoryHint: { type: 'string', description: 'e.g. "project management", "testing", "analytics".' },
          },
        },
      },
      domains: {
        type: 'array',
        description: 'Industry or business domain signals from work history.',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'e.g. "HCM", "fintech", "credit union", "healthcare IT".' },
          },
        },
      },
      possibleConflicts: {
        type: 'array',
        description: 'Pairs of claims that appear to conflict (different dates for same role, contradictory metrics, etc.).',
        items: {
          type: 'object',
          required: ['description', 'claimTexts'],
          properties: {
            description: { type: 'string' },
            claimTexts: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
}

export async function extractProfileSignals(resumeText: string): Promise<ExtractedProfileSignals> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [EXTRACT_TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'extract_profile_signals' },
    system: `You extract structured profile signals from resume text for a layered profile compiler.

Rules:
- Extract claims as discrete, atomic facts. Do not merge bullets.
- Preserve the candidate's original wording — do not rewrite or improve resume text.
- evidenceStrength = strong when a specific metric, named project, or concrete outcome is present.
- evidenceStrength = medium for clear responsibilities with no numeric evidence.
- evidenceStrength = weak for vague or inferred claims ("led initiatives", "contributed to team").
- Metrics must be extracted verbatim from the resume — do not infer numbers.
- Tools must be extracted exactly as named — do not normalize (normalization happens downstream).
- Domains must reflect the actual industries in the work history, not assumptions.
- possibleConflicts: flag only genuine contradictions, not just variations in wording.
- Do not add claims not present in the resume text.
- Do not generate summaries, assessments, or career advice.`,
    messages: [{ role: 'user', content: `Resume text:\n\n${resumeText}` }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Profile extractor: no tool_use response from model')
  }

  return toolUse.input as ExtractedProfileSignals
}
