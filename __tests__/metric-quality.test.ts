/**
 * metric-quality.test.ts — A–C suites
 *
 * All fixtures are synthetic. No candidate-specific metrics, employers, or tools.
 */

import { describe, expect, it } from 'vitest'
import { classifyMetric, validateBulletMetrics } from '@/lib/validators/metric-quality'
import type { MetricPolicy } from '@/contracts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STRICT_POLICY: MetricPolicy = {
  preferImpactOverVolume: true,
  volumeMetricsRequireImpactTie: true,
}

const LENIENT_POLICY: MetricPolicy = {
  preferImpactOverVolume: false,
  volumeMetricsRequireImpactTie: false,
}

// ─── Suite A — classifyMetric ─────────────────────────────────────────────────

describe('A: classifyMetric', () => {
  it('A1: identifies retention improvement as impact', () => {
    expect(classifyMetric('Improved retention by 12% through targeted onboarding')).toBe('impact')
  })

  it('A2: identifies revenue growth as impact', () => {
    expect(classifyMetric('Contributed to $2.4M revenue growth in Q3')).toBe('impact')
  })

  it('A3: identifies adoption increase as impact', () => {
    expect(classifyMetric('Drove 40% adoption increase within 90 days of launch')).toBe('impact')
  })

  it('A4: identifies ticket count as volume', () => {
    expect(classifyMetric('Managed 85 tickets per sprint across four teams')).toBe('volume')
  })

  it('A5: identifies request count as volume', () => {
    expect(classifyMetric('Processed 120 requests weekly from the support queue')).toBe('volume')
  })

  it('A6: identifies sprint cadence as process', () => {
    expect(classifyMetric('Ran 2-week sprints with daily standups')).toBe('process')
  })

  it('A7: identifies bi-weekly sprint as process', () => {
    expect(classifyMetric('Facilitated bi-weekly sprint planning and retrospectives')).toBe('process')
  })

  it('A8: percentage alone (no signal word) → impact via heuristic', () => {
    expect(classifyMetric('Achieved 18% improvement in cycle time')).toBe('impact')
  })

  it('A9: dollar amount alone → impact via heuristic', () => {
    expect(classifyMetric('Delivered $500K in cost savings by eliminating redundant processes')).toBe('impact')
  })

  it('A10: generic delivery statement without metric → unclassified', () => {
    expect(classifyMetric('Coordinated with stakeholders to align priorities')).toBe('unclassified')
  })

  it('A11: volume keyword without explicit count → unclassified (no pattern match)', () => {
    expect(classifyMetric('Reviewed backlog items during sprint planning')).toBe('unclassified')
  })

  it('A12: cycle-time improvement → impact', () => {
    expect(classifyMetric('Reduced cycle time from 14 days to 8 days')).toBe('impact')
  })
})

// ─── Suite B — validateBulletMetrics ─────────────────────────────────────────

describe('B: validateBulletMetrics', () => {
  it('B1: lenient policy returns no violations regardless of content', () => {
    const bullets = [
      '- Processed 200 support tickets per week',
      '- Managed 50 stakeholder requests monthly',
    ]
    expect(validateBulletMetrics(bullets, LENIENT_POLICY)).toHaveLength(0)
  })

  it('B2: strict policy flags volume bullet without impact tie', () => {
    const bullets = ['- Handled 90 inbound tickets per sprint']
    const violations = validateBulletMetrics(bullets, STRICT_POLICY)
    expect(violations).toHaveLength(1)
    expect(violations[0].issue).toBe('volume_without_impact')
    expect(violations[0].severity).toBe('error')
  })

  it('B3: strict policy does NOT flag volume bullet that has impact tie in same line', () => {
    const bullets = ['- Reduced support ticket volume by 35% through proactive documentation']
    const violations = validateBulletMetrics(bullets, STRICT_POLICY)
    const volumeWithoutImpact = violations.filter(v => v.issue === 'volume_without_impact')
    expect(volumeWithoutImpact).toHaveLength(0)
  })

  it('B4: strict policy flags process-as-headline bullet', () => {
    const bullets = ['- Ran 2-week sprints each quarter for three product teams']
    const violations = validateBulletMetrics(bullets, STRICT_POLICY)
    const processViolations = violations.filter(v => v.issue === 'process_as_headline')
    expect(processViolations).toHaveLength(1)
    expect(processViolations[0].severity).toBe('warning')
  })

  it('B5: impact bullet generates no violations', () => {
    const bullets = ['- Improved feature adoption by 28% over two quarters']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })

  it('B6: unclassified bullet generates no violations', () => {
    const bullets = ['- Collaborated with engineering to finalize acceptance criteria']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })

  it('B7: multiple volume bullets each flagged separately', () => {
    const bullets = [
      '- Managed 40 user stories per sprint',
      '- Reviewed 70 requests from customer success team monthly',
    ]
    const violations = validateBulletMetrics(bullets, STRICT_POLICY)
    expect(violations.filter(v => v.issue === 'volume_without_impact')).toHaveLength(2)
  })

  it('B8: metricSnippet is populated for flagged bullets', () => {
    const bullets = ['- Handled 55 inbound requests weekly']
    const violations = validateBulletMetrics(bullets, STRICT_POLICY)
    expect(violations[0].metricSnippet).toBeTruthy()
  })

  it('B9: team composition with developers and QA does not trigger volume violation', () => {
    const bullets = ['- Coordinated delivery scope across 6 developers and 1 QA.']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })

  it('B10: team of 8 is scope context and does not trigger volume violation', () => {
    const bullets = ['- Led release planning for a team of 8 across product and engineering.']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })

  it('B11: analyzed 3,000 requests still triggers without impact tie', () => {
    const bullets = ['- Analyzed 3,000 requests from internal stakeholders.']
    const violations = validateBulletMetrics(bullets, STRICT_POLICY)
    expect(violations.some(v => v.issue === 'volume_without_impact')).toBe(true)
  })

  it('B12: reduced 50-80 support tickets is impact and passes', () => {
    const bullets = ['- Reduced 50-80 support tickets per month through clearer documentation.']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })

  it('B13: bare processed count without workload noun does not trigger volume violation', () => {
    const bullets = ['- Processed 2 release decisions through stakeholder review.']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })

  it('B14: biweekly cadence improvement with impact language does not trigger volume violation', () => {
    const bullets = ['- Integrated smoke and regression suites into CI pipeline, strengthening quality and accelerating release cadence from monthly to biweekly.']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })

  it('B15: education degree text is not a volume metric', () => {
    const bullets = ['BS | Electrical and Computer Engineering | Example University']
    expect(validateBulletMetrics(bullets, STRICT_POLICY)).toHaveLength(0)
  })
})

// ─── Suite C — policy interaction ─────────────────────────────────────────────

describe('C: policy interaction', () => {
  it('C1: preferImpactOverVolume=false reduces volume violations to warning', () => {
    const relaxedPolicy: MetricPolicy = {
      preferImpactOverVolume: false,
      volumeMetricsRequireImpactTie: true,
    }
    const bullets = ['- Processed 100 change requests each quarter']
    const violations = validateBulletMetrics(bullets, relaxedPolicy)
    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('warning')
  })

  it('C2: volumeMetricsRequireImpactTie=false suppresses all volume violations', () => {
    const bullets = [
      '- Processed 100 change requests each quarter',
      '- Managed 200 support tickets per month',
    ]
    expect(validateBulletMetrics(bullets, LENIENT_POLICY)).toHaveLength(0)
  })

  it('C3: mixed bullet list produces violations only for volume/process bullets', () => {
    const bullets = [
      '- Improved retention by 15% through proactive customer success workflows',
      '- Managed 60 support tickets per sprint',
      '- Coordinated requirements across three engineering squads',
    ]
    const violations = validateBulletMetrics(bullets, STRICT_POLICY)
    expect(violations).toHaveLength(1)
    expect(violations[0].issue).toBe('volume_without_impact')
  })
})
