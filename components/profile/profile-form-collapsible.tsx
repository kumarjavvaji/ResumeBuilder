'use client'
import { useState } from 'react'
import { ProfileForm } from './profile-form'

export function ProfileFormCollapsible() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-10 border-t border-gray-800 pt-6">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        <span>{open ? '▲' : '▼'}</span>
        <span className="font-medium">Edit Raw Profile Details</span>
        <span className="text-xs text-gray-600 ml-1">— basic info, work history, skills, constraints</span>
      </button>
      {open && (
        <div className="mt-6">
          <ProfileForm />
        </div>
      )}
    </div>
  )
}
