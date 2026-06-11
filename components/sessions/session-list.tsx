'use client'
import { useEffect, useState } from 'react'
import { getAllSessions, deleteSession } from '@/lib/storage/sessions'
import type { TargetIntake } from '@/contracts'

const STATUS_LABELS: Record<TargetIntake['status'], string> = {
  intake: 'Intake',
  bridge: 'Bridge Questions',
  artifact: 'Artifacts',
  export: 'Export'
}

export function SessionList() {
  const [sessions, setSessions] = useState<TargetIntake[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAllSessions().then(s => {
      setSessions(s)
      setLoading(false)
    })
  }, [])

  async function handleDelete(id: string) {
    if (!confirm('Delete this session and all its artifacts?')) return
    await deleteSession(id)
    setSessions(s => s.filter(x => x.id !== id))
  }

  if (loading) return <p className="text-sm text-gray-400">Loading sessions...</p>

  if (sessions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-400 text-sm mb-4">No sessions yet.</p>
        <a
          href="/sessions/new"
          className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
        >
          Start your first session
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map(s => (
        <div key={s.id} className="flex items-start justify-between border border-gray-200 rounded-lg p-4 hover:border-gray-400 transition-colors">
          <a href={`/sessions/${s.id}`} className="flex-1 min-w-0">
            <div className="font-medium text-sm">{s.roleTitle} at {s.company}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {new Date(s.createdAt).toLocaleDateString()} · {STATUS_LABELS[s.status]}
              {s.emphasisRecommendation && ` · ${s.emphasisRecommendation}`}
            </div>
            {s.riskGaps?.length > 0 && (
              <div className="text-xs text-amber-600 mt-1">
                {s.riskGaps.length} gap{s.riskGaps.length > 1 ? 's' : ''} flagged
              </div>
            )}
          </a>
          <button
            onClick={() => handleDelete(s.id)}
            className="ml-4 text-xs text-gray-400 hover:text-red-500 shrink-0"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  )
}
