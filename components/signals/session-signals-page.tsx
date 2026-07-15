'use client'

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type { Stage5Tab, StageLearningStage, Stage5LearningReport, Stage5MetaSignal } from '@/lib/stage5/session-learning'
import type { NormalizedLearning, NormalizedLearningBucket } from '@/contracts'
import { getSession } from '@/lib/storage/sessions'
import { getSessionBridgeQuestions } from '@/lib/storage/bridge-questions'
import { getSessionSections } from '@/lib/storage/artifacts'
import { getAppliedCalibrationState } from '@/lib/storage/applied-calibration'
import { getStage4RawResumeText } from '@/lib/storage/stage4-raw-resume'
import { getUserProfile } from '@/lib/storage/user-profile'
import { getAllSignals } from '@/lib/storage/learning-signals'
import {
  getNormalizedLearningsForSession,
  saveNormalizedLearnings,
  getAllNormalizedLearnings,
  filterNovelCandidates,
} from '@/lib/storage/normalized-learnings'
import { buildStage5LearningReport, primaryLearningSignals } from '@/lib/stage5/session-learning'
import { convertSignalsToRawCandidates } from '@/lib/stage5/normalization-pipeline'
import { Spinner } from '@/components/shared/spinner'

// ─── Tab types ────────────────────────────────────────────────────────────────

type PageTab = Stage5Tab | 'normalized'

const TAB_LABELS: Record<PageTab, string> = {
  strategy: 'Strategy',
  stages: 'By Stage',
  personal: 'Personal',
  global: 'Global',
  facts: 'Artifact Facts',
  normalized: 'Normalized',
}

const STAGE_LABELS: Record<StageLearningStage, string> = {
  stage1: 'Stage 1 - Target Intake',
  stage2: 'Stage 2 - Bridge Questions',
  stage3a: 'Stage 3A - Calibration',
  stage3b: 'Stage 3B - Artifact Refinement',
  stage4: 'Stage 4 - Raw Text Export'
}

// ─── Bucket display config ────────────────────────────────────────────────────

const BUCKET_LABELS: Record<NormalizedLearningBucket, string> = {
  artifact_fact: 'Artifact Fact',
  bridge_fact: 'Bridge Fact',
  personal_signal: 'Personal Signal',
  strategy_signal: 'Strategy Signal',
  global_signal: 'Global Signal',
  stage_learning: 'Stage Learning',
}

const BUCKET_COLORS: Record<NormalizedLearningBucket, string> = {
  artifact_fact: 'bg-slate-800 text-slate-300 border-slate-700',
  bridge_fact: 'bg-teal-900/60 text-teal-300 border-teal-800/50',
  personal_signal: 'bg-blue-900/60 text-blue-300 border-blue-800/50',
  strategy_signal: 'bg-purple-900/60 text-purple-300 border-purple-800/50',
  global_signal: 'bg-amber-900/60 text-amber-300 border-amber-800/50',
  stage_learning: 'bg-gray-800 text-gray-400 border-gray-700',
}

const BUCKET_QUESTIONS: Record<NormalizedLearningBucket, string> = {
  artifact_fact: 'What is true?',
  bridge_fact: 'How does evidence connect to a JD requirement?',
  personal_signal: 'How should this candidate\'s evidence be used next time?',
  strategy_signal: 'How should artifacts be shaped for this role family or strategy?',
  global_signal: 'What should ResumeBuilder always do?',
  stage_learning: 'What did this stage teach us about the workflow?',
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SessionSignalsPage({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<Stage5LearningReport | null>(null)
  const [normalizedLearnings, setNormalizedLearnings] = useState<NormalizedLearning[]>([])
  const [loading, setLoading] = useState(true)
  const [normalizing, setNormalizing] = useState(false)
  const [activeTab, setActiveTab] = useState<PageTab>('strategy')
  const [activeBucketFilter, setActiveBucketFilter] = useState<NormalizedLearningBucket | 'all'>('all')
  const [error, setError] = useState('')
  const [normalizeError, setNormalizeError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [session, bridgeQuestions, artifactSections, appliedCalibration, stage4RawText, profile, storedSignals, existingNormalized] = await Promise.all([
          getSession(sessionId),
          getSessionBridgeQuestions(sessionId),
          getSessionSections(sessionId),
          getAppliedCalibrationState(sessionId),
          getStage4RawResumeText(sessionId),
          getUserProfile(),
          getAllSignals(),
          getNormalizedLearningsForSession(sessionId),
        ])
        if (!session) {
          setError('Session not found.')
          return
        }
        const nextReport = buildStage5LearningReport({
          session,
          profile,
          bridgeQuestions,
          artifactSections,
          appliedCalibration,
          stage4RawText,
          storedSignals
        })
        setReport(nextReport)
        setNormalizedLearnings(existingNormalized)
        setActiveTab(existingNormalized.length > 0 ? 'normalized' : nextReport.defaultTab)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Stage 5 learning report.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  const strategySignals = useMemo(() => report ? primaryLearningSignals(report) : [], [report])
  const personalSignals = useMemo(() => strategySignals.filter(s => s.scope === 'personal' || s.scope === 'both'), [strategySignals])
  const globalSignals = useMemo(() => strategySignals.filter(s => s.scope === 'global' || s.scope === 'both'), [strategySignals])
  const artifactFactCount = report
    ? report.artifactFacts.acceptedBullets.length + report.artifactFacts.acceptedSkills.length + report.artifactFacts.approvedMetrics.length + report.artifactFacts.rejectedPhrases.length
    : 0

  const filteredNormalized = useMemo(
    () => activeBucketFilter === 'all'
      ? normalizedLearnings
      : normalizedLearnings.filter(l => l.bucket === activeBucketFilter),
    [normalizedLearnings, activeBucketFilter],
  )

  const normalizedBucketCounts = useMemo(() => {
    const counts: Partial<Record<NormalizedLearningBucket, number>> = {}
    for (const l of normalizedLearnings) {
      counts[l.bucket] = (counts[l.bucket] ?? 0) + 1
    }
    return counts
  }, [normalizedLearnings])

  async function runNormalization() {
    if (!report) return
    setNormalizing(true)
    setNormalizeError('')
    try {
      const rawCandidates = convertSignalsToRawCandidates(strategySignals, sessionId)
      if (rawCandidates.length === 0) {
        setNormalizeError('No signals to normalize.')
        return
      }

      const res = await fetch('/api/normalize-learnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: rawCandidates, sessionId }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Normalization failed.')
      }
      const { normalizedLearnings: newLearnings } = await res.json() as { normalizedLearnings: NormalizedLearning[] }

      // Client-side deduplication against all existing normalized learnings before saving
      const allExisting = await getAllNormalizedLearnings()
      const novel = filterNovelCandidates(newLearnings, allExisting)
      await saveNormalizedLearnings(novel)

      const updated = await getNormalizedLearningsForSession(sessionId)
      setNormalizedLearnings(updated)
      setActiveTab('normalized')
    } catch (err) {
      setNormalizeError(err instanceof Error ? err.message : 'Normalization failed.')
    } finally {
      setNormalizing(false)
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>
  if (error) return <p className="text-sm text-red-400">{error}</p>
  if (!report) return <p className="text-sm text-gray-500">No learning report available.</p>

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Stage 5 - Session Learning</h1>
          <p className="text-sm text-gray-400 mt-1">
            What this session taught ResumeBuilder about generating better targeted artifacts next time.
          </p>
        </div>
        <button
          onClick={runNormalization}
          disabled={normalizing || strategySignals.length === 0}
          className="shrink-0 px-4 py-2 bg-gray-700 text-white rounded text-sm font-medium hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
        >
          {normalizing && <Spinner className="text-white" />}
          {normalizing ? 'Normalizing…' : normalizedLearnings.length > 0 ? 'Re-Normalize' : 'Normalize & Save'}
        </button>
      </div>

      {normalizeError && (
        <p className="text-sm text-red-400 border border-red-800/50 rounded px-3 py-2">{normalizeError}</p>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Raw signals" value={strategySignals.length} />
        <SummaryCard label="Normalized" value={normalizedLearnings.length} />
        <SummaryCard label="Personal" value={personalSignals.length} />
        <SummaryCard label="Artifact facts" value={artifactFactCount} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-2">
        {(Object.keys(TAB_LABELS) as PageTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded text-xs border ${
              activeTab === tab
                ? 'bg-gray-200 text-gray-900 border-gray-200'
                : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
            }`}
          >
            {TAB_LABELS[tab]}
            {tab === 'normalized' && normalizedLearnings.length > 0 && (
              <span className="ml-1 text-gray-500">({normalizedLearnings.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Normalized learnings tab ── */}
      {activeTab === 'normalized' && (
        <div className="space-y-4">
          {normalizedLearnings.length === 0 ? (
            <div className="border border-gray-700 rounded-lg px-5 py-8 text-center text-sm text-gray-500">
              <p>No normalized learnings yet.</p>
              <p className="mt-1 text-xs">Click "Normalize & Save" to classify raw signals into the correct buckets.</p>
            </div>
          ) : (
            <>
              {/* Bucket filter bar */}
              <div className="flex flex-wrap gap-2">
                <BucketFilterChip bucket="all" active={activeBucketFilter === 'all'} count={normalizedLearnings.length} onClick={() => setActiveBucketFilter('all')} />
                {(Object.keys(BUCKET_LABELS) as NormalizedLearningBucket[]).map(bucket => {
                  const count = normalizedBucketCounts[bucket] ?? 0
                  if (count === 0) return null
                  return (
                    <BucketFilterChip
                      key={bucket}
                      bucket={bucket}
                      active={activeBucketFilter === bucket}
                      count={count}
                      onClick={() => setActiveBucketFilter(activeBucketFilter === bucket ? 'all' : bucket)}
                    />
                  )
                })}
              </div>

              <div className="space-y-3">
                {filteredNormalized.map(learning => (
                  <NormalizedLearningCard key={learning.id} learning={learning} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Strategy tab ── */}
      {activeTab === 'strategy' && (
        <div className="space-y-4">
          <Panel title="Session Strategy Summary">
            <p className="text-sm text-gray-200 leading-relaxed">{report.strategySummary}</p>
          </Panel>

          <Panel title="Before → After">
            <div className="space-y-3">
              {report.beforeAfter.map((item, i) => (
                <div key={i} className="grid gap-3 md:grid-cols-3">
                  <BeforeAfterColumn label="Before" text={item.before} />
                  <BeforeAfterColumn label="After" text={item.after} />
                  <BeforeAfterColumn label="Why" text={item.why} />
                </div>
              ))}
            </div>
          </Panel>

          <RawSignalList signals={strategySignals} />
        </div>
      )}

      {/* ── By stage tab ── */}
      {activeTab === 'stages' && (
        <div className="space-y-4">
          {(Object.keys(STAGE_LABELS) as StageLearningStage[]).map(stage => {
            const stageSignals = strategySignals.filter(s => s.stage === stage)
            return (
              <Panel key={stage} title={STAGE_LABELS[stage]}>
                <RawSignalList signals={stageSignals} emptyText="No distinct learning captured for this stage yet." />
              </Panel>
            )
          })}
        </div>
      )}

      {/* ── Personal tab ── */}
      {activeTab === 'personal' && (
        <Panel title="Personal Signals">
          <RawSignalList signals={personalSignals} emptyText="No personal strategy signals yet." />
        </Panel>
      )}

      {/* ── Global tab ── */}
      {activeTab === 'global' && (
        <Panel title="Global Signals">
          <RawSignalList signals={globalSignals} emptyText="No anonymized global signals yet." preferGlobal />
        </Panel>
      )}

      {/* ── Facts tab ── */}
      {activeTab === 'facts' && (
        <div className="space-y-4">
          <Panel title="Accepted Bullets">
            <FactList items={report.artifactFacts.acceptedBullets} />
          </Panel>
          <Panel title="Accepted Skills">
            <FactList items={report.artifactFacts.acceptedSkills} />
          </Panel>
          <Panel title="Approved Metrics">
            <FactList items={report.artifactFacts.approvedMetrics} />
          </Panel>
          <Panel title="Rejected Phrases">
            <FactList items={report.artifactFacts.rejectedPhrases} />
          </Panel>
        </div>
      )}
    </div>
  )
}

// ─── Normalized learning card ─────────────────────────────────────────────────

function NormalizedLearningCard({ learning }: { learning: NormalizedLearning }) {
  const bucketColor = BUCKET_COLORS[learning.bucket]
  const bucketLabel = BUCKET_LABELS[learning.bucket]
  const bucketQuestion = BUCKET_QUESTIONS[learning.bucket]
  const isGlobal = learning.bucket === 'global_signal'

  return (
    <article className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-gray-800/60 border-b border-gray-700">
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${bucketColor}`}>
          {bucketLabel}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-900 text-gray-400 border border-gray-700">
          {learning.scope}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded border ${
          learning.confidence === 'high' ? 'bg-green-950 text-green-400 border-green-900' :
          learning.confidence === 'medium' ? 'bg-yellow-950 text-yellow-400 border-yellow-900' :
          'bg-gray-900 text-gray-500 border-gray-700'
        }`}>
          {learning.confidence}
        </span>
        <span className="text-xs text-gray-600 ml-auto">{learning.sourceStage}</span>
      </div>

      {/* Rule text */}
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">{isGlobal ? 'Universal rule' : bucketQuestion}</p>
          <p className="text-sm text-gray-100 leading-relaxed font-medium">{learning.ruleText}</p>
        </div>

        {/* Examples — visually separated for global signals */}
        {learning.examples && learning.examples.length > 0 && (
          <div className={`space-y-1 ${isGlobal ? 'border-l-2 border-amber-800/40 pl-3' : 'pl-3 border-l border-gray-700'}`}>
            <p className="text-xs text-gray-500">{isGlobal ? 'Session examples' : 'Examples'}</p>
            {learning.examples.map((ex, i) => (
              <p key={i} className="text-xs text-gray-400">{ex}</p>
            ))}
          </div>
        )}

        {/* Boundary */}
        {learning.boundary && (
          <div className="border border-red-900/30 bg-red-950/10 rounded px-3 py-2">
            <p className="text-xs text-red-400 font-medium mb-0.5">Boundary</p>
            <p className="text-xs text-red-300/80">{learning.boundary}</p>
          </div>
        )}

        {/* Rationale */}
        {learning.rationale && (
          <p className="text-xs text-gray-500 italic">{learning.rationale}</p>
        )}

        {/* Bridge fact: evidence → requirement links */}
        {learning.bucket === 'bridge_fact' && (learning.requirementIds?.length || learning.evidenceIds?.length) && (
          <div className="flex flex-wrap gap-2 text-xs text-gray-600">
            {learning.requirementIds?.length ? (
              <span>Requirements: {learning.requirementIds.join(', ')}</span>
            ) : null}
            {learning.evidenceIds?.length ? (
              <span>Evidence: {learning.evidenceIds.join(', ')}</span>
            ) : null}
          </div>
        )}
      </div>
    </article>
  )
}

// ─── Bucket filter chip ───────────────────────────────────────────────────────

function BucketFilterChip({
  bucket,
  active,
  count,
  onClick,
}: {
  bucket: NormalizedLearningBucket | 'all'
  active: boolean
  count: number
  onClick: () => void
}) {
  const label = bucket === 'all' ? 'All' : BUCKET_LABELS[bucket]
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-xs border transition-colors ${
        active
          ? 'bg-gray-100 text-gray-900 border-gray-100'
          : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
      }`}
    >
      {label} <span className="ml-1 opacity-60">{count}</span>
    </button>
  )
}

// ─── Raw signal list (legacy) ─────────────────────────────────────────────────

function RawSignalList({
  signals,
  emptyText = 'No strategy signals yet.',
  preferGlobal = false,
}: {
  signals: Stage5MetaSignal[]
  emptyText?: string
  preferGlobal?: boolean
}) {
  if (signals.length === 0) {
    return <p className="text-sm text-gray-500 py-2">{emptyText}</p>
  }

  return (
    <div className="space-y-2">
      {signals.map(signal => (
        <div key={signal.id} className="border border-gray-800 rounded px-3 py-2">
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{signal.type.replace(/_/g, ' ')}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-900 text-slate-300">{signal.scope}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-900 text-gray-500">{STAGE_LABELS[signal.stage]}</span>
          </div>
          <p className="text-sm text-gray-200 leading-relaxed">
            {preferGlobal && signal.globalContent ? signal.globalContent : signal.content}
          </p>
          {signal.globalContent && !preferGlobal && (
            <p className="mt-1.5 text-xs text-violet-300 border-l border-violet-900 pl-2">
              Global: {signal.globalContent}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Shared components ────────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-gray-700 rounded-lg px-4 py-3">
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-700 rounded-lg px-4 py-3 space-y-3">
      <h2 className="text-sm font-semibold text-gray-300">{title}</h2>
      {children}
    </section>
  )
}

function BeforeAfterColumn({ label, text }: { label: string; text: string }) {
  return (
    <div className="border border-gray-800 rounded px-3 py-2">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-200 leading-relaxed">{text}</p>
    </div>
  )
}

function FactList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-500">No facts recorded.</p>
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={`${item}-${i}`} className="text-sm text-gray-300 border-l border-gray-800 pl-2">{item}</li>
      ))}
    </ul>
  )
}
