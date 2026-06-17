'use client'
import { useState } from 'react'
import type { Stage1Finding } from '@/contracts'
import { Badge } from '@/components/shared/badge'

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

/** Matches a finding to a piece of existing Stage 1 UI text by topic or finding text. No fuzzy guessing beyond exact (normalized) match — an unmatched item just gets no trace chip. */
export function findFindingByTopic(findings: Stage1Finding[] | undefined, topic: string): Stage1Finding | undefined {
  if (!findings || !topic) return undefined
  const target = normalize(topic)
  return findings.find(f => normalize(f.topic) === target || normalize(f.findingText) === target)
}

/** Findings that don't correspond to any candidate label currently rendered inline — surfaced only in the debug fallback. */
export function computeUnmatchedFindings(
  findings: Stage1Finding[] | undefined,
  candidateLabels: string[],
): Stage1Finding[] {
  if (!findings || findings.length === 0) return []
  const matchedIds = new Set<string>()
  for (const label of candidateLabels) {
    const match = findFindingByTopic(findings, label)
    if (match) matchedIds.add(match.id)
  }
  return findings.filter(f => !matchedIds.has(f.id))
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

/** Compact source-trace body for a single finding — meant to be expanded next to the content it explains, not listed standalone. */
export function FindingTraceDetails({ finding, showTopic = false }: { finding: Stage1Finding; showTopic?: boolean }) {
  return (
    <div className="border border-gray-200 rounded p-2 bg-gray-50 space-y-1.5 text-left">
      {showTopic && <p className="text-xs font-medium text-gray-600">{finding.topic}</p>}
      <div className="flex gap-1 flex-wrap">
        {finding.coverageStatus && (
          <Badge variant={coverageVariant(finding.coverageStatus)}>{finding.coverageStatus}</Badge>
        )}
        {finding.downstreamPermission && <Badge variant="neutral">{finding.downstreamPermission}</Badge>}
      </div>
      <div className="space-y-1">
        {finding.sourceTrace.map((trace, i) => (
          <div key={i} className="text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-gray-600">{trace.sourceLabel}</span>
              <span className="text-gray-400">({trace.sourceType})</span>
              {trace.primary && <Badge variant="covered">primary</Badge>}
              <span className="text-gray-400">usage: {trace.usage}</span>
            </div>
            <p className="text-gray-500 italic">"{trace.supportingText}"</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Small chip that expands inline to a finding's trace. Renders nothing if no finding is passed. */
export function TraceChip({ finding, label = 'Trace' }: { finding?: Stage1Finding; label?: string }) {
  const [open, setOpen] = useState(false)
  if (!finding) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-200 shrink-0"
      >
        {open ? 'Hide trace' : label}
      </button>
      {open && (
        <div className="mt-1 w-full">
          <FindingTraceDetails finding={finding} />
        </div>
      )}
    </>
  )
}

/**
 * A bulleted line (risk gap, needs-evidence item, weakly-supported item) that gets a trace
 * chip only when a matching finding exists. With no match, renders exactly as before.
 */
export function TraceableBullet({
  text,
  finding,
  className,
}: {
  text: string
  finding?: Stage1Finding
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <li className={className}>
      <div className="flex items-start gap-2">
        <span className="shrink-0">·</span>
        <span className="flex-1">{text}</span>
        {finding && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-200 shrink-0"
          >
            {open ? 'Hide trace' : 'Trace'}
          </button>
        )}
      </div>
      {finding && open && (
        <div className="ml-4 mt-1">
          <FindingTraceDetails finding={finding} />
        </div>
      )}
    </li>
  )
}

/** Collapsed-by-default debug fallback for findings that exist but weren't matched to any rendered item. */
export function UnmatchedFindingsDebug({ findings }: { findings: Stage1Finding[] }) {
  if (findings.length === 0) return null
  return (
    <details className="border border-dashed border-gray-300 rounded p-2 text-xs text-gray-400">
      <summary className="cursor-pointer select-none">Unmatched source findings ({findings.length})</summary>
      <div className="mt-2 space-y-2">
        {findings.map(f => (
          <FindingTraceDetails key={f.id} finding={f} showTopic />
        ))}
      </div>
    </details>
  )
}
