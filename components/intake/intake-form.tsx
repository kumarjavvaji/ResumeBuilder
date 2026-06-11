'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getUserProfile } from '@/lib/storage/user-profile'
import { saveSession } from '@/lib/storage/sessions'
import { nanoid } from '@/lib/storage/nanoid'
import type {
  TargetIntake,
  Stage1Status,
  JDSourceType,
  RawJD,
  JDRequirementMap,
  DomainIQImport,
} from '@/contracts'
import { deriveStageStatuses, canCompleteStage1 } from '@/contracts'
import { Spinner } from '@/components/shared/spinner'
import { inputCls, textareaCls } from '@/lib/input-cls'
import { JDRequirementMapView } from './jd-requirement-map-view'

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

type ProfileMode = 'upload' | 'use-saved' | null

function ProfileSection({ mode, onMode }: { mode: ProfileMode; onMode: (m: ProfileMode) => void }) {
  return (
    <div>
      <SectionLabel n="1" text="Resume / Profile" />
      <div className="space-y-2">
        <Collapse
          label="Upload existing resume"
          hint="PDF or Word — parsed into profile fields"
          open={mode === 'upload'}
          onToggle={() => onMode(mode === 'upload' ? null : 'upload')}
        >
          <label className="block text-xs font-medium text-gray-700 mb-1">Resume file</label>
          <p className="text-xs text-gray-500 mb-2">
            Upload a PDF or Word resume. The system will parse it into your profile fields.
          </p>
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white hover:file:bg-gray-50"
          />
          <p className="text-xs text-amber-600">Resume parsing is coming soon. Use your saved profile for now.</p>
        </Collapse>

        <Collapse
          label="Use saved profile"
          hint="Pull from your /profile work history"
          open={mode === 'use-saved'}
          onToggle={() => onMode(mode === 'use-saved' ? null : 'use-saved')}
        >
          <p className="text-xs text-gray-500">
            Your profile from{' '}
            <a href="/profile" className="underline hover:text-gray-700">
              /profile
            </a>{' '}
            will be used as the candidate context for this session.
          </p>
          <a
            href="/profile"
            className="inline-block text-xs font-medium text-gray-900 underline underline-offset-2 hover:text-gray-600"
          >
            Review or edit profile →
          </a>
        </Collapse>
      </div>
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
    if (typeof parsed.companyProfile === 'string' && Array.isArray(parsed.industrySignals)) {
      return {
        companyProfile: parsed.companyProfile ?? '',
        industrySignals: parsed.industrySignals ?? [],
        techStack: parsed.techStack ?? [],
        cultureSignals: parsed.cultureSignals ?? [],
      }
    }
  } catch {}
  return null
}

function DomainIQSection({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [mode, setMode] = useState<DomainIQMode>(null)
  const [jsonError, setJsonError] = useState('')

  // Auto-detect JSON when user pastes into JSON mode
  function handleJsonChange(raw: string) {
    setJsonError('')
    onChange(raw)
    if (raw.trim()) {
      const parsed = tryParseDomainIQJson(raw)
      if (!parsed && raw.trim().startsWith('{')) {
        setJsonError('Not a valid DomainIQ JSON export. Check the format or use raw text instead.')
      }
    }
  }

  const parsedPreview = mode === 'json' && value.trim() ? tryParseDomainIQJson(value) : null

  return (
    <div>
      <SectionLabel n="3" text="Company Research" />
      <p className="text-xs text-gray-400 mb-3">
        Optional. Augments the JD with company context, tech stack, and culture signals.
      </p>
      <div className="space-y-2">
        <Collapse
          label="Paste DomainIQ JSON"
          hint="Structured export — company profile, tech stack, industry signals"
          open={mode === 'json'}
          onToggle={() => { setMode(mode === 'json' ? null : 'json'); setJsonError('') }}
        >
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">DomainIQ JSON export</label>
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

// ─── Main form ────────────────────────────────────────────────────────────────

export function IntakeForm() {
  const router = useRouter()
  const [profileMode, setProfileMode] = useState<ProfileMode>('use-saved')
  const [jdMode, setJDMode] = useState<JDMode>('paste')

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
  const [error, setError] = useState('')
  const [result, setResult] = useState<null | Awaited<ReturnType<typeof runIntake>>>(null)

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

  async function handleAnalyze() {
    setError('')

    // Guard: must have valid JD text to proceed
    if (!jdText.trim()) {
      setError('Paste the job description to continue.')
      return
    }
    if (!roleTitle.trim() || !company.trim()) {
      setError('Role title and company are required.')
      return
    }

    const profile = await getUserProfile()
    if (!profile) {
      setError('Please complete your profile before creating a session.')
      return
    }

    setLoading(true)
    try {
      const data = await runIntake(jdText, domainIQText, profile, jdSourceType, roleTitle, company)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!result) return
    if (!canCompleteStage1(stage1Status)) return
    const profile = await getUserProfile()
    if (!profile) return

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
      status: 'intake',
      stageStatuses: deriveStageStatuses('intake'),
    }
    await saveSession(session)
    router.push(`/sessions/${session.id}`)
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
      <ProfileSection mode={profileMode} onMode={setProfileMode} />

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

      <DomainIQSection value={domainIQText} onChange={setDomainIQText} />

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
            className="px-5 py-2 bg-green-700 text-white rounded text-sm font-medium hover:bg-green-600"
          >
            Save Stage 1 and Continue to Bridge Questions →
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

      {result && (
        <div className="mt-8 space-y-8">
          <IntakeSynthesisView synthesis={result.synthesis} />
          <JDRequirementMapView map={result.requirementMap} />
        </div>
      )}
    </div>
  )
}

function IntakeSynthesisView({
  synthesis,
}: {
  synthesis: {
    companySummary: string
    fitHypothesis: string
    riskGaps: string[]
    emphasisRecommendation: string
  }
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Company Context</h3>
        <p className="text-sm text-gray-700">{synthesis.companySummary}</p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Fit Hypothesis</h3>
        <p className="text-sm text-gray-700">{synthesis.fitHypothesis}</p>
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
              <li key={i} className="text-sm text-amber-700 flex gap-2">
                <span className="shrink-0">·</span>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

async function runIntake(
  jdText: string,
  domainIQText: string,
  profile: unknown,
  jdSourceType: JDSourceType = 'pasted_jd',
  roleTitle?: string,
  company?: string
) {
  const res = await fetch('/api/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jdText, domainIQText, profile, jdSourceType, roleTitle, company }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message ?? err.error ?? 'Intake API failed')
  }
  return res.json() as Promise<{
    rawJD: import('@/contracts').RawJD
    requirementMap: import('@/contracts').JDRequirementMap
    domainIQ: import('@/contracts').DomainIQImport
    synthesis: {
      companySummary: string
      fitHypothesis: string
      riskGaps: string[]
      emphasisRecommendation: import('@/contracts').EmphasisCategory
    }
  }>
}
