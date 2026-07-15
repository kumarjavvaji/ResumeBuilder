'use client'
import { useEffect, useState } from 'react'
import { getUserProfile, saveUserProfile } from '@/lib/storage/user-profile'
import type { UserProfile, WorkEntry, SkillGroup } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'
import { Spinner } from '@/components/shared/spinner'
import { ProfileEvidenceUpload } from './profile-evidence-upload'
import { SkillGroupEditor } from './skill-group-editor'
import { inputCls, textareaCls } from '@/lib/input-cls'
import { emptySkillGroups } from '@/lib/skills/classify'

type ParsedBasics = Omit<UserProfile, 'id' | 'updatedAt' | 'constraints' | 'rejectedPhrases'>

const EMPTY_PROFILE: Omit<UserProfile, 'id' | 'updatedAt'> = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  linkedIn: '',
  summary: '',
  workHistory: [],
  education: [],
  skillGroups: emptySkillGroups(),
  skills: [],
  certifications: [],
  constraints: [
    'Resume must fit two pages.',
    'Prefer impact over volume.',
    'Do not invent claims or inflate experience.',
    'Avoid generic AI prose.',
    'Avoid phrases like "sits at the intersection of."',
    'Avoid puff language.'
  ],
  rejectedPhrases: [
    'sits at the intersection of',
    'thought leader',
    'synergy',
    'leverage',
    'game-changer',
    'paradigm shift'
  ]
}

export function ProfileForm() {
  const [profile, setProfile] = useState<Omit<UserProfile, 'id' | 'updatedAt'>>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [prefillBanner, setPrefillBanner] = useState(false)

  useEffect(() => {
    getUserProfile().then(p => {
      if (p) {
        const { id, updatedAt, ...rest } = p
        setProfile({
          ...EMPTY_PROFILE,
          ...rest,
          workHistory: (rest.workHistory ?? []).map(w => ({
            ...w,
            bullets: w.bullets ?? [],
            approvedMetrics: w.approvedMetrics ?? [],
            skills: w.skills ?? [],
            domain: w.domain ?? '',
          })),
          education:      rest.education      ?? EMPTY_PROFILE.education,
          certifications: rest.certifications ?? EMPTY_PROFILE.certifications,
          constraints:    rest.constraints    ?? EMPTY_PROFILE.constraints,
          rejectedPhrases: rest.rejectedPhrases ?? EMPTY_PROFILE.rejectedPhrases,
        })
      }
      setLoading(false)
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    await saveUserProfile(profile)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  /**
   * Prefill handler — only writes fields that are currently empty.
   * Never overwrites existing user-entered data.
   */
  function handlePrefillRequest(parsed: ParsedBasics) {
    setProfile(p => ({
      ...p,
      fullName: p.fullName || parsed.fullName || p.fullName,
      email: p.email || parsed.email || p.email,
      phone: p.phone || parsed.phone || p.phone,
      location: p.location || parsed.location || p.location,
      linkedIn: p.linkedIn || parsed.linkedIn || p.linkedIn,
      summary: p.summary || parsed.summary || p.summary,
      workHistory: p.workHistory.length === 0 ? (parsed.workHistory ?? []) : p.workHistory,
      education: p.education.length === 0 ? (parsed.education ?? []) : p.education,
      // skillGroups and skills: only prefill if user hasn't added any groups yet
      skillGroups: (p.skillGroups ?? []).every(g => g.skills.length === 0)
        ? (parsed.skillGroups ?? p.skillGroups)
        : p.skillGroups,
      // Preserve constraints and rejected phrases — user preferences, never overwritten
      constraints: p.constraints,
      rejectedPhrases: p.rejectedPhrases,
    }))
    setPrefillBanner(true)
    setTimeout(() => setPrefillBanner(false), 4000)
  }

  function addWorkEntry() {
    setProfile(p => ({
      ...p,
      workHistory: [...p.workHistory, {
        id: nanoid(),
        company: '',
        title: '',
        startDate: '',
        endDate: '',
        bullets: [],
        approvedMetrics: [],
        domain: '',
        skills: []
      }]
    }))
  }

  function updateWorkEntry(id: string, updates: Partial<WorkEntry>) {
    setProfile(p => ({
      ...p,
      workHistory: p.workHistory.map(w => w.id === id ? { ...w, ...updates } : w)
    }))
  }

  function removeWorkEntry(id: string) {
    setProfile(p => ({ ...p, workHistory: p.workHistory.filter(w => w.id !== id) }))
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>

  return (
    <div className="space-y-10">

      {/* Resume evidence upload — single upload surface */}
      <section>
        <div className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Add Resume Evidence</h2>
          <p className="mt-1 text-xs text-gray-400">
            Upload a resume to add claims, skills, metrics, and role evidence to your profile.
            Existing profile data is preserved — only new evidence is added.
          </p>
        </div>
        <ProfileEvidenceUpload onPrefillRequest={handlePrefillRequest} />
        {prefillBanner && (
          <div className="mt-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
            Empty fields filled from resume. Review below, then save.
          </div>
        )}
      </section>

      {/* Basic Info */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Basic Info</h2>
        <div className="grid grid-cols-2 gap-4">
          {(['fullName', 'email', 'phone', 'location', 'linkedIn'] as const).map(field => (
            <div key={field} className={field === 'fullName' ? 'col-span-2' : ''}>
              <label className="block text-sm font-medium mb-1 capitalize">
                {field === 'linkedIn' ? 'LinkedIn URL' : field.replace(/([A-Z])/g, ' $1')}
              </label>
              <input
                className={inputCls}
                value={profile[field]}
                onChange={e => setProfile(p => ({ ...p, [field]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-1">Skills</h2>
        <p className="text-xs text-gray-400 mb-4">
          Grouped by single-term ATS headings. Click a heading to rename it. Hover a skill pill to remove it.
        </p>
        <SkillGroupEditor
          groups={profile.skillGroups ?? []}
          onChange={skillGroups => setProfile(p => ({ ...p, skillGroups }))}
        />
      </section>

      {/* Work History */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Work History</h2>
          <button
            onClick={addWorkEntry}
            className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
          >
            + Add Role
          </button>
        </div>
        <div className="space-y-6">
          {profile.workHistory.map((w, i) => (
            <WorkEntryEditor
              key={w.id}
              entry={w}
              index={i}
              onChange={updates => updateWorkEntry(w.id, updates)}
              onRemove={() => removeWorkEntry(w.id)}
            />
          ))}
          {profile.workHistory.length === 0 && (
            <p className="text-sm text-gray-400">No roles yet. Add your most recent position.</p>
          )}
        </div>
      </section>

      {/* Constraints & Rejected Phrases */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Constraints</h2>
        <p className="text-xs text-gray-500 mb-2">One per line. Applied to all resume generation.</p>
        <textarea
          className={`${textareaCls} h-28`}
          value={profile.constraints.join('\n')}
          onChange={e => setProfile(p => ({
            ...p,
            constraints: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
          }))}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Rejected Phrases</h2>
        <p className="text-xs text-gray-500 mb-2">Phrases that should never appear in generated text. Comma-separated.</p>
        <textarea
          className={`${textareaCls} h-20`}
          value={profile.rejectedPhrases.join(', ')}
          onChange={e => setProfile(p => ({
            ...p,
            rejectedPhrases: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
          }))}
        />
      </section>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Spinner className="text-white" />}
          Save Profile
        </button>
        {saved && <span className="text-sm text-green-600">Saved.</span>}
      </div>
    </div>
  )
}

function WorkEntryEditor({
  entry, index, onChange, onRemove
}: {
  entry: WorkEntry
  index: number
  onChange: (updates: Partial<WorkEntry>) => void
  onRemove: () => void
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">Role {index + 1}</span>
        <button onClick={onRemove} className="text-xs text-red-500 hover:text-red-700">Remove</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Job Title" value={entry.title} onChange={v => onChange({ title: v })} />
        <Field label="Company" value={entry.company} onChange={v => onChange({ company: v })} />
        <Field label="Start Date" value={entry.startDate} placeholder="e.g. Jan 2021" onChange={v => onChange({ startDate: v })} />
        <Field label="End Date" value={entry.endDate as string} placeholder="e.g. Present" onChange={v => onChange({ endDate: v })} />
        <Field label="Domain / Industry" value={entry.domain} className="col-span-2" onChange={v => onChange({ domain: v })} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Skills at this role</label>
        <input
          className={inputCls}
          placeholder="Comma-separated"
          value={entry.skills.join(', ')}
          onChange={e => onChange({ skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Bullets</label>
        <p className="text-xs text-gray-400 mb-1">One per line. Write exactly what you want preserved.</p>
        <textarea
          className={`${textareaCls} h-28`}
          value={entry.bullets.join('\n')}
          onChange={e => onChange({ bullets: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Approved Metrics</label>
        <p className="text-xs text-gray-400 mb-1">Specific numbers you've validated and can claim. One per line.</p>
        <textarea
          className={`${textareaCls} h-16`}
          value={entry.approvedMetrics.join('\n')}
          onChange={e => onChange({ approvedMetrics: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
        />
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, className
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        className={inputCls}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
