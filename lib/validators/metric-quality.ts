import type { MetricClass, MetricPolicy } from '@/contracts'

export type { MetricClass }

export interface MetricViolation {
  bulletText: string
  metricSnippet: string
  metricClass: MetricClass
  issue: 'volume_without_impact' | 'process_as_headline'
  severity: 'error' | 'warning'
}

const TEAM_SCOPE_SIGNALS: RegExp[] = [
  /\bteam\s+of\s+\d+\b/i,
  /\bsquad\s+of\s+\d+\b/i,
  /\b\d+\+?\s+(?:developers?|engineers?|analysts?|qas?|qa|testers?|product\s+owners?|product\s+managers?|designers?|members?)\b/i,
]

// Impact: changes a measurable outcome, such as revenue, retention, speed, quality, or adoption.
const IMPACT_SIGNALS: RegExp[] = [
  /\brevenue\b/i,
  /\bretention\b/i,
  /\badoption\b/i,
  /\butiliz(?:ation|ized|ing)\b/i,
  /\bredu(?:ced|cing|ction)\b/i,
  /\bimprove[dm]?\b/i,
  /\bgrew?\b/i,
  /\bgrowth\b/i,
  /\bacceler(?:ated?|ating)\b/i,
  /\breleas(?:e|ed|ing)\s+(?:time|cycle|frequency|cadence)\b/i,
  /\bcycle.?time\b/i,
  /\btime.?to.?market\b/i,
  /\bsaving[s]?\b/i,
  /\befficiency\b/i,
  /\bdefect\s+rate\b/i,
  /\bchurn\b/i,
  /\bconversion\b/i,
  /\blatency\b/i,
  /\bperformance\b/i,
  /\bkpi\b/i,
  /\bsla\b/i,
  /\buplift\b/i,
]

// Volume: workload or throughput counts, not scope/context counts.
const VOLUME_SIGNALS: RegExp[] = [
  /\b\d+\+?\s+(?:\w+\s+){0,2}(?:requests?|tickets?|issues?|stories?|user\s+stories?|features?|bugs?|defects?|cases?|records?|items?)\b/i,
  /\b\d+\+?\s+(?:meetings?|standups?|stakeholders?|customers?|users?|clients?|accounts?|reports?)\b/i,
  /\b(?:analyz(?:ed|ing)|review(?:ed|ing)|processed?|handled?|generated?)\s+\d[\d,.]*\+?\s+(?:\w+\s+){0,2}(?:requests?|tickets?|cases?|records?|stories?|meetings?|stakeholders?|clients?|customers?|defects?|reports?)\b/i,
  /\bmanaged?\s+\d+\s+(?:ticket|request|issue|story|case|item|defect)\b/i,
]

// Process: cadence / ritual / ceremony metrics, not outcomes.
const PROCESS_SIGNALS: RegExp[] = [
  /\b\d+[-\s]?week\s+sprints?\b/i,
  /\bbi[-\s]?weekly\s+(?:sprint|meeting|standup|sync)\b/i,
  /\bdaily\s+standup\b/i,
  /\b\d+\s+sprints?\s+per\b/i,
]

export function classifyMetric(text: string): MetricClass {
  if (IMPACT_SIGNALS.some(p => p.test(text))) return 'impact'
  if (TEAM_SCOPE_SIGNALS.some(p => p.test(text))) return 'unclassified'
  if (PROCESS_SIGNALS.some(p => p.test(text))) return 'process'
  if (VOLUME_SIGNALS.some(p => p.test(text))) return 'volume'
  if (/\d+%/.test(text) || /\$\d+/.test(text)) return 'impact'
  return 'unclassified'
}

export function validateBulletMetrics(
  bullets: string[],
  policy: MetricPolicy,
): MetricViolation[] {
  if (!policy.volumeMetricsRequireImpactTie) return []

  const violations: MetricViolation[] = []

  for (const bullet of bullets) {
    const mc = classifyMetric(bullet)

    if (mc === 'volume') {
      const hasImpactTie = IMPACT_SIGNALS.some(p => p.test(bullet))
      if (!hasImpactTie) {
        violations.push({
          bulletText: bullet,
          metricSnippet: extractMetricSnippet(bullet),
          metricClass: 'volume',
          issue: 'volume_without_impact',
          severity: policy.preferImpactOverVolume ? 'error' : 'warning',
        })
      }
    }

    if (mc === 'process') {
      const leadingClause = bullet.replace(/^[-*•]\s*/, '').split(/[,;]/)[0]
      if (PROCESS_SIGNALS.some(p => p.test(leadingClause))) {
        violations.push({
          bulletText: bullet,
          metricSnippet: extractMetricSnippet(leadingClause),
          metricClass: 'process',
          issue: 'process_as_headline',
          severity: 'warning',
        })
      }
    }
  }

  return violations
}

function extractMetricSnippet(text: string): string {
  const metricPattern = [...VOLUME_SIGNALS, ...PROCESS_SIGNALS, ...IMPACT_SIGNALS]
    .map(pattern => text.match(pattern))
    .find(Boolean)
  if (metricPattern?.[0]) return metricPattern[0].trim()

  const m = text.match(/\$?\d[\d,.]*\s*(?:%|k|m|billion|million|\+)?/i)
  return m ? m[0].trim() : ''
}
