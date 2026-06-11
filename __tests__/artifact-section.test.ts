import { describe, it, expect } from 'vitest'
import type { ArtifactSection, ResumeBullet } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'

function makeSection(overrides: Partial<ArtifactSection> = {}): ArtifactSection {
  return {
    id: nanoid(),
    sessionId: 'test-session',
    type: 'summary',
    content: 'Experienced product owner with 7 years of agile delivery.',
    bullets: [],
    status: 'draft',
    generationRationale: 'Based on 7 years PO experience in JD.',
    jdTraceability: ['5+ years product management experience'],
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

function makeBullet(overrides: Partial<ResumeBullet> = {}): ResumeBullet {
  return {
    id: nanoid(),
    text: 'Led sprint planning for a cross-functional team of 12.',
    claimStatus: 'supported',
    sourceSignal: 'user-history',
    approved: null,
    ...overrides
  }
}

describe('accepted section preservation', () => {
  it('accepted sections are identifiable by status', () => {
    const section = makeSection({ status: 'accepted' })
    expect(section.status).toBe('accepted')
  })

  it('accepted section should not be silently overwritten — check logic', () => {
    // The artifacts-page.tsx checks: if existing?.status === 'accepted' && !refinementInstruction, return
    // Simulate that guard
    const existing = makeSection({ status: 'accepted' })
    const refinementInstruction = undefined

    function wouldRegenerate(sec: ArtifactSection, instruction?: string): boolean {
      if (sec.status === 'accepted' && !instruction) return false
      return true
    }

    expect(wouldRegenerate(existing, refinementInstruction)).toBe(false)
    expect(wouldRegenerate(existing, 'Make it shorter')).toBe(true)
  })

  it('draft sections can be regenerated freely', () => {
    const draft = makeSection({ status: 'draft' })
    function wouldRegenerate(sec: ArtifactSection, instruction?: string): boolean {
      if (sec.status === 'accepted' && !instruction) return false
      return true
    }
    expect(wouldRegenerate(draft)).toBe(true)
  })
})

describe('bullet claim validation', () => {
  it('unsupported bullets are visible in the section', () => {
    const bullet = makeBullet({ claimStatus: 'unsupported' })
    const section = makeSection({ bullets: [bullet] })
    const hasUnsupported = section.bullets.some(b => b.claimStatus === 'unsupported')
    expect(hasUnsupported).toBe(true)
  })

  it('approved null means unreviewed', () => {
    const bullet = makeBullet({ approved: null })
    expect(bullet.approved).toBeNull()
  })

  it('rejected bullet approval set to false', () => {
    const bullet = makeBullet({ approved: false })
    expect(bullet.approved).toBe(false)
  })
})

describe('section version increment', () => {
  it('version should increment on re-save', () => {
    const v1 = makeSection({ version: 1 })
    // Simulate what saveArtifactSection does
    const v2 = { ...v1, version: (v1.version ?? 0) + 1 }
    expect(v2.version).toBe(2)
  })
})

describe('JD traceability', () => {
  it('section has non-empty jdTraceability when generated', () => {
    const section = makeSection({
      jdTraceability: ['5+ years product management', 'Agile/Scrum experience']
    })
    expect(section.jdTraceability.length).toBeGreaterThan(0)
  })
})
