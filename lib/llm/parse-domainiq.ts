import { anthropic, MODEL } from './client'
import type { DomainIQImport } from '@/contracts'

export async function parseDomainIQ(rawText: string): Promise<DomainIQImport> {
  if (!rawText.trim()) {
    return {
      rawText: '',
      companyProfile: '',
      industrySignals: [],
      techStack: [],
      cultureSignals: []
    }
  }

  // If the input is already a structured DomainIQ JSON export, use it directly.
  // This avoids an unnecessary LLM round-trip when the user pastes a JSON export.
  if (rawText.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawText.trim())
      if (typeof parsed.companyProfile === 'string' && Array.isArray(parsed.industrySignals)) {
        return {
          rawText,
          companyProfile: parsed.companyProfile ?? '',
          industrySignals: parsed.industrySignals ?? [],
          techStack: parsed.techStack ?? [],
          cultureSignals: parsed.cultureSignals ?? [],
        }
      }
    } catch {
      // Not valid JSON — fall through to LLM
    }
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [{
      name: 'structure_domainiq',
      description: 'Structure DomainIQ or company research text into typed signals.',
      input_schema: {
        type: 'object' as const,
        required: ['companyProfile', 'industrySignals', 'techStack', 'cultureSignals'],
        properties: {
          companyProfile: { type: 'string' },
          industrySignals: { type: 'array', items: { type: 'string' } },
          techStack: { type: 'array', items: { type: 'string' } },
          cultureSignals: { type: 'array', items: { type: 'string' } }
        }
      }
    }],
    tool_choice: { type: 'tool', name: 'structure_domainiq' },
    system: `You extract structured signals from company research or DomainIQ exports.
- companyProfile: 2-3 sentence summary of what the company does, its size/stage, and market position.
- industrySignals: specific industry verticals, regulatory context, customer segments mentioned.
- techStack: technologies, platforms, tools mentioned in the company context.
- cultureSignals: values, ways of working, cultural indicators mentioned.
Extract only what is actually stated. Do not infer or add context not in the text.`,
    messages: [{ role: 'user', content: rawText }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { rawText, companyProfile: rawText, industrySignals: [], techStack: [], cultureSignals: [] }
  }

  const input = toolUse.input as Omit<DomainIQImport, 'rawText'>
  return { ...input, rawText }
}
