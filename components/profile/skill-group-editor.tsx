'use client'
import { useState, useRef } from 'react'
import type { SkillGroup } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'
import { inputCls } from '@/lib/input-cls'
import { cn } from '@/lib/cn'

interface Props {
  groups: SkillGroup[]
  onChange: (groups: SkillGroup[]) => void
}

export function SkillGroupEditor({ groups, onChange }: Props) {
  function updateGroup(id: string, updates: Partial<SkillGroup>) {
    onChange(groups.map(g => g.id === id ? { ...g, ...updates } : g))
  }

  function removeGroup(id: string) {
    onChange(groups.filter(g => g.id !== id))
  }

  function addGroup() {
    onChange([...groups, { id: nanoid(), heading: 'New', skills: [] }])
  }

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <SkillGroupCard
          key={group.id}
          group={group}
          onChange={updates => updateGroup(group.id, updates)}
          onRemove={() => removeGroup(group.id)}
        />
      ))}
      <button
        type="button"
        onClick={addGroup}
        className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
      >
        + Add Group
      </button>
    </div>
  )
}

function SkillGroupCard({
  group, onChange, onRemove
}: {
  group: SkillGroup
  onChange: (updates: Partial<SkillGroup>) => void
  onRemove: () => void
}) {
  const [addingSkill, setAddingSkill] = useState(false)
  const [newSkill, setNewSkill] = useState('')
  const [editingHeading, setEditingHeading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleAddSkill() {
    const trimmed = newSkill.trim()
    if (!trimmed) return
    // Avoid duplicates within this group
    if (group.skills.map(s => s.toLowerCase()).includes(trimmed.toLowerCase())) {
      setNewSkill('')
      return
    }
    onChange({ skills: [...group.skills, trimmed] })
    setNewSkill('')
  }

  function removeSkill(skill: string) {
    onChange({ skills: group.skills.filter(s => s !== skill) })
  }

  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
      {/* Heading */}
      <div className="flex items-center justify-between mb-3">
        {editingHeading ? (
          <input
            autoFocus
            className={cn(inputCls, 'h-7 py-0 text-xs font-semibold w-32')}
            value={group.heading}
            onChange={e => onChange({ heading: e.target.value })}
            onBlur={() => setEditingHeading(false)}
            onKeyDown={e => e.key === 'Enter' && setEditingHeading(false)}
          />
        ) : (
          <button
            onClick={() => setEditingHeading(true)}
            className="text-xs font-semibold text-gray-700 uppercase tracking-wide hover:text-gray-900 cursor-text"
            title="Click to rename"
          >
            {group.heading}
          </button>
        )}
        <button
          onClick={onRemove}
          className="text-xs text-gray-300 hover:text-red-500 ml-2"
          title="Remove group"
        >
          ×
        </button>
      </div>

      {/* Skill pills */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {group.skills.map(skill => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700 group/pill"
          >
            {skill}
            <button
              onClick={() => removeSkill(skill)}
              className="text-gray-300 hover:text-red-500 leading-none opacity-0 group-hover/pill:opacity-100 transition-opacity"
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}

        {/* Add skill inline */}
        {addingSkill ? (
          <span className="inline-flex items-center gap-1">
            <input
              ref={inputRef}
              autoFocus
              className={cn(inputCls, 'h-6 py-0 px-2 text-xs w-36')}
              value={newSkill}
              placeholder="Add skill…"
              onChange={e => setNewSkill(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { handleAddSkill(); inputRef.current?.focus() }
                if (e.key === 'Escape') { setAddingSkill(false); setNewSkill('') }
              }}
              onBlur={() => { handleAddSkill(); setAddingSkill(false) }}
            />
          </span>
        ) : (
          <button
            onClick={() => setAddingSkill(true)}
            className="inline-flex items-center px-2 py-0.5 border border-dashed border-gray-300 rounded text-xs text-gray-400 hover:border-gray-500 hover:text-gray-600"
          >
            + skill
          </button>
        )}
      </div>
    </div>
  )
}
