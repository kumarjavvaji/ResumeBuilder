import { describe, expect, it } from 'vitest'
import {
  formatCalibrationInfluenceLine,
  normalizeCalibrationInfluence,
  sanitizeCalibrationEvidenceRefs,
  sanitizeSourceMappings
} from '@/lib/calibration/influence'
import type { ArtifactSection, ResumeBullet } from '@/contracts'

describe('calibration influence audit', () => {
  it('applied calibration with no concrete decisions records availability but no use', () => {
    const influence = normalizeCalibrationInfluence(undefined, {
      calibrationAvailable: true,
      sectionType: 'experience-ba'
    })

    expect(influence.calibrationAvailable).toBe(true)
    expect(influence.calibrationUsed).toBe(false)
    expect(influence.useLevel).toBe('none')
    expect(influence.influenceSummary).toBe('Calibration available but no material influence recorded.')
  })

  it('concrete calibration decisions record calibration use', () => {
    const influence = normalizeCalibrationInfluence({
      calibrationAvailable: true,
      calibrationUsed: true,
      useLevel: 'material',
      influenceSummary: 'Ordered BA bullets first due to SI BA calibration pattern.',
      influencedPatterns: ['SI BA evidence ordering'],
      artifactDecisions: [{
        pattern: 'SI BA evidence ordering',
        decisionType: 'ordering',
        decision: 'Ordered Business Analyst bullets before cross-role context because SI BA calibration patterns favored BA-specific evidence.',
        affectedSection: 'experience-ba'
      }]
    }, {
      calibrationAvailable: true,
      sectionType: 'experience-ba'
    })

    expect(influence.calibrationUsed).toBe(true)
    expect(influence.useLevel).toBe('material')
    expect(influence.artifactDecisions).toHaveLength(1)
    expect(influence.artifactDecisions[0].decision).toContain('Ordered Business Analyst bullets')
  })

  it('generic model claims of calibration use are downgraded', () => {
    const influence = normalizeCalibrationInfluence({
      calibrationAvailable: true,
      calibrationUsed: true,
      useLevel: 'material',
      influenceSummary: 'Used calibration to make this stronger.',
      influencedPatterns: ['similar roles'],
      artifactDecisions: [{
        pattern: 'similar roles',
        decisionType: 'emphasis',
        decision: 'Used calibration to make this stronger.'
      }]
    }, {
      calibrationAvailable: true,
      sectionType: 'summary'
    })

    expect(influence.calibrationUsed).toBe(false)
    expect(influence.useLevel).toBe('none')
    expect(influence.artifactDecisions).toHaveLength(0)
  })

  it('light influence is preserved for concrete wording or emphasis decisions', () => {
    const influence = normalizeCalibrationInfluence({
      calibrationAvailable: true,
      calibrationUsed: true,
      useLevel: 'light',
      influenceSummary: 'Adjusted wording toward systems integration and stakeholder translation.',
      influencedPatterns: ['Stakeholder translation'],
      artifactDecisions: [{
        pattern: 'Stakeholder translation',
        decisionType: 'wording',
        decision: 'Adjusted wording toward systems integration and stakeholder translation because calibration favored BA translation language.',
      }]
    }, {
      calibrationAvailable: true,
      sectionType: 'experience-ba'
    })

    expect(influence.calibrationUsed).toBe(true)
    expect(influence.useLevel).toBe('light')
  })

  it('source mappings remove calibration references while preserving evidence mappings', () => {
    const mappings = sanitizeSourceMappings([
      'Gap analysis claim -> Product Analyst at SaaS Co',
      'Requirements claim -> Calibration reference: CoverGo BA profile',
      'SQL usage analysis -> Bridge evidence'
    ])

    expect(mappings).toEqual([
      'Gap analysis claim -> Product Analyst at SaaS Co',
      'SQL usage analysis -> Bridge evidence'
    ])
  })

  it('calibration references are removed from bullet evidence refs', () => {
    const bullets: ResumeBullet[] = [
      {
        id: 'b1',
        text: 'Mapped requirements.',
        claimStatus: 'supported',
        sourceSignal: 'user-history',
        evidenceRef: 'Product Analyst at SaaS Co',
        approved: null
      },
      {
        id: 'b2',
        text: 'Insurance platform analysis.',
        claimStatus: 'supported',
        sourceSignal: 'user-history',
        evidenceRef: 'Calibration reference CoverGo',
        approved: null
      }
    ]

    const sanitized = sanitizeCalibrationEvidenceRefs(bullets)
    expect(sanitized[0].evidenceRef).toBe('Product Analyst at SaaS Co')
    expect(sanitized[1].evidenceRef).toBeUndefined()
  })

  it('accepted sections preserve calibrationInfluence after serialization', () => {
    const section = {
      id: 'sec-1',
      sessionId: 'sess-1',
      type: 'experience-ba',
      content: 'content',
      bullets: [],
      status: 'accepted',
      generationRationale: 'Generated from profile and JD.',
      evidenceWarnings: [],
      sourceMappings: [],
      jdTraceability: [],
      calibrationInfluence: normalizeCalibrationInfluence({
        calibrationAvailable: true,
        calibrationUsed: true,
        useLevel: 'material',
        influenceSummary: 'Ordered BA bullets first due to SI BA calibration pattern.',
        influencedPatterns: ['SI BA evidence ordering'],
        artifactDecisions: [{
          pattern: 'SI BA evidence ordering',
          decisionType: 'ordering',
          decision: 'Ordered Business Analyst bullets before cross-role context because SI BA calibration patterns favored BA-specific evidence.'
        }]
      }, { calibrationAvailable: true, sectionType: 'experience-ba' }),
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString()
    } satisfies ArtifactSection

    const reloaded = JSON.parse(JSON.stringify(section)) as ArtifactSection
    expect(reloaded.calibrationInfluence?.calibrationUsed).toBe(true)
    expect(reloaded.calibrationInfluence?.artifactDecisions[0].decisionType).toBe('ordering')
  })

  it('regenerating after reapplying calibration records a new influence state', () => {
    const previous = normalizeCalibrationInfluence(undefined, {
      calibrationAvailable: true,
      sectionType: 'experience-ba'
    })
    const regenerated = normalizeCalibrationInfluence({
      calibrationAvailable: true,
      calibrationUsed: true,
      useLevel: 'material',
      influenceSummary: 'Handled insurance domain as a gap due to calibration boundaries.',
      influencedPatterns: ['Insurance domain credibility boundary'],
      artifactDecisions: [{
        pattern: 'Insurance domain credibility boundary',
        decisionType: 'gap_handling',
        decision: 'Excluded insurance domain ownership claims because calibration expected domain fluency but user evidence did not support direct platform ownership.'
      }]
    }, {
      calibrationAvailable: true,
      sectionType: 'experience-ba'
    })

    expect(previous.calibrationUsed).toBe(false)
    expect(regenerated.calibrationUsed).toBe(true)
    expect(regenerated.useLevel).toBe('material')
  })

  it('display text is separate from source mappings and rationale text', () => {
    const influence = normalizeCalibrationInfluence({
      calibrationAvailable: true,
      calibrationUsed: true,
      useLevel: 'light',
      influenceSummary: 'Adjusted wording toward systems integration and stakeholder translation.',
      influencedPatterns: ['Stakeholder translation'],
      artifactDecisions: [{
        pattern: 'Stakeholder translation',
        decisionType: 'emphasis',
        decision: 'Emphasized stakeholder translation because calibration patterns showed SI BA roles foreground requirements elicitation.'
      }]
    }, {
      calibrationAvailable: true,
      sectionType: 'experience-ba'
    })

    const line = formatCalibrationInfluenceLine(influence)
    expect(line).toContain('Calibration influence: Light')
    expect(line).not.toContain('Source mappings')
    expect(line).not.toContain('Why this was written')
  })
})

