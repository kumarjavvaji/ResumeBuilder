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
  Stage4RawResumeText,
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
  saveStage4FullRefinement,
  acceptStage4FullRefinement,
  rejectStage4FullRefinement,
  saveStage4SectionRefinement,
  acceptStage4SectionRefinement,
  rejectStage4SectionRefinement,
} from '@/lib/storage/stage4-raw-resume'
import {
  buildStage4RawResumeText,
  formatExperienceBlock,
  getStage4Readiness,
  getStage4StaleReasons,
} from '@/lib/stage4/raw-resume-text'
import {
  buildResumeGenerationContract,
  validateStage4ResumeOutput,
} from '@/lib/stage4/resume-generation-contract'
import { buildResumeReadinessContract } from '@/lib/stage3/readiness-contract'
import { buildResumeStrategyBrief } from '@/lib/resume-strategy/resume-strategy-brief'
import { Spinner } from '@/components/shared/spinner'
import { inputCls, textareaCls } from '@/lib/input-cls'

const REQUIRED_LABELS: Record<string, string> = {
  summary: 'Professional Summary',
  skills: 'Skills',
  'experience-po': 'Experience: Product Owner',
  'experience-ba': 'Experience: Business Analyst',
  'experience-qa': 'Experience: QA / Quality',
}

// Keys that appear in sectionRefinements; 'education' is profile-assembled (not an ArtifactSection type)
const REFINEABLE_SECTION_KEYS = ['summary', 'skills', 'experience-po', 'experience-ba', 'experience-qa', 'education'] as const
type RefineKey = typeof REFINEABLE_SECTION_KEYS[number]

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

// ─── Helper: text for a given section key ────────────────────────────────────

function getSectionTextForKey(
  rawText: Stage4RawResumeText,
  sectionKey: RefineKey,
  artifactSections: ArtifactSection[]
): string {
  if (sectionKey === 'summary') return rawText.sections.summary
  if (sectionKey === 'skills') return rawText.sections.skills
  if (sectionKey === 'education') return rawText.sections.education
  // Experience — find blocks whose sourceArtifactSectionId matches the section of this type
  const sourceSection = artifactSections.find(s => s.type === sectionKey)
  if (!sourceSection) return ''
  const blocks = rawText.sections.experiences.filter(b => b.sourceArtifactSectionId === sourceSection.id)
  return blocks.map(formatExperienceBlock).join('\n\n')
}

// ─── Helper: resolve copy text respecting accepted refinements ─────────────────

function effectiveSectionText(
  rawText: Stage4RawResumeText,
  sectionKey: RefineKey,
  artifactSections: ArtifactSection[]
): string {
  const ref = rawText.sectionRefinements?.[sectionKey]
  if (ref?.accepted) return ref.output
  return getSectionTextForKey(rawText, sectionKey, artifactSections)
}

function effectiveFullText(rawText: Stage4RawResumeText, artifactSections: ArtifactSection[]): string {
  if (rawText.refinementAccepted && rawText.refinementOutput) return rawText.refinementOutput

  const anySectionRefined = REFINEABLE_SECTION_KEYS.some(
    k => rawText.sectionRefinements?.[k]?.accepted
  )
  if (!anySectionRefined) return rawText.sections.fullText

  // Re-assemble full text from per-section accepted refinements
  const summary = effectiveSectionText(rawText, 'summary', artifactSections)
  const skills = effectiveSectionText(rawText, 'skills', artifactSections)
  const education = effectiveSectionText(rawText, 'education', artifactSections)

  // For experience: per-type accepted refinements replace entire type; original blocks fill the rest
  const poRef = rawText.sectionRefinements?.['experience-po']
  const baRef = rawText.sectionRefinements?.['experience-ba']
  const qaRef = rawText.sectionRefinements?.['experience-qa']

  const poSection = artifactSections.find(s => s.type === 'experience-po')
  const baSection = artifactSections.find(s => s.type === 'experience-ba')
  const qaSection = artifactSections.find(s => s.type === 'experience-qa')

  const experienceChunks: string[] = []
  for (const block of rawText.sections.experiences) {
    if (poRef?.accepted && poSection && block.sourceArtifactSectionId === poSection.id) continue
    if (baRef?.accepted && baSection && block.sourceArtifactSectionId === baSection.id) continue
    if (qaRef?.accepted && qaSection && block.sourceArtifactSectionId === qaSection.id) continue
    experienceChunks.push(formatExperienceBlock(block))
  }
  if (poRef?.accepted) experienceChunks.unshift(poRef.output)
  if (baRef?.accepted) experienceChunks.push(baRef.output)
  if (qaRef?.accepted) experienceChunks.push(qaRef.output)

  const experienceText = experienceChunks.filter(Boolean).join('\n\n')

  return [
    summary ? `SUMMARY\n${summary}` : '',
    skills ? `SKILLS\n${skills}` : '',
    experienceText ? `EXPERIENCE\n${experienceText}` : '',
    education ? `EDUCATION\n${education}` : '',
  ].filter(Boolean).join('\n\n')
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [validation, setValidation] = useState<ContractValidationResult | undefined>(undefined)
  const [repairPreview, setRepairPreview] = useState<RepairPreview | undefined>(undefined)

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

  // Derived deterministically — re-computed if session or profile changes
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

  function validateStage4Text(text: string): ContractValidationResult | undefined {
    if (!contract || !profile) return undefined
    const knownTools = [...profile.skills, ...profile.skillGroups.flatMap(g => g.skills)]
    return validateStage4ResumeOutput(text, contract, {
      knownTools,
      readinessContract,
    })
  }
  const displayRaw = rawText
    ? {
        ...rawText,
        status: staleReasons.length > 0 ? ('stale' as const) : rawText.status,
        staleReasons: staleReasons.length > 0 ? staleReasons : rawText.staleReasons,
      }
    : undefined

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
      })
      const saved = await saveStage4RawResumeText(assembled)
      setRawText(saved)
      const result = validateStage4Text(assembled.sections.fullText)
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
      const currentText = effectiveFullText(targetRawText, sections)
      const currentValidation = validationOverride ?? validateStage4Text(currentText)
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

      // Auto-repair output has already passed validation, so display it immediately.
      await saveStage4FullRefinement(
        sessionId,
        `[auto-repair] ${result.repairsApplied.join('; ')}`,
        result.repairedText,
      )
      await acceptStage4FullRefinement(sessionId)
      const updated = await getStage4RawResumeText(sessionId)
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
    if (!repairPreview) return
    await saveStage4FullRefinement(
      sessionId,
      `[partial auto-repair] ${repairPreview.repairsApplied.join('; ')}`,
      repairPreview.repairedText,
    )
    await acceptStage4FullRefinement(sessionId)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
    setValidation(repairPreview.validation)
    setRepairPreview(undefined)
  }

  async function copyText(key: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1600)
  }

  // ── Refinement handlers ───────────────────────────────────────────────────

  async function runFullRefinement(instruction: string) {
    if (!refineCtx || !rawText) return null
    const text = effectiveFullText(rawText, sections)
    const res = await fetch('/api/stage4-refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'full',
        sessionId,
        fullResumeText: text,
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
      throw new Error(err.error ?? 'Full resume refinement failed.')
    }
    const result = await res.json() as { revisedText: string; changeSummary: string[]; warnings: string[] }
    await saveStage4FullRefinement(sessionId, instruction, result.revisedText)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
    return result
  }

  async function handleAcceptFullRefinement() {
    await acceptStage4FullRefinement(sessionId)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function handleRejectFullRefinement() {
    await rejectStage4FullRefinement(sessionId)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function runSectionRefinement(sectionKey: RefineKey, instruction: string) {
    if (!refineCtx || !rawText) return null
    const sectionText = getSectionTextForKey(rawText, sectionKey, sections)
    const res = await fetch('/api/stage4-refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'section',
        sessionId,
        sectionType: sectionKey === 'education' ? 'summary' : sectionKey,
        sectionText,
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
    const result = await res.json() as { revisedText: string; changeSummary: string[]; warnings: string[] }
    await saveStage4SectionRefinement(sessionId, sectionKey, instruction, result.revisedText)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
    return result
  }

  async function handleAcceptSectionRefinement(sectionKey: RefineKey) {
    await acceptStage4SectionRefinement(sessionId, sectionKey)
    const updated = await getStage4RawResumeText(sessionId)
    if (updated) setRawText(updated)
  }

  async function handleRejectSectionRefinement(sectionKey: RefineKey) {
    await rejectStage4SectionRefinement(sessionId, sectionKey)
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
          Copyable plain-text resume sections assembled from reviewed Stage 3 artifacts.
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
            {generating ? 'Generating...' : displayRaw ? 'Regenerate Raw Text' : 'Generate Raw Resume Text'}
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
          hasSemanticErrors={validation.violations.some(
            v => !v.canAutoRepair && v.severity === 'error'
          )}
        />
      )}

      {repairPreview && displayRaw && (
        <RepairPreviewPanel
          preview={repairPreview}
          copied={copiedKey === 'repair-preview'}
          onCopy={() => copyText('repair-preview', repairPreview.repairedText)}
          onAccept={acceptPartialRepair}
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
              Regenerate Raw Text
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
        <div className="space-y-6">
          {displayRaw.status === 'needs_review' && (
            <p className="text-xs text-amber-400">
              Draft preview only. Do not treat this as final or export-ready until all required Stage 3
              sections are accepted.
            </p>
          )}

          {/* ── Full resume refinement ── */}
          {canRefine && (
            <FullRefinementPanel
              rawText={displayRaw}
              onRefine={runFullRefinement}
              onAccept={handleAcceptFullRefinement}
              onReject={handleRejectFullRefinement}
              onCopy={text => copyText('full-refined', text)}
              copied={copiedKey === 'full-refined'}
            />
          )}

          {/* ── Summary ── */}
          <RefinableTextBlock
            sectionKey="summary"
            title="Summary"
            text={effectiveSectionText(displayRaw, 'summary', sections)}
            rawText={displayRaw}
            canRefine={canRefine}
            copied={copiedKey === 'summary'}
            onCopy={text => copyText('summary', text)}
            onRefine={inst => runSectionRefinement('summary', inst)}
            onAccept={() => handleAcceptSectionRefinement('summary')}
            onReject={() => handleRejectSectionRefinement('summary')}
          />

          {/* ── Skills ── */}
          <RefinableTextBlock
            sectionKey="skills"
            title="Skills"
            text={effectiveSectionText(displayRaw, 'skills', sections)}
            rawText={displayRaw}
            canRefine={canRefine}
            copied={copiedKey === 'skills'}
            onCopy={text => copyText('skills', text)}
            onRefine={inst => runSectionRefinement('skills', inst)}
            onAccept={() => handleAcceptSectionRefinement('skills')}
            onReject={() => handleRejectSectionRefinement('skills')}
          />

          {/* ── Experience (grouped by section type) ── */}
          <ExperienceSections
            rawText={displayRaw}
            artifactSections={sections}
            canRefine={canRefine}
            copiedKey={copiedKey}
            onCopy={copyText}
            onRefine={(key, inst) => runSectionRefinement(key as RefineKey, inst)}
            onAccept={key => handleAcceptSectionRefinement(key as RefineKey)}
            onReject={key => handleRejectSectionRefinement(key as RefineKey)}
          />

          {/* ── Education ── */}
          <RefinableTextBlock
            sectionKey="education"
            title="Education & Certifications"
            text={effectiveSectionText(displayRaw, 'education', sections)}
            rawText={displayRaw}
            canRefine={canRefine}
            copied={copiedKey === 'education'}
            onCopy={text => copyText('education', text)}
            onRefine={inst => runSectionRefinement('education', inst)}
            onAccept={() => handleAcceptSectionRefinement('education')}
            onReject={() => handleRejectSectionRefinement('education')}
          />

          {/* ── Full text copy ── */}
          <TextBlock
            title="Full Resume Text"
            text={effectiveFullText(displayRaw, sections)}
            copied={copiedKey === 'full'}
            onCopy={() => copyText('full', effectiveFullText(displayRaw, sections))}
          />
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

// ─── Experience sections (grouped by type) ────────────────────────────────────

function ExperienceSections({
  rawText,
  artifactSections,
  canRefine,
  copiedKey,
  onCopy,
  onRefine,
  onAccept,
  onReject,
}: {
  rawText: Stage4RawResumeText
  artifactSections: ArtifactSection[]
  canRefine: boolean
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
  onRefine: (key: string, instruction: string) => Promise<unknown>
  onAccept: (key: string) => void
  onReject: (key: string) => void
}) {
  const experienceSectionTypes = ['experience-po', 'experience-ba', 'experience-qa'] as const
  const EXPERIENCE_LABELS: Record<string, string> = {
    'experience-po': 'Product Owner Experience',
    'experience-ba': 'Business Analyst Experience',
    'experience-qa': 'QA / Quality Experience',
  }

  const sections: Array<{ key: string; label: string; text: string }> = []

  // Preferred order: first by presence of an accepted refinement, then by original block order
  for (const sectionType of experienceSectionTypes) {
    const srcSection = artifactSections.find(s => s.type === sectionType)
    const ref = rawText.sectionRefinements?.[sectionType]
    const hasBlocks = srcSection
      ? rawText.sections.experiences.some(b => b.sourceArtifactSectionId === srcSection.id)
      : false

    if (!hasBlocks && !ref) continue

    const text = ref?.accepted && ref.output
      ? ref.output
      : srcSection
        ? rawText.sections.experiences
            .filter(b => b.sourceArtifactSectionId === srcSection.id)
            .map(formatExperienceBlock)
            .join('\n\n')
        : ''

    if (!text) continue
    sections.push({ key: sectionType, label: EXPERIENCE_LABELS[sectionType], text })
  }

  if (sections.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Experience</h2>
        <button
          onClick={() => onCopy('experience-all', sections.map(s => s.text).join('\n\n'))}
          className="text-xs px-3 py-1.5 border border-gray-700 text-gray-300 rounded hover:border-gray-500 disabled:opacity-40"
        >
          {copiedKey === 'experience-all' ? 'Copied' : 'Copy All Experience'}
        </button>
      </div>
      {sections.map(({ key, label, text }) => (
        <RefinableTextBlock
          key={key}
          sectionKey={key as RefineKey}
          title={label}
          text={text}
          rawText={rawText}
          canRefine={canRefine}
          copied={copiedKey === key}
          onCopy={t => onCopy(key, t)}
          onRefine={inst => onRefine(key, inst)}
          onAccept={() => onAccept(key)}
          onReject={() => onReject(key)}
        />
      ))}
    </div>
  )
}

// ─── Full resume refinement panel ────────────────────────────────────────────

function FullRefinementPanel({
  rawText,
  onRefine,
  onAccept,
  onReject,
  onCopy,
  copied,
}: {
  rawText: Stage4RawResumeText
  onRefine: (instruction: string) => Promise<{ revisedText: string; changeSummary: string[]; warnings: string[] } | null>
  onAccept: () => void
  onReject: () => void
  onCopy: (text: string) => void
  copied: boolean
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState(rawText.refinementInstruction ?? '')
  const [refining, setRefining] = useState(false)
  const [localError, setLocalError] = useState('')

  const pending = rawText.refinementOutput && !rawText.refinementAccepted
  const accepted = rawText.refinementAccepted && rawText.refinementOutput

  async function submit() {
    if (!instruction.trim()) return
    setRefining(true)
    setLocalError('')
    try {
      await onRefine(instruction.trim())
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Refinement failed.')
    } finally {
      setRefining(false)
    }
  }

  return (
    <div className="border border-gray-600 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/60 hover:bg-gray-800/90 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">Refine Full Resume</span>
          {accepted && (
            <span className="text-xs px-2 py-0.5 bg-green-900/60 text-green-300 rounded border border-green-800/50">
              Accepted
            </span>
          )}
          {pending && !accepted && (
            <span className="text-xs px-2 py-0.5 bg-amber-900/60 text-amber-300 rounded border border-amber-800/50">
              Pending review
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs ml-3">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 py-4 space-y-4 bg-gray-900/40">
          <p className="text-xs text-gray-400">
            Applies a single instruction to the entire assembled resume. Accepted output replaces
            the full-text copy. Stage 3 artifact sections are not modified.
          </p>

          {accepted && rawText.refinementOutput && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-green-300 font-medium">Accepted refinement output</p>
                <button
                  onClick={() => onCopy(rawText.refinementOutput!)}
                  className="text-xs px-3 py-1.5 border border-gray-600 text-gray-300 rounded hover:border-gray-400"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs font-mono text-gray-200 bg-gray-950/40 rounded p-3 max-h-64 overflow-y-auto">
                {rawText.refinementOutput}
              </pre>
              <button
                onClick={() => { onReject(); setInstruction('') }}
                className="text-xs text-gray-400 underline hover:text-gray-200"
              >
                Clear and start over
              </button>
            </div>
          )}

          {!accepted && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Refinement instruction
                </label>
                <textarea
                  className={`${textareaCls} h-20 text-xs`}
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  placeholder={'e.g. "Tighten to two pages" or "Make this more tactical and less senior" or "Remove Azure DevOps and emphasize Jira"'}
                  disabled={refining}
                />
              </div>

              {pending && rawText.refinementOutput && (
                <div className="space-y-3">
                  <p className="text-xs text-amber-300 font-medium">Pending refinement output — review before accepting</p>
                  <pre className="whitespace-pre-wrap text-xs font-mono text-gray-200 bg-gray-950/40 rounded p-3 max-h-72 overflow-y-auto border border-amber-800/30">
                    {rawText.refinementOutput}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      onClick={onAccept}
                      className="px-3 py-1.5 bg-green-800 text-green-100 rounded text-xs font-medium hover:bg-green-700"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => { onReject(); setInstruction('') }}
                      className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded text-xs hover:border-gray-400"
                    >
                      Reject
                    </button>
                    <button
                      onClick={submit}
                      disabled={!instruction.trim() || refining}
                      className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded text-xs hover:border-gray-400 disabled:opacity-50"
                    >
                      {refining ? <span className="flex items-center gap-1"><Spinner className="text-gray-300" /> Refining…</span> : 'Refine Again'}
                    </button>
                  </div>
                </div>
              )}

              {!pending && (
                <button
                  onClick={submit}
                  disabled={!instruction.trim() || refining}
                  className="px-4 py-2 bg-gray-700 text-white rounded text-sm font-medium hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
                >
                  {refining && <Spinner className="text-white" />}
                  {refining ? 'Refining…' : 'Refine Full Resume'}
                </button>
              )}

              {localError && (
                <p className="text-xs text-red-400">{localError}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Refinable text block ─────────────────────────────────────────────────────

function RefinableTextBlock({
  sectionKey,
  title,
  text,
  rawText,
  canRefine,
  copied,
  onCopy,
  onRefine,
  onAccept,
  onReject,
}: {
  sectionKey: RefineKey
  title: string
  text: string
  rawText: Stage4RawResumeText
  canRefine: boolean
  copied: boolean
  onCopy: (text: string) => void
  onRefine: (instruction: string) => Promise<unknown>
  onAccept: () => void
  onReject: () => void
}) {
  const ref = rawText.sectionRefinements?.[sectionKey]
  const hasPending = !!ref && !ref.accepted
  const hasAccepted = !!ref?.accepted

  return (
    <section className="border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/60">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-white">{title}</h2>
          {hasAccepted && (
            <span className="text-xs px-2 py-0.5 bg-green-900/60 text-green-300 rounded border border-green-800/50">
              Refined
            </span>
          )}
          {hasPending && (
            <span className="text-xs px-2 py-0.5 bg-amber-900/60 text-amber-300 rounded border border-amber-800/50">
              Pending
            </span>
          )}
        </div>
        <button
          onClick={() => onCopy(text)}
          disabled={!text.trim()}
          className="text-xs px-3 py-1.5 border border-gray-600 text-gray-300 rounded hover:border-gray-400 hover:text-white disabled:opacity-40"
        >
          {copied ? 'Copied' : 'Copy Section'}
        </button>
      </div>
      <pre className="min-h-16 whitespace-pre-wrap text-left font-mono text-sm leading-relaxed text-gray-200 bg-gray-950/40 px-4 py-3">
        {text || 'No accepted text available for this block.'}
      </pre>

      {canRefine && (
        <SectionRefinementPanel
          sectionKey={sectionKey}
          refinement={ref}
          onRefine={onRefine}
          onAccept={onAccept}
          onReject={onReject}
        />
      )}
    </section>
  )
}

// ─── Section refinement panel ─────────────────────────────────────────────────

function SectionRefinementPanel({
  sectionKey,
  refinement,
  onRefine,
  onAccept,
  onReject,
}: {
  sectionKey: RefineKey
  refinement: import('@/contracts').Stage4SectionRefinement | undefined
  onRefine: (instruction: string) => Promise<unknown>
  onAccept: () => void
  onReject: () => void
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState(refinement?.instruction ?? '')
  const [refining, setRefining] = useState(false)
  const [localError, setLocalError] = useState('')

  const hasPending = !!refinement && !refinement.accepted

  async function submit() {
    if (!instruction.trim()) return
    setRefining(true)
    setLocalError('')
    try {
      await onRefine(instruction.trim())
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Section refinement failed.')
    } finally {
      setRefining(false)
    }
  }

  if (!open) {
    return (
      <div className="border-t border-gray-700/50 px-4 py-2">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-gray-400 hover:text-gray-200 underline"
        >
          {refinement?.accepted ? 'Revise again' : 'Request Changes'}
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-gray-700/50 px-4 py-3 bg-gray-900/30 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">Refine section</span>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-300">
          ✕
        </button>
      </div>

      {hasPending && refinement && (
        <div className="space-y-2">
          <p className="text-xs text-amber-300 font-medium">Pending output — review before accepting</p>
          <pre className="whitespace-pre-wrap text-xs font-mono text-gray-200 bg-gray-950/40 rounded p-3 max-h-48 overflow-y-auto border border-amber-800/30">
            {refinement.output}
          </pre>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={onAccept}
              className="px-3 py-1.5 bg-green-800 text-green-100 rounded text-xs font-medium hover:bg-green-700"
            >
              Accept
            </button>
            <button
              onClick={() => { onReject(); setInstruction('') }}
              className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded text-xs hover:border-gray-400"
            >
              Reject
            </button>
            <button
              onClick={submit}
              disabled={!instruction.trim() || refining}
              className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded text-xs hover:border-gray-400 disabled:opacity-50"
            >
              {refining ? <span className="flex items-center gap-1"><Spinner className="text-gray-300" />Refining…</span> : 'Refine Again'}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Instruction</label>
        <textarea
          className={`${textareaCls} h-16 text-xs`}
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder={SECTION_PLACEHOLDERS[sectionKey] ?? 'Describe the change you want…'}
          disabled={refining}
        />
      </div>

      {!hasPending && (
        <button
          onClick={submit}
          disabled={!instruction.trim() || refining}
          className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs font-medium hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
        >
          {refining && <Spinner className="text-white" />}
          {refining ? 'Refining…' : 'Refine Section'}
        </button>
      )}

      {localError && <p className="text-xs text-red-400">{localError}</p>}
    </div>
  )
}

const SECTION_PLACEHOLDERS: Partial<Record<RefineKey, string>> = {
  summary: 'e.g. "Lead with fintech experience" or "Tighten to 3 sentences"',
  skills: 'e.g. "Remove Azure DevOps and emphasize Jira" or "Add SpecFlow under Testing"',
  'experience-po': 'e.g. "Reduce by 2 lines" or "Emphasize backlog ownership over delivery metrics"',
  'experience-ba': 'e.g. "Lead with gap analysis work" or "Tighten to 4 bullets"',
  'experience-qa': 'e.g. "Emphasize automation over manual testing" or "Add SpecFlow if evidenced"',
  education: 'e.g. "Add CSPO year if from bridge answers" or "Separate certifications from degrees"',
}

function RepairPreviewPanel({
  preview,
  copied,
  onCopy,
  onAccept,
}: {
  preview: RepairPreview
  copied: boolean
  onCopy: () => void
  onAccept: () => void
}) {
  return (
    <div className="border border-amber-800/60 rounded-lg bg-amber-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-300">Partial Auto-Repair Preview</p>
          <p className="text-xs text-amber-100/75 mt-1">
            {preview.changed
              ? 'Auto-repair changed the output, but validation still has remaining violations.'
              : 'Auto-repair could not change the output because remaining violations require validator or source-data changes.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCopy}
            className="text-xs px-3 py-1.5 border border-amber-700 text-amber-100 rounded hover:bg-amber-900/40"
          >
            {copied ? 'Copied' : 'Copy Preview'}
          </button>
          {preview.changed && (
            <button
              onClick={onAccept}
              className="text-xs px-3 py-1.5 bg-amber-700 text-amber-50 rounded hover:bg-amber-600"
            >
              Accept Partial Repair
            </button>
          )}
        </div>
      </div>

      {preview.repairsApplied.length > 0 && (
        <div>
          <p className="text-xs font-medium text-amber-200 mb-1">Repair activity</p>
          <ul className="space-y-1 text-xs text-amber-100/80">
            {preview.repairsApplied.map((repair, i) => <li key={i}>{repair}</li>)}
          </ul>
        </div>
      )}

      {preview.unfixedViolations.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-300 mb-1">Remaining violations</p>
          <ul className="space-y-1 text-xs text-red-200/90">
            {preview.unfixedViolations.map((violation, i) => <li key={i}>{violation}</li>)}
          </ul>
        </div>
      )}

      {preview.changed && (
        <pre className="whitespace-pre-wrap text-xs font-mono text-gray-200 bg-gray-950/40 rounded p-3 max-h-72 overflow-y-auto border border-amber-800/30">
          {preview.repairedText}
        </pre>
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
        {(hasSemanticErrors || errors.some(v => !v.canAutoRepair)) && (
          <button
            onClick={onRepair}
            disabled={repairing}
            className="text-xs px-3 py-1.5 bg-amber-700 text-amber-100 rounded hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5"
          >
            {repairing && <Spinner className="text-amber-200" />}
            {repairing ? 'Repairing…' : 'Run Auto-Repair'}
          </button>
        )}
        {!hasSemanticErrors && errors.every(v => v.canAutoRepair) && errors.length > 0 && (
          <button
            onClick={onRepair}
            disabled={repairing}
            className="text-xs px-3 py-1.5 bg-green-800 text-green-100 rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {repairing && <Spinner className="text-green-200" />}
            {repairing ? 'Repairing…' : 'Fix Automatically'}
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <div className="space-y-1.5">
          {errors.map((v, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 shrink-0 text-xs ${v.canAutoRepair ? 'text-amber-400' : 'text-red-400'}`}>
                {v.canAutoRepair ? '⚙' : '✗'}
              </span>
              <div>
                <span className="text-red-300 font-medium">[{v.rule}]</span>
                {' '}
                <span className="text-gray-400">{v.section}:</span>
                {' '}
                <span className="text-gray-300">{v.detail}</span>
                {v.canAutoRepair && (
                  <span className="ml-1 text-amber-500 italic">(auto-repairable)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-700/50 pt-2">
          <p className="text-xs text-gray-500 font-medium">Warnings (advisory)</p>
          {warnings.map((v, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0 text-yellow-500">⚠</span>
              <div>
                <span className="text-yellow-400 font-medium">[{v.rule}]</span>
                {' '}
                <span className="text-gray-400">{v.section}:</span>
                {' '}
                <span className="text-gray-400">{v.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Plain text block (no refinement) ────────────────────────────────────────

function TextBlock({
  title,
  text,
  copied,
  onCopy,
}: {
  title: string
  text: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <section className="border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/60">
        <h2 className="text-sm font-medium text-white">{title}</h2>
        <button
          onClick={onCopy}
          disabled={!text.trim()}
          className="text-xs px-3 py-1.5 border border-gray-600 text-gray-300 rounded hover:border-gray-400 hover:text-white disabled:opacity-40"
        >
          {copied ? 'Copied' : 'Copy Section'}
        </button>
      </div>
      <pre className="min-h-20 whitespace-pre-wrap text-left font-mono text-sm leading-relaxed text-gray-200 bg-gray-950/40 px-4 py-3">
        {text || 'No accepted text available for this block.'}
      </pre>
    </section>
  )
}

