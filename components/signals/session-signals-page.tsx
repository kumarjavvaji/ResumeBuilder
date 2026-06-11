'use client'
import { useEffect, useState } from 'react'
import { db } from '@/lib/storage/db'
import { deleteLearningSignal } from '@/lib/storage/learning-signals'
import type { LearningSignal } from '@/contracts'

export function SessionSignalsPage({ sessionId }: { sessionId: string }) {
  const [signals, setSignals] = useState<LearningSignal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Signals for this session are scoped by context containing the sessionId,
    // or by looking at artifact sections that belong to this session.
    // For now, show all personal signals ordered by creation time.
    db.learningSignals
      .where('scope').equals('personal')
      .reverse()
      .sortBy('createdAt')
      .then(s => { setSignals(s); setLoading(false) })
  }, [sessionId])

  async function handleDelete(id: string) {
    await deleteLearningSignal(id)
    setSignals(prev => prev.filter(s => s.id !== id))
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Stage 5 — Session Signals</h1>
        <p className="text-sm text-gray-400 mt-1">
          Learning signals generated from this session's artifact review. Accept bullets and reject phrases to build your signal library.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-gray-700 rounded-lg px-4 py-3">
          <div className="text-xl font-bold text-white">
            {signals.filter(s => s.type === 'accepted-bullet').length}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">Accepted bullets</div>
        </div>
        <div className="border border-gray-700 rounded-lg px-4 py-3">
          <div className="text-xl font-bold text-white">
            {signals.filter(s => s.type === 'rejected-phrase' || s.type === 'rejected-bullet').length}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">Rejected bullets / phrases</div>
        </div>
      </div>

      {signals.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No signals yet. Accept or reject artifact sections to generate signals.
        </p>
      ) : (
        <div className="space-y-2">
          {signals.map(s => (
            <div key={s.id} className="border border-gray-700 rounded-lg px-4 py-3 flex items-start gap-3">
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${
                s.type === 'accepted-bullet' ? 'bg-green-900 text-green-300' :
                s.type === 'rejected-bullet' || s.type === 'rejected-phrase' ? 'bg-red-900 text-red-300' :
                'bg-gray-800 text-gray-300'
              }`}>
                {s.type.replace(/-/g, ' ')}
              </span>
              <p className="flex-1 text-sm text-gray-200">{s.content}</p>
              <button onClick={() => handleDelete(s.id)} className="text-xs text-gray-600 hover:text-red-400 shrink-0">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
