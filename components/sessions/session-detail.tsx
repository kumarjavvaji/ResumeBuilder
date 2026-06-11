'use client'
import { useEffect, useState } from 'react'
import { getSession } from '@/lib/storage/sessions'
import type { TargetIntake } from '@/contracts'
import { JDRequirementMapView } from '@/components/intake/jd-requirement-map-view'

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<TargetIntake | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Don't attempt a Dexie lookup until we have a real id string
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      setLoading(false)
      return
    }
    getSession(sessionId).then(s => { setSession(s ?? null); setLoading(false) })
  }, [sessionId])

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>
  if (!session) return (
    <div className="space-y-2">
      <p className="text-sm text-red-400 font-medium">Session not found.</p>
      <p className="text-xs text-gray-500">
        The session may have been deleted, or the URL is incorrect.{' '}
        <a href="/sessions" className="underline hover:text-gray-300">Back to sessions</a>
      </p>
    </div>
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-white">{session.roleTitle}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{session.company} · {new Date(session.createdAt).toLocaleDateString()}</p>
      </div>

      {/* Synthesis */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Company Context</h2>
          <p className="text-sm text-gray-200">{session.companySummary}</p>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Fit Hypothesis</h2>
          <p className="text-sm text-gray-200">{session.fitHypothesis}</p>
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Emphasis</h2>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-blue-900 text-blue-200">
            {session.emphasisRecommendation}
          </span>
        </div>
        {session.riskGaps.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-500 mb-1">Risk / Gaps</h2>
            <ul className="space-y-1">
              {session.riskGaps.map((g, i) => (
                <li key={i} className="text-sm text-amber-300 flex gap-2"><span>·</span>{g}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <JDRequirementMapView map={session.jdRequirementMap} />

      <div>
        <a
          href={`/sessions/${sessionId}/bridge`}
          className="inline-block px-4 py-2 bg-blue-700 text-white rounded text-sm font-medium hover:bg-blue-600"
        >
          Continue to Stage 2 — Fit Intelligence →
        </a>
      </div>
    </div>
  )
}
