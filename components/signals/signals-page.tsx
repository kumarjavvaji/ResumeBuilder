'use client'
import { useEffect, useState } from 'react'
import { getAllSignals, deleteLearningSignal, promoteToGlobal } from '@/lib/storage/learning-signals'
import type { LearningSignal, LearningSignalType, SignalScope, ProductArea } from '@/contracts'
import { Spinner } from '@/components/shared/spinner'
import { inputCls, textareaCls } from '@/lib/input-cls'

// ── Labels ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<LearningSignalType, string> = {
  'accepted-bullet': 'Accepted Bullet',
  'rejected-bullet': 'Rejected Bullet',
  'approved-metric': 'Approved Metric',
  'rejected-phrase': 'Rejected Phrase',
  'role-preference': 'Role Preference',
  'jd-pattern': 'JD Pattern',
  'style-constraint': 'Style Constraint',
  'artifact-strategy': 'Artifact Strategy',
  'bridge-question-pattern': 'Bridge Question Pattern',
  'evidence-classification': 'Evidence Classification',
  'domain-translation': 'Domain Translation',
  'generation-drift': 'Generation Drift'
}

const PRODUCT_AREA_LABELS: Record<ProductArea, string> = {
  'jd-parsing': 'JD Parsing',
  'bridge-questions': 'Bridge Questions',
  'claim-validation': 'Claim Validation',
  'artifact-strategy': 'Artifact Strategy',
  'cover-letter': 'Cover Letter',
  'outreach': 'Outreach',
  'formatting': 'Formatting'
}

const TYPE_COLORS: Partial<Record<LearningSignalType, string>> = {
  'accepted-bullet': 'bg-green-100 text-green-700',
  'rejected-bullet': 'bg-red-100 text-red-700',
  'approved-metric': 'bg-blue-100 text-blue-700',
  'rejected-phrase': 'bg-orange-100 text-orange-700',
  'role-preference': 'bg-purple-100 text-purple-700',
  'jd-pattern': 'bg-gray-100 text-gray-700',
  'style-constraint': 'bg-yellow-100 text-yellow-700',
  'artifact-strategy': 'bg-teal-100 text-teal-700',
  'bridge-question-pattern': 'bg-indigo-100 text-indigo-700',
  'evidence-classification': 'bg-cyan-100 text-cyan-700',
  'domain-translation': 'bg-pink-100 text-pink-700',
  'generation-drift': 'bg-red-50 text-red-600'
}

// ── Promote modal ─────────────────────────────────────────────────────────

function PromoteModal({
  signal,
  onConfirm,
  onClose
}: {
  signal: LearningSignal
  onConfirm: (id: string, globalContent: string, productArea: ProductArea) => Promise<void>
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<{ globalContent: string; productArea: ProductArea; rationale: string } | null>(null)
  const [error, setError] = useState('')

  async function generate() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/abstract-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal })
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setDraft(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to abstract.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!draft) return
    setLoading(true)
    try {
      await onConfirm(signal.id, draft.globalContent, draft.productArea)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold">Promote to Global Signal</h2>
          <p className="text-sm text-gray-500 mt-1">
            Claude will abstract this personal signal into an anonymized product improvement rule. No employer names, metrics, or PII will be retained.
          </p>
        </div>

        <div className="bg-gray-50 rounded px-4 py-3 text-sm text-gray-700">
          <div className="text-xs text-gray-400 mb-1">Personal content</div>
          {signal.content}
        </div>

        {!draft && (
          <button
            onClick={generate}
            disabled={loading}
            className="w-full py-2 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Spinner className="text-white" />}
            Generate Abstraction
          </button>
        )}

        {draft && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Global content (anonymized)</label>
              <textarea
                className={`${textareaCls} h-20`}
                value={draft.globalContent}
                onChange={e => setDraft(d => d ? { ...d, globalContent: e.target.value } : d)}
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Product area</label>
                <select
                  className={inputCls}
                  value={draft.productArea}
                  onChange={e => setDraft(d => d ? { ...d, productArea: e.target.value as ProductArea } : d)}
                >
                  {(Object.keys(PRODUCT_AREA_LABELS) as ProductArea[]).map(a => (
                    <option key={a} value={a}>{PRODUCT_AREA_LABELS[a]}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-400 italic">{draft.rationale}</p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-2">
          {draft && (
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="px-4 py-2 bg-green-700 text-white rounded text-sm font-medium hover:bg-green-600 disabled:opacity-50"
            >
              Confirm & Save as Global
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded text-sm text-gray-500 hover:border-gray-400">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Signal row ─────────────────────────────────────────────────────────────

function SignalRow({
  signal,
  onDelete,
  onPromote
}: {
  signal: LearningSignal
  onDelete: () => void
  onPromote: () => void
}) {
  const scopeStyle = {
    personal: 'bg-gray-100 text-gray-600',
    global: 'bg-violet-100 text-violet-700',
    both: 'bg-violet-50 text-violet-600'
  }[signal.scope]

  const isPromotable = signal.scope === 'personal' &&
    ['accepted-bullet', 'approved-metric', 'role-preference', 'style-constraint'].includes(signal.type)

  return (
    <div className="border border-gray-100 rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${TYPE_COLORS[signal.type] ?? 'bg-gray-100 text-gray-700'}`}>
          {TYPE_LABELS[signal.type]}
        </span>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium border ${scopeStyle}`}>
          {signal.scope}
        </span>
        {signal.productArea && (
          <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-100">
            {PRODUCT_AREA_LABELS[signal.productArea]}
          </span>
        )}
        <div className="flex-1" />
        {isPromotable && (
          <button
            onClick={onPromote}
            className="text-xs text-violet-600 hover:text-violet-800 shrink-0"
            title="Promote to global signal"
          >
            ↑ promote
          </button>
        )}
        <button onClick={onDelete} className="text-xs text-gray-300 hover:text-red-500 shrink-0">×</button>
      </div>

      <p className="text-sm text-gray-800">{signal.content}</p>

      {signal.scope !== 'personal' && signal.globalContent && (
        <div className="border-l-2 border-violet-200 pl-3 text-sm text-violet-700">
          <div className="text-xs text-violet-400 mb-0.5">Global (anonymized)</div>
          {signal.globalContent}
        </div>
      )}

      <div className="flex gap-3 text-xs text-gray-400">
        {signal.context && <span>{signal.context}</span>}
        {signal.roleCategory && <span>· {signal.roleCategory}</span>}
        <span>· {new Date(signal.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

type ScopeFilter = 'all' | 'personal' | 'global'
type TypeFilter = LearningSignalType | 'all'

export function SignalsPage() {
  const [signals, setSignals] = useState<LearningSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [promoting, setPromoting] = useState<LearningSignal | null>(null)

  useEffect(() => {
    getAllSignals().then(s => { setSignals(s); setLoading(false) })
  }, [])

  async function handleDelete(id: string) {
    await deleteLearningSignal(id)
    setSignals(prev => prev.filter(s => s.id !== id))
  }

  async function handlePromote(id: string, globalContent: string, productArea: ProductArea) {
    await promoteToGlobal(id, globalContent, productArea)
    setSignals(prev => prev.map(s =>
      s.id === id ? { ...s, scope: 'both', globalContent, productArea, promotedToGlobal: true } : s
    ))
  }

  const personalCount = signals.filter(s => s.scope === 'personal' || s.scope === 'both').length
  const globalCount = signals.filter(s => s.scope === 'global' || s.scope === 'both').length

  const filtered = signals.filter(s => {
    if (scopeFilter === 'personal' && s.scope !== 'personal' && s.scope !== 'both') return false
    if (scopeFilter === 'global' && s.scope !== 'global' && s.scope !== 'both') return false
    if (typeFilter !== 'all' && s.type !== typeFilter) return false
    return true
  })

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-8">
        <a href="/" className="text-sm text-gray-500 hover:text-gray-700">← Home</a>
        <h1 className="text-2xl font-bold mt-3">Learning Signals</h1>
        <p className="text-sm text-gray-500 mt-1">
          Intelligence accumulated from your sessions. Personal signals improve your future applications. Global signals improve the product for everyone.
        </p>
      </div>

      {/* Scope summary */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold">{personalCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">Personal signals</div>
          <div className="text-xs text-gray-400 mt-1">Your resume positioning, approved bullets, rejected phrases</div>
        </div>
        <div className="border border-violet-200 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-violet-700">{globalCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">Global signals</div>
          <div className="text-xs text-gray-400 mt-1">Anonymized product improvement patterns</div>
        </div>
      </div>

      {/* Scope filter */}
      <div className="flex gap-2 mb-3">
        {(['all', 'personal', 'global'] as ScopeFilter[]).map(s => (
          <button
            key={s}
            onClick={() => setScopeFilter(s)}
            className={`px-3 py-1 rounded text-xs border capitalize ${scopeFilter === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Type filter */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-2.5 py-1 rounded text-xs border ${typeFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
        >
          All types
        </button>
        {(Object.keys(TYPE_LABELS) as LearningSignalType[]).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-2.5 py-1 rounded text-xs border ${typeFilter === t ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">
          {signals.length === 0
            ? 'No signals yet. Accept or reject artifacts to build your signal library.'
            : 'No signals match the current filter.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <SignalRow
              key={s.id}
              signal={s}
              onDelete={() => handleDelete(s.id)}
              onPromote={() => setPromoting(s)}
            />
          ))}
        </div>
      )}

      {promoting && (
        <PromoteModal
          signal={promoting}
          onConfirm={handlePromote}
          onClose={() => setPromoting(null)}
        />
      )}
    </main>
  )
}
