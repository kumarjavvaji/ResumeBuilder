/**
 * Generation quality gate tests.
 *
 * Validates:
 *   1. Quality gate constants export the expected prohibitions
 *   2. buildSectionQualityGate returns section-specific rules
 *   3. Summary prohibitions are present in generate-artifact-section system prompt
 *   4. Bullet compression rules are enforced for experience sections
 *   5. PA overclaim prohibitions are enforced
 *   6. Full-resume quality gate is present in refine-stage4-resume system prompt
 *   7. Brief mustAvoid arrays carry the quality gate prohibitions
 */

import { describe, it, expect } from 'vitest'
import {
  SUMMARY_PROHIBITIONS,
  BULLET_QUALITY_RULES,
  PA_OVERCLAIM_PROHIBITIONS,
  buildSectionQualityGate,
  buildFullResumeQualityGate,
} from '../lib/llm/generation-quality-gate'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── 1. Constants ──────────────────────────────────────────────────────────────

describe('1. Quality gate constants', () => {
  it('1.1: SUMMARY_PROHIBITIONS includes "formal PO tenure"', () => {
    expect(SUMMARY_PROHIBITIONS).toContain('formal PO tenure')
  })

  it('1.2: SUMMARY_PROHIBITIONS includes "early career includes"', () => {
    expect(SUMMARY_PROHIBITIONS).toContain('early career includes')
  })

  it('1.3: SUMMARY_PROHIBITIONS includes grounding phrasing', () => {
    expect(SUMMARY_PROHIBITIONS).toContain('grounding operational')
  })

  it('1.4: SUMMARY_PROHIBITIONS includes "grounding operational" phrasing', () => {
    expect(SUMMARY_PROHIBITIONS).toContain('grounding operational')
  })

  it('1.5: BULLET_QUALITY_RULES enforces 1–2 line limit', () => {
    const rule = BULLET_QUALITY_RULES.find(r => r.includes('1–2 lines'))
    expect(rule).toBeTruthy()
  })

  it('1.6: BULLET_QUALITY_RULES enforces "~" over "approximately"', () => {
    const rule = BULLET_QUALITY_RULES.find(r => r.includes('approximately'))
    expect(rule).toBeTruthy()
    expect(rule).toContain('"~"')
  })

  it('1.7: PA_OVERCLAIM_PROHIBITIONS includes "Led all Scrum ceremonies"', () => {
    expect(PA_OVERCLAIM_PROHIBITIONS).toContain('Led all Scrum ceremonies')
  })

  it('1.8: PA_OVERCLAIM_PROHIBITIONS includes "Owned product roadmap"', () => {
    expect(PA_OVERCLAIM_PROHIBITIONS).toContain('Owned product roadmap')
  })

  it('1.9: PA_OVERCLAIM_PROHIBITIONS includes "Managed sprint delivery"', () => {
    expect(PA_OVERCLAIM_PROHIBITIONS).toContain('Managed sprint delivery')
  })
})

// ─── 2. buildSectionQualityGate ───────────────────────────────────────────────

describe('2. buildSectionQualityGate output', () => {
  it('2.1: summary gate prohibits older employers not required by JD', () => {
    const gate = buildSectionQualityGate('summary')
    expect(gate).toContain('older employers not required by this JD')
  })

  it('2.2: summary gate prohibits "formal PO tenure"', () => {
    const gate = buildSectionQualityGate('summary')
    expect(gate).toContain('formal PO tenure')
  })

  it('2.3: summary gate prohibits "early career includes"', () => {
    const gate = buildSectionQualityGate('summary')
    expect(gate).toContain('early career includes')
  })

  it('2.4: summary gate sets 3–4 line limit', () => {
    const gate = buildSectionQualityGate('summary')
    expect(gate).toContain('3–4 lines')
  })

  it('2.5: experience-po gate enforces "~" over "approximately"', () => {
    const gate = buildSectionQualityGate('experience-po')
    expect(gate).toContain('"~"')
    expect(gate).toContain('approximately')
  })

  it('2.6: experience-po gate enforces 1–2 line bullet limit', () => {
    const gate = buildSectionQualityGate('experience-po')
    expect(gate).toContain('1–2 lines')
  })

  it('2.7: experience-ba gate prohibits PA Scrum ceremony overclaim', () => {
    const gate = buildSectionQualityGate('experience-ba')
    expect(gate).toContain('Led Scrum ceremonies')
    expect(gate).toContain('Owned product roadmap')
    expect(gate).toContain('Managed sprint delivery')
  })

  it('2.8: experience-ba gate provides correct Scrum ceremony phrasing', () => {
    const gate = buildSectionQualityGate('experience-ba')
    expect(gate).toContain('Supported backlog refinement, sprint demos, and ceremony preparation')
  })

  it('2.9: experience-qa gate keeps QA as supporting differentiator', () => {
    const gate = buildSectionQualityGate('experience-qa')
    expect(gate).toContain('supporting differentiator')
  })

  it('2.10: skills gate enforces single-word headings', () => {
    const gate = buildSectionQualityGate('skills')
    expect(gate).toContain('Single-word')
    expect(gate).toContain('Product, Delivery, Analysis')
  })

  it('2.11: skills gate excludes Azure DevOps unless evidenced', () => {
    const gate = buildSectionQualityGate('skills')
    expect(gate).toContain('Azure DevOps')
    expect(gate).toContain('Jira is sufficient')
  })

  it('2.12: all section gates contain the quality gate delimiter', () => {
    const sections = ['summary', 'skills', 'experience-po', 'experience-ba', 'experience-qa'] as const
    for (const s of sections) {
      const gate = buildSectionQualityGate(s)
      expect(gate).toContain('QUALITY GATE')
    }
  })
})

// ─── 3. buildFullResumeQualityGate ───────────────────────────────────────────

describe('3. buildFullResumeQualityGate output', () => {
  it('3.1: full-resume gate includes summary check', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('SUMMARY CHECK')
  })

  it('3.2: full-resume gate checks for "formal PO tenure" prohibition', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('formal PO tenure')
  })

  it('3.3: full-resume gate prohibits older employers not required by JD', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('older employers not relevant to this JD')
  })

  it('3.4: full-resume gate checks bullet line limit', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('1–2 lines')
    expect(gate).toContain('paragraph-length')
  })

  it('3.5: full-resume gate checks "approximately" → "~"', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('approximately')
    expect(gate).toContain('"~"')
  })

  it('3.6: full-resume gate checks Azure DevOps exclusion', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('Azure DevOps')
  })

  it('3.7: full-resume gate checks travel willingness exclusion', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('travel willingness')
  })

  it('3.8: full-resume gate checks skills heading format', () => {
    const gate = buildFullResumeQualityGate()
    expect(gate).toContain('Single-word heading')
  })
})

// ─── 4. Prompt integration — quality gate wired into generate-artifact-section ─

describe('4. Quality gate wired into generate-artifact-section', () => {
  const src = readFileSync(join(__dirname, '../lib/llm/generate-artifact-section.ts'), 'utf-8')

  it('4.1: imports buildSectionQualityGate from generation-quality-gate', () => {
    expect(src).toContain("from './generation-quality-gate'")
    expect(src).toContain('buildSectionQualityGate')
  })

  it('4.2: calls buildSectionQualityGate(type) and appends to system prompt', () => {
    expect(src).toContain('buildSectionQualityGate(type)')
    expect(src).toContain('qualityGate')
  })

  it('4.3: summary typeInstruction prohibits older employers not required by JD', () => {
    expect(src).toContain('older employers not required by this JD')
  })

  it('4.4: summary typeInstruction prohibits "formal PO tenure"', () => {
    expect(src).toContain('"formal PO tenure"')
  })

  it('4.5: summary typeInstruction prohibits "early career includes"', () => {
    expect(src).toContain('early career includes')
  })

  it('4.6: experience-po typeInstruction requires "~" for approximations', () => {
    expect(src).toContain('NEVER spell out "approximately"')
  })

  it('4.7: experience-po typeInstruction sets 1–2 line bullet limit', () => {
    expect(src).toContain('1–2 lines per bullet maximum')
  })

  it('4.8: experience-ba typeInstruction prohibits "Led all Scrum ceremonies"', () => {
    expect(src).toContain('"Led all Scrum ceremonies"')
  })

  it('4.9: experience-ba typeInstruction provides correct Scrum ceremony phrasing', () => {
    expect(src).toContain('Supported backlog refinement, sprint demos, and ceremony preparation')
  })

  it('4.10: skills typeInstruction enforces single-word headings', () => {
    expect(src).toContain('SINGLE-WORD ATS headings only')
  })
})

// ─── 5. Prompt integration — quality gate wired into refine-stage4-resume ─────

describe('5. Quality gate wired into refine-stage4-resume', () => {
  const src = readFileSync(join(__dirname, '../lib/llm/refine-stage4-resume.ts'), 'utf-8')

  it('5.1: imports buildFullResumeQualityGate', () => {
    expect(src).toContain("from './generation-quality-gate'")
    expect(src).toContain('buildFullResumeQualityGate')
  })

  it('5.2: calls buildFullResumeQualityGate() and appends to system prompt', () => {
    expect(src).toContain('buildFullResumeQualityGate()')
    expect(src).toContain('qualityGate')
  })
})

// ─── 6. Brief mustAvoid arrays carry prohibitions ─────────────────────────────

describe('6. Brief mustAvoid arrays carry quality gate prohibitions', () => {
  const src = readFileSync(join(__dirname, '../lib/llm/artifact-generation-brief.ts'), 'utf-8')

  it('6.1: summary mustAvoid includes "formal PO tenure"', () => {
    expect(src).toContain('"formal PO tenure"')
  })

  it('6.2: summary mustAvoid includes "early career includes"', () => {
    expect(src).toContain('"early career includes"')
  })

  it('6.3: summary mustAvoid includes older employer exclusion rule', () => {
    expect(src).toContain('older employers not relevant to this JD')
  })

  it('6.4: experience-ba mustAvoid includes PA overclaim prohibitions', () => {
    expect(src).toContain('"Led all Scrum ceremonies"')
    expect(src).toContain('"Owned product roadmap"')
    expect(src).toContain('"Managed sprint delivery"')
  })
})
