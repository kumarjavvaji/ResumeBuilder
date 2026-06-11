import { describe, it, expect } from 'vitest'
import { validateBulletClaim, containsRejectedPhrase, estimatePageCount } from '@/lib/validators/claim-classifier'
import type { ResumeBullet, UserProfile } from '@/contracts'

const PROFILE: UserProfile = {
  id: 'test',
  fullName: 'Test User',
  email: 'test@example.com',
  phone: '',
  location: '',
  linkedIn: '',
  summary: '',
  workHistory: [{
    id: 'w1',
    company: 'Acme',
    title: 'Product Owner',
    startDate: '2020',
    endDate: 'present',
    bullets: ['Managed product backlog for Salesforce integration', 'Led sprint planning with cross-functional teams'],
    approvedMetrics: ['Reduced time-to-deploy by 40%'],
    domain: 'fintech',
    skills: ['Jira', 'Salesforce', 'Scrum', 'SQL', 'backlog management']
  }],
  education: [],
  skills: ['Product Management', 'SQL', 'Jira', 'Scrum', 'Salesforce', 'UAT'],
  skillGroups: [
    { id: 'sg1', heading: 'Product', skills: ['Product Management', 'Scrum'] },
    { id: 'sg2', heading: 'Data', skills: ['SQL'] },
    { id: 'sg3', heading: 'Tools', skills: ['Jira', 'Salesforce'] },
    { id: 'sg4', heading: 'Delivery', skills: ['UAT'] }
  ],
  certifications: [],
  constraints: [],
  rejectedPhrases: [],
  updatedAt: '2026-01-01'
}

function makeBullet(overrides: Partial<ResumeBullet>): ResumeBullet {
  return {
    id: 'b1',
    text: '',
    claimStatus: 'supported',
    sourceSignal: 'user-history',
    approved: null,
    ...overrides
  }
}

describe('validateBulletClaim', () => {
  it('passes a supported bullet that references profile skills', () => {
    const bullet = makeBullet({
      text: 'Managed product backlog for Salesforce integration using Jira',
      claimStatus: 'supported'
    })
    const result = validateBulletClaim(bullet, PROFILE)
    expect(result.correctedStatus).toBe('supported')
    expect(result.valid).toBe(true)
  })

  it('downgrades a "supported" bullet with no profile match to needs-user-confirmation', () => {
    const bullet = makeBullet({
      text: 'Led machine learning model deployment using PyTorch and Kubernetes',
      claimStatus: 'supported'
    })
    const result = validateBulletClaim(bullet, PROFILE)
    expect(result.correctedStatus).toBe('needs-user-confirmation')
    expect(result.valid).toBe(false)
  })

  it('always passes unsupported bullets through unchanged', () => {
    const bullet = makeBullet({
      text: 'Built entire data warehouse from scratch',
      claimStatus: 'unsupported'
    })
    const result = validateBulletClaim(bullet, PROFILE)
    expect(result.correctedStatus).toBe('unsupported')
    expect(result.valid).toBe(true)
  })

  it('passes needs-user-confirmation without downgrade', () => {
    const bullet = makeBullet({
      text: 'Coordinated release readiness across 3 business units',
      claimStatus: 'needs-user-confirmation'
    })
    const result = validateBulletClaim(bullet, PROFILE)
    expect(result.correctedStatus).toBe('needs-user-confirmation')
  })
})

describe('containsRejectedPhrase', () => {
  const rejected = ['sits at the intersection of', 'thought leader', 'leverage synergies']

  it('detects an exact rejected phrase (case insensitive)', () => {
    const text = 'This role Sits At The Intersection Of product and technology.'
    expect(containsRejectedPhrase(text, rejected)).toBe('sits at the intersection of')
  })

  it('returns null when no rejected phrases found', () => {
    const text = 'Managed a cross-functional team to deliver the product roadmap on time.'
    expect(containsRejectedPhrase(text, rejected)).toBeNull()
  })

  it('detects phrase in the middle of longer text', () => {
    const text = 'As a thought leader in the industry, I have...'
    expect(containsRejectedPhrase(text, rejected)).toBe('thought leader')
  })
})

describe('estimatePageCount', () => {
  it('estimates under 1 page for a short section set', () => {
    const sections = [{ content: 'Short summary. Only a few words here.' }]
    expect(estimatePageCount(sections)).toBeLessThan(1)
  })

  it('estimates over 2 pages for a very long content set', () => {
    const longContent = 'word '.repeat(1200)
    const sections = [{ content: longContent }]
    expect(estimatePageCount(sections)).toBeGreaterThan(2)
  })

  it('sums across multiple sections', () => {
    const sections = Array(5).fill({ content: 'word '.repeat(100) })
    const estimate = estimatePageCount(sections)
    expect(estimate).toBeGreaterThan(0)
    expect(estimate).toBeLessThan(2)
  })
})
