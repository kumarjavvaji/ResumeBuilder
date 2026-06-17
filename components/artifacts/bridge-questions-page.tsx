'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, updateSessionStatus } from '@/lib/storage/sessions'
import { getUserProfile } from '@/lib/storage/user-profile'
import { saveBridgeQuestions, getSessionBridgeQuestions, updateBridgeQuestion } from '@/lib/storage/bridge-questions'
import { promoteBridgeAnswerToProfile } from '@/lib/profile/promoteBridgeAnswer'
import type { BridgeQuestion, TargetIntake } from '@/contracts'
import { Spinner } from '@/components/shared/spinner'
import { inputCls, textareaCls } from '@/lib/input-cls'

// ─── Collapse primitive (local copy) ─────────────────────────────────────────

function Collapse({
  label,
  sublabel,
  open,
  onToggle,
  children,
}: {
  label: string
  sublabel?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-left bg-gray-900/60 hover:bg-gray-800 transition-colors"
      >
        <span>
          <span className="font-medium text-gray-200">{label}</span>
          {sublabel && <span className="ml-2 text-xs text-gray-500">{sublabel}</span>}
        </span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 py-4 space-y-3">{children}</div>}
    </div>
  )
}

// ─── Existing resume bypass ───────────────────────────────────────────────────

function ExistingResumeSection({ sessionId, onSkip }: { sessionId: string; onSkip: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapse
      label="Have an existing refined resume?"
      sublabel="skip bridge questions"
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      <p className="text-xs text-gray-400">
        Upload a resume that has already been tailored for this role. It will be used as the baseline for artifact generation — bridge questions won't be needed.
      </p>
      <input
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-600 file:text-xs file:font-medium file:bg-gray-800 file:text-gray-200 hover:file:bg-gray-700"
      />
      <p className="text-xs text-amber-500">Resume parsing is coming soon. For now, proceed through bridge questions.</p>
      <button
        onClick={onSkip}
        className="px-4 py-1.5 border border-gray-600 rounded text-xs text-gray-300 hover:border-gray-400 hover:text-white"
      >
        Skip to artifact generation →
      </button>
    </Collapse>
  )
}

// ─── JD context panel ─────────────────────────────────────────────────────────

type JDInputMode = 'link' | 'paste' | 'fields' | null

function JDContextSection({ session }: { session: TargetIntake }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<JDInputMode>(null)

  function toggle(m: JDInputMode) {
    setMode(prev => prev === m ? null : m)
  }

  return (
    <Collapse
      label="Job description"
      sublabel="review or update"
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      <p className="text-xs text-gray-400">
        JD captured in Stage 1. Update it here if you want to retarget without starting a new session.
      </p>

      <div className="space-y-2">
        {/* Link */}
        <Collapse label="Paste a link" open={mode === 'link'} onToggle={() => toggle('link')}>
          <input className={inputCls} type="url" placeholder="https://..." />
          <p className="text-xs text-amber-500">Auto-fetch coming soon.</p>
        </Collapse>

        {/* Paste */}
        <Collapse label="Paste full JD text" open={mode === 'paste'} onToggle={() => toggle('paste')}>
          <textarea
            className={`${textareaCls} h-40 font-mono text-xs`}
            defaultValue={session.jobDescription?.fullText ?? ''}
            placeholder="Paste full job description here..."
          />
          <button className="px-3 py-1.5 bg-gray-800 text-gray-200 rounded text-xs hover:bg-gray-700">
            Re-analyze JD
          </button>
          <p className="text-xs text-amber-500">Re-analysis coming soon.</p>
        </Collapse>

        {/* Fields */}
        <Collapse label="Fill each field" open={mode === 'fields'} onToggle={() => toggle('fields')}>
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-400">Responsibilities</label>
            <textarea className={`${textareaCls} h-20 text-xs`} placeholder="One per line..." />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-400">Required Skills</label>
            <textarea className={`${textareaCls} h-16 text-xs`} placeholder="One per line..." />
          </div>
          <p className="text-xs text-amber-500">Structured field parsing coming soon.</p>
        </Collapse>
      </div>
    </Collapse>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export function BridgeQuestionsPage({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const [session, setSession] = useState<TargetIntake | null>(null)
  const [questions, setQuestions] = useState<BridgeQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const [s, qs] = await Promise.all([
        getSession(sessionId),
        getSessionBridgeQuestions(sessionId)
      ])
      setSession(s ?? null)
      setQuestions(qs)
      setLoading(false)
    }
    load()
  }, [sessionId])

  async function handleGenerate() {
    if (!session) return
    const profile = await getUserProfile()
    if (!profile) { setError('Profile required.'); return }
    setGenerating(true)
    setError('')
    try {
      const res = await fetch('/api/bridge-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jdMap: session.jdRequirementMap,
          profile,
          emphasis: session.emphasisRecommendation,
          sessionId,
          fitAnalysis: session.fitAnalysis
        })
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const { questions: raw } = await res.json()
      const saved = await saveBridgeQuestions(raw)
      setQuestions(saved)
      await updateSessionStatus(sessionId, 'bridge')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleAnswer(id: string, answer: string) {
    await updateBridgeQuestion(id, { status: 'answered', userAnswer: answer })
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, status: 'answered', userAnswer: answer } : q))
    const question = questions.find(q => q.id === id)
    if (question) {
      try {
        await promoteBridgeAnswerToProfile(question, answer, sessionId)
      } catch (err) {
        console.error('promoteBridgeAnswerToProfile failed — answer saved but not promoted to profile:', err)
      }
    }
  }

  async function handleSkip(id: string) {
    await updateBridgeQuestion(id, { status: 'skipped' })
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, status: 'skipped' } : q))
  }

  async function handleProceed() {
    await updateSessionStatus(sessionId, 'artifact')
    router.push(`/sessions/${sessionId}/artifacts`)
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>
  if (!session) return <p className="text-sm text-red-400">Session not found.</p>

  const answeredCount = questions.filter(q => q.status === 'answered').length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-white">Stage 2 — Fit Intelligence</h1>
        <p className="text-sm text-gray-400 mt-1">
          Answer as many questions as you can. Each answer improves resume accuracy. Skip is fine — it won't block generation.
        </p>
      </div>

      {/* Shortcuts */}
      <div className="space-y-2">
        <ExistingResumeSection sessionId={sessionId} onSkip={handleProceed} />
        <JDContextSection session={session} />
      </div>

      <div className="border-t border-gray-800" />

      {questions.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            No questions generated yet. Click below to generate targeted questions based on the JD gaps and your profile.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-5 py-2 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating && <Spinner className="text-white" />}
            Generate Bridge Questions
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="text-xs text-gray-500">
            {answeredCount} of {questions.length} answered
          </div>

          {questions.map(q => (
            <QuestionCard
              key={q.id}
              question={q}
              onAnswer={answer => handleAnswer(q.id, answer)}
              onSkip={() => handleSkip(q.id)}
            />
          ))}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleProceed}
              className="px-5 py-2 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-700"
            >
              Proceed to Artifact Generation →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function QuestionCard({
  question, onAnswer, onSkip
}: {
  question: BridgeQuestion
  onAnswer: (answer: string) => void
  onSkip: () => void
}) {
  const [draft, setDraft] = useState(question.userAnswer ?? '')
  const [editing, setEditing] = useState(question.status === 'pending')

  const priorityColor = {
    high: 'text-red-600',
    medium: 'text-amber-600',
    low: 'text-gray-500'
  }[question.priority]

  const typeLabel = {
    gap: 'Gap',
    evidence: 'Evidence needed',
    metric: 'Metric needed',
    'domain-translation': 'Domain translation',
    emphasis: 'Emphasis decision',
    'underused-experience': 'Underused experience'
  }[question.type]

  return (
    <div className={`border rounded-lg p-5 ${question.status === 'skipped' ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2 mb-3">
        <span className={`text-xs font-medium uppercase ${priorityColor}`}>{question.priority}</span>
        <span className="text-xs text-gray-400">·</span>
        <span className="text-xs text-gray-500">{typeLabel}</span>
        <span className="text-xs text-gray-400">·</span>
        <span className="text-xs text-gray-400">{question.affectedArtifactSection}</span>
      </div>
      <p className="text-sm font-medium text-gray-800 mb-3">{question.question}</p>

      {question.status === 'answered' && !editing ? (
        <div className="bg-gray-50 rounded px-3 py-2 text-sm text-gray-700 mb-2">
          {question.userAnswer}
        </div>
      ) : question.status !== 'skipped' ? (
        <textarea
          className={`${textareaCls} h-20`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Your answer..."
        />
      ) : null}

      {question.status !== 'skipped' && (
        <div className="flex gap-2 mt-2">
          {question.status === 'answered' && !editing ? (
            <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-gray-600">Edit</button>
          ) : (
            <>
              <button
                onClick={() => { onAnswer(draft); setEditing(false) }}
                disabled={!draft.trim()}
                className="px-3 py-1 bg-gray-900 text-white rounded text-xs disabled:opacity-40 hover:bg-gray-700"
              >
                Save Answer
              </button>
              <button onClick={onSkip} className="px-3 py-1 border border-gray-200 rounded text-xs text-gray-500 hover:border-gray-400">
                Skip
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
