'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getUserProfile } from '@/lib/storage/user-profile'
import { saveSession } from '@/lib/storage/sessions'
import { nanoid } from '@/lib/storage/nanoid'
import { getActiveSnapshot } from '@/lib/profile/profileSnapshotStore'
import { buildEvidenceIndex } from '@/lib/profile/profileProjectionService'
import {
  createStage1Job,
  getStage1Job,
  updateStage1JobPass,
  setStage1JobComplete,
  setStage1JobFailed,
  getActiveJobId,
  setActiveJobId,
} from '@/lib/storage/stage1-jobs'
import type {
  TargetIntake,
  Stage1Status,
  JDSourceType,
  UserProfile,
  ProfileEvidenceIndexItem,
  RawJD,
  JDRequirementMap,
  DomainIQImport,
  FitAnalysis,
  Stage1StepId,
  Stage1StepStatus,
  Stage1ProgressStep,
  Stage1Job,
  Stage1PassKey,
  CandidateProfileMap,
  ValidatedProfileClaims,
  JDRequirementMapExtended,
  MatchMatrix,
  GapFitAnalysis,
  Stage2QuestionCandidate,
} from '@/contracts'
import { deriveStageStatuses, canCompleteStage1 } from '@/contracts'
import type { Stage1PipelineResult } from '@/lib/llm/stage1/pipeline'
import { Spinner } from '@/components/shared/spinner'
import { inputCls, textareaCls } from '@/lib/input-cls'
import { JDRequirementMapView } from './jd-requirement-map-view'
import { findFindingByTopic, TraceChip, TraceableBullet, computeUnmatchedFindings, UnmatchedFindingsDebug } from './stage1-findings-view'

// ─── Stage1Status derivation ──────────────────────────────────────────────────

function deriveStage1Status(opts: {
  jdText: string
  jdFetchFailed: boolean
  analyzed: boolean
}): Stage1Status {
  if (opts.analyzed) return 'analyzed_needs_review'
  if (opts.jdText.trim() && opts.jdFetchFailed) return 'jd_needs_paste'
  if (opts.jdText.trim()) return 'ready_to_analyze'
  if (opts.jdFetchFailed) return 'jd_fetch_failed'
  return 'draft'
}

// ─── Collapse primitive ───────────────────────────────────────────────────────

function Collapse({
  label,
  hint,
  open,
  onToggle,
  children,
}: {
  label: string
  hint?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start justify-between px-4 py-3 text-left bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-800">{label}</span>
          {hint && !open && (
            <span className="block text-xs text-gray-400 mt-0.5">{hint}</span>
          )}
        </span>
        <span className="text-gray-400 text-xs ml-3 mt-0.5 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 py-4 space-y-4">{children}</div>}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">
        {n}
      </span>
      <span className="text-sm font-semibold text-gray-800">{text}</span>
    </div>
  )
}

// ─── Step 1: Resume / Profile ─────────────────────────────────────────────────

function ProfileSection({ profile }: { profile: UserProfile | null | undefined }) {
  return (
    <div>
      <SectionLabel n="1" text="Candidate Profile" />
      {profile === undefined ? (
        <p className="text-xs text-gray-400">Loading profile...</p>
      ) : profile === null ? (
        <div className="border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-800">
            No saved profile found. Go to{' '}
            <a href="/profile" className="underline hover:text-amber-900">/profile</a>{' '}
            and complete it before starting a session.
          </p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
          <p className="text-sm text-gray-700">
            Your saved profile will be used as candidate context for this session.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {profile.fullName} · {profile.workHistory.length} role{profile.workHistory.length === 1 ? '' : 's'} · {profile.skills.length} skill{profile.skills.length === 1 ? '' : 's'}
          </p>
          <a
            href="/profile"
            className="inline-block mt-2 text-xs font-medium text-gray-900 underline underline-offset-2 hover:text-gray-600"
          >
            Review or edit profile →
          </a>
        </div>
      )}
    </div>
  )
}

// ─── Step 2: Job Description ──────────────────────────────────────────────────

type JDMode = 'link' | 'paste' | 'fields' | null

interface JDSectionProps {
  mode: JDMode
  onMode: (m: JDMode) => void
  roleTitle: string
  setRoleTitle: (v: string) => void
  company: string
  setCompany: (v: string) => void
  jdText: string
  setJDText: (v: string) => void
  jdLink: string
  setJDLink: (v: string) => void
  /** Called when a URL was fetched and content validated as a real JD. */
  onFetchSuccess: (sourceType: JDSourceType) => void
  /** Called when a URL fetch returned invalid content (login wall, nav dump, etc.). */
  onFetchFailed: (message: string) => void
}

/** Assembles per-field form inputs into a plain-text JD string. */
function assembleJDText(
  roleTitle: string,
  company: string,
  responsibilities: string,
  required: string,
  niceToHave: string
): string {
  const parts: string[] = []
  if (roleTitle) parts.push(`Role: ${roleTitle}`)
  if (company) parts.push(`Company: ${company}`)
  if (responsibilities.trim()) parts.push(`\nResponsibilities:\n${responsibilities.trim()}`)
  if (required.trim()) parts.push(`\nRequired:\n${required.trim()}`)
  if (niceToHave.trim()) parts.push(`\nNice to Have:\n${niceToHave.trim()}`)
  return parts.join('\n')
}

function JDSection({
  mode, onMode,
  roleTitle, setRoleTitle,
  company, setCompany,
  jdText, setJDText,
  jdLink, setJDLink,
  onFetchSuccess,
  onFetchFailed,
}: JDSectionProps) {
  const [fetching, setFetching] = useState(false)
  const [fetchPreview, setFetchPreview] = useState('')

  // Fields mode local state — derives jdText on change
  const [responsibilities, setResponsibilities] = useState('')
  const [requiredSkills, setRequiredSkills] = useState('')
  const [niceToHave, setNiceToHave] = useState('')

  function updateFields(resp: string, req: string, nth: string) {
    setJDText(assembleJDText(roleTitle, company, resp, req, nth))
  }

  async function handleFetchLink() {
    if (!jdLink.trim()) return
    setFetching(true)
    setFetchPreview('')
    try {
      const res = await fetch('/api/fetch-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: jdLink.trim(), roleTitle, company }),
      })
      const data = await res.json()

      if (!res.ok) {
        // Hard server error (400, 500) — shouldn't happen in normal flow
        onFetchFailed(data.error ?? 'Fetch failed. Paste the JD text directly.')
        return
      }

      if (!data.valid) {
        // Content was fetched but failed validation (login wall, nav dump, etc.)
        onFetchFailed(data.message ?? 'The job page could not be fetched. Paste the full job description to continue.')
        return
      }

      setJDText(data.text)
      setFetchPreview(data.text)
      onFetchSuccess('fetched_jd')
    } catch {
      onFetchFailed('Network error. Check your connection or paste the JD text directly.')
    } finally {
      setFetching(false)
    }
  }

  return (
    <div>
      <SectionLabel n="2" text="Job Description" />
      <div className="space-y-2">
        {/* ── Link ── */}
        <Collapse
          label="Paste a link"
          hint="Fetch job text directly from a posting URL"
          open={mode === 'link'}
          onToggle={() => onMode(mode === 'link' ? null : 'link')}
        >
          <p className="text-xs text-gray-500">
            Paste the job posting URL. Text is fetched server-side and pre-filled below.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Role Title</label>
              <input
                className={inputCls}
                value={roleTitle}
                onChange={e => setRoleTitle(e.target.value)}
                placeholder="e.g. Senior Product Owner"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Company</label>
              <input
                className={inputCls}
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="e.g. Acme Corp"
              />
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1">Job Posting URL</label>
              <input
                className={inputCls}
                type="url"
                value={jdLink}
                onChange={e => setJDLink(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFetchLink() }}
                placeholder="https://..."
              />
            </div>
            <button
              type="button"
              onClick={handleFetchLink}
              disabled={fetching || !jdLink.trim()}
              className="px-3 py-2 bg-gray-900 text-white rounded text-xs font-medium hover:bg-gray-700 disabled:opacity-40 flex items-center gap-1.5 shrink-0"
            >
              {fetching && <Spinner className="text-white h-3 w-3" />}
              {fetching ? 'Fetching…' : 'Fetch JD'}
            </button>
          </div>
          {fetchPreview && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">Fetched text — review and edit</label>
                <button
                  type="button"
                  onClick={() => { setFetchPreview(''); setJDText('') }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              </div>
              <textarea
                className={`${textareaCls} h-48 font-mono text-xs`}
                value={jdText}
                onChange={e => { setJDText(e.target.value); setFetchPreview(e.target.value) }}
              />
            </div>
          )}
        </Collapse>

        {/* ── Paste ── */}
        <Collapse
          label="Paste full JD text"
          hint="Copy and paste the complete job posting — most reliable"
          open={mode === 'paste'}
          onToggle={() => onMode(mode === 'paste' ? null : 'paste')}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Role Title</label>
              <input
                className={inputCls}
                value={roleTitle}
                onChange={e => setRoleTitle(e.target.value)}
                placeholder="e.g. Senior Product Owner"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Company</label>
              <input
                className={inputCls}
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="e.g. Acme Corp"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Job Description</label>
            <p className="text-xs text-gray-400 mb-1">
              Paste the full JD. Required vs nice-to-have is separated automatically.
            </p>
            <textarea
              className={`${textareaCls} h-48 font-mono text-xs`}
              value={jdText}
              onChange={e => setJDText(e.target.value)}
              placeholder="Paste full job description here..."
            />
          </div>
        </Collapse>

        {/* ── Fields ── */}
        <Collapse
          label="Fill each field"
          hint="Enter responsibilities and requirements individually"
          open={mode === 'fields'}
          onToggle={() => onMode(mode === 'fields' ? null : 'fields')}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Role Title</label>
              <input
                className={inputCls}
                value={roleTitle}
                onChange={e => { setRoleTitle(e.target.value); updateFields(responsibilities, requiredSkills, niceToHave) }}
                placeholder="e.g. Senior Product Owner"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Company</label>
              <input
                className={inputCls}
                value={company}
                onChange={e => { setCompany(e.target.value); updateFields(responsibilities, requiredSkills, niceToHave) }}
                placeholder="e.g. Acme Corp"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Responsibilities <span className="text-gray-400 font-normal">(one per line)</span>
            </label>
            <textarea
              className={`${textareaCls} h-24 text-xs`}
              value={responsibilities}
              onChange={e => { setResponsibilities(e.target.value); updateFields(e.target.value, requiredSkills, niceToHave) }}
              placeholder={'Manage product backlog\nCoordinate with engineering\nDrive sprint planning'}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Required Skills <span className="text-gray-400 font-normal">(one per line)</span>
            </label>
            <textarea
              className={`${textareaCls} h-20 text-xs`}
              value={requiredSkills}
              onChange={e => { setRequiredSkills(e.target.value); updateFields(responsibilities, e.target.value, niceToHave) }}
              placeholder={'5+ years in product ownership\nExperience with Agile/Scrum'}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Nice to Have <span className="text-gray-400 font-normal">(one per line)</span>
            </label>
            <textarea
              className={`${textareaCls} h-16 text-xs`}
              value={niceToHave}
              onChange={e => { setNiceToHave(e.target.value); updateFields(responsibilities, requiredSkills, e.target.value) }}
              placeholder={'SQL experience\nSaaS background'}
            />
          </div>
          {jdText && (
            <details className="mt-1">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                Preview assembled JD text
              </summary>
              <pre className="mt-2 text-xs text-gray-500 bg-gray-50 p-3 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                {jdText}
              </pre>
            </details>
          )}
        </Collapse>

      </div>
    </div>
  )
}

// ─── DomainIQ / company research section ─────────────────────────────────────

type DomainIQMode = 'json' | 'text' | null

/** Tries to parse text as DomainIQImport JSON. Returns null if invalid shape. */
function tryParseDomainIQJson(raw: string): {
  companyProfile: string
  industrySignals: string[]
  techStack: string[]
  cultureSignals: string[]
} | null {
  try {
    const parsed = JSON.parse(raw.trim())
    // Legacy flat format
    if (typeof parsed.companyProfile === 'string' && Array.isArray(parsed.industrySignals)) {
      return {
        companyProfile: parsed.companyProfile ?? '',
        industrySignals: parsed.industrySignals ?? [],
        techStack: parsed.techStack ?? [],
        cultureSignals: parsed.cultureSignals ?? [],
      }
    }
    // New diq_stage3_resume_builder_basis format
    const exp = parsed.export
    if (exp?.exportKind === 'diq_stage3_resume_builder_basis') {
      return {
        companyProfile: exp.domainBasis?.thesis ?? '',
        industrySignals: exp.domainBasis?.keyThemes ?? [],
        techStack: [],
        cultureSignals: exp.resumePositioningBasis?.businessConcepts ?? [],
      }
    }
  } catch {}
  return null
}

interface QuickStartDiagnostic {
  mode: 'llm' | 'llm_normalized' | 'retry' | 'retry_normalized' | 'deterministic_fallback'
  providerConfigured: boolean
  apiRouteReached: boolean
  modelCallAttempted: boolean
  modelCallSucceeded: boolean
  parseSucceeded: boolean
  validationSucceeded: boolean
  normalizationAttempted?: boolean
  normalizationSucceeded?: boolean
  retryAttempted: boolean
  retrySucceeded: boolean
  fallbackReason: string
  validationErrors?: string[]
  normalizedWarnings?: string[]
  rejectedAttemptNumber?: number
  rejectedOutputPreview?: string
  rejectedBasisPreview?: string
  normalizedOutputPreview?: string
  displayedJsonSource?: QuickDisplayedSource
  providerErrorName?: string
  providerErrorMessage?: string
}

type QuickDisplayedSource = 'llm' | 'llm_normalized' | 'retry' | 'retry_normalized' | 'deterministic_fallback'

function formatQuickStartFallbackReason(diagnostic: QuickStartDiagnostic | undefined): string {
  if (!diagnostic) return 'deterministic fallback used; no diagnostic returned.'
  if (diagnostic.fallbackReason === 'provider_not_configured') return 'provider is not configured.'
  if (diagnostic.fallbackReason === 'provider_error') return diagnostic.providerErrorMessage || 'provider call failed.'
  if (diagnostic.fallbackReason === 'parse_failed') return 'model response could not be parsed.'
  if (diagnostic.fallbackReason === 'validation_failed') return diagnostic.validationErrors?.[0] || 'model response failed validation.'
  return diagnostic.fallbackReason || 'deterministic fallback used.'
}

function formatQuickDisplayedSource(source: QuickDisplayedSource): string {
  if (source === 'deterministic_fallback') return 'deterministic fallback'
  if (source === 'llm_normalized') return 'LLM synthesis, normalized'
  if (source === 'retry') return 'LLM synthesis after retry'
  if (source === 'retry_normalized') return 'Retry synthesis, normalized'
  return 'LLM synthesis'
}

function DomainIQSection({
  value,
  onChange,
  company,
  roleTitle,
  jdText,
}: {
  value: string
  onChange: (v: string) => void
  company: string
  roleTitle: string
  jdText: string
}) {
  const [mode, setMode] = useState<DomainIQMode>(null)
  const [jsonError, setJsonError] = useState('')
  const [quickIndustry, setQuickIndustry] = useState('')
  const [quickNotes, setQuickNotes] = useState('')
  const [quickGenerating, setQuickGenerating] = useState(false)
  const [quickStatus, setQuickStatus] = useState('')
  const [quickDiagnostic, setQuickDiagnostic] = useState<QuickStartDiagnostic | null>(null)
  const [quickDisplayedSource, setQuickDisplayedSource] = useState<QuickDisplayedSource | null>(null)

  // Auto-detect JSON when user pastes into JSON mode
  function handleJsonChange(raw: string) {
    setJsonError('')
    setQuickDisplayedSource(null)
    onChange(raw)
    if (raw.trim()) {
      const parsed = tryParseDomainIQJson(raw)
      if (!parsed && raw.trim().startsWith('{')) {
        setJsonError('Not a valid DomainIQ JSON export. Check the format or use raw text instead.')
      }
    }
  }

  const parsedPreview = mode === 'json' && value.trim() ? tryParseDomainIQJson(value) : null

  async function handleGenerateQuickStart() {
    setJsonError('')
    setQuickStatus('Generating JD + inferred problem-space synthesis...')
    setQuickDiagnostic(null)
    setQuickDisplayedSource(null)
    setQuickGenerating(true)
    try {
      const res = await fetch('/api/company-industry-basis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetCompany: company,
          targetRoleTitle: roleTitle,
          jobDescription: jdText,
          industry: quickIndustry,
          userNotes: quickNotes,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Company / industry basis generation failed.')
      }
      const result = await res.json() as {
        domainIQJson: string
        mode: 'llm' | 'llm_normalized' | 'retry' | 'retry_normalized' | 'fallback' | 'mock'
        diagnostic?: QuickStartDiagnostic
      }
      onChange(result.domainIQJson)
      setMode('json')
      setQuickDiagnostic(result.diagnostic ?? null)
      const displayedSource = result.diagnostic?.displayedJsonSource
        ?? (result.mode === 'fallback' ? 'deterministic_fallback' : result.mode === 'mock' ? 'llm' : result.mode)
      setQuickDisplayedSource(displayedSource)
      setQuickStatus(
        result.mode === 'fallback'
          ? `LLM synthesis fell back: ${formatQuickStartFallbackReason(result.diagnostic)}`
          : result.diagnostic?.mode === 'retry' || result.diagnostic?.mode === 'retry_normalized'
            ? 'Basis generated from LLM synthesis after retry. Review/edit before analysis.'
            : result.diagnostic?.mode === 'llm_normalized'
              ? 'Basis generated from LLM synthesis and normalized for DomainIQ. Review/edit before analysis.'
          : 'Basis generated from JD + inferred problem-space synthesis. Review/edit before analysis.',
      )
    } catch (err) {
      setQuickStatus(err instanceof Error ? err.message : 'Company / industry basis generation failed.')
    } finally {
      setQuickGenerating(false)
    }
  }

  return (
    <div>
      <SectionLabel n="3" text="Company Research" />
      <p className="text-xs text-gray-400 mb-3">
        Optional. Augments the JD with company context, tech stack, and culture signals.
      </p>
      <div className="space-y-2">
        <div className="border border-blue-100 bg-blue-50/70 rounded-lg p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-blue-950">Quick Start: Company / Industry Basis</h3>
            <p className="text-xs text-blue-800/80 mt-1">
              Generate a JD + inferred problem-space synthesis from the company, role, JD, and optional domain notes.
              This creates structured DomainIQ-compatible JSON; it does not draft resume text.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-blue-950 mb-1">Industry / domain (optional)</label>
              <input
                className={inputCls}
                value={quickIndustry}
                onChange={e => setQuickIndustry(e.target.value)}
                placeholder="e.g. logistics, fintech, SaaS operations"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-blue-950 mb-1">User notes (optional)</label>
              <input
                className={inputCls}
                value={quickNotes}
                onChange={e => setQuickNotes(e.target.value)}
                placeholder="Known workflows, users, risks, or priorities"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateQuickStart}
              disabled={quickGenerating || !company.trim() || !roleTitle.trim() || !jdText.trim()}
              className="px-3 py-1.5 bg-blue-700 text-white rounded text-xs font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {quickGenerating ? 'Generating...' : 'Generate Quick Company Basis'}
            </button>
            {quickStatus && (
              <span className="text-xs text-blue-800">
                {quickStatus}
              </span>
            )}
            {quickDiagnostic && (
              <div className="w-full rounded border border-blue-200 bg-white/70 px-3 py-2 text-[11px] text-blue-950">
                <div className="font-medium">Quick Start diagnostic</div>
                {quickDiagnostic.mode === 'deterministic_fallback' && quickDiagnostic.fallbackReason === 'validation_failed' && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900">
                    LLM synthesis failed validation; deterministic fallback inserted.
                  </div>
                )}
                <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  <span>mode: {quickDiagnostic.mode}</span>
                  <span>providerConfigured: {String(quickDiagnostic.providerConfigured)}</span>
                  <span>apiRouteReached: {String(quickDiagnostic.apiRouteReached)}</span>
                  <span>modelCallAttempted: {String(quickDiagnostic.modelCallAttempted)}</span>
                  <span>modelCallSucceeded: {String(quickDiagnostic.modelCallSucceeded)}</span>
                  <span>parseSucceeded: {String(quickDiagnostic.parseSucceeded)}</span>
                  <span>validationSucceeded: {String(quickDiagnostic.validationSucceeded)}</span>
                  <span>normalizationAttempted: {String(Boolean(quickDiagnostic.normalizationAttempted))}</span>
                  <span>normalizationSucceeded: {String(Boolean(quickDiagnostic.normalizationSucceeded))}</span>
                  <span>retryAttempted: {String(quickDiagnostic.retryAttempted)}</span>
                  <span>retrySucceeded: {String(quickDiagnostic.retrySucceeded)}</span>
                  {quickDiagnostic.fallbackReason && <span className="sm:col-span-2">fallbackReason: {quickDiagnostic.fallbackReason}</span>}
                  {quickDiagnostic.providerErrorName && <span className="sm:col-span-2">providerErrorName: {quickDiagnostic.providerErrorName}</span>}
                  {quickDiagnostic.providerErrorMessage && <span className="sm:col-span-2">providerErrorMessage: {quickDiagnostic.providerErrorMessage}</span>}
                  {quickDiagnostic.validationErrors?.length ? (
                    <span className="sm:col-span-2">validationErrors: {quickDiagnostic.validationErrors.join(' | ')}</span>
                  ) : null}
                  {quickDiagnostic.normalizedWarnings?.length ? (
                    <span className="sm:col-span-2">normalizedWarnings: {quickDiagnostic.normalizedWarnings.join(' | ')}</span>
                  ) : null}
                  {quickDiagnostic.rejectedAttemptNumber && <span className="sm:col-span-2">rejectedAttemptNumber: {quickDiagnostic.rejectedAttemptNumber}</span>}
                </div>
                {quickDiagnostic.rejectedOutputPreview && (
                  <details className="mt-2 rounded border border-blue-100 bg-blue-50/60 px-2 py-1.5">
                    <summary className="cursor-pointer font-medium">Rejected LLM output preview</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-[10px] leading-relaxed text-blue-950">
                      {quickDiagnostic.rejectedBasisPreview || quickDiagnostic.rejectedOutputPreview}
                    </pre>
                  </details>
                )}
              </div>
            )}
            {(!company.trim() || !roleTitle.trim() || !jdText.trim()) && (
              <span className="text-xs text-blue-700/80">
                Requires company, role title, and pasted/fetched JD.
              </span>
            )}
          </div>
        </div>

        <Collapse
          label="Paste DomainIQ JSON"
          hint="Structured export — company profile, tech stack, industry signals"
          open={mode === 'json'}
          onToggle={() => { setMode(mode === 'json' ? null : 'json'); setJsonError('') }}
        >
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">DomainIQ JSON export</label>
            {quickDisplayedSource && (
              <p className="text-xs font-medium text-gray-600 mb-1">
                Displayed JSON source: {formatQuickDisplayedSource(quickDisplayedSource)}
              </p>
            )}
            <p className="text-xs text-gray-400 mb-2">
              Paste the full JSON object from a DomainIQ export. Fields:{' '}
              <code className="text-gray-500">companyProfile</code>,{' '}
              <code className="text-gray-500">industrySignals</code>,{' '}
              <code className="text-gray-500">techStack</code>,{' '}
              <code className="text-gray-500">cultureSignals</code>.
            </p>
            <textarea
              className={`${textareaCls} h-32 font-mono text-xs`}
              value={value}
              onChange={e => handleJsonChange(e.target.value)}
              placeholder={'{\n  "companyProfile": "...",\n  "industrySignals": ["fintech", "B2B SaaS"],\n  "techStack": ["React", "Python"],\n  "cultureSignals": ["remote-first"]\n}'}
            />
          </div>
          {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
          {parsedPreview && !jsonError && (
            <div className="bg-gray-50 rounded p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Parsed successfully</p>
              {parsedPreview.companyProfile && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Company</span>
                  <p className="text-xs text-gray-700 mt-0.5">{parsedPreview.companyProfile}</p>
                </div>
              )}
              {parsedPreview.industrySignals.length > 0 && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Industry</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {parsedPreview.industrySignals.map((s, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded text-xs">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {parsedPreview.techStack.length > 0 && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Tech Stack</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {parsedPreview.techStack.map((s, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {parsedPreview.cultureSignals.length > 0 && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Culture</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {parsedPreview.cultureSignals.map((s, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Collapse>

        <Collapse
          label="Paste raw text / notes"
          hint="Glassdoor blurb, LinkedIn company page, your own notes — any format"
          open={mode === 'text'}
          onToggle={() => setMode(mode === 'text' ? null : 'text')}
        >
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Company research notes</label>
            <p className="text-xs text-gray-400 mb-2">
              Paste anything: Glassdoor excerpts, LinkedIn company page, news snippets, or your own notes.
              The system extracts signals automatically.
            </p>
            <textarea
              className={`${textareaCls} h-32 text-xs`}
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder="e.g. Acme Corp is a Series B fintech startup focused on SMB lending. 200 employees, remote-first. Stack: React, Python, AWS. Known for fast iteration cycles..."
            />
          </div>
        </Collapse>
      </div>
    </div>
  )
}

// ─── Fetch-failed warning banner ──────────────────────────────────────────────

function FetchFailedBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <span className="text-amber-500 text-sm shrink-0">⚠</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800">
          The job page could not be fetched.
        </p>
        <p className="text-xs text-amber-700 mt-0.5">{message}</p>
        <p className="text-xs text-amber-700 mt-1 font-medium">
          Paste the full job description to continue.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-amber-400 hover:text-amber-600 text-xs shrink-0"
      >
        ✕
      </button>
    </div>
  )
}

// ─── Empty values for draft sessions (no analysis run) ───────────────────────

const EMPTY_DOMAIN_IQ: DomainIQImport = {
  rawText: '',
  companyProfile: '',
  industrySignals: [],
  techStack: [],
  cultureSignals: [],
}

const EMPTY_RAW_JD: RawJD = {
  fullText: '',
  summary: '',
  responsibilities: [],
  requiredSkills: [],
  niceToHaves: [],
  domainSignals: [],
}

const EMPTY_REQUIREMENT_MAP: JDRequirementMap = {
  required: [],
  niceToHave: [],
  realJobFunction: '',
  needsEvidenceItems: [],
  unsupportedRequirements: [],
  weaklySupportedRequirements: [],
}

// ─── JD payload validation ────────────────────────────────────────────────────

const INSTRUCTION_MARKERS = [
  'Stage 1 Analyze JD Button Status Tracking',
  'Stage 1 Refactor',
  'Refactor ResumeBuilder',
  'Implementation Boundary',
  'ResumeBuilder source logic owns',
  'Anthropic LLM does not own status state',
  'Acceptance Criteria',
  'Multi-Pass Architecture',
  'Pass A – Candidate Profile Map',
  'Pass B – Claim Validation',
  'Pass C – JD Requirement Map',
]

function validateJDText(jdText: string): string | null {
  const text = jdText.trim()
  if (text.length < 200) return 'Job description is too short. Paste the full JD text.'
  for (const marker of INSTRUCTION_MARKERS) {
    if (text.includes(marker)) {
      return `The JD field appears to contain implementation notes rather than a job description (found: "${marker.slice(0, 50)}…"). Clear the JD field and paste the actual job posting.`
    }
  }
  return null
}

// ─── Job → progress step mapping ─────────────────────────────────────────────

const PASS_TO_STEPS: Record<Stage1PassKey, Stage1StepId[]> = {
  profileMap:      ['buildingCandidateProfileMap'],
  jdMap:           ['analyzingJDRequirements'],
  claimValidation: ['validatingProfileClaims'],
  matchMatrix:     ['matchingProfileToJD'],
  gapFit:          ['generatingGapFitAnalysis'],
  bridgeQuestions: ['generatingBridgeQuestions'],
  assembly:        ['savingResults', 'renderingArtifact'],
}

function jobToProgressSteps(job: Stage1Job): Stage1ProgressStep[] {
  const steps = makeInitialSteps()
  // loadingProfileEvidence — completed if any pass has started
  const anyStarted = Object.values(job.passes).some(p => p.status !== 'not_started')
  return steps.map(step => {
    if (step.id === 'loadingProfileEvidence') {
      return { ...step, status: anyStarted ? 'completed' : 'not_started' }
    }
    for (const [passKey, stepIds] of Object.entries(PASS_TO_STEPS) as [Stage1PassKey, Stage1StepId[]][]) {
      if (stepIds.includes(step.id)) {
        const pass = job.passes[passKey]
        return { ...step, status: pass.status, error: pass.errorMessage }
      }
    }
    return step
  })
}

// ─── JD Source Confirmation Panel ────────────────────────────────────────────

function JDSourceConfirmation({
  jdText,
  jdSourceType,
  roleTitle,
  company,
  evidenceCount,
}: {
  jdText: string
  jdSourceType: JDSourceType
  roleTitle: string
  company: string
  evidenceCount: number
}) {
  const sourceLabel: Record<JDSourceType, string> = {
    pasted_jd: 'Pasted Job Description',
    fetched_jd: 'Fetched from URL',
    structured_fields: 'Assembled from Fields',
    domainiq: 'DomainIQ Import',
    company_notes: 'Company Notes',
    inference: 'Inferred',
  }
  const validationError = validateJDText(jdText)
  const preview = jdText.trim().slice(0, 200).replace(/\s+/g, ' ')

  return (
    <div className={`rounded-lg border px-4 py-3 space-y-2 text-xs ${validationError ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
      <p className={`font-semibold ${validationError ? 'text-red-700' : 'text-gray-700'}`}>
        Stage 1 Payload Preview
      </p>
      {validationError ? (
        <p className="text-red-600">{validationError}</p>
      ) : (
        <div className="space-y-1 text-gray-600">
          <p><span className="font-medium text-gray-500">JD Source:</span> {sourceLabel[jdSourceType] ?? jdSourceType}</p>
          <p><span className="font-medium text-gray-500">JD Length:</span> {jdText.trim().length.toLocaleString()} characters</p>
          <p><span className="font-medium text-gray-500">Role:</span> {roleTitle || '—'}</p>
          <p><span className="font-medium text-gray-500">Company:</span> {company || '—'}</p>
          <p><span className="font-medium text-gray-500">Profile Evidence:</span> {evidenceCount} items loaded</p>
          <p className="font-medium text-gray-500">JD Preview:</p>
          <p className="text-gray-400 italic">"{preview}{jdText.trim().length > 200 ? '…' : ''}"</p>
        </div>
      )}
    </div>
  )
}

// ─── Stage 1 Progress Panel ───────────────────────────────────────────────────

const STEP_LABELS: Record<Stage1StepId, string> = {
  loadingProfileEvidence:    'Loading Profile Evidence',
  buildingCandidateProfileMap: 'Building Candidate Profile Map',
  analyzingJDRequirements:   'Analyzing JD Requirements',
  validatingProfileClaims:   'Validating Profile Claims',
  matchingProfileToJD:       'Matching Profile to JD',
  generatingGapFitAnalysis:  'Generating Gap-Fit Analysis',
  generatingBridgeQuestions: 'Generating Stage 2 Bridge Questions',
  savingResults:             'Saving Stage 1 Results',
  renderingArtifact:         'Rendering Stage 1 Artifact',
}

const STEP_ORDER: Stage1StepId[] = [
  'loadingProfileEvidence',
  'buildingCandidateProfileMap',
  'analyzingJDRequirements',
  'validatingProfileClaims',
  'matchingProfileToJD',
  'generatingGapFitAnalysis',
  'generatingBridgeQuestions',
  'savingResults',
  'renderingArtifact',
]

function makeInitialSteps(): Stage1ProgressStep[] {
  return STEP_ORDER.map(id => ({ id, label: STEP_LABELS[id], status: 'not_started' as Stage1StepStatus }))
}

function StepStatusIcon({ status }: { status: Stage1StepStatus }) {
  if (status === 'completed') return <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs shrink-0">✓</span>
  if (status === 'failed') return <span className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white text-xs shrink-0">✗</span>
  if (status === 'in_progress') return <Spinner className="text-gray-900 h-4 w-4 shrink-0" />
  return <span className="w-5 h-5 rounded-full border-2 border-gray-200 shrink-0" />
}

function Stage1ProgressPanel({ steps }: { steps: Stage1ProgressStep[] }) {
  const activeStep = steps.find(s => s.status === 'in_progress')
  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">Stage 1 Analysis Pipeline</h3>
        {activeStep && (
          <p className="text-xs text-gray-500 mt-0.5">{STEP_LABELS[activeStep.id]}…</p>
        )}
      </div>
      <div className="divide-y divide-gray-50">
        {steps.map(step => (
          <div key={step.id} className={`flex items-start gap-3 px-4 py-2.5 ${step.status === 'in_progress' ? 'bg-blue-50/40' : ''}`}>
            <div className="mt-0.5">
              <StepStatusIcon status={step.status} />
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-sm ${
                step.status === 'in_progress' ? 'text-gray-900 font-medium' :
                step.status === 'completed' ? 'text-gray-500' :
                step.status === 'failed' ? 'text-red-600 font-medium' :
                'text-gray-300'
              }`}>
                {step.label}
              </span>
              {step.error && <p className="text-xs text-red-500 mt-0.5">{step.error}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Per-pass fetch helpers ───────────────────────────────────────────────────

async function callPassRoute<T>(
  url: string,
  body: object,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) {
    const err = Object.assign(new Error(json.error ?? `${url} failed`), {
      rawOutput: json.rawOutput,
      validationErrors: json.validationErrors,
    })
    throw err
  }
  return json.output as T
}

// ─── Main form ────────────────────────────────────────────────────────────────

export function IntakeForm() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined)
  const [jdMode, setJDMode] = useState<JDMode>('paste')

  useEffect(() => {
    getUserProfile().then(p => setProfile(p ?? null))
  }, [])

  const [roleTitle, setRoleTitle] = useState('')
  const [company, setCompany] = useState('')
  const [jdText, setJDText] = useState('')
  const [jdLink, setJDLink] = useState('')
  const [domainIQText, setDomainIQText] = useState('')
  const [jdSourceType, setJDSourceType] = useState<JDSourceType>('pasted_jd')

  // Fetch failure state — drives banner and paste-mode auto-switch
  const [jdFetchFailed, setJDFetchFailed] = useState(false)
  const [fetchFailMessage, setFetchFailMessage] = useState('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Stage1PipelineResult | null>(null)
  const [showTrace, setShowTrace] = useState(false)
  const [progressSteps, setProgressSteps] = useState<Stage1ProgressStep[]>(makeInitialSteps())
  const [profileEvidenceCount, setProfileEvidenceCount] = useState(0)
  const [stage1Job, setStage1Job] = useState<Stage1Job | null>(null)
  const [failedPass, setFailedPass] = useState<Stage1PassKey | null>(null)

  useEffect(() => {
    getActiveSnapshot().then(snap => {
      if (snap) setProfileEvidenceCount(buildEvidenceIndex(snap).length)
    })
    // Restore in-progress job on page refresh
    const activeId = getActiveJobId()
    if (activeId) {
      getStage1Job(activeId).then(job => {
        if (job && job.status === 'running') {
          setStage1Job(job)
          setProgressSteps(jobToProgressSteps(job))
          // Restore form fields from job
          setRoleTitle(job.roleTitle)
          setCompany(job.company)
          setJDText(job.jdText)
          setJDSourceType(job.jdSourceType)
          setDomainIQText(job.domainIQText)
        } else if (job && job.status === 'completed' && job.finalArtifact) {
          setResult(job.finalArtifact as Stage1PipelineResult)
          setProgressSteps(jobToProgressSteps(job))
        }
      })
    }
  }, [])

  const stage1Status = deriveStage1Status({
    jdText,
    jdFetchFailed,
    analyzed: result !== null,
  })

  function handleFetchSuccess(sourceType: JDSourceType) {
    setJDFetchFailed(false)
    setFetchFailMessage('')
    setJDSourceType(sourceType)
  }

  function handleFetchFailed(message: string) {
    setJDFetchFailed(true)
    setFetchFailMessage(message)
    setJDText('')  // clear any stale text
    setJDMode('paste')  // open paste collapse automatically
  }

  async function runPipeline(job: Stage1Job) {
    const now = () => new Date().toISOString()

    async function runPass<T>(
      passKey: Stage1PassKey,
      url: string,
      body: object,
    ): Promise<T> {
      const updated = await updateStage1JobPass(job.id, passKey, { status: 'in_progress', startedAt: now() })
      if (updated) { setStage1Job(updated); setProgressSteps(jobToProgressSteps(updated)) }

      try {
        const output = await callPassRoute<T>(url, body)
        const done = await updateStage1JobPass(job.id, passKey, { status: 'completed', output, completedAt: now() })
        if (done) { setStage1Job(done); setProgressSteps(jobToProgressSteps(done)) }
        return output
      } catch (err: any) {
        const failed = await updateStage1JobPass(job.id, passKey, {
          status: 'failed',
          errorMessage: err.message,
          rawOutput: err.rawOutput,
          validationErrors: err.validationErrors,
          retryCount: (job.passes[passKey].retryCount ?? 0) + 1,
        })
        if (failed) { setStage1Job(failed); setProgressSteps(jobToProgressSteps(failed)) }
        await setStage1JobFailed(job.id)
        setFailedPass(passKey)
        throw err
      }
    }

    // Mark evidence loaded
    setProgressSteps(prev => prev.map(s => s.id === 'loadingProfileEvidence' ? { ...s, status: 'completed' } : s))

    // Pass A and C — parallel, independent
    const [profileMap, jdMap] = await Promise.all([
      runPass<CandidateProfileMap>('profileMap', '/api/stage1/pass/profile-map', {
        profile: job.profile,
        profileEvidenceIndex: job.profileEvidenceIndex,
        bridgeAnswers: job.bridgeAnswers,
        acceptedArtifacts: job.acceptedArtifacts,
      }),
      runPass<JDRequirementMapExtended>('jdMap', '/api/stage1/pass/jd-map', {
        jdText: job.jdText,
        domainIQText: job.domainIQText,
      }),
    ])

    // Pass B — depends on A
    const validatedClaims = await runPass<ValidatedProfileClaims>('claimValidation', '/api/stage1/pass/claim-validation', {
      profileMap,
      skills: job.profile.skills,
      certifications: job.profile.certifications,
    })

    // Pass D — depends on B and C
    const matchMatrix = await runPass<MatchMatrix>('matchMatrix', '/api/stage1/pass/match-matrix', {
      validatedClaims,
      jdMap,
    })

    // Pass E — depends on D
    const gapFitAnalysis = await runPass<GapFitAnalysis>('gapFit', '/api/stage1/pass/gap-fit', {
      matchMatrix,
      validatedClaims,
    })

    // Pass F — depends on E
    const bridgeQuestions = await runPass<Stage2QuestionCandidate[]>('bridgeQuestions', '/api/stage1/pass/bridge-questions', {
      gapFitAnalysis,
      validatedClaims,
    })

    // Assembly — final artifact
    const finalResult = await runPass<Stage1PipelineResult>('assembly', '/api/stage1/assemble', {
      profileMap,
      validatedClaims,
      jdMapExtended: jdMap,
      matchMatrix,
      gapFitAnalysis,
      bridgeQuestions,
      jdText: job.jdText,
      domainIQText: job.domainIQText,
      profile: job.profile,
      jdSourceType: job.jdSourceType,
      evidenceIndex: job.profileEvidenceIndex,
    })

    await setStage1JobComplete(job.id, finalResult)
    setResult(finalResult)
  }

  async function handleAnalyze() {
    setError('')
    setFailedPass(null)

    if (!jdText.trim()) {
      setError('Paste the job description to continue.')
      return
    }
    if (!roleTitle.trim() || !company.trim()) {
      setError('Role title and company are required.')
      return
    }

    const jdValidationError = validateJDText(jdText)
    if (jdValidationError) {
      setError(jdValidationError)
      return
    }

    const profileData = await getUserProfile()
    if (!profileData) {
      setError('Please complete your profile before creating a session.')
      return
    }

    setLoading(true)
    setResult(null)
    setProgressSteps(makeInitialSteps())

    try {
      const snapshot = await getActiveSnapshot()
      const profileEvidenceIndex = snapshot ? buildEvidenceIndex(snapshot) : []

      if (process.env.NODE_ENV === 'development') {
        console.log('[Stage1 intake payload]', {
          company, roleTitle, jdSource: jdSourceType,
          jdTextLength: jdText?.length, jdTextPreview: jdText?.slice(0, 300),
          hasProfile: Boolean(profileData), profileEvidenceCount: profileEvidenceIndex?.length ?? 0,
          hasDomainIQ: Boolean(domainIQText?.trim()),
        })
      }

      const job = await createStage1Job({
        company, roleTitle, jdText, jdSourceType, domainIQText,
        profile: profileData, profileEvidenceIndex,
      })
      setStage1Job(job)
      setActiveJobId(job.id)

      await runPipeline(job)
    } catch (err) {
      if (!failedPass) {
        // Only set generic error if we haven't already marked a specific pass as failed
        setError(err instanceof Error ? err.message : 'Analysis failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleRetryPass() {
    if (!stage1Job || !failedPass) return
    setError('')
    setLoading(true)

    try {
      // Reload job state from DB to get latest outputs from completed passes
      const freshJob = await getStage1Job(stage1Job.id)
      if (!freshJob) { setError('Job not found.'); return }

      // Update job status back to running so pipeline can continue
      const updatedJob = await updateStage1JobPass(freshJob.id, failedPass, {
        status: 'not_started',
        errorMessage: undefined,
        retryCount: (freshJob.passes[failedPass].retryCount ?? 0),
      })
      const jobToRun = updatedJob ?? freshJob
      setStage1Job(jobToRun)
      setFailedPass(null)
      setProgressSteps(jobToProgressSteps(jobToRun))

      // Re-enter pipeline from the failed pass using saved prior outputs
      const getOutput = <T,>(key: Stage1PassKey): T => freshJob.passes[key].output as T

      const now = () => new Date().toISOString()
      const runPassRetry = async <T,>(passKey: Stage1PassKey, url: string, body: object): Promise<T> => {
        if (freshJob.passes[passKey].status === 'completed') {
          return getOutput<T>(passKey)
        }
        const upd = await updateStage1JobPass(jobToRun.id, passKey, { status: 'in_progress', startedAt: now() })
        if (upd) { setStage1Job(upd); setProgressSteps(jobToProgressSteps(upd)) }
        try {
          const output = await callPassRoute<T>(url, body)
          const done = await updateStage1JobPass(jobToRun.id, passKey, { status: 'completed', output, completedAt: now() })
          if (done) { setStage1Job(done); setProgressSteps(jobToProgressSteps(done)) }
          return output
        } catch (err: any) {
          const failed = await updateStage1JobPass(jobToRun.id, passKey, {
            status: 'failed', errorMessage: err.message, rawOutput: err.rawOutput,
            validationErrors: err.validationErrors,
            retryCount: (jobToRun.passes[passKey].retryCount ?? 0) + 1,
          })
          if (failed) { setStage1Job(failed); setProgressSteps(jobToProgressSteps(failed)) }
          await setStage1JobFailed(jobToRun.id)
          setFailedPass(passKey)
          throw err
        }
      }

      const profileMap = await runPassRetry<CandidateProfileMap>('profileMap', '/api/stage1/pass/profile-map', {
        profile: freshJob.profile, profileEvidenceIndex: freshJob.profileEvidenceIndex,
        bridgeAnswers: freshJob.bridgeAnswers, acceptedArtifacts: freshJob.acceptedArtifacts,
      })
      const [, jdMap] = await Promise.all([
        Promise.resolve(profileMap),
        runPassRetry<JDRequirementMapExtended>('jdMap', '/api/stage1/pass/jd-map', {
          jdText: freshJob.jdText, domainIQText: freshJob.domainIQText,
        }),
      ])
      const validatedClaims = await runPassRetry<ValidatedProfileClaims>('claimValidation', '/api/stage1/pass/claim-validation', {
        profileMap, skills: freshJob.profile.skills, certifications: freshJob.profile.certifications,
      })
      const matchMatrix = await runPassRetry<MatchMatrix>('matchMatrix', '/api/stage1/pass/match-matrix', {
        validatedClaims, jdMap,
      })
      const gapFitAnalysis = await runPassRetry<GapFitAnalysis>('gapFit', '/api/stage1/pass/gap-fit', {
        matchMatrix, validatedClaims,
      })
      const bridgeQuestions = await runPassRetry<Stage2QuestionCandidate[]>('bridgeQuestions', '/api/stage1/pass/bridge-questions', {
        gapFitAnalysis, validatedClaims,
      })
      const finalResult = await runPassRetry<Stage1PipelineResult>('assembly', '/api/stage1/assemble', {
        profileMap, validatedClaims, jdMapExtended: jdMap, matchMatrix, gapFitAnalysis, bridgeQuestions,
        jdText: freshJob.jdText, domainIQText: freshJob.domainIQText, profile: freshJob.profile,
        jdSourceType: freshJob.jdSourceType, evidenceIndex: freshJob.profileEvidenceIndex,
      })

      await setStage1JobComplete(jobToRun.id, finalResult)
      setResult(finalResult)
    } catch (err) {
      if (!failedPass) setError(err instanceof Error ? err.message : 'Retry failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!result) return
    if (!canCompleteStage1(stage1Status)) return
    if (saving) return

    setError('')
    setSaving(true)
    try {
      const profile = await getUserProfile()
      if (!profile) {
        setError('Please complete your profile before saving a session.')
        return
      }

      const session: TargetIntake = {
        id: nanoid(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        roleTitle,
        company,
        postingUrl: jdLink.trim() || undefined,
        jdSourceType,
        stage1Status: 'complete',
        domainIQInsights: result.domainIQ,
        jobDescription: result.rawJD,
        jdRequirementMap: result.requirementMap,
        companySummary: result.synthesis.companySummary,
        fitHypothesis: result.synthesis.fitHypothesis,
        riskGaps: result.synthesis.riskGaps,
        emphasisRecommendation: result.synthesis.emphasisRecommendation,
        fitAnalysis: result.fitAnalysis,
        status: 'intake',
        stageStatuses: deriveStageStatuses('intake'),
      }
      await saveSession(session)
      router.push(`/sessions/${session.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save session. Please try again.')
      setSaving(false)
    }
  }

  async function handleSaveDraft() {
    if (!roleTitle.trim() || !company.trim()) {
      setError('Role title and company are required to save a draft.')
      return
    }
    const session: TargetIntake = {
      id: nanoid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      roleTitle,
      company,
      postingUrl: jdLink.trim() || undefined,
      jdSourceType,
      stage1Status,
      domainIQInsights: EMPTY_DOMAIN_IQ,
      jobDescription: EMPTY_RAW_JD,
      jdRequirementMap: EMPTY_REQUIREMENT_MAP,
      companySummary: '',
      fitHypothesis: '',
      riskGaps: [],
      emphasisRecommendation: 'blended',
      status: 'intake',
      stageStatuses: deriveStageStatuses('intake'),
    }
    await saveSession(session)
    router.push(`/sessions/${session.id}`)
  }

  const canAnalyze = (stage1Status === 'ready_to_analyze' || stage1Status === 'jd_needs_paste') && !loading

  return (
    <div className="space-y-8">
      <ProfileSection profile={profile} />

      <div className="border-t border-gray-100 pt-6" />

      {/* Fetch-failed warning — shown above the JD section */}
      {jdFetchFailed && fetchFailMessage && (
        <FetchFailedBanner
          message={fetchFailMessage}
          onDismiss={() => { setJDFetchFailed(false); setFetchFailMessage('') }}
        />
      )}

      <JDSection
        mode={jdMode}
        onMode={setJDMode}
        roleTitle={roleTitle}
        setRoleTitle={setRoleTitle}
        company={company}
        setCompany={setCompany}
        jdText={jdText}
        setJDText={setJDText}
        jdLink={jdLink}
        setJDLink={setJDLink}
        onFetchSuccess={handleFetchSuccess}
        onFetchFailed={handleFetchFailed}
      />

      <div className="border-t border-gray-100 pt-6" />

      <DomainIQSection
        value={domainIQText}
        onChange={setDomainIQText}
        company={company}
        roleTitle={roleTitle}
        jdText={jdText}
      />

      {jdText.trim() && (
        <JDSourceConfirmation
          jdText={jdText}
          jdSourceType={jdSourceType}
          roleTitle={roleTitle}
          company={company}
          evidenceCount={profileEvidenceCount}
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* CTAs — driven by stage1Status */}
      <div className="flex flex-wrap gap-3 pt-2">
        {stage1Status === 'jd_fetch_failed' ? (
          // Fetch failed, no JD text yet — disable analyze, show paste CTA
          <button
            disabled
            className="px-5 py-2 bg-gray-200 text-gray-400 rounded text-sm font-medium cursor-not-allowed"
          >
            Paste JD to Continue
          </button>
        ) : stage1Status === 'analyzed_needs_review' ? (
          // Analysis done — show save CTA
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-green-700 text-white rounded text-sm font-medium hover:bg-green-600 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Spinner className="text-white" />}
            {saving ? 'Saving…' : 'Save Stage 1 and Continue →'}
          </button>
        ) : (
          // Default — Analyze JD button
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="px-5 py-2 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2"
          >
            {loading && <Spinner className="text-white" />}
            {loading ? 'Analyzing…' : 'Analyze JD'}
          </button>
        )}

        {/* Draft save — available once role+company are filled */}
        {(stage1Status === 'jd_fetch_failed' || stage1Status === 'jd_needs_paste') &&
          roleTitle.trim() &&
          company.trim() && (
            <button
              onClick={handleSaveDraft}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded text-sm font-medium hover:border-gray-500 hover:text-gray-800"
            >
              Save as Draft
            </button>
          )}
      </div>

      {/* Progress panel — visible while loading or when a pass has failed */}
      {(loading || failedPass) && (
        <div className="space-y-3">
          <Stage1ProgressPanel steps={progressSteps} />
          {failedPass && !loading && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleRetryPass}
                className="px-4 py-2 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-500"
              >
                Retry {STEP_LABELS[PASS_TO_STEPS[failedPass][0]] ?? failedPass}
              </button>
              <p className="text-xs text-gray-500">
                Completed passes are preserved — only the failed pass will rerun.
              </p>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="mt-8 space-y-8">
          <div className="flex justify-end">
            <label className="flex items-center gap-2 text-xs text-gray-400 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={showTrace}
                onChange={e => setShowTrace(e.target.checked)}
              />
              Show evidence trace
            </label>
          </div>
          <IntakeSynthesisView synthesis={result.synthesis} findings={result.fitAnalysis?.findings} showTrace={showTrace} />
          <JDRequirementMapView map={result.requirementMap} findings={result.fitAnalysis?.findings} showTrace={showTrace} />
          {showTrace && (
            <UnmatchedFindingsDebug
              findings={computeUnmatchedFindings(result.fitAnalysis?.findings, [
                ...result.requirementMap.required.map(r => r.text),
                ...result.requirementMap.niceToHave.map(r => r.text),
                ...(result.requirementMap.needsEvidenceItems ?? result.requirementMap.unsupportedRequirements ?? []),
                ...result.requirementMap.weaklySupportedRequirements,
                ...result.synthesis.riskGaps,
                'company_context',
              ])}
            />
          )}
        </div>
      )}
    </div>
  )
}

function IntakeSynthesisView({
  synthesis,
  findings,
  showTrace,
}: {
  synthesis: {
    companySummary: string
    fitHypothesis: string
    riskGaps: string[]
    emphasisRecommendation: string
    riskGapBreakdown?: {
      trueCandidateGaps: string[]
      weakButBridgeable: string[]
      retrievalGaps: string[]
    }
    resumeDirection?: {
      summaryGuidance: string
      skillsGuidance: string
      experienceBulletGuidance: string[]
    }
    qualityAudit?: {
      compoundRequirementsSplit: string[]
      contradictionsResolved: string[]
      retrievalGapsFlagged: string[]
      stage2QuestionsSuppressed: string[]
    }
  }
  findings?: import('@/contracts').Stage1Finding[]
  showTrace: boolean
}) {
  const companyContextFinding = showTrace ? findFindingByTopic(findings, 'company_context') : undefined
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Company Context</h3>
          {showTrace && <TraceChip finding={companyContextFinding} label="Why" />}
        </div>
        <p className="text-sm text-gray-700">{synthesis.companySummary}</p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Fit Hypothesis</h3>
        <p className="text-sm text-gray-700">{synthesis.fitHypothesis}</p>
        {showTrace && (
          <p className="text-xs text-gray-400 italic mt-1">No formal trace yet</p>
        )}
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Emphasis Recommendation</h3>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-900 text-white">
          {synthesis.emphasisRecommendation}
        </span>
      </div>
      {synthesis.riskGaps.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">Risk / Gap Areas</h3>
          <ul className="space-y-1">
            {synthesis.riskGaps.map((gap, i) => (
              <TraceableBullet
                key={i}
                text={gap}
                finding={showTrace ? findFindingByTopic(findings, gap) : undefined}
                className="text-sm text-amber-700"
              />
            ))}
          </ul>
        </div>
      )}

      {synthesis.riskGapBreakdown && (
        <div className="border border-amber-100 bg-amber-50/40 rounded-md px-3 py-3 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700">Risk / Gap Breakdown</h3>
          {synthesis.riskGapBreakdown.trueCandidateGaps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-600 mb-1">True Gaps</p>
              <ul className="space-y-0.5">
                {synthesis.riskGapBreakdown.trueCandidateGaps.map((g, i) => (
                  <li key={i} className="text-xs text-red-700">· {g}</li>
                ))}
              </ul>
            </div>
          )}
          {synthesis.riskGapBreakdown.weakButBridgeable.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-600 mb-1">Weak but Bridgeable</p>
              <ul className="space-y-0.5">
                {synthesis.riskGapBreakdown.weakButBridgeable.map((g, i) => (
                  <li key={i} className="text-xs text-amber-700">· {g}</li>
                ))}
              </ul>
            </div>
          )}
          {synthesis.riskGapBreakdown.retrievalGaps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-violet-600 mb-1">Retrieval Gaps (likely in profile)</p>
              <ul className="space-y-0.5">
                {synthesis.riskGapBreakdown.retrievalGaps.map((g, i) => (
                  <li key={i} className="text-xs text-violet-700">· {g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {synthesis.resumeDirection && (
        <div className="border border-indigo-100 bg-indigo-50/40 rounded-md px-3 py-3 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Resume Direction</h3>
          <p className="text-xs text-indigo-800"><span className="font-semibold">Summary:</span> {synthesis.resumeDirection.summaryGuidance}</p>
          <p className="text-xs text-indigo-800"><span className="font-semibold">Skills:</span> {synthesis.resumeDirection.skillsGuidance}</p>
          {synthesis.resumeDirection.experienceBulletGuidance.length > 0 && (
            <ul className="space-y-0.5 mt-1">
              {synthesis.resumeDirection.experienceBulletGuidance.map((g, i) => (
                <li key={i} className="text-xs text-indigo-700">· {g}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {synthesis.qualityAudit && (
        <details className="border border-gray-200 rounded-md">
          <summary className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 cursor-pointer select-none">
            Quality Audit (I)
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            {synthesis.qualityAudit.compoundRequirementsSplit.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-0.5">Compound requirements split:</p>
                <ul className="space-y-0.5">
                  {synthesis.qualityAudit.compoundRequirementsSplit.map((s, i) => (
                    <li key={i} className="text-xs text-gray-500">· {s}</li>
                  ))}
                </ul>
              </div>
            )}
            {synthesis.qualityAudit.contradictionsResolved.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-0.5">Contradictions resolved:</p>
                <ul className="space-y-0.5">
                  {synthesis.qualityAudit.contradictionsResolved.map((s, i) => (
                    <li key={i} className="text-xs text-gray-500">· {s}</li>
                  ))}
                </ul>
              </div>
            )}
            {synthesis.qualityAudit.retrievalGapsFlagged.length > 0 && (
              <div>
                <p className="text-xs font-medium text-violet-600 mb-0.5">Retrieval gaps flagged:</p>
                <ul className="space-y-0.5">
                  {synthesis.qualityAudit.retrievalGapsFlagged.map((s, i) => (
                    <li key={i} className="text-xs text-violet-600">· {s}</li>
                  ))}
                </ul>
              </div>
            )}
            {synthesis.qualityAudit.stage2QuestionsSuppressed.length > 0 && (
              <div>
                <p className="text-xs font-medium text-green-700 mb-0.5">Stage 2 questions suppressed (already answered):</p>
                <ul className="space-y-0.5">
                  {synthesis.qualityAudit.stage2QuestionsSuppressed.map((s, i) => (
                    <li key={i} className="text-xs text-green-600">· {s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

