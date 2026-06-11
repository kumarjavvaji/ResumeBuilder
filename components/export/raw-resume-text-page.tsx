'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ArtifactSection, Stage4RawResumeText, UserProfile } from '@/contracts'
import { getSessionSections } from '@/lib/storage/artifacts'
import { getUserProfile } from '@/lib/storage/user-profile'
import {
  getStage4RawResumeText,
  saveStage4RawResumeText,
  updateStage4RawResumeText
} from '@/lib/storage/stage4-raw-resume'
import {
  buildStage4RawResumeText,
  formatExperienceBlock,
  getStage4Readiness,
  getStage4StaleReasons
} from '@/lib/stage4/raw-resume-text'
import { Spinner } from '@/components/shared/spinner'

const REQUIRED_LABELS: Record<string, string> = {
  summary: 'Professional Summary',
  skills: 'Skills',
  'experience-po': 'Experience: Product Owner',
  'experience-ba': 'Experience: Business Analyst',
  'experience-qa': 'Experience: QA / Quality'
}

export function RawResumeTextPage({ sessionId }: { sessionId: string }) {
  const [sections, setSections] = useState<ArtifactSection[]>([])
  const [profile, setProfile] = useState<UserProfile | undefined>(undefined)
  const [rawText, setRawText] = useState<Stage4RawResumeText | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const [loadedSections, loadedProfile, savedRaw] = await Promise.all([
        getSessionSections(sessionId),
        getUserProfile(),
        getStage4RawResumeText(sessionId)
      ])
      setSections(loadedSections)
      setProfile(loadedProfile)
      setRawText(savedRaw)
      setLoading(false)
    }
    load()
  }, [sessionId])

  const readiness = useMemo(() => getStage4Readiness(sections), [sections])
  const staleReasons = useMemo(() => getStage4StaleReasons(rawText, sections), [rawText, sections])
  const displayRaw = rawText
    ? {
      ...rawText,
      status: staleReasons.length > 0 ? 'stale' as const : rawText.status,
      staleReasons: staleReasons.length > 0 ? staleReasons : rawText.staleReasons
    }
    : undefined

  async function generate(allowDraft: boolean) {
    if (!profile) {
      setError('Profile required before Stage 4 raw text can be assembled.')
      return
    }
    setGenerating(true)
    setError('')
    try {
      const assembled = buildStage4RawResumeText({
        sessionId,
        sections,
        profile,
        allowDraft
      })
      const saved = await saveStage4RawResumeText(assembled)
      setRawText(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assemble raw resume text.')
    } finally {
      setGenerating(false)
    }
  }

  async function acknowledgeStale() {
    if (!rawText || staleReasons.length === 0) return
    await updateStage4RawResumeText(rawText.id, { status: 'stale', staleReasons })
    setRawText({ ...rawText, status: 'stale', staleReasons, updatedAt: new Date().toISOString() })
  }

  async function copyText(key: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1600)
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>

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
            Missing accepted sections: {readiness.missingRequired.map(t => REQUIRED_LABELS[t]).join(', ')}
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
        <div className="space-y-4">
          {displayRaw.status === 'needs_review' && (
            <p className="text-xs text-amber-400">
              Draft preview only. Do not treat this as final or export-ready until all required Stage 3 sections are accepted.
            </p>
          )}

          <TextBlock
            title="Summary"
            text={displayRaw.sections.summary}
            copied={copiedKey === 'summary'}
            onCopy={() => copyText('summary', displayRaw.sections.summary)}
          />

          <TextBlock
            title="Skills"
            text={displayRaw.sections.skills}
            copied={copiedKey === 'skills'}
            onCopy={() => copyText('skills', displayRaw.sections.skills)}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">Experience</h2>
              <button
                onClick={() => copyText('experience-all', displayRaw.sections.experiences.map(formatExperienceBlock).join('\n\n'))}
                disabled={displayRaw.sections.experiences.length === 0}
                className="text-xs px-3 py-1.5 border border-gray-700 text-gray-300 rounded hover:border-gray-500 disabled:opacity-40"
              >
                {copiedKey === 'experience-all' ? 'Copied' : 'Copy All Experience'}
              </button>
            </div>
            {displayRaw.sections.experiences.map(role => {
              const text = formatExperienceBlock(role)
              return (
                <TextBlock
                  key={role.roleId}
                  title={role.title || role.company || 'Experience Role'}
                  text={text}
                  copied={copiedKey === role.roleId}
                  onCopy={() => copyText(role.roleId, text)}
                />
              )
            })}
          </div>

          <TextBlock
            title="Education"
            text={displayRaw.sections.education}
            copied={copiedKey === 'education'}
            onCopy={() => copyText('education', displayRaw.sections.education)}
          />

          <TextBlock
            title="Full Resume Text"
            text={displayRaw.sections.fullText}
            copied={copiedKey === 'full'}
            onCopy={() => copyText('full', displayRaw.sections.fullText)}
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

function TextBlock({
  title,
  text,
  copied,
  onCopy
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
