'use client'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { getSession } from '@/lib/storage/sessions'
import { getUserProfile } from '@/lib/storage/user-profile'
import { getSessionBridgeQuestions } from '@/lib/storage/bridge-questions'
import {
  saveArtifactSection,
  getSessionSections,
  acceptSection,
  saveManualEdit
} from '@/lib/storage/artifacts'
import { getAppliedCalibrationState } from '@/lib/storage/applied-calibration'
import { addLearningSignal, getGenerationContext } from '@/lib/storage/learning-signals'
import { containsRejectedPhrase } from '@/lib/validators/claim-classifier'
import { isGlobalEvidenceWarning } from '@/lib/evidence-scope'
import type {
  TargetIntake, ArtifactSection, SectionType,
  CalibrationSummary, AppliedCalibrationState,
  ArtifactGenerationProvenance, CalibrationStatusAtGeneration
} from '@/contracts'
import { Spinner } from '@/components/shared/spinner'
import { ArtifactSectionCard } from './artifact-section-card'
import { CalibrationPanel } from './calibration-panel'

const SECTION_ORDER: SectionType[] = [
  'summary', 'skills', 'experience-po', 'experience-ba', 'experience-qa',
  'cover-letter', 'referral-message', 'recruiter-message', 'linkedin-dm', 'talking-points'
]

const SECTION_LABELS: Record<SectionType, string> = {
  summary: 'Professional Summary',
  skills: 'Skills',
  'experience-po': 'Experience (Product Owner)',
  'experience-ba': 'Experience (Business Analyst)',
  'experience-qa': 'Experience (QA / Quality)',
  'cover-letter': 'Cover Letter',
  'referral-message': 'Referral Message',
  'recruiter-message': 'Recruiter Message',
  'linkedin-dm': 'LinkedIn DM',
  'talking-points': 'Interview Talking Points'
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ArtifactSection['status'] }) {
  const map: Partial<Record<ArtifactSection['status'], { label: string; cls: string }>> = {
    accepted: { label: 'Accepted', cls: 'text-green-600 bg-green-50 border-green-200' },
    rejected: { label: 'Rejected', cls: 'text-red-500 bg-red-50 border-red-200' },
    generated: { label: 'Needs review', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
    draft: { label: 'Needs review', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
    needs_review: { label: 'Needs review', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
    refinement_requested: { label: 'Refining', cls: 'text-blue-600 bg-blue-50 border-blue-200' },
    'needs-refinement': { label: 'Needs refinement', cls: 'text-blue-600 bg-blue-50 border-blue-200' },
    error: { label: 'Error', cls: 'text-red-600 bg-red-50 border-red-200' },
  }
  const entry = map[status]
  if (!entry) return null
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${entry.cls}`}>
      {entry.label}
    </span>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ArtifactsPage({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<TargetIntake | null>(null)
  const [sections, setSections] = useState<Map<SectionType, ArtifactSection>>(new Map())
  const [loading, setLoading] = useState(true)
  const [generatingType, setGeneratingType] = useState<SectionType | null>(null)
  const [error, setError] = useState('')
  // Bridge question completeness for Stage 2 warning
  const [bridgeTotal, setBridgeTotal] = useState(0)
  const [bridgeAnswered, setBridgeAnswered] = useState(0)
  // Stage 3A calibration state
  const [calibrationSummary, setCalibrationSummary] = useState<CalibrationSummary | undefined>(undefined)
  const [appliedCalibrationState, setAppliedCalibrationState] = useState<AppliedCalibrationState | undefined>(undefined)
  const [calibrationSkipped, setCalibrationSkipped] = useState(false)
  const [calibrationUpdatedBanner, setCalibrationUpdatedBanner] = useState(false)
  const prevCalibrationRef = useRef<CalibrationSummary | undefined>(undefined)

  // Deduplicated global evidence warnings — shown once at top, filtered from section cards
  const globalWarnings = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const section of sections.values()) {
      for (const w of section.evidenceWarnings ?? []) {
        const key = w.toLowerCase()
        if (isGlobalEvidenceWarning(w) && !seen.has(key)) {
          seen.add(key)
          result.push(w)
        }
      }
    }
    return result
  }, [sections])

  useEffect(() => {
    async function load() {
      const [s, existingSections, bridgeQs, savedApplied] = await Promise.all([
        getSession(sessionId),
        getSessionSections(sessionId),
        getSessionBridgeQuestions(sessionId),
        getAppliedCalibrationState(sessionId)
      ])
      setSession(s ?? null)
      const map = new Map<SectionType, ArtifactSection>()
      for (const sec of existingSections) map.set(sec.type, sec)
      setSections(map)
      setBridgeTotal(bridgeQs.length)
      setBridgeAnswered(bridgeQs.filter(q => q.status === 'answered').length)
      // Restore applied calibration state across reloads
      if (savedApplied) {
        setAppliedCalibrationState(savedApplied)
        setCalibrationSummary(savedApplied.summary)
        prevCalibrationRef.current = savedApplied.summary
      }
      setLoading(false)
    }
    load()
  }, [sessionId])

  // ── Calibration handlers ───────────────────────────────────────────────────

  function handleCalibrationApplied(summary: CalibrationSummary, applied: AppliedCalibrationState) {
    const hadPrev = prevCalibrationRef.current !== undefined
    if (hadPrev && sections.size > 0) setCalibrationUpdatedBanner(true)
    prevCalibrationRef.current = summary
    setCalibrationSummary(summary)
    setAppliedCalibrationState(applied)
  }

  function handleCalibrationSkip() {
    setCalibrationSkipped(true)
  }

  // ── Generate / refine ──────────────────────────────────────────────────────

  const generateSection = useCallback(async (
    type: SectionType,
    opts: { refinementInstruction?: string; operation?: 'generate' | 'refine' | 'regenerate' } = {}
  ) => {
    const { refinementInstruction, operation = 'generate' } = opts
    const existing = sections.get(type)

    // Guard: never regenerate accepted without explicit user instruction
    if (existing?.status === 'accepted' && !refinementInstruction) return
    if (!session) return

    const [profile, signalCtx] = await Promise.all([
      getUserProfile(),
      getGenerationContext({
        roleCategory: session.emphasisRecommendation,
        sectionType: type
      })
    ])
    if (!profile) { setError('Profile required.'); return }

    const allRejected = [...signalCtx.rejectedPhrases, ...profile.rejectedPhrases]

    setGeneratingType(type)
    setError('')

    // Build generation provenance snapshot (calibration state at generation time)
    const calibStatus: CalibrationStatusAtGeneration = calibrationSummary
      ? (appliedCalibrationState?.isPartial ? 'applied_partial' : 'applied_full')
      : calibrationSkipped ? 'skipped' : 'none'

    const provenance: ArtifactGenerationProvenance = {
      generatedAt: new Date().toISOString(),
      operation: operation as ArtifactGenerationProvenance['operation'],
      calibrationUsed: calibrationSummary !== undefined,
      calibrationAppliedAt: appliedCalibrationState?.appliedAt,
      calibrationStateId: appliedCalibrationState?.id,
      calibrationStatusAtGeneration: calibStatus,
      targetReferenceCount: appliedCalibrationState?.targetReferenceCount,
      comparableReferenceCount: appliedCalibrationState?.comparableReferenceCount,
      appliedCalibrationPatterns: appliedCalibrationState?.appliedCalibrationPatterns,
      referencedCalibrationIds: appliedCalibrationState?.referencedCalibrationIds
    }

    try {
      const res = await fetch('/api/artifact-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          sectionType: type,
          jdMap: session.jdRequirementMap,
          profile,
          answeredQuestions: await import('@/lib/storage/bridge-questions').then(m => m.getAnsweredQuestions(sessionId)),
          emphasis: session.emphasisRecommendation,
          companySummary: session.companySummary,
          fitHypothesis: session.fitHypothesis,
          riskGaps: session.riskGaps,
          acceptedSignals: signalCtx.personalSignals,
          globalSignals: signalCtx.globalSignals,
          rejectedPhrases: allRejected,
          refinementInstruction,
          currentContent: refinementInstruction ? existing?.content : undefined,
          operation,
          calibrationSummary
        })
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Generation failed.')
        return
      }

      // Rejected-phrase check with one auto-retry
      const phraseViolation = containsRejectedPhrase(data.content, allRejected)
      if (phraseViolation) {
        setGeneratingType(null)
        return generateSection(type, {
          refinementInstruction: `Do not use the phrase: "${phraseViolation}"`,
          operation: 'refine'
        })
      }

      const saved = await saveArtifactSection({
        sessionId,
        type,
        content: data.content,
        bullets: data.bullets,
        generationRationale: data.generationRationale,
        evidenceWarnings: data.evidenceWarnings ?? [],
        sourceMappings: data.sourceMappings ?? [],
        signalInfluence: data.signalInfluence,
        jdTraceability: data.jdTraceability ?? [],
        blockedClaimDiagnostics: data.blockedClaimDiagnostics ?? [],
        generationProvenance: provenance,
        status: operation === 'refine' ? 'needs_review' : 'generated'
      })

      setSections(prev => new Map(prev).set(type, saved))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.')
    } finally {
      setGeneratingType(null)
    }
  }, [session, sections, sessionId, calibrationSummary])

  // ── Accept ─────────────────────────────────────────────────────────────────

  async function handleAccept(section: ArtifactSection) {
    await acceptSection(section.id)
    const updated: ArtifactSection = {
      ...section,
      status: 'accepted',
      acceptedAt: new Date().toISOString()
    }
    setSections(prev => new Map(prev).set(section.type, updated))

    // Emit accepted-bullet signals only for display-partition bullets (the accepted content)
    for (const bullet of section.bullets.filter(b =>
      (b.partition ?? 'display') === 'display' && b.approved !== false
    )) {
      await addLearningSignal({
        scope: 'personal',
        type: 'accepted-bullet',
        content: bullet.text,
        context: `${session?.roleTitle} at ${session?.company}`,
        roleCategory: session?.emphasisRecommendation,
        sectionType: section.type
      })
    }

    // Emit signal-influence signal if one was present
    if (section.signalInfluence) {
      await addLearningSignal({
        scope: 'personal',
        type: 'artifact-strategy',
        content: `Accepted section with: ${section.signalInfluence}`,
        context: `${section.type} for ${session?.roleTitle}`,
        productArea: 'artifact-strategy',
        roleCategory: session?.emphasisRecommendation,
        sectionType: section.type
      })
    }
  }

  // ── Reject ─────────────────────────────────────────────────────────────────

  async function handleReject(section: ArtifactSection, reason?: string) {
    const updated: ArtifactSection = { ...section, status: 'rejected' }
    await saveArtifactSection(updated)
    setSections(prev => new Map(prev).set(section.type, updated))
    if (reason) {
      await addLearningSignal({
        scope: 'personal',
        type: 'rejected-phrase',
        content: reason,
        context: `Rejected in ${section.type} for ${session?.roleTitle}`,
        roleCategory: session?.emphasisRecommendation,
        sectionType: section.type
      })
    }
  }

  // ── Bullet approval ────────────────────────────────────────────────────────

  async function handleBulletApproval(section: ArtifactSection, bulletId: string, approved: boolean) {
    const updatedBullets = section.bullets.map(b =>
      b.id === bulletId ? { ...b, approved } : b
    )
    const updated: ArtifactSection = { ...section, bullets: updatedBullets }
    await saveArtifactSection(updated)
    setSections(prev => new Map(prev).set(section.type, updated))

    if (!approved) {
      const bullet = section.bullets.find(b => b.id === bulletId)
      if (bullet) {
        await addLearningSignal({
          scope: 'personal',
          type: 'rejected-bullet',
          content: bullet.text,
          context: `Rejected bullet in ${section.type}`,
          roleCategory: session?.emphasisRecommendation,
          sectionType: section.type
        })
      }
    }
  }

  // ── Manual edit ────────────────────────────────────────────────────────────

  async function handleManualSave(section: ArtifactSection, content: string, note?: string) {
    await saveManualEdit(section.id, content, note)
    const updated: ArtifactSection = {
      ...section,
      content,
      userNote: note,
      version: (section.version ?? 0) + 1
    }
    setSections(prev => new Map(prev).set(section.type, updated))
  }

  // ── Render guards ──────────────────────────────────────────────────────────

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>
  if (!session) return <p className="text-sm text-red-400">Session not found.</p>

  // Stage 1 blocker
  const hasValidJD = (session.jdRequirementMap?.required?.length ?? 0) > 0
  if (!hasValidJD) {
    return (
      <div className="space-y-3 py-8">
        <p className="text-sm font-medium text-red-400">
          Complete Stage 1 Target Intake before generating artifacts.
        </p>
        <p className="text-xs text-gray-500">
          Stage 1 must produce a valid analyzed JD requirement map. Go back and analyze a real job description first.
        </p>
        <a href={`/sessions/${sessionId}`} className="inline-block text-xs text-gray-400 underline hover:text-gray-200">
          ← Back to Stage 1
        </a>
      </div>
    )
  }

  // Stage 2 warning (non-blocking)
  const bridgeIncomplete = bridgeTotal > 0 && bridgeAnswered < Math.ceil(bridgeTotal * 0.5)
  const bridgeNotStarted = bridgeTotal === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Stage 3 — Calibration &amp; Artifact Refinement</h1>
        <p className="text-sm text-gray-400 mt-1">
          Emphasis: <span className="text-blue-300 font-medium">{session.emphasisRecommendation}</span>
          {' · '}Calibrate against the market in Stage 3A, then generate and refine artifacts in Stage 3B.
        </p>
      </div>

      {/* Session evidence gaps — shown once, not repeated in every section card */}
      {globalWarnings.length > 0 && (
        <div className="space-y-1 px-4 py-3 bg-gray-900/60 border border-gray-700 rounded-lg">
          <p className="text-xs font-medium text-gray-400">Session evidence gaps</p>
          {globalWarnings.map((w, i) => (
            <p key={i} className="text-xs text-gray-500">· {w}</p>
          ))}
        </div>
      )}

      {/* Stage 3A — Calibration References panel */}
      {!calibrationSkipped && (
        <CalibrationPanel
          sessionId={sessionId}
          targetCompany={session.company}
          roleTitle={session.roleTitle}
          jdSummary={session.jobDescription?.summary}
          onCalibrationApplied={(summary, applied) => handleCalibrationApplied(summary, applied)}
          onSkip={handleCalibrationSkip}
        />
      )}
      {calibrationSkipped && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/40 border border-gray-700 rounded-lg text-xs text-gray-500">
          <span>Stage 3A calibration skipped.</span>
          <button
            onClick={() => setCalibrationSkipped(false)}
            className="underline hover:text-gray-300"
          >
            Show calibration panel
          </button>
        </div>
      )}

      {calibrationSummary && !calibrationUpdatedBanner && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-950/20 border border-blue-800/40 rounded-lg text-xs text-blue-400">
          <span>Calibration applied — market patterns will guide artifact language and emphasis.</span>
          <button onClick={() => setCalibrationSummary(undefined)} className="text-gray-500 hover:text-gray-300">Clear</button>
        </div>
      )}

      {calibrationUpdatedBanner && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/20 border border-amber-800/40 rounded-lg text-xs text-amber-400">
          <span>Calibration updated. Regenerate sections manually to apply new guidance.</span>
          <button onClick={() => setCalibrationUpdatedBanner(false)} className="text-gray-500 hover:text-gray-300">Dismiss</button>
        </div>
      )}

      {/* Stage 3B heading */}
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-300">Stage 3B — Artifact Refinement</h2>
        {!calibrationSummary && !calibrationSkipped && (
          <span className="text-xs text-gray-600">Run Stage 3A calibration first for best results, or skip to generate without it.</span>
        )}
      </div>

      {/* Stage 2 warning */}
      {(bridgeIncomplete || bridgeNotStarted) && (
        <div className="flex gap-2 px-4 py-3 bg-amber-950/30 border border-amber-800/50 rounded-lg text-xs text-amber-300">
          <span className="shrink-0">⚠</span>
          <span>
            {bridgeNotStarted
              ? 'Bridge questions have not been completed. '
              : `Bridge questions are incomplete (${bridgeAnswered}/${bridgeTotal} answered). `}
            Generated artifacts may miss job-specific evidence.{' '}
            <a href={`/sessions/${sessionId}/bridge`} className="underline hover:text-amber-100">
              Complete Stage 2 first →
            </a>
          </span>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-950/30 border border-red-800/50 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {SECTION_ORDER.map(type => {
          const section = sections.get(type)
          const isGenerating = generatingType === type
          const isAccepted = section?.status === 'accepted'

          return (
            <div key={type} className="border border-gray-700 rounded-lg overflow-hidden">
              {/* Card header */}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-800/60 border-b border-gray-700">
                <div className="flex items-center gap-3 min-w-0">
                  <h2 className="text-sm font-medium text-white truncate">{SECTION_LABELS[type]}</h2>
                  {section && <StatusBadge status={section.status} />}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {isAccepted && (
                    <button
                      onClick={() => generateSection(type, {
                        refinementInstruction: 'Rewrite this section.',
                        operation: 'regenerate'
                      })}
                      disabled={isGenerating}
                      className="text-xs px-3 py-1 border border-gray-600 text-gray-400 rounded hover:border-gray-400 hover:text-gray-200 disabled:opacity-40"
                    >
                      {isGenerating
                        ? <span className="flex items-center gap-1"><Spinner className="h-3 w-3 text-gray-400" />Generating…</span>
                        : 'Request Changes'}
                    </button>
                  )}
                  {!isAccepted && (
                    <button
                      onClick={() => generateSection(type, { operation: section ? 'regenerate' : 'generate' })}
                      disabled={isGenerating}
                      className="text-xs px-3 py-1 border border-gray-600 text-gray-300 rounded hover:border-gray-400 hover:text-white disabled:opacity-40"
                    >
                      {isGenerating
                        ? <span className="flex items-center gap-1"><Spinner className="h-3 w-3 text-gray-300" />Generating…</span>
                        : section ? 'Regenerate' : 'Generate'}
                    </button>
                  )}
                </div>
              </div>

              {/* Card body */}
              {section ? (
                <ArtifactSectionCard
                  section={section}
                  isGenerating={isGenerating}
                  globalWarnings={globalWarnings}
                  currentCalibrationStateId={appliedCalibrationState?.id}
                  onAccept={() => handleAccept(section)}
                  onReject={reason => handleReject(section, reason)}
                  onRefine={instruction => generateSection(type, { refinementInstruction: instruction, operation: 'refine' })}
                  onBulletApproval={(bulletId, approved) => handleBulletApproval(section, bulletId, approved)}
                  onManualSave={(content, note) => handleManualSave(section, content, note)}
                />
              ) : (
                <div className="px-5 py-10 text-sm text-gray-500 text-center">
                  {isGenerating
                    ? <span className="flex items-center justify-center gap-2"><Spinner className="h-4 w-4 text-gray-400" />Generating…</span>
                    : 'Not generated yet.'}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
