import { anthropic, MODEL } from './client'
import type { LearningSignal, ProductArea } from '@/contracts'

interface AbstractionResult {
  globalContent: string
  productArea: ProductArea
  rationale: string
}

const PRODUCT_AREAS: ProductArea[] = [
  'jd-parsing', 'bridge-questions', 'claim-validation',
  'artifact-strategy', 'cover-letter', 'outreach', 'formatting'
]

export async function abstractSignalToGlobal(signal: LearningSignal): Promise<AbstractionResult> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{
      name: 'abstract_signal',
      description: 'Abstract a personal learning signal into an anonymized global product insight.',
      input_schema: {
        type: 'object' as const,
        required: ['globalContent', 'productArea', 'rationale'],
        properties: {
          globalContent: {
            type: 'string',
            description: 'The abstracted, anonymized insight. No employer names, no personal metrics, no PII. A reusable product rule.'
          },
          productArea: {
            type: 'string',
            enum: PRODUCT_AREAS,
            description: 'Which part of the product this insight improves.'
          },
          rationale: {
            type: 'string',
            description: 'One sentence: why this is a useful general rule.'
          }
        }
      }
    }],
    tool_choice: { type: 'tool', name: 'abstract_signal' },
    system: `You convert personal resume learning signals into anonymized, reusable product improvement insights.

Privacy rules — the global content must:
- Contain NO employer names, company names, or product names
- Contain NO personal metrics or numbers (replace with "quantified outcome" or "measurable impact")
- Contain NO job titles specific to one person
- Contain NO personally identifying language

The global content should be a generalizable rule or pattern that improves how the tool generates or evaluates resume artifacts for any user with similar characteristics.

Product areas:
- jd-parsing: improves how job descriptions are parsed into requirement maps
- bridge-questions: improves which questions to ask and how to ask them
- claim-validation: improves how to classify supported vs unsupported claims
- artifact-strategy: improves what content belongs in a resume section for a role/domain
- cover-letter: improves cover letter generation quality
- outreach: improves referral/recruiter message generation
- formatting: improves structure, length, and formatting decisions`,
    messages: [{
      role: 'user',
      content: `Personal signal to abstract:
Type: ${signal.type}
Role category: ${signal.roleCategory ?? 'unknown'}
Section: ${signal.sectionType ?? 'unknown'}
Content: ${signal.content}
Context: ${signal.context}`
    }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Signal abstraction: no tool_use response')
  }

  return toolUse.input as AbstractionResult
}
