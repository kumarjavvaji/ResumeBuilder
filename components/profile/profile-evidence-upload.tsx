'use client'
import { useRef, useState } from 'react'
import { processResumeUpload } from '@/lib/profile/profileIntakeService'
import type { ProfileDelta, UserProfile } from '@/contracts'
import { Spinner } from '@/components/shared/spinner'
import { cn } from '@/lib/cn'

type ParsedBasics = Omit<UserProfile, 'id' | 'updatedAt' | 'constraints' | 'rejectedPhrases'>

interface Props {
  onComplete?: (delta: ProfileDelta) => void
  onPrefillRequest?: (parsed: ParsedBasics) => void
}

export function ProfileEvidenceUpload({ onComplete, onPrefillRequest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [prefilling, setPrefilling] = useState(false)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [prefillError, setPrefillError] = useState('')
  const [delta, setDelta] = useState<ProfileDelta | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [isDuplicate, setIsDuplicate] = useState(false)
  // Retained after upload so the prefill action can reuse it without re-uploading
  const lastFileRef = useRef<File | null>(null)

  async function handleFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx', 'doc', 'txt'].includes(ext ?? '')) {
      setError('Unsupported file type. Upload a PDF, DOCX, or TXT.')
      return
    }

    lastFileRef.current = file
    setFileName(file.name)
    setError('')
    setPrefillError('')
    setDelta(null)
    setIsDuplicate(false)
    setWarnings([])
    setLoading(true)

    try {
      const result = await processResumeUpload(file)
      setDelta(result.delta)
      setWarnings(result.warnings)
      setIsDuplicate(result.isDuplicate)
      onComplete?.(result.delta)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
      lastFileRef.current = null
      setFileName('')
    } finally {
      setLoading(false)
    }
  }

  async function handlePrefill() {
    const file = lastFileRef.current
    if (!file || !onPrefillRequest) return

    setPrefilling(true)
    setPrefillError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/parse-resume', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Parse failed.')
      onPrefillRequest(json.profile)
    } catch (err) {
      setPrefillError(err instanceof Error ? err.message : 'Prefill failed.')
    } finally {
      setPrefilling(false)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input value so the same file can be re-uploaded if needed
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const showPrefill = !loading && !isDuplicate && delta !== null && onPrefillRequest

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        disabled={loading}
        className={cn(
          'w-full flex flex-col items-center gap-2 px-6 py-8 border-2 border-dashed rounded-lg transition-colors text-sm',
          dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50',
          loading && 'opacity-60 cursor-not-allowed'
        )}
      >
        {loading ? (
          <><Spinner className="h-5 w-5" /><span className="text-gray-500">Reading {fileName}...</span></>
        ) : (
          <>
            <UploadIcon />
            <span className="font-medium text-gray-700">
              {delta ? 'Upload another resume' : 'Upload resume as evidence'}
            </span>
            <span className="text-xs text-gray-400">
              PDF, DOCX, or TXT · claims are extracted and merged — existing profile data is preserved
            </span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt"
        className="hidden"
        onChange={handleInputChange}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {warnings.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 space-y-0.5">
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      {isDuplicate && (
        <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
          This file was already added — no changes made.
        </div>
      )}

      {delta && !isDuplicate && <DeltaSummary delta={delta} filename={fileName} />}

      {showPrefill && (
        <div className="pt-1">
          <button
            type="button"
            onClick={handlePrefill}
            disabled={prefilling}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2 disabled:opacity-50"
          >
            {prefilling && <Spinner className="h-3 w-3" />}
            Prefill empty basic fields from this resume
          </button>
          {prefillError && <p className="mt-1 text-xs text-red-600">{prefillError}</p>}
        </div>
      )}
    </div>
  )
}

function DeltaSummary({ delta, filename }: { delta: ProfileDelta; filename: string }) {
  const hasChanges =
    delta.addedClaims.length > 0 ||
    delta.addedSkills.length > 0 ||
    delta.addedTools.length > 0 ||
    delta.addedMetrics.length > 0

  if (!hasChanges) {
    return (
      <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-500">
        No new evidence found in <span className="font-medium">{filename}</span>. Profile unchanged.
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-green-50 border border-green-200 rounded space-y-2">
      <p className="text-sm font-medium text-green-800">
        Evidence added from <span className="font-semibold">{filename}</span>
        <span className="ml-2 text-xs font-normal text-green-600">
          v{delta.profileVersionBefore} → v{delta.profileVersionAfter}
        </span>
      </p>
      <ul className="text-xs text-green-700 space-y-0.5">
        {delta.addedClaims.length > 0 && (
          <li>+{delta.addedClaims.length} experience claim{delta.addedClaims.length !== 1 ? 's' : ''}</li>
        )}
        {delta.addedSkills.length > 0 && (
          <li>+{delta.addedSkills.length} skill{delta.addedSkills.length !== 1 ? 's' : ''}</li>
        )}
        {delta.addedTools.length > 0 && (
          <li>+{delta.addedTools.length} tool{delta.addedTools.length !== 1 ? 's' : ''}</li>
        )}
        {delta.addedMetrics.length > 0 && (
          <li>+{delta.addedMetrics.length} metric{delta.addedMetrics.length !== 1 ? 's' : ''}</li>
        )}
        {delta.mergedClaims.length > 0 && (
          <li>{delta.mergedClaims.length} duplicate claim{delta.mergedClaims.length !== 1 ? 's' : ''} merged</li>
        )}
        {delta.unresolvedConflicts.length > 0 && (
          <li className="text-amber-700">
            {delta.unresolvedConflicts.length} conflict{delta.unresolvedConflicts.length !== 1 ? 's' : ''} flagged for review
          </li>
        )}
      </ul>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}
