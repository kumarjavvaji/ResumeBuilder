'use client'
import type { Stage1Finding } from '@/contracts'
import { Badge } from '@/components/shared/badge'

/**
 * Renders the formal, source-cited Stage 1 findings (fitAnalysis.findings).
 * Only renders what is present on each finding — no inferred or synthesized citations.
 */
export function Stage1FindingsView({ findings }: { findings?: Stage1Finding[] }) {
  if (!findings || findings.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 rounded-lg p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
          Source-backed Findings
        </h3>
        <p className="text-xs text-gray-400">
          No formal findings on this session. Either it was analyzed before provenance tracking
          existed, or no findings were derived for this artifact.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        Source-backed Findings
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        Claim-level provenance for findings that may influence Stage 2 questions. Sections not
        listed here have no formal source trace yet.
      </p>
      <div className="space-y-3">
        {findings.map(finding => (
          <Stage1FindingCard key={finding.id} finding={finding} />
        ))}
      </div>
    </div>
  )
}

function Stage1FindingCard({ finding }: { finding: Stage1Finding }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-gray-500">{finding.topic}</span>
        <div className="flex gap-1 shrink-0">
          {finding.coverageStatus && (
            <Badge variant={coverageVariant(finding.coverageStatus)}>{finding.coverageStatus}</Badge>
          )}
          {finding.downstreamPermission && (
            <Badge variant="neutral">{finding.downstreamPermission}</Badge>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-700 mb-2">{finding.findingText}</p>
      <div className="space-y-1.5">
        {finding.sourceTrace.map((trace, i) => (
          <div key={i} className="text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-600">{trace.sourceLabel}</span>
              <span className="text-gray-400">({trace.sourceType})</span>
              {trace.primary && <Badge variant="covered">primary</Badge>}
              <span className="text-gray-400">usage: {trace.usage}</span>
            </div>
            <p className="text-gray-500 italic mt-0.5">"{trace.supportingText}"</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function coverageVariant(status: Stage1Finding['coverageStatus']) {
  switch (status) {
    case 'covered': return 'covered' as const
    case 'partial': return 'partial' as const
    case 'gap': return 'gap' as const
    case 'needs_evidence': return 'partial' as const
    case 'weakly_supported': return 'partial' as const
    case 'context_only': return 'neutral' as const
    default: return 'neutral' as const
  }
}
