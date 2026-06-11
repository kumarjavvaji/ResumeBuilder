'use client'
import { useRef, useState } from 'react'
import type { UserProfile } from '@/contracts'
import { Spinner } from '@/components/shared/spinner'
import { cn } from '@/lib/cn'

interface Props {
  onParsed: (profile: Omit<UserProfile, 'id' | 'updatedAt' | 'constraints' | 'rejectedPhrases'>) => void
}

export function ResumeUpload({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')

  async function handleFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx', 'doc'].includes(ext ?? '')) {
      setError('Unsupported file type. Upload a PDF or DOCX.')
      return
    }

    setFileName(file.name)
    setError('')
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/parse-resume', { method: 'POST', body: formData })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error ?? 'Parse failed.')

      onParsed(json.profile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
      setFileName('')
    } finally {
      setLoading(false)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

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
          dragging
            ? 'border-gray-400 bg-gray-50'
            : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50',
          loading && 'opacity-60 cursor-not-allowed'
        )}
      >
        {loading ? (
          <><Spinner className="h-5 w-5" /><span className="text-gray-500">Parsing {fileName}...</span></>
        ) : (
          <>
            <UploadIcon />
            <span className="font-medium text-gray-700">Upload existing resume</span>
            <span className="text-xs text-gray-400">PDF or DOCX · drag and drop or click to browse</span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.doc"
        className="hidden"
        onChange={handleInputChange}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
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
