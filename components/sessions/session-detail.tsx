'use client'
import { useEffect, useState } from 'react'
import { getSession, updateSessionFromStage1Artifact } from '@/lib/storage/sessions'
import { getStage1Job } from '@/lib/storage/stage1-jobs'
import type { TargetIntake } from '@/contracts'
import type { Stage1PipelineResult } from '@/lib/llm/stage1/pipeline'
import {
  JDRequirementMapView,
  canonicalRequirementSources,
  resolveRequirementDisplayItems,
} from '@/components/intake/jd-requirement-map-view'
import { findFindingByTopic, TraceChip, TraceableBullet, computeUnmatchedFindings, UnmatchedFindingsDebug } from '@/components/intake/stage1-findings-view'

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<TargetIntake | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTrace, setShowTrace] = useState(false)
  const [recoveryJson, setRecoveryJson] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')

  useEffect(() => {
    // Don't attempt a Dexie lookup until we have a real id string
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      setLoading(false)
      return
    }
    getSession(sessionId).then(async s => {
      if (!s) {
        setSession(null)
        setLoading(false)
        return
      }

      if (s.stage1JobId) {
        const job = await getStage1Job(s.stage1JobId)
        if (job?.status === 'completed' && isStage1PipelineResult(job.finalArtifact)) {
          await updateSessionFromStage1Artifact(s.id, job.finalArtifact, job.id)
          const refreshed = await getSession(s.id)
          setSession(refreshed ?? s)
          setLoading(false)
          return
        }
      }

      setSession(s)
      setLoading(false)
    })
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

  const findings = session.fitAnalysis?.findings
  const requirementSources = canonicalRequirementSources(session.jdRequirementMap, session.fitAnalysis?.requirements)
  const riskGapItems = resolveRequirementDisplayItems(session.riskGaps, requirementSources)
  const companyContextFinding = showTrace ? findFindingByTopic(findings, 'company_context') : undefined
  const unmatched = showTrace
    ? computeUnmatchedFindings(findings, [
        ...session.jdRequirementMap.required.map(r => r.text),
        ...session.jdRequirementMap.niceToHave.map(r => r.text),
        ...(session.jdRequirementMap.needsEvidenceItems ?? session.jdRequirementMap.unsupportedRequirements ?? []),
        ...session.jdRequirementMap.weaklySupportedRequirements,
        ...session.riskGaps,
        'company_context',
      ])
    : []

  async function handleRecoverArtifact() {
    if (!session) return
    const currentSession = session
    setRecoveryMessage('')
    try {
      const parsed = JSON.parse(recoveryJson)
      if (!isStage1PipelineResult(parsed)) {
        setRecoveryMessage('That JSON does not match the completed Stage 1 artifact shape.')
        return
      }
      await updateSessionFromStage1Artifact(currentSession.id, parsed)
      const refreshed = await getSession(currentSession.id)
      setSession(refreshed ?? currentSession)
      setRecoveryJson('')
      setRecoveryMessage('Stage 1 artifact attached to this session.')
    } catch {
      setRecoveryMessage('Could not parse the JSON artifact.')
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">{session.roleTitle}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{session.company} · {new Date(session.createdAt).toLocaleDateString()}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400 select-none shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={showTrace}
            onChange={e => setShowTrace(e.target.checked)}
          />
          Show evidence trace
        </label>
      </div>

      {/* Synthesis */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-300 mb-1">Company Context</h2>
            {showTrace && <TraceChip finding={companyContextFinding} label="Why" />}
          </div>
          <p className="text-sm leading-relaxed break-words text-gray-100">{session.companySummary}</p>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-300 mb-1">Fit Hypothesis</h2>
          <p className="text-sm leading-relaxed break-words text-gray-100">{session.fitHypothesis}</p>
          {showTrace && (
            <p className="text-xs text-gray-500 italic mt-1">No formal trace yet</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Emphasis</h2>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-blue-900 text-blue-200">
            {session.emphasisRecommendation}
          </span>
        </div>
        {riskGapItems.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-500 mb-1">Risk / Gaps</h2>
            <ul className="space-y-1">
              {riskGapItems.map((g, i) => (
                <TraceableBullet
                  key={i}
                  text={g.display}
                  finding={showTrace ? findFindingByTopic(findings, g.original) ?? findFindingByTopic(findings, g.display) : undefined}
                  className="text-sm text-amber-300"
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <JDRequirementMapView map={session.jdRequirementMap} findings={findings} showTrace={showTrace} tone="dark" />

      {showTrace && <UnmatchedFindingsDebug findings={unmatched} />}

      <details className="border border-gray-800 rounded-md px-3 py-2">
        <summary className="text-xs font-semibold uppercase tracking-wide text-gray-400 cursor-pointer select-none">
          Recover Stage 1 Artifact
        </summary>
        <div className="mt-3 space-y-2">
          <textarea
            value={recoveryJson}
            onChange={e => setRecoveryJson(e.target.value)}
            className="w-full min-h-40 rounded bg-gray-950 border border-gray-700 px-3 py-2 text-xs text-gray-100 font-mono"
            placeholder="Paste completed /assemble JSON"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRecoverArtifact}
              disabled={!recoveryJson.trim()}
              className="px-3 py-1.5 bg-gray-100 text-gray-900 rounded text-xs font-medium hover:bg-white disabled:opacity-40"
            >
              Attach Artifact
            </button>
            {recoveryMessage && <p className="text-xs text-gray-400">{recoveryMessage}</p>}
          </div>
        </div>
      </details>

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

function isStage1PipelineResult(value: unknown): value is Stage1PipelineResult {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Partial<Stage1PipelineResult>
  return Boolean(
    artifact.rawJD &&
    artifact.requirementMap &&
    artifact.domainIQ &&
    artifact.synthesis &&
    artifact.fitAnalysis &&
    typeof artifact.synthesis.companySummary === 'string' &&
    typeof artifact.synthesis.fitHypothesis === 'string' &&
    Array.isArray(artifact.synthesis.riskGaps) &&
    typeof artifact.synthesis.emphasisRecommendation === 'string' &&
    Array.isArray(artifact.requirementMap.required) &&
    Array.isArray(artifact.requirementMap.niceToHave)
  )
}
