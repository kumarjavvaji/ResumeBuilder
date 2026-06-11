/**
 * Unit tests for JD parsing logic.
 * These test the parsing contract validation, not the LLM call itself.
 */
import { describe, it, expect } from 'vitest'
import type { JDRequirementMap } from '@/contracts'

// Helpers that mirror the expectations the LLM must satisfy
function assertNoOverlap(map: JDRequirementMap) {
  const requiredTexts = new Set(map.required.map(r => r.text.toLowerCase()))
  const niceTexts = map.niceToHave.map(r => r.text.toLowerCase())
  for (const t of niceTexts) {
    if (requiredTexts.has(t)) {
      throw new Error(`"${t}" appears in both required and niceToHave`)
    }
  }
}

function assertUnsupportedSubsetOfRequired(map: JDRequirementMap) {
  const allTexts = new Set([
    ...map.required.map(r => r.text.toLowerCase()),
    ...map.niceToHave.map(r => r.text.toLowerCase())
  ])
  for (const u of map.unsupportedRequirements) {
    const lower = u.toLowerCase()
    const found = [...allTexts].some(t => t.includes(lower) || lower.includes(t))
    if (!found) {
      throw new Error(`unsupportedRequirement "${u}" does not match any JD item`)
    }
  }
}

function assertValidCategories(map: JDRequirementMap) {
  const validCats = new Set(['technical', 'domain', 'soft', 'tool', 'process'])
  const validCoverage = new Set(['covered', 'partial', 'gap', 'unknown'])
  for (const r of [...map.required, ...map.niceToHave]) {
    if (!validCats.has(r.category)) throw new Error(`Invalid category: ${r.category}`)
    if (!validCoverage.has(r.userCoverageStatus)) throw new Error(`Invalid coverage: ${r.userCoverageStatus}`)
  }
}

const SAMPLE_MAP: JDRequirementMap = {
  required: [
    { text: '5+ years product management experience', category: 'process', userCoverageStatus: 'covered' },
    { text: 'Proficiency with SQL', category: 'technical', userCoverageStatus: 'partial' },
    { text: 'Experience with Agile/Scrum', category: 'process', userCoverageStatus: 'covered' },
    { text: 'Salesforce platform knowledge', category: 'tool', userCoverageStatus: 'gap' }
  ],
  niceToHave: [
    { text: 'Experience with Tableau', category: 'tool', userCoverageStatus: 'unknown' },
    { text: 'Fintech domain experience', category: 'domain', userCoverageStatus: 'covered' }
  ],
  realJobFunction: 'Product Owner managing a cross-functional scrum team in a SaaS fintech company',
  needsEvidenceItems: ['Salesforce platform knowledge'],
  unsupportedRequirements: ['Salesforce platform knowledge'],
  weaklySupportedRequirements: ['Proficiency with SQL']
}

describe('JDRequirementMap contract', () => {
  it('required and niceToHave are non-overlapping', () => {
    expect(() => assertNoOverlap(SAMPLE_MAP)).not.toThrow()
  })

  it('throws when same item appears in both required and niceToHave', () => {
    const bad: JDRequirementMap = {
      ...SAMPLE_MAP,
      niceToHave: [
        { text: '5+ years product management experience', category: 'process', userCoverageStatus: 'covered' }
      ]
    }
    expect(() => assertNoOverlap(bad)).toThrow()
  })

  it('all items have valid category and coverage status', () => {
    expect(() => assertValidCategories(SAMPLE_MAP)).not.toThrow()
  })

  it('throws for invalid category', () => {
    const bad: JDRequirementMap = {
      ...SAMPLE_MAP,
      required: [{ text: 'SQL', category: 'unknown_type' as never, userCoverageStatus: 'covered' }]
    }
    expect(() => assertValidCategories(bad)).toThrow()
  })

  it('unsupportedRequirements reference actual JD items', () => {
    expect(() => assertUnsupportedSubsetOfRequired(SAMPLE_MAP)).not.toThrow()
  })

  it('realJobFunction is non-empty', () => {
    expect(SAMPLE_MAP.realJobFunction.length).toBeGreaterThan(0)
  })

  it('gaps are classified as gap coverage status', () => {
    const gapItems = SAMPLE_MAP.required.filter(r => r.userCoverageStatus === 'gap')
    const unsupportedSet = SAMPLE_MAP.unsupportedRequirements.map(u => u.toLowerCase())
    for (const g of gapItems) {
      // Gap items should appear in unsupported or weakly supported
      const inUnsupported = unsupportedSet.some(u => u.includes(g.text.toLowerCase()) || g.text.toLowerCase().includes(u))
      const inWeak = SAMPLE_MAP.weaklySupportedRequirements.some(w =>
        w.toLowerCase().includes(g.text.toLowerCase()) || g.text.toLowerCase().includes(w.toLowerCase())
      )
      expect(inUnsupported || inWeak).toBe(true)
    }
  })
})
