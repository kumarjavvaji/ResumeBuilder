'use client'

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type { Stage5Tab, StageLearningStage, Stage5LearningReport, Stage5MetaSignal } from '@/lib/stage5/session-learning'
import { getSession } from '@/lib/storage/sessions'
import { getSessionBridgeQuestions } from '@/lib/storage/bridge-questions'
import { getSessionSections } from '@/lib/storage/artifacts'
import { getAppliedCalibrationState } from '@/lib/storage/applied-calibration'
import { getStage4RawResumeText } from '@/lib/storage/stage4-raw-resume'
import { getUserProfile } from '@/lib/storage/user-profile'
import { getAllSignals } from '@/lib/storage/learning-signals'
import { buildStage5LearningReport, primaryLearningSignals } from '@/lib/stage5/session-learning'
import { Spinner } from '@/components/shared/spinner'

const TAB_LABELS: Record<Stage5Tab, string> = {
  strategy: 'Strategy Learnings',
  stages: 'Stage Learnings',
  personal: 'Personal Signals',
  global: 'Global Signals',
  facts: 'Artifact Facts'
}

const STAGE_LABELS: Record<StageLearningStage, string> = {
  stage1: 'Stage 1 - Target Intake',
  stage2: 'Stage 2 - Bridge Questions',
  stage3a: 'Stage 3A - Calibration',
  stage3b: 'Stage 3B - Artifact Refinement',
  stage4: 'Stage 4 - Raw Text Export'
}

export function SessionSignalsPage({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<Stage5LearningReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Stage5Tab>('strategy')
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [session, bridgeQuestions, artifactSections, appliedCalibration, stage4RawText, profile, storedSignals] = await Promise.all([
          getSession(sessionId),
          getSessionBridgeQuestions(sessionId),
          getSessionSections(sessionId),
          getAppliedCalibrationState(sessionId),
          getStage4RawResumeText(sessionId),
          getUserProfile(),
          getAllSignals()
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
        setActiveTab(nextReport.defaultTab)
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

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>
  if (error) return <p className="text-sm text-red-400">{error}</p>
  if (!report) return <p className="text-sm text-gray-500">No learning report available.</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Stage 5 - Session Learning</h1>
        <p className="text-sm text-gray-400 mt-1">
          What this session taught Resume Builder about generating better targeted artifacts next time.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Strategy signals" value={strategySignals.length} />
        <SummaryCard label="Personal signals" value={personalSignals.length} />
        <SummaryCard label="Global signals" value={globalSignals.length} />
        <SummaryCard label="Artifact facts" value={artifactFactCount} />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-2">
        {(Object.keys(TAB_LABELS) as Stage5Tab[]).map(tab => (
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
          </button>
        ))}
      </div>

      {activeTab === 'strategy' && (
        <div className="space-y-4">
          <Panel title="Session Strategy Summary">
            <p className="text-sm text-gray-200 leading-relaxed">{report.strategySummary}</p>
          </Panel>

          <Panel title="Before -> After">
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

          <SignalList signals={strategySignals} />
        </div>
      )}

      {activeTab === 'stages' && (
        <div className="space-y-4">
          {(Object.keys(STAGE_LABELS) as StageLearningStage[]).map(stage => {
            const stageSignals = strategySignals.filter(s => s.stage === stage)
            return (
              <Panel key={stage} title={STAGE_LABELS[stage]}>
                <SignalList signals={stageSignals} emptyText="No distinct learning captured for this stage yet." />
              </Panel>
            )
          })}
        </div>
      )}

      {activeTab === 'personal' && (
        <Panel title="Personal Signals">
          <SignalList signals={personalSignals} emptyText="No personal strategy signals yet." />
        </Panel>
      )}

      {activeTab === 'global' && (
        <Panel title="Global Signals">
          <SignalList signals={globalSignals} emptyText="No anonymized global signals yet." preferGlobal />
        </Panel>
      )}

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

function SignalList({
  signals,
  emptyText = 'No strategy signals yet.',
  preferGlobal = false
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
