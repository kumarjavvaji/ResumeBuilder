'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  ArtifactSection,
  BridgeQuestion,
  ContractValidationResult,
  EmphasisCategory,
  LearningSignal,
  ResumeGenerationContract,
  ResumeReadinessContract,
  ResumeStrategyBrief,
  SectionWarning,
  Stage4QualityTrace,
  Stage4RawResumeText,
  Stage4Section,
  TargetIntake,
  UserProfile,
} from '@/contracts'
import { getSessionSections } from '@/lib/storage/artifacts'
import { getUserProfile } from '@/lib/storage/user-profile'
import { getSession } from '@/lib/storage/sessions'
import { getAnsweredQuestions } from '@/lib/storage/bridge-questions'
import {
  getPersonalSignalsForRole,
  getGlobalSignals,
  getRejectedPhrases,
} from '@/lib/storage/learning-signals'
import { getAppliedCalibrationState } from '@/lib/storage/applied-calibration'
import {
  getStage4RawResumeText,
  saveStage4RawResumeText,
  updateStage4RawResumeText,
  updateStage4RawResumeTextSections,
  updateStage4SectionBlock,
  acceptStage4SectionProposal,
  rejectStage4SectionProposal,
  setStage4SectionManualEdit,
  ignoreStage4SectionWarning,
  unignoreStage4SectionWarning,
} from '@/lib/storage/stage4-raw-resume'
import {
  generateAllSectionWarnings,
  summarizeWarnings,
  SECTION_WARNING_LABELS,
  SECTION_WARNING_SEVERITY_COLOR,
  SUGGESTED_ACTION_LABELS,
} from '@/lib/stage4/section-warnings'
import {
  buildSectionBlocks,
  buildStage4RawResumeText,
  compiledFullText,
  getStage4Readiness,
  getStage4StaleReasons,
  parseSectionsFromRepairedText,
} from '@/lib/stage4/raw-resume-text'
import {
  buildResumeGenerationContract,
  validateStage4ResumeOutput,
} from '@/lib/stage4/resume-generation-contract'
import { buildResumeReadinessContract } from '@/lib/stage3/readiness-contract'
import { buildResumeStrategyBrief } from '@/lib/resume-strategy/resume-strategy-brief'
import { Spinner } from '@/components/shared/spinner'
import { textareaCls } from '@/lib/input-cls'

const REQUIRED_LABELS: Record<string, string> = {
  summary: 'Summary',
  skills: 'Skills',
  'experience-primary': 'Primary Experience',
  'experience-secondary': 'Secondary Experience',
  'experience-supporting': 'Supporting Experience',
}

const SECTION_DISPLAY: Record<string, string> = {
  ...REQUIRED_LABELS,
  education: 'Education & Certifications',
}

// ─── Context for LLM refinement calls ────────────────────────────────────────

interface RefineContext {
  session: TargetIntake
  profile: UserProfile
  bridgeQuestions: BridgeQuestion[]
  acceptedSignals: LearningSignal[]
  globalSignals: LearningSignal[]
  rejectedPhrases: string[]
  calibrationSummary?: import('@/contracts').CalibrationSummary
}

interface RepairPreview {
  repairedText: string
  repairsApplied: string[]
  unfixedViolations: string[]
  validation: ContractValidationResult
  changed: boolean
}

// ─── Derive section blocks from rawText ──────────────────────────────────────

function deriveBlocks(rawText: Stage4RawResumeText, artifactSections: ArtifactSection[]): Stage4Section[] {
  if (rawText.sectionBlocks?.length) return rawText.sectionBlocks
  return buildSectionBlocks(rawText.sections, artifactSections)
}

// ─── Main page component ──────────────────────────────────────────────────────

export function RawResumeTextPage({ sessionId }: { sessionId: string }) {
  const [sections, setSections] = useState<ArtifactSection[]>([])
  const [profile, setProfile] = useState<UserProfile | undefined>(undefined)
  const [rawText, setRawText] = useState<Stage4RawResumeText | undefined>(undefined)
  const [refineCtx, setRefineCtx] = useState<RefineContext | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [fullRefining, setFullRefining] = useState(false)
  const [copiedFull, setCopiedFull] = useState(false)
  const [error, setError] = useState('')
  const [validation, setValidation] = useState<ContractValidationResult | undefined>(undefined)
  const [repairPreview, setRepairPreview] = useState<RepairPreview | undefined>(undefined)
  const [showDebugTrace, setShowDebugTrace] = useState(false)
  const [fullRefineInstruction, setFullRefineInstruction] = useState('')
  const [showFullRefine, setShowFullRefine] = useState(false)

  useEffect(() => {
    async function load() {
      const [loadedSections, loadedProfile, savedRaw, session] = await Promise.all([
        getSessionSections(sessionId),
        getUserProfile(),
        getStage4RawResumeText(sessionId),
        getSession(sessionId),
      ])
      setSections(loadedSections)
      setProfile(loadedProfile)
      setRawText(savedRaw)

      if (session && loadedProfile) {
        const emphasis = (session.emphasisRecommendation ?? 'blended') as EmphasisCategory
        const [bridgeQuestions, acceptedSignals, globalSignals, rejectedPhrases, calibState] =
          await Promise.all([
            getAnsweredQuestions(sessionId),
            getPersonalSignalsForRole(emphasis),
            getGlobalSignals(20),
            getRejectedPhrases(),
            getAppliedCalibrationState(sessionId),
          ])
        setRefineCtx({
          session,
          profile: loadedProfile,
          bridgeQuestions,
          acceptedSignals,
          globalSignals,
          rejectedPhrases,
          calibrationSummary: calibState?.summary,
        })
      }

      setLoading(false)
    }
    load()
  }, [sessionId])

  const readiness = useMemo(() => getStage4Readiness(sections), [sections])
  const staleReasons = useMemo(() => getStage4StaleReasons(rawText, sections), [rawText, sections])

  const contract = useMemo<ResumeGenerationContract | undefined>(() => {
    if (!refineCtx || !profile) return undefined
    return buildResumeGenerationContract({
      emphasisRecommendation: refineCtx.session.emphasisRecommendation,
      roleTitle: refineCtx.session.roleTitle,
      overallRefinementPrompt: refineCtx.session.overallRefinementPrompt,
      jdMap: refineCtx.session.jdRequirementMap,
      profile,
    })
  }, [refineCtx, profile])

  const readinessContract = useMemo<ResumeReadinessContract | undefined>(() => {
    if (!refineCtx || !profile) return undefined
    return buildResumeReadinessContract({
      emphasisRecommendation: refineCtx.session.emphasisRecommendation,
      roleTitle: refineCtx.session.roleTitle,
      jdMap: refineCtx.session.jdRequirementMap,
      profile,
      evidenceAtoms: [],
      resolvedDecisions: [],
    })
  }, [refineCtx, profile])

  const strategyBrief = useMemo<ResumeStrategyBrief | undefined>(() => {
    if (!refineCtx || !contract) return undefined
    return buildResumeStrategyBrief({
      jdMap: refineCtx.session.jdRequirementMap,
      blueprint: contract,
      targetRole: refineCtx.session.roleTitle,
    })
  }, [contract, refineCtx])

  // Derived section blocks — stable across renders
  const sectionBlocks = useMemo<Stage4Section[]>(
    () => rawText ? deriveBlocks(rawText, sections) : [],
    [rawText, sections],
  )

  const compiledText = useMemo(() => compiledFullText(sectionBlocks), [sectionBlocks])

  // Section-level warnings — regenerated whenever blocks change
  const warningMap = useMemo(() => generateAllSectionWarnings(sectionBlocks), [sectionBlocks])
  const warningSummary = useMemo(() => {
    const ignoredBySection: Record<string, string[]> = {}
    for (const b of sectionBlocks) {
      if (b.ignoredWarningIds?.length) ignoredBySection[b.sectionId] = b.ignoredWarningIds
    }
    return summarizeWarnings(warningMap, ignoredBySection)
  }, [warningMap, sectionBlocks])

  const displayRaw = rawText
    ? {
        ...rawText,
        status: staleReasons.length > 0 ? ('stale' as const) : rawText.status,
        staleReasons: staleReasons.length > 0 ? staleReasons : rawText.staleReasons,
      }
    : undefined

  function validateText(text: string): ContractValidationResult | undefined {
    if (!contract || !profile) return undefined
    const knownTools = [...profile.skills, ...profile.skillGroups.flatMap(g => g.skills)]
    return validateStage4ResumeOutput(text, contract, { knownTools, readinessContract })
  }

  async function generate(allowDraft: boolean) {
    if (!profile) {
      setError('Profile required before Stage 4 raw text can be assembled.')
      return
    }
    setGenerating(true)
    setError('')
    setValidation(undefined)
    setRepairPreview(undefined)
    try {
      const assembled = buildStage4RawResumeText({
        sessionId,
        sections,
        profile,
        allowDraft,
        contract,
        readinessContract,
        strategyBrief,
        jdMap: refineCtx?.session.jdRequirementMap,
      })
      const saved = await saveStage4RawResumeText(assembled)
      setRawText(saved)
      const result = validateText(assembled.sections.fullText)
      setValidation(result)
      if (result && !result.pass) {
        await runAutoRepair(saved, result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assemble raw resume text.')
    } finally {
      setGenerating(false)
    }
  }

  async function runAutoRepair(
    rawOverride?: Stage4RawResumeText,
    validationOverride?: ContractValidationResult,
  ) {
    const targetRawText = rawOverride ?? rawText
    if (!targetRawText || !contract || !refineCtx) return
    setRepairing(true)
    setError('')
    try {
      const currentText = compiledFullText(deriveBlocks(targetRawText, sections))
      const currentValidation = validationOverride ?? validateText(currentText)
      const violations = currentValidation?.violations ?? []
      const res = await fetch('/api/stage4-repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeText: currentText,
          violations,
          contract,
          profile: refineCtx.profile,
          jdMap: refineCtx.session.jdRequirementMap,
          bridgeAnswers: refineCtx.bridgeQuestions,
          readinessContract,
          strategyBrief,
          rewriteDirectives: targetRawText?.qualityTrace?.reviewTrace?.rewriteDirectives ?? [],
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Auto-repair failed.')
      }
      const result = await res.json() as {
        repairedText: string
        repairsApplied: string[]
        unfixedViolations: string[]
        repairStatus: 'repaired' | 'partial'
        remainingValidation: ContractValidationResult
      }
      if (!result.remainingValidation.pass) {
        setValidation(result.remainingValidation)
        setRepairPreview({
          repairedText: result.repairedText,
          repairsApplied: result.repairsApplied,
          unfixedViolations: result.unfixedViolations,
          validation: result.remainingValidation,
          changed: result.repairedText.trim() !== currentText.trim(),
        })
        return
      }

      const currentSections = targetRawText.sections
      const patchedSections = parseSectionsFromRepairedText(result.repairedText, currentSections)
      const newBlocks = buildSectionBlocks(patchedSections, sections)
      const updated = await updateStage4RawResumeTextSections(sessionId, patchedSections, newBlocks)
      if (updated) setRawText(updated)
      setValidation(result.remainingValidation)
      setRepairPreview(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-repair failed.')
    } finally {
      setRepairing(false)
    }
  }

  async function acknowledgeStale() {
    if (!rawText || staleReasons.length === 0) return
    await updateStage4RawResumeText(rawText.id, { status: 'stale', staleReasons })
    setRawText({ ...rawText, status: 'stale', staleReasons, updatedAt: new Date().toISOString() })
  }

  async function acceptPartialRepair() {
    if (!repairPreview || !rawText) return
    const patchedSections = parseSectionsFromRepairedText(repairPreview.repairedText, rawText.sections)
    const newBlocks = buildSectionBlocks(patchedSections, sections)
    const updated = await updateStage4RawResumeTextSections(sessionId, patchedSections, newBlocks)
    if (updated) setRawText(updated)
    setValidation(repairPreview.validation)
    setRepairPreview(undefined)
  }

  async function copyFull() {
    await navigator.clipboard.writeText(compiledText)
    setCopiedFull(true)
    setTimeout(() => setCopiedFull(false), 1600)
  }

  // ── Full-resume refinement (returns section-level proposals) ──────────────

  async function runFullRefinement() {
    if (!refineCtx || !rawText || !fullRefineInstruction.trim()) return
    setFullRefining(true)
    setError('')
    try {
      const res = await fetch('/api/stage4-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'full',
          sessionId,
          fullResumeText: compiledText,
          userInstruction: fullRefineInstruction.trim(),
          jdMap: refineCtx.session.jdRequirementMap,
          profile: refineCtx.profile,
          answeredQuestions: refineCtx.bridgeQuestions,
          emphasis: refineCtx.session.emphasisRecommendation,
          companySummary: refineCtx.session.companySummary,
          fitHypothesis: refineCtx.session.fitHypothesis,
          riskGaps: refineCtx.session.riskGaps,
          acceptedSignals: refineCtx.acceptedSignals,
          globalSignals: refineCtx.globalSignals,
          rejectedPhrases: refineCtx.rejectedPhrases,
          calibrationSummary: refineCtx.calibrationSummary,
          roleTitle: refineCtx.session.roleTitle,
          company: refineCtx.session.company,
          contract,
          strategyBrief,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Full resume refinement failed.')
      }
      const { revisedText } = await res.json() as { revisedText: string; changeSummary: string[]; warnings: string[] }

      // Parse revised text into sections and set proposedText per block
      const parsedSections = parseSectionsFromRepairedText(revisedText, rawText.sections)
      const newBlocks = buildSectionBlocks(parsedSections, sections)
      const currentBlockMap = new Map(sectionBlocks.map(b => [b.sectionId, b]))
      for (const nb of newBlocks) {
        const current = currentBlockMap.get(nb.sectionId)
        if (current && nb.acceptedText.trim() !== current.acceptedText.trim()) {
          await updateStage4SectionBlock(sessionId, nb.sectionId, nb.acceptedText)
        }
      }
      const updated = await getStage4RawResumeText(sessionId)
      if (updated) setRawText(updated)
      setShowFullRefine(false)
      setFullRefineInstruction('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Full resume refinement failed.')
    } finally {
      setFullRefining(false)
    }
  }

  // ── Per-section handlers ──────────────────────────────────────────────────

  async function handleSectionRefine(sectionId: string, instruction: string) {
    if (!refineCtx || !rawText) return
    const block = sectionBlocks.find(b => b.sectionId === sectionId)
    const res = await fetch('/api/stage4-refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'section',
        sessionId,
        sectionType: sectionId,
        sectionText: block?.acceptedText ?? '',
        userInstruction: instruction,
        jdMap: refineCtx.session.jdRequirementMap,
        profile: refineCtx.profile,
        answeredQuestions: refineCtx.bridgeQuestions,
        emphasis: refineCtx.session.emphasisRecommendation,
        companySummary: refineCtx.session.companySummary,
        fitHypothesis: refineCtx.session.fitHypothesis,
        riskGaps: refineCtx.session.riskGaps,
        acceptedSignals: refineCtx.acceptedSignals,
        globalSignals: refineCtx.globalSignals,
        rejectedPhrases: refineCtx.rejectedPhrases,
        calibrationSummary: refineCtx.calibrationSummary,
        roleTitle: refineCtx.session.roleTitle,
        company: refineCtx.session.company,
        contract,
        strategyBrief,
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? 'Section refinement failed.')
    }
    const { revisedText } = await res.json() as { revisedText: string }
    await updateStage4SectionBlock(sessionId, sectionId, revisedText)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function handleSectionAccept(sectionId: string) {
    await acceptStage4SectionProposal(sessionId, sectionId)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function handleSectionReject(sectionId: string) {
    await rejectStage4SectionProposal(sessionId, sectionId)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function handleSectionManualEdit(sectionId: string, text: string) {
    await setStage4SectionManualEdit(sessionId, sectionId, text)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function handleIgnoreWarning(sectionId: string, warningId: string) {
    await ignoreStage4SectionWarning(sessionId, sectionId, warningId)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function handleUnignoreWarning(sectionId: string, warningId: string) {
    await unignoreStage4SectionWarning(sessionId, sectionId, warningId)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>

  const canRefine = !!refineCtx && !!displayRaw

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Stage 4 - Raw Resume Text</h1>
        <p className="text-sm text-gray-400 mt-1">
          Plain-text resume assembled from accepted Stage 3 artifacts. Each section is independently refinable.
        </p>
      </div>

      {!readiness.ready && (
        <div className="space-y-2 border border-amber-800/50 bg-amber-950/25 rounded-lg px-4 py-3 text-sm">
          <p className="font-medium text-amber-300">Not ready for final raw text.</p>
          <p className="text-xs text-amber-200/80">
            Missing accepted sections:{' '}
            {readiness.missingRequired.map(t => REQUIRED_LABELS[t]).join(', ')}
          </p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => generate(true)}
              disabled={generating}
              className="px-3 py-1.5 border border-amber-700 text-amber-100 rounded text-xs hover:bg-amber-900/40 disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate Draft Preview'}
            </button>
          </div>
        </div>
      )}

      {readiness.ready && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => generate(false)}
            disabled={generating}
            className="px-4 py-2 bg-gray-200 text-gray-900 rounded text-sm font-medium hover:bg-white disabled:opacity-50"
          >
            {generating ? 'Generating...' : displayRaw ? 'Regenerate' : 'Generate Raw Resume Text'}
          </button>
          <span className="text-xs text-gray-500">No DOCX or PDF is generated in this pass.</span>
        </div>
      )}

      {error && (
        <div className="border border-red-800/50 bg-red-950/30 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {validation && !validation.pass && displayRaw && (
        <ValidationPanel
          validation={validation}
          repairing={repairing}
          onRepair={() => runAutoRepair()}
          hasSemanticErrors={validation.violations.some(v => !v.canAutoRepair && v.severity === 'error')}
        />
      )}

      {repairPreview && displayRaw && (
        <RepairPreviewPanel
          preview={repairPreview}
          onAccept={acceptPartialRepair}
        />
      )}

      {process.env.NODE_ENV === 'development' && displayRaw?.qualityTrace && (
        <QualityTracePanel
          trace={displayRaw.qualityTrace}
          open={showDebugTrace}
          onToggle={() => setShowDebugTrace(v => !v)}
          warningSummary={warningSummary}
        />
      )}

      {displayRaw && displayRaw.status === 'stale' && (
        <div className="space-y-2 border border-amber-800/50 bg-amber-950/25 rounded-lg px-4 py-3 text-sm">
          <p className="font-medium text-amber-300">Raw resume text is stale.</p>
          {displayRaw.staleReasons.map((reason, i) => (
            <p key={i} className="text-xs text-amber-200/80">{reason}</p>
          ))}
          <div className="flex gap-2">
            <button
              onClick={() => generate(false)}
              disabled={!readiness.ready || generating}
              className="px-3 py-1.5 border border-amber-700 text-amber-100 rounded text-xs hover:bg-amber-900/40 disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              onClick={acknowledgeStale}
              className="px-3 py-1.5 text-xs text-amber-200/80 underline hover:text-amber-100"
            >
              Keep stale notice
            </button>
          </div>
        </div>
      )}

      {displayRaw && (
        <div className="space-y-4">
          {displayRaw.status === 'needs_review' && (
            <p className="text-xs text-amber-400">
              Draft preview only — not export-ready until all required Stage 3 sections are accepted.
            </p>
          )}

          {/* ── Full-resume refine bar ── */}
          {canRefine && (
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFullRefine(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-800/60 hover:bg-gray-800/90 text-left text-sm"
              >
                <span className="text-gray-300 font-medium">Refine Full Resume</span>
                <span className="text-gray-500 text-xs">{showFullRefine ? '▲' : '▼'}</span>
              </button>
              {showFullRefine && (
                <div className="px-4 py-3 bg-gray-900/40 space-y-2">
                  <p className="text-xs text-gray-400">
                    Apply one instruction across the entire resume. Changes appear as section-level proposals you can Accept or Reject independently.
                  </p>
                  <textarea
                    className={`${textareaCls} h-16 text-xs`}
                    value={fullRefineInstruction}
                    onChange={e => setFullRefineInstruction(e.target.value)}
                    placeholder='e.g. "Tighten to two pages" or "Lead with fintech" or "Remove Azure DevOps"'
                    disabled={fullRefining}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={runFullRefinement}
                      disabled={!fullRefineInstruction.trim() || fullRefining}
                      className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs font-medium hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {fullRefining && <Spinner className="text-white" />}
                      {fullRefining ? 'Refining…' : 'Apply'}
                    </button>
                    <button
                      onClick={() => { setShowFullRefine(false); setFullRefineInstruction('') }}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Warning summary ── */}
          {sectionBlocks.length > 0 && (warningSummary.errorCount + warningSummary.warningCount + warningSummary.advisoryCount) > 0 && (
            <div className="flex items-center gap-3 px-3 py-2 bg-gray-800/40 border border-gray-700/50 rounded-lg text-xs">
              <span className="text-gray-400 font-medium">Section warnings:</span>
              {warningSummary.errorCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-300">
                  {warningSummary.errorCount} error{warningSummary.errorCount !== 1 ? 's' : ''}
                </span>
              )}
              {warningSummary.warningCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-900/30 text-amber-300">
                  {warningSummary.warningCount} warning{warningSummary.warningCount !== 1 ? 's' : ''}
                </span>
              )}
              {warningSummary.advisoryCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-blue-900/20 text-blue-400">
                  {warningSummary.advisoryCount} advisory
                </span>
              )}
              {(warningSummary.byType.role_boundary_leakage ?? 0) > 0 && (
                <span className="text-gray-500">· {warningSummary.byType.role_boundary_leakage} boundary</span>
              )}
              {(warningSummary.byType.duplicate_evidence ?? 0) > 0 && (
                <span className="text-gray-500">· {warningSummary.byType.duplicate_evidence} duplicate</span>
              )}
            </div>
          )}

          {/* ── Document spine ── */}
          {sectionBlocks.length > 0 && (
            <div className="space-y-3">
              {[...sectionBlocks].sort((a, b) => a.order - b.order).map(block => (
                <SectionCard
                  key={block.sectionId}
                  block={block}
                  sectionWarnings={warningMap.get(block.sectionId) ?? []}
                  canRefine={canRefine}
                  onRefine={inst => handleSectionRefine(block.sectionId, inst)}
                  onAccept={() => handleSectionAccept(block.sectionId)}
                  onReject={() => handleSectionReject(block.sectionId)}
                  onManualEdit={text => handleSectionManualEdit(block.sectionId, text)}
                  onIgnoreWarning={id => handleIgnoreWarning(block.sectionId, id)}
                  onUnignoreWarning={id => handleUnignoreWarning(block.sectionId, id)}
                />
              ))}
            </div>
          )}

          {/* ── Copy full resume action bar ── */}
          {sectionBlocks.length > 0 && (
            <div className="flex items-center justify-between border border-gray-700 rounded-lg px-4 py-3 bg-gray-900/40">
              <div>
                <p className="text-sm font-medium text-gray-200">Full Resume</p>
                <p className="text-xs text-gray-500">Compiled from accepted section text in document order.</p>
              </div>
              <button
                onClick={copyFull}
                disabled={!compiledText.trim()}
                className="px-4 py-2 border border-gray-600 text-gray-300 rounded text-sm hover:border-gray-400 hover:text-white disabled:opacity-40"
              >
                {copiedFull ? 'Copied' : 'Copy Full Resume'}
              </button>
            </div>
          )}
        </div>
      )}

      {!displayRaw && (
        <div className="border border-gray-700 rounded-lg px-5 py-8 text-sm text-gray-500 text-center">
          Generate raw resume text after accepting the required Stage 3 resume sections.
        </div>
      )}
    </div>
  )
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  block,
  sectionWarnings,
  canRefine,
  onRefine,
  onAccept,
  onReject,
  onManualEdit,
  onIgnoreWarning,
  onUnignoreWarning,
}: {
  block: Stage4Section
  sectionWarnings: SectionWarning[]
  canRefine: boolean
  onRefine: (instruction: string) => Promise<void>
  onAccept: () => void
  onReject: () => void
  onManualEdit: (text: string) => void
  onIgnoreWarning: (warningId: string) => void
  onUnignoreWarning: (warningId: string) => void
}) {
  const [copiedSection, setCopiedSection] = useState(false)
  const [showRefine, setShowRefine] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [refineInstruction, setRefineInstruction] = useState('')
  const [editText, setEditText] = useState(block.acceptedText)
  const [refining, setRefining] = useState(false)
  const [localError, setLocalError] = useState('')

  const label = SECTION_DISPLAY[block.sectionType] ?? block.sectionType
  const hasProposal = !!block.proposedText

  async function copySection() {
    await navigator.clipboard.writeText(block.acceptedText)
    setCopiedSection(true)
    setTimeout(() => setCopiedSection(false), 1600)
  }

  async function submitRefine() {
    if (!refineInstruction.trim()) return
    setRefining(true)
    setLocalError('')
    try {
      await onRefine(refineInstruction.trim())
      setShowRefine(false)
      setRefineInstruction('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Refinement failed.')
    } finally {
      setRefining(false)
    }
  }

  function submitEdit() {
    onManualEdit(editText)
    setShowEdit(false)
  }

  return (
    <section className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/60">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-white">{label}</h2>
          {block.status === 'manual' && (
            <span className="text-xs px-2 py-0.5 bg-blue-900/60 text-blue-300 rounded border border-blue-800/50">
              Edited
            </span>
          )}
          {hasProposal && (
            <span className="text-xs px-2 py-0.5 bg-amber-900/60 text-amber-300 rounded border border-amber-800/50">
              Proposal ready
            </span>
          )}
          {sectionWarnings.length > 0 && (() => {
            const ignored = new Set(block.ignoredWarningIds ?? [])
            const visible = sectionWarnings.filter(w => !ignored.has(w.id))
            const errCount = visible.filter(w => w.severity === 'error').length
            const warnCount = visible.filter(w => w.severity === 'warning').length
            const advCount = visible.filter(w => w.severity === 'advisory').length
            if (visible.length === 0) return null
            return (
              <span className="flex items-center gap-1">
                {errCount > 0 && <span className="text-xs px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded">{errCount}e</span>}
                {warnCount > 0 && <span className="text-xs px-1.5 py-0.5 bg-amber-900/30 text-amber-300 rounded">{warnCount}w</span>}
                {advCount > 0 && <span className="text-xs px-1.5 py-0.5 bg-blue-900/20 text-blue-400 rounded">{advCount}a</span>}
              </span>
            )
          })()}
        </div>
        <button
          onClick={copySection}
          disabled={!block.acceptedText.trim()}
          className="text-xs px-3 py-1.5 border border-gray-600 text-gray-300 rounded hover:border-gray-400 hover:text-white disabled:opacity-40"
        >
          {copiedSection ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Current accepted text */}
      <pre className="whitespace-pre-wrap text-left font-mono text-sm leading-relaxed text-gray-200 bg-gray-950/40 px-4 py-3 min-h-12">
        {block.acceptedText || <span className="text-gray-600 italic">No accepted text.</span>}
      </pre>

      {/* Section warnings */}
      {sectionWarnings.length > 0 && (
        <SectionWarningList
          warnings={sectionWarnings}
          ignoredIds={block.ignoredWarningIds ?? []}
          onIgnore={onIgnoreWarning}
          onUnignore={onUnignoreWarning}
        />
      )}

      {/* Proposal block */}
      {hasProposal && block.proposedText && (
        <div className="border-t border-amber-800/30 bg-amber-950/10 px-4 py-3 space-y-2">
          <p className="text-xs font-medium text-amber-300">Proposed revision — review before accepting</p>
          <pre className="whitespace-pre-wrap text-xs font-mono text-gray-200 bg-gray-950/40 rounded p-3 max-h-64 overflow-y-auto border border-amber-800/30">
            {block.proposedText}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={onAccept}
              className="px-3 py-1.5 bg-green-800 text-green-100 rounded text-xs font-medium hover:bg-green-700"
            >
              Accept
            </button>
            <button
              onClick={onReject}
              className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded text-xs hover:border-gray-400"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      {canRefine && !showRefine && !showEdit && (
        <div className="border-t border-gray-700/50 px-4 py-2 flex items-center gap-3">
          <button
            onClick={() => setShowRefine(true)}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
          >
            Refine with note
          </button>
          <button
            onClick={() => { setEditText(block.acceptedText); setShowEdit(true) }}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
          >
            Edit manually
          </button>
        </div>
      )}

      {/* Inline refine panel */}
      {showRefine && (
        <div className="border-t border-gray-700/50 px-4 py-3 bg-gray-900/30 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-300">Refine {label}</span>
            <button onClick={() => { setShowRefine(false); setLocalError('') }} className="text-xs text-gray-500 hover:text-gray-300">✕</button>
          </div>
          <textarea
            className={`${textareaCls} h-16 text-xs`}
            value={refineInstruction}
            onChange={e => setRefineInstruction(e.target.value)}
            placeholder="Describe the change you want…"
            disabled={refining}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submitRefine}
              disabled={!refineInstruction.trim() || refining}
              className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs font-medium hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1.5"
            >
              {refining && <Spinner className="text-white" />}
              {refining ? 'Refining…' : 'Refine'}
            </button>
            <button onClick={() => { setShowRefine(false); setLocalError('') }} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
          </div>
          {localError && <p className="text-xs text-red-400">{localError}</p>}
        </div>
      )}

      {/* Inline manual edit */}
      {showEdit && (
        <div className="border-t border-gray-700/50 px-4 py-3 bg-gray-900/30 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-300">Edit {label}</span>
            <button onClick={() => setShowEdit(false)} className="text-xs text-gray-500 hover:text-gray-300">✕</button>
          </div>
          <textarea
            className={`${textareaCls} text-xs`}
            rows={Math.max(6, editText.split('\n').length + 2)}
            value={editText}
            onChange={e => setEditText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={submitEdit}
              className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs font-medium hover:bg-gray-600"
            >
              Save
            </button>
            <button onClick={() => setShowEdit(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Section warning list ─────────────────────────────────────────────────────

const SEVERITY_ICON: Record<string, string> = {
  error: '✗',
  warning: '⚠',
  advisory: '◦',
}

function SectionWarningList({
  warnings,
  ignoredIds,
  onIgnore,
  onUnignore,
}: {
  warnings: SectionWarning[]
  ignoredIds: string[]
  onIgnore: (id: string) => void
  onUnignore: (id: string) => void
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showIgnored, setShowIgnored] = useState(false)

  const ignored = new Set(ignoredIds)
  const visible = warnings.filter(w => !ignored.has(w.id))
  const hiddenCount = warnings.length - visible.length
  const allExpanded = visible.length > 0 && visible.every(w => expandedIds.has(w.id))

  function toggleOne(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setExpandedIds(allExpanded ? new Set() : new Set(visible.map(w => w.id)))
  }

  if (visible.length === 0 && hiddenCount === 0) return null

  return (
    <div className="border-t border-gray-700/40 divide-y divide-gray-700/30">
      {/* Expand-all control */}
      {visible.length > 1 && (
        <div className="px-4 py-1.5 flex justify-end">
          <button
            onClick={toggleAll}
            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}

      {visible.map(w => {
        const isExpanded = expandedIds.has(w.id)
        const colorCls = SECTION_WARNING_SEVERITY_COLOR[w.severity] ?? 'text-gray-400 bg-gray-800/20'

        return (
          <div key={w.id} className="text-xs">
            <button
              onClick={() => toggleOne(w.id)}
              className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-800/40 transition-colors"
            >
              <span className={`shrink-0 w-4 text-center font-bold ${colorCls.split(' ')[0]}`}>
                {SEVERITY_ICON[w.severity]}
              </span>
              <span className="flex-1 text-gray-300">
                {SECTION_WARNING_LABELS[w.warningType] ?? w.warningType}
              </span>
              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${colorCls}`}>
                {w.severity}
              </span>
              <span className="shrink-0 text-gray-600">{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
              <div className="px-4 pb-3 pt-1 space-y-2 bg-gray-900/30">
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">Affected text</p>
                  <pre className="text-gray-300 font-mono text-[11px] whitespace-pre-wrap bg-gray-950/60 px-2 py-1 rounded leading-relaxed">
                    {w.affectedText}
                  </pre>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-0.5">Why it matters</p>
                  <p className="text-gray-300 leading-relaxed">{w.explanation}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-0.5">Suggested action</p>
                  <p className="text-gray-300">{SUGGESTED_ACTION_LABELS[w.suggestedAction] ?? w.suggestedAction}</p>
                </div>
                {w.repairInstruction && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-0.5">Repair instruction</p>
                    <p className="text-amber-200/80 italic">{w.repairInstruction}</p>
                  </div>
                )}
                <button
                  onClick={() => { onIgnore(w.id); toggleOne(w.id) }}
                  className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                >
                  Ignore for this resume
                </button>
              </div>
            )}
          </div>
        )
      })}

      {hiddenCount > 0 && (
        <div className="px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] text-gray-600">{hiddenCount} ignored warning{hiddenCount !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
          >
            {showIgnored ? 'Hide' : 'Show ignored'}
          </button>
        </div>
      )}

      {showIgnored && hiddenCount > 0 && (
        <div className="divide-y divide-gray-700/20">
          {warnings.filter(w => ignored.has(w.id)).map(w => (
            <div key={w.id} className="px-4 py-2 flex items-center gap-2 text-xs">
              <span className="text-gray-600 line-through flex-1">
                {SECTION_WARNING_LABELS[w.warningType] ?? w.warningType}
              </span>
              <button
                onClick={() => onUnignore(w.id)}
                className="text-[10px] text-gray-600 hover:text-gray-400 underline"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Repair preview panel ─────────────────────────────────────────────────────

function RepairPreviewPanel({
  preview,
  onAccept,
}: {
  preview: RepairPreview
  onAccept: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(preview.repairedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="border border-amber-800/60 rounded-lg bg-amber-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-300">Partial Auto-Repair Preview</p>
          <p className="text-xs text-amber-100/75 mt-1">
            {preview.changed
              ? 'Auto-repair changed the output, but validation still has remaining violations.'
              : 'Auto-repair could not change the output — remaining violations need source-data changes.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="text-xs px-3 py-1.5 border border-amber-700 text-amber-100 rounded hover:bg-amber-900/40"
          >
            {copied ? 'Copied' : 'Copy Preview'}
          </button>
          {preview.changed && (
            <button
              onClick={onAccept}
              className="text-xs px-3 py-1.5 bg-amber-700 text-amber-50 rounded hover:bg-amber-600"
            >
              Accept Partial
            </button>
          )}
        </div>
      </div>

      {preview.repairsApplied.length > 0 && (
        <div>
          <p className="text-xs font-medium text-amber-200 mb-1">Repairs applied</p>
          <ul className="space-y-1 text-xs text-amber-100/80">
            {preview.repairsApplied.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {preview.unfixedViolations.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-300 mb-1">Remaining violations</p>
          <ul className="space-y-1 text-xs text-red-200/90">
            {preview.unfixedViolations.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Validation panel ─────────────────────────────────────────────────────────

function ValidationPanel({
  validation,
  repairing,
  onRepair,
  hasSemanticErrors,
}: {
  validation: import('@/contracts').ContractValidationResult
  repairing: boolean
  onRepair: () => void
  hasSemanticErrors: boolean
}) {
  const errors = validation.violations.filter(v => v.severity === 'error')
  const warnings = validation.violations.filter(v => v.severity === 'warning')

  return (
    <div className="border border-red-800/60 rounded-lg bg-red-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-red-300">Contract Violations</span>
          <span className="text-xs px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded">
            {errors.length} error{errors.length !== 1 ? 's' : ''}
            {warnings.length > 0 && `, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        {!hasSemanticErrors && errors.every(v => v.canAutoRepair) && errors.length > 0 ? (
          <button
            onClick={onRepair}
            disabled={repairing}
            className="text-xs px-3 py-1.5 bg-green-800 text-green-100 rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {repairing && <Spinner className="text-green-200" />}
            {repairing ? 'Repairing…' : 'Fix Automatically'}
          </button>
        ) : (
          <button
            onClick={onRepair}
            disabled={repairing}
            className="text-xs px-3 py-1.5 bg-amber-700 text-amber-100 rounded hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5"
          >
            {repairing && <Spinner className="text-amber-200" />}
            {repairing ? 'Repairing…' : 'Run Auto-Repair'}
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <div className="space-y-1.5">
          {errors.map((v, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 shrink-0 ${v.canAutoRepair ? 'text-amber-400' : 'text-red-400'}`}>
                {v.canAutoRepair ? '⚙' : '✗'}
              </span>
              <div>
                <span className="text-red-300 font-medium">[{v.rule}]</span>
                {' '}<span className="text-gray-400">{v.section}:</span>
                {' '}<span className="text-gray-300">{v.detail}</span>
                {v.canAutoRepair && <span className="ml-1 text-amber-500 italic">(auto-repairable)</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-2 border-t border-gray-700/50 pt-2">
          <p className="text-xs text-gray-500 font-medium">Warnings (advisory)</p>
          {warnings.map((v, i) => {
            const tw = validation.themeWarnings?.find(
              t => t.themeLabel === v.detail.match(/"([^"]+)"/)?.[1]
            )
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0 text-yellow-500">⚠</span>
                <div className="space-y-1 min-w-0">
                  <div>
                    <span className="text-yellow-400 font-medium">[{v.rule}]</span>
                    {' '}<span className="text-gray-400">{v.section}:</span>
                    {' '}<span className="text-gray-400">{v.detail}</span>
                  </div>
                  {tw && tw.matchingExperienceBullets.length > 0 && (
                    <div className="ml-1 border-l border-green-800/40 pl-2 space-y-0.5">
                      <p className="text-green-600 text-[10px] font-medium">Evidence found:</p>
                      {tw.matchingExperienceBullets.map((b, bi) => (
                        <p key={bi} className="text-green-700/80 text-[10px] truncate">{b}</p>
                      ))}
                    </div>
                  )}
                  {tw && tw.suggestedAction !== 'ignore' && (
                    <p className="text-amber-600/70 text-[10px] italic">
                      {tw.suggestedAction === 'refine_section' && 'Add a bullet that proves this theme (it appears in Skills only).'}
                      {tw.suggestedAction === 'remove_skill' && 'Consider removing this skill if it cannot be proven.'}
                      {tw.suggestedAction === 'add_bridge_question' && 'No evidence found — add a bridge question to surface relevant experience.'}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Quality trace panel (dev-only) ──────────────────────────────────────────

function QualityTracePanel({
  trace,
  open,
  onToggle,
  warningSummary,
}: {
  trace: Stage4QualityTrace
  open: boolean
  onToggle: () => void
  warningSummary?: import('@/lib/stage4/section-warnings').WarningSummary
}) {
  const { rulesetTrace, strategyBriefTrace, blueprintTrace, generationTrace, validationTrace, reviewTrace, repairTrace } = trace

  function BoolRow({ label, value }: { label: string; value: boolean }) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className={value ? 'text-green-400' : 'text-gray-500'}>{value ? '✓' : '✗'}</span>
        <span className={value ? 'text-gray-200' : 'text-gray-500'}>{label}</span>
      </div>
    )
  }

  function CountRow({ label, count }: { label: string; count: number }) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-400 font-mono w-6 text-right">{count}</span>
        <span className="text-gray-300">{label}</span>
      </div>
    )
  }

  return (
    <div className="border border-gray-700/60 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-800/40 text-left hover:bg-gray-800/60"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">[dev]</span>
          <span className="text-xs text-gray-300 font-medium">Stage 4 Quality Trace</span>
          {!rulesetTrace.rulesetLoaded && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded">no ruleset</span>
          )}
          {reviewTrace.ranCriticalReview && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">reviewed</span>
          )}
        </div>
        <span className="text-xs text-gray-500">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="px-4 py-3 bg-gray-900/40 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ruleset / Brief</p>
              <BoolRow label="Ruleset loaded" value={rulesetTrace.rulesetLoaded} />
              <BoolRow label="Strategy brief built" value={strategyBriefTrace.built} />
              <CountRow label="active rule IDs" count={rulesetTrace.activeRuleIds.length} />
              <CountRow label="anti-pattern IDs" count={rulesetTrace.antiPatternIds.length} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Blueprint / Generation</p>
              <BoolRow label="Blueprint built" value={blueprintTrace.built} />
              <BoolRow label="Prompt has strategy brief" value={generationTrace.promptIncludesStrategyBrief} />
              <BoolRow label="Prompt has blueprint" value={generationTrace.promptIncludesBlueprint} />
              <CountRow label="bullet intent count" count={blueprintTrace.bulletIntentCount} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Validation</p>
              <BoolRow label="Ran deterministic validation" value={validationTrace.ranDeterministicValidation} />
              <CountRow label="contract violations" count={validationTrace.violationCount} />
              {warningSummary && (
                <>
                  <CountRow label="section errors" count={warningSummary.errorCount} />
                  <CountRow label="section warnings" count={warningSummary.warningCount} />
                  <CountRow label="style advisories" count={warningSummary.advisoryCount} />
                  {(warningSummary.byType.role_boundary_leakage ?? 0) > 0 && (
                    <CountRow label="boundary warnings" count={warningSummary.byType.role_boundary_leakage!} />
                  )}
                  {(warningSummary.byType.duplicate_evidence ?? 0) > 0 && (
                    <CountRow label="duplicate evidence" count={warningSummary.byType.duplicate_evidence!} />
                  )}
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Review / Repair</p>
              <BoolRow label="Ran critical review" value={reviewTrace.ranCriticalReview} />
              <CountRow label="rewrite directives" count={reviewTrace.rewriteDirectiveCount} />
              <BoolRow label="Repair attempted" value={repairTrace.repairAttempted} />
              <BoolRow label="Final validation passed" value={repairTrace.finalValidationPassed} />
            </div>
          </div>
          <p className="text-xs text-gray-600 font-mono">{trace.generatedAt}</p>
        </div>
      )}
    </div>
  )
}
