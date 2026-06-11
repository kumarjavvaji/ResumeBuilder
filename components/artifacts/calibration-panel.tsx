'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Spinner } from '@/components/shared/spinner'
import {
  dedupeCandidates,
  getEnrichedRefsFromCandidates,
  isMinThresholdMet,
  isIdealThresholdMet,
  countByType
} from '@/lib/calibration/pipeline-logic'
import {
  getSessionCandidates,
  saveCalibrationCandidates,
  updateCalibrationCandidate
} from '@/lib/storage/calibration-candidates'
import {
  getSessionCalibrationRefs,
  upsertCalibrationReference
} from '@/lib/storage/calibration'
import {
  saveCalibrationSynthesis,
  getCalibrationSynthesis,
  getAppliedCalibrationState,
  saveAppliedCalibrationState,
  markAppliedCalibrationStale
} from '@/lib/storage/applied-calibration'
import { nanoid } from '@/lib/storage/nanoid'
import type {
  CalibrationCandidate,
  CalibrationReference,
  CalibrationSummary,
  CalibrationDiagnostic,
  CalibrationSynthesisRecord,
  AppliedCalibrationState,
  CandidateStatus
} from '@/contracts'

interface CalibrationPanelProps {
  sessionId: string
  targetCompany: string
  roleTitle: string
  jdSummary?: string
  onCalibrationApplied: (summary: CalibrationSummary, appliedState: AppliedCalibrationState) => void
  onSkip: () => void
}

type PipelineStatus =
  | 'idle'
  | 'discovering'
  | 'enriching'
  | 'synthesizing'
  | 'paused'
  | 'complete'
  | 'error'

// ─── Small display components ─────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: CalibrationReference['confidence'] }) {
  const map = {
    high: 'text-green-400 bg-green-950/40 border-green-800/50',
    medium: 'text-amber-400 bg-amber-950/40 border-amber-800/50',
    low: 'text-gray-400 bg-gray-800/80 border-gray-700'
  }
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${map[confidence]}`}>{confidence}</span>
}

function MatchBadge({ matchType }: { matchType: CalibrationReference['matchType'] }) {
  const map: Record<CalibrationReference['matchType'], { label: string; cls: string }> = {
    target_company: { label: 'Target', cls: 'text-blue-300 bg-blue-950/40 border-blue-800/50' },
    competitor: { label: 'Competitor', cls: 'text-purple-300 bg-purple-950/40 border-purple-800/50' },
    adjacent_employer: { label: 'Adjacent', cls: 'text-gray-400 bg-gray-800/80 border-gray-700' }
  }
  const { label, cls } = map[matchType]
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
}

function CandidateStatusChip({ status }: { status: CandidateStatus }) {
  const map: Record<CandidateStatus, { label: string; cls: string }> = {
    queued: { label: 'Queued', cls: 'text-gray-500 border-gray-700' },
    enriching: { label: 'Enriching…', cls: 'text-blue-400 border-blue-800/50' },
    enriched: { label: 'Enriched', cls: 'text-green-500 border-green-800/50' },
    skipped: { label: 'Skipped', cls: 'text-gray-600 border-gray-700' },
    failed: { label: 'Failed', cls: 'text-red-400 border-red-800/50' },
    duplicate: { label: 'Duplicate', cls: 'text-gray-600 border-gray-700' },
    low_relevance: { label: 'Low relevance', cls: 'text-gray-600 border-gray-700' }
  }
  const { label, cls } = map[status]
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
}

// ─── Ref card ────────────────────────────────────────────────────────────────

function RefCard({ ref: r, onRemove }: { ref: CalibrationReference; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-gray-700 rounded-md px-3 py-2 space-y-1 bg-gray-900/40">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-medium text-white truncate">
            {r.personName ? `${r.personName} — ` : ''}{r.title}
          </span>
          <span className="text-xs text-gray-400 shrink-0">{r.company}</span>
          <MatchBadge matchType={r.matchType} />
          <ConfidenceBadge confidence={r.confidence} />
        </div>
        <button onClick={onRemove} className="shrink-0 text-xs text-gray-700 hover:text-red-400 mt-0.5">✕</button>
      </div>
      <p className="text-xs text-gray-400 italic">{r.matchReason}</p>
      {r.limitations && <p className="text-xs text-amber-600">⚠ {r.limitations}</p>}
      <button onClick={() => setExpanded(v => !v)} className="text-xs text-gray-600 hover:text-gray-400">
        {expanded ? 'Hide snippet ↑' : 'Show snippet ↓'}
      </button>
      {expanded && <p className="text-xs text-gray-500 whitespace-pre-wrap border-t border-gray-800 pt-1">{r.snippetOrSummary}</p>}
    </div>
  )
}

// ─── Candidate queue row ──────────────────────────────────────────────────────

function CandidateCard({ c, onRetry }: { c: CalibrationCandidate; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-gray-800/50 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <CandidateStatusChip status={c.status} />
        <span className="text-xs text-gray-400 truncate">{c.title} · {c.company}</span>
      </div>
      {c.status === 'enriching' && <Spinner className="h-3 w-3 text-blue-400 shrink-0" />}
      {c.status === 'failed' && onRetry && (
        <button onClick={onRetry} className="text-xs text-gray-500 hover:text-gray-300 shrink-0">retry</button>
      )}
    </div>
  )
}

// ─── Synthesis summary panel ──────────────────────────────────────────────────

function SummaryPanel({ summary }: { summary: CalibrationSummary }) {
  const sections: Array<{ label: string; items: string[] }> = [
    { label: 'Repeated titles', items: summary.repeatedTitles },
    { label: 'Repeated tools / skills', items: summary.repeatedSkillsTools },
    { label: 'Domain expectations', items: summary.domainExpectations },
    { label: 'Artifact guidance', items: summary.artifactGuidance },
    { label: 'Outreach guidance', items: summary.outreachGuidance },
    { label: 'Gaps to handle carefully', items: summary.gapsToHandleCarefully },
    { label: 'Credibility boundaries', items: summary.credibilityBoundaries }
  ].filter(s => s.items.length > 0)

  if (!sections.length) return null

  return (
    <div className="space-y-3 px-4 py-3 border border-blue-900/40 rounded-lg bg-blue-950/10">
      <p className="text-xs font-medium text-blue-300">Calibration Analysis</p>
      {sections.map(s => (
        <div key={s.label}>
          <p className="text-xs font-medium text-gray-400 mb-0.5">{s.label}</p>
          <ul className="space-y-0.5">
            {s.items.map((item, i) => <li key={i} className="text-xs text-gray-500">· {item}</li>)}
          </ul>
        </div>
      ))}
      <p className="text-xs text-gray-600 border-t border-gray-800 pt-2">
        Market observations only — not user evidence. Calibration refs may influence artifact language and emphasis, but must never create unsupported user claims.
      </p>
    </div>
  )
}

// ─── Applied state chip ───────────────────────────────────────────────────────

function AppliedChip({ state }: { state: AppliedCalibrationState }) {
  const stale = state.calibrationUpdatedAfterApply
  const partial = state.isPartial
  const ts = new Date(state.appliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (stale) {
    return (
      <span className="text-xs px-2 py-0.5 rounded border border-amber-800/50 text-amber-400 bg-amber-950/30">
        Applied {partial ? '(partial)' : ''} · stale after refresh
      </span>
    )
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded border border-green-800/50 text-green-400 bg-green-950/30">
      ✓ Applied {partial ? '(partial)' : ''} · {ts}
    </span>
  )
}

// ─── Add source form ──────────────────────────────────────────────────────────

function AddSourceForm({ sessionId, onAdded }: {
  sessionId: string
  onAdded: (ref: CalibrationReference) => void
}) {
  const [mode, setMode] = useState<'url' | 'paste' | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleAdd() {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/calibration', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          url: mode === 'url' ? url.trim() : undefined,
          pastedText: mode === 'paste' ? pastedText.trim() : undefined,
          title: title.trim() || undefined,
          company: company.trim() || undefined
        })
      })
      const data = await res.json()
      if (!res.ok || !data.reference) throw new Error(data.error ?? 'Failed.')
      onAdded(data.reference as CalibrationReference)
      setUrl(''); setTitle(''); setCompany(''); setPastedText(''); setMode(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed.')
    } finally {
      setLoading(false)
    }
  }

  if (!mode) {
    return (
      <div className="flex gap-2">
        <button onClick={() => setMode('url')} className="text-xs px-2 py-1 border border-gray-700 text-gray-400 rounded hover:border-gray-500 hover:text-gray-200">
          + Add URL
        </button>
        <button onClick={() => setMode('paste')} className="text-xs px-2 py-1 border border-gray-700 text-gray-400 rounded hover:border-gray-500 hover:text-gray-200">
          + Paste text
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 p-3 border border-gray-700 rounded-lg bg-gray-900/40">
      <div className="flex gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)"
          className="flex-1 text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500" />
        <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company (optional)"
          className="flex-1 text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500" />
      </div>
      {mode === 'url' ? (
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500" />
      ) : (
        <textarea value={pastedText} onChange={e => setPastedText(e.target.value)}
          placeholder="Paste profile bio, LinkedIn summary, or any public text…"
          rows={4}
          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none" />
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button onClick={handleAdd} disabled={loading}
          className="text-xs px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-40">
          {loading ? <span className="flex items-center gap-1"><Spinner className="h-3 w-3" />Adding…</span> : 'Add'}
        </button>
        <button onClick={() => { setMode(null); setErr('') }} className="text-xs px-3 py-1 text-gray-500 hover:text-gray-300">Cancel</button>
      </div>
    </div>
  )
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

function DiagnosticsPanel({ diagnostics }: { diagnostics: CalibrationDiagnostic[] }) {
  const [open, setOpen] = useState(false)
  if (!diagnostics.length) return null
  const hasFailed = diagnostics.some(d => d.outcome === 'failed' || d.outcome === 'limited')
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className={`text-xs ${hasFailed ? 'text-amber-500' : 'text-gray-500'} hover:text-gray-300`}>
        {hasFailed ? '⚠ ' : ''}{diagnostics.length} diagnostic{diagnostics.length !== 1 ? 's' : ''} {open ? '↑' : '↓'}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {diagnostics.map((d, i) => (
            <li key={i} className="text-xs text-gray-500">
              <span className={d.outcome === 'failed' || d.outcome === 'limited' ? 'text-amber-600' : 'text-green-700'}>[{d.outcome}]</span>{' '}
              {d.query}: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function CalibrationPanel({
  sessionId,
  targetCompany,
  roleTitle,
  jdSummary,
  onCalibrationApplied,
  onSkip
}: CalibrationPanelProps) {
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle')
  const [candidates, setCandidates] = useState<CalibrationCandidate[]>([])
  const [userRefs, setUserRefs] = useState<CalibrationReference[]>([])
  const [synthesisRecord, setSynthesisRecord] = useState<CalibrationSynthesisRecord | undefined>()
  const [appliedState, setAppliedState] = useState<AppliedCalibrationState | undefined>()
  const [diagnostics, setDiagnostics] = useState<CalibrationDiagnostic[]>([])
  const [showSummary, setShowSummary] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const candidatesRef = useRef<CalibrationCandidate[]>([])

  function syncCandidates(updated: CalibrationCandidate[]) {
    candidatesRef.current = updated
    setCandidates([...updated])
  }

  // ── Load persisted state on mount ───────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const [saved, savedUserRefs, savedSynthesis, savedApplied] = await Promise.all([
        getSessionCandidates(sessionId),
        getSessionCalibrationRefs(sessionId),
        getCalibrationSynthesis(sessionId),
        getAppliedCalibrationState(sessionId)
      ])

      setUserRefs(savedUserRefs)
      if (savedSynthesis) setSynthesisRecord(savedSynthesis)
      if (savedApplied) setAppliedState(savedApplied)

      if (saved.length > 0) {
        // Reset any 'enriching' status left over when page closed mid-run
        const reset = saved.map(c =>
          c.status === 'enriching' ? { ...c, status: 'queued' as CandidateStatus } : c
        )
        syncCandidates(reset)

        const hasEnriched = reset.some(c => c.status === 'enriched')
        const hasQueued = reset.some(c => c.status === 'queued')
        if (hasEnriched && !hasQueued) {
          setPipelineStatus('complete')
        } else if (hasEnriched && hasQueued) {
          setPipelineStatus('paused') // had partial run
        }
      }
    }
    load()
  }, [sessionId])

  // ── Derived values ──────────────────────────────────────────────────────────

  const enrichedRefs = getEnrichedRefsFromCandidates(candidates)
  const allRefs = [...enrichedRefs, ...userRefs]
  const counts = countByType(allRefs)
  const minMet = isMinThresholdMet(allRefs)
  const idealMet = isIdealThresholdMet(allRefs)

  const activeCount = candidates.filter(c => c.status === 'enriching').length
  const queuedCount = candidates.filter(c => c.status === 'queued').length
  const failedCandidates = candidates.filter(c => c.status === 'failed' && c.retryCount < 2)
  const isRunning = pipelineStatus === 'discovering' || pipelineStatus === 'enriching' || pipelineStatus === 'synthesizing'

  // Calibration readiness label (4/5 is usable partial, not a failure)
  function getReadinessLabel(): string {
    if (allRefs.length === 0) return ''
    if (idealMet) return 'Full calibration'
    if (minMet) return 'Usable partial calibration'
    return 'Below threshold'
  }

  // ── Pipeline steps ──────────────────────────────────────────────────────────

  const runDiscovery = useCallback(async (signal: AbortSignal): Promise<CalibrationCandidate[]> => {
    setPipelineStatus('discovering')

    const [targetRes, comparableRes] = await Promise.allSettled([
      fetch('/api/calibration/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetCompany, roleTitle, type: 'target', jdSummary }),
        signal
      }).then(r => r.json()),
      fetch('/api/calibration/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetCompany, roleTitle, type: 'comparable', jdSummary }),
        signal
      }).then(r => r.json())
    ])

    const newDiagnostics: CalibrationDiagnostic[] = []
    const allNew: CalibrationCandidate[] = []

    for (const res of [targetRes, comparableRes]) {
      if (res.status === 'fulfilled') {
        allNew.push(...(res.value.candidates ?? []))
        newDiagnostics.push(...(res.value.diagnostics ?? []))
      } else {
        newDiagnostics.push({ query: 'discovery', outcome: 'failed', message: String(res.reason) })
      }
    }

    const deduped = dedupeCandidates(allNew, candidatesRef.current)
    const fresh = deduped.filter(c => c.status !== 'duplicate')
    const merged = [...candidatesRef.current, ...fresh]
    syncCandidates(merged)
    setDiagnostics(prev => [...prev, ...newDiagnostics])

    // Persist immediately after discovery
    await saveCalibrationCandidates(merged)
    return fresh.filter(c => c.status === 'queued')
  }, [sessionId, targetCompany, roleTitle, jdSummary])

  const enrichOne = useCallback(async (candidate: CalibrationCandidate, signal: AbortSignal): Promise<void> => {
    const enrichingCandidate = { ...candidate, status: 'enriching' as CandidateStatus }
    syncCandidates(candidatesRef.current.map(c => c.id === candidate.id ? enrichingCandidate : c))

    let enriched: CalibrationCandidate

    try {
      const res = await fetch('/api/calibration/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate, targetCompany, roleTitle }),
        signal
      })
      const data = await res.json()
      enriched = data.candidate ?? { ...candidate, status: 'failed', failureReason: 'Empty response.' }
    } catch (err) {
      if (signal.aborted) return
      enriched = { ...candidate, status: 'failed', failureReason: err instanceof Error ? err.message : 'Failed.' }
    }

    const updated = candidatesRef.current.map(c => c.id === candidate.id ? enriched : c)
    syncCandidates(updated)

    // Persist each enriched/failed candidate immediately
    await updateCalibrationCandidate(enriched)
  }, [targetCompany, roleTitle])

  const runEnrichmentQueue = useCallback(async (queue: CalibrationCandidate[], signal: AbortSignal): Promise<void> => {
    setPipelineStatus('enriching')
    const MAX_CONCURRENCY = 2

    for (let i = 0; i < queue.length; i += MAX_CONCURRENCY) {
      if (signal.aborted) return
      const batch = queue.slice(i, i + MAX_CONCURRENCY).filter(c => c.status === 'queued')
      await Promise.all(batch.map(c => enrichOne(c, signal)))
    }
  }, [enrichOne])

  const runSynthesis = useCallback(async (refs: CalibrationReference[], signal: AbortSignal): Promise<void> => {
    if (refs.length === 0) return
    setPipelineStatus('synthesizing')

    try {
      const res = await fetch('/api/calibration/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs, targetCompany, roleTitle }),
        signal
      })
      const data = await res.json()
      if (data.summary) {
        // Persist synthesis record immediately
        const tc = refs.filter(r => r.matchType === 'target_company').length
        const cc = refs.filter(r => r.matchType !== 'target_company').length
        const saved = await saveCalibrationSynthesis({
          sessionId,
          summary: data.summary,
          targetRefCount: tc,
          comparableRefCount: cc,
          generatedAt: new Date().toISOString()
        })
        setSynthesisRecord(saved)
      }
    } catch (err) {
      if (!signal.aborted) {
        setDiagnostics(prev => [...prev, {
          query: 'synthesis',
          outcome: 'failed',
          message: err instanceof Error ? err.message : 'Synthesis failed.'
        }])
      }
    }
  }, [sessionId, targetCompany, roleTitle])

  // ── Full pipeline ───────────────────────────────────────────────────────────

  const startPipeline = useCallback(async (mode: 'fresh' | 'resume' = 'fresh') => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    if (mode === 'fresh') {
      syncCandidates([])
      setDiagnostics([])
      setSynthesisRecord(undefined)
    }

    try {
      const freshQueue = mode === 'fresh'
        ? await runDiscovery(signal)
        : candidatesRef.current.filter(c => c.status === 'queued')

      if (signal.aborted) return

      if (freshQueue.length > 0 || mode === 'resume') {
        await runEnrichmentQueue(freshQueue, signal)
      }

      if (signal.aborted) return

      const enriched = getEnrichedRefsFromCandidates(candidatesRef.current)
      const allForSynth = [...enriched, ...userRefs]
      await runSynthesis(allForSynth, signal)

      if (!signal.aborted) setPipelineStatus('complete')
    } catch (err) {
      if (!signal.aborted) {
        setDiagnostics(prev => [...prev, {
          query: 'pipeline',
          outcome: 'failed',
          message: err instanceof Error ? err.message : 'Pipeline error.'
        }])
        setPipelineStatus('error')
      }
    }
  }, [runDiscovery, runEnrichmentQueue, runSynthesis, userRefs])

  // ── Controls ────────────────────────────────────────────────────────────────

  function handlePause() {
    abortRef.current?.abort()
    setPipelineStatus('paused')
  }

  function handleResume() { startPipeline('resume') }

  function handleStop() {
    abortRef.current?.abort()
    setPipelineStatus(allRefs.length > 0 ? 'complete' : 'idle')
  }

  async function handleRefresh() {
    // Mark existing applied state as stale before refreshing
    if (appliedState && !appliedState.calibrationUpdatedAfterApply) {
      await markAppliedCalibrationStale(sessionId)
      setAppliedState(prev => prev ? { ...prev, calibrationUpdatedAfterApply: true, applyStatus: 'stale_after_refresh' } : prev)
    }
    startPipeline('fresh')
  }

  async function handleRetryFailed() {
    const retryable = candidatesRef.current.map(c =>
      (c.status === 'failed' && c.retryCount < 2) ? { ...c, status: 'queued' as CandidateStatus, retryCount: c.retryCount + 1 } : c
    )
    syncCandidates(retryable)
    await saveCalibrationCandidates(retryable)
    startPipeline('resume')
  }

  async function handleApply() {
    const summaryToApply: CalibrationSummary = synthesisRecord?.summary ?? buildPartialSummary(allRefs)
    const isPartial = !synthesisRecord || !idealMet
    const now = new Date().toISOString()

    const newAppliedState: AppliedCalibrationState = {
      id: nanoid(),
      sessionId,
      summary: summaryToApply,
      applyStatus: isPartial ? 'applied_partial' : 'applied_full',
      isPartial,
      targetReferenceCount: counts.target,
      comparableReferenceCount: counts.comparable,
      appliedCalibrationPatterns: summaryToApply.calibrationPatterns.slice(0, 8),
      referencedCalibrationIds: allRefs.map(r => r.id),
      appliedAt: now,
      calibrationUpdatedAfterApply: false
    }

    // Persist applied state to IndexedDB
    await saveAppliedCalibrationState(newAppliedState)

    // Update local state
    setAppliedState(newAppliedState)

    // Notify parent
    onCalibrationApplied(summaryToApply, newAppliedState)
  }

  async function handleRemoveRef(id: string) {
    setUserRefs(prev => prev.filter(r => r.id !== id))
    syncCandidates(candidatesRef.current.map(c =>
      c.id === id ? { ...c, status: 'low_relevance' as CandidateStatus } : c
    ))
    await saveCalibrationCandidates(candidatesRef.current)
  }

  function handleAddedUserRef(ref: CalibrationReference) {
    setUserRefs(prev => [...prev, ref])
    upsertCalibrationReference(ref).catch(() => {})
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const targetRefs = allRefs.filter(r => r.matchType === 'target_company')
  const comparableRefs = allRefs.filter(r => r.matchType !== 'target_company')
  const isApplied = appliedState !== undefined && !appliedState.calibrationUpdatedAfterApply
  const readinessLabel = getReadinessLabel()

  const statusLabel: Record<PipelineStatus, string> = {
    idle: 'Not started',
    discovering: 'Searching…',
    enriching: `Enriching (${activeCount} active, ${queuedCount} queued)…`,
    synthesizing: 'Analyzing patterns…',
    paused: 'Paused',
    complete: 'Complete',
    error: 'Error'
  }

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-800/60 border-b border-gray-700">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <h2 className="text-sm font-semibold text-white shrink-0">Stage 3A — Calibration References</h2>

          {allRefs.length > 0 && (
            <span className="text-xs text-gray-400 shrink-0">
              {counts.target}/5 target · {counts.comparable}/5 comparable
            </span>
          )}
          {allRefs.length > 0 && readinessLabel && (
            <span className={`text-xs shrink-0 ${idealMet ? 'text-green-500' : minMet ? 'text-amber-400' : 'text-gray-500'}`}>
              {readinessLabel}
            </span>
          )}
          {isRunning && <span className="text-xs text-blue-400">{statusLabel[pipelineStatus]}</span>}
          {!isRunning && appliedState && <AppliedChip state={appliedState} />}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {pipelineStatus === 'idle' && (
            <button onClick={() => startPipeline('fresh')}
              className="text-xs px-3 py-1 border border-gray-600 text-gray-300 rounded hover:border-gray-400 hover:text-white">
              Search
            </button>
          )}
          {isRunning && (
            <>
              <button onClick={handlePause}
                className="text-xs px-2 py-1 border border-gray-600 text-gray-400 rounded hover:border-gray-400 hover:text-gray-200">
                Pause
              </button>
              <button onClick={handleStop}
                className="text-xs px-2 py-1 border border-gray-700 text-gray-500 rounded hover:border-gray-500 hover:text-gray-400">
                Stop
              </button>
            </>
          )}
          {pipelineStatus === 'paused' && (
            <button onClick={handleResume}
              className="text-xs px-3 py-1 border border-gray-600 text-gray-300 rounded hover:border-gray-400 hover:text-white">
              Resume
            </button>
          )}
          {(pipelineStatus === 'complete' || pipelineStatus === 'error' || pipelineStatus === 'paused') && !isRunning && (
            <button onClick={handleRefresh}
              className="text-xs px-2 py-1 border border-gray-700 text-gray-500 rounded hover:border-gray-500 hover:text-gray-300">
              Refresh
            </button>
          )}

          {/* Apply button — shown when min threshold met */}
          {minMet && !isRunning && (
            <button
              onClick={handleApply}
              className={`text-xs px-3 py-1 border rounded ${
                isApplied
                  ? 'border-green-800/50 text-green-400 bg-green-950/20 hover:border-green-600 hover:text-green-300'
                  : 'border-blue-700 text-blue-300 hover:border-blue-500 hover:text-blue-100'
              }`}
            >
              {isApplied
                ? (appliedState?.isPartial ? 'Re-apply partial' : 'Re-apply')
                : (idealMet && synthesisRecord ? 'Apply calibration' : 'Apply partial calibration')}
            </button>
          )}

          <button onClick={onSkip} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-300">Skip</button>
          <button onClick={() => setCollapsed(v => !v)} className="text-xs text-gray-600 hover:text-gray-400 ml-1">
            {collapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 py-4 space-y-4">
          {/* Idle description */}
          {pipelineStatus === 'idle' && allRefs.length === 0 && (
            <p className="text-xs text-gray-400">
              Calibration searches for 3–5 target-company and 3–5 comparable-employer profiles from public sources.
              Results appear progressively — 4/5 is usable partial calibration. You can apply as soon as the minimum set is found.
            </p>
          )}

          {/* Target company refs */}
          {targetRefs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400">
                {targetCompany} — {targetRefs.length}/5
                {targetRefs.length >= 3 && targetRefs.length < 5 && <span className="text-amber-500 ml-1">(usable)</span>}
                {targetRefs.length >= 5 && <span className="text-green-500 ml-1">(complete)</span>}
              </p>
              {targetRefs.map(r => <RefCard key={r.id} ref={r} onRemove={() => handleRemoveRef(r.id)} />)}
            </div>
          )}

          {/* Comparable refs */}
          {comparableRefs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400">
                Comparable / competitor — {comparableRefs.length}/5
                {comparableRefs.length >= 3 && comparableRefs.length < 5 && <span className="text-amber-500 ml-1">(usable)</span>}
                {comparableRefs.length >= 5 && <span className="text-green-500 ml-1">(complete)</span>}
              </p>
              {comparableRefs.map(r => <RefCard key={r.id} ref={r} onRemove={() => handleRemoveRef(r.id)} />)}
            </div>
          )}

          {/* Queue (when running) */}
          {isRunning && candidates.filter(c => c.status !== 'enriched' && c.status !== 'low_relevance' && c.status !== 'duplicate').length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Queue</p>
              {candidates
                .filter(c => c.status !== 'enriched' && c.status !== 'duplicate' && c.status !== 'low_relevance')
                .map(c => <CandidateCard key={c.id} c={c} />)}
            </div>
          )}

          {/* Retry failed */}
          {failedCandidates.length > 0 && !isRunning && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">{failedCandidates.length} failed</span>
              <button onClick={handleRetryFailed} className="text-xs text-gray-500 hover:text-gray-300 underline">Retry</button>
            </div>
          )}

          {/* Synthesis analysis */}
          {synthesisRecord && (
            <div className="space-y-2">
              <button onClick={() => setShowSummary(v => !v)} className="text-xs text-blue-400 hover:text-blue-200">
                {showSummary ? 'Hide calibration analysis ↑' : 'Show calibration analysis ↓'}
              </button>
              {showSummary && <SummaryPanel summary={synthesisRecord.summary} />}
            </div>
          )}

          {/* Threshold hint — below minimum */}
          {!isRunning && !minMet && allRefs.length > 0 && (
            <p className="text-xs text-gray-500">
              {counts.target < 3 ? `${3 - counts.target} more target ref${3 - counts.target !== 1 ? 's' : ''} needed` : ''}
              {counts.target < 3 && counts.comparable < 3 ? ' or ' : ''}
              {counts.comparable < 3 ? `${3 - counts.comparable} more comparable ref${3 - counts.comparable !== 1 ? 's' : ''} needed` : ''} to enable apply.
              &nbsp;
              <button onClick={() => startPipeline('resume')} className="underline hover:text-gray-300">Continue searching</button>
            </p>
          )}

          <AddSourceForm sessionId={sessionId} onAdded={handleAddedUserRef} />
          <DiagnosticsPanel diagnostics={diagnostics} />

          <p className="text-xs text-gray-700 border-t border-gray-800/60 pt-2">
            Calibration references tune artifact strategy only — they are market observations, not evidence of user skills.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Helper: build a partial summary when synthesis hasn't run yet ────────────

function buildPartialSummary(refs: CalibrationReference[]): CalibrationSummary {
  return {
    targetCompanyPatterns: [],
    competitorPatterns: [],
    repeatedTitles: [...new Set(refs.map(r => r.title))].slice(0, 6),
    repeatedSkillsTools: [],
    domainExpectations: [],
    credibilityBoundaries: [],
    artifactGuidance: refs.map(r => r.matchReason).filter(Boolean).slice(0, 5),
    outreachGuidance: [],
    gapsToHandleCarefully: [],
    calibrationUsed: true,
    // Patterns must be short normalized labels — not raw matchReason text.
    // Without synthesis, no labels are available; provenance shows ref counts instead.
    calibrationPatterns: [],
    generatedAt: new Date().toISOString()
  }
}
