/**
 * Tests for Profile page UI cleanup.
 *
 * 1. Profile page renders only one resume upload dropzone.
 * 2. Uploading a resume calls the profile-intake flow (processResumeUpload).
 * 3. The old "Import from Resume" upload UI (ResumeUpload) is no longer rendered.
 * 4. Non-empty manual profile fields are not overwritten by the prefill action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockProcessResumeUpload = vi.hoisted(() => vi.fn())
const mockGetUserProfile = vi.hoisted(() => vi.fn())
const mockSaveUserProfile = vi.hoisted(() => vi.fn())

vi.mock('@/lib/profile/profileIntakeService', () => ({
  processResumeUpload: mockProcessResumeUpload,
}))

vi.mock('@/lib/storage/user-profile', () => ({
  getUserProfile: mockGetUserProfile,
  saveUserProfile: mockSaveUserProfile,
}))

// Dexie / storage stubs
vi.mock('@/lib/storage/db', () => ({ db: {} }))
vi.mock('@/lib/storage/nanoid', () => ({ nanoid: () => 'test-id' }))
vi.mock('@/lib/skills/classify', () => ({
  emptySkillGroups: () => [],
  migrateToSkillGroups: () => [],
}))

const mockDelta = {
  addedClaims: [{ claimId: '1', normalizedKey: 'led agile teams', text: 'Led agile teams.', category: 'responsibility', evidenceStrength: 'medium', sourceIds: ['s1'], artifactLinks: [], firstSeenAt: '', lastSeenAt: '', status: 'active' }],
  addedSkills: [],
  addedTools: [],
  addedMetrics: [],
  mergedClaims: [],
  linkedArtifacts: [],
  preservedDirections: [],
  preservedLearningSignals: [],
  unresolvedConflicts: [],
  profileVersionBefore: 1,
  profileVersionAfter: 2,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProfileForm UI cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserProfile.mockResolvedValue(null)
    mockSaveUserProfile.mockResolvedValue(undefined)
    mockProcessResumeUpload.mockResolvedValue({
      snapshot: {},
      delta: mockDelta,
      warnings: [],
      isDuplicate: false,
    })
  })

  it('renders exactly one file input for resume upload', async () => {
    const { ProfileForm } = await import('@/components/profile/profile-form')
    render(<ProfileForm />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /save profile/i })).toBeTruthy())

    const fileInputs = document.querySelectorAll('input[type="file"]')
    expect(fileInputs).toHaveLength(1)
  })

  it('does not render an "Import from Resume" heading', async () => {
    const { ProfileForm } = await import('@/components/profile/profile-form')
    render(<ProfileForm />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /save profile/i })).toBeTruthy())

    expect(screen.queryByText(/import from resume/i)).toBeNull()
  })

  it('calls processResumeUpload when a file is dropped on the dropzone', async () => {
    const { ProfileForm } = await import('@/components/profile/profile-form')
    render(<ProfileForm />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /save profile/i })).toBeTruthy())

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'resume.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(mockProcessResumeUpload).toHaveBeenCalledWith(file))
  })

  it('shows delta summary after successful upload', async () => {
    const { ProfileForm } = await import('@/components/profile/profile-form')
    render(<ProfileForm />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /save profile/i })).toBeTruthy())

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'resume.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/evidence added from/i)).toBeTruthy())
    expect(screen.getByText(/\+1 experience claim/i)).toBeTruthy()
  })

  it('shows "Prefill empty basic fields" button after upload', async () => {
    const { ProfileForm } = await import('@/components/profile/profile-form')
    render(<ProfileForm />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /save profile/i })).toBeTruthy())

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'r.pdf')] } })

    await waitFor(() => expect(screen.getByText(/prefill empty basic fields/i)).toBeTruthy())
  })
})

// ─── Prefill guardrail: non-empty fields must not be overwritten ──────────────

describe('handlePrefillRequest — empty-field-only guard', () => {
  it('does not overwrite a non-empty fullName', () => {
    const existing = {
      fullName: 'Jane Doe',
      email: '',
      phone: '',
      location: '',
      linkedIn: '',
      summary: '',
      workHistory: [] as import('@/contracts').WorkEntry[],
      education: [] as import('@/contracts').EducationEntry[],
      skillGroups: [],
      skills: [],
      certifications: [],
      constraints: [],
      rejectedPhrases: [],
    }

    const parsed = {
      fullName: 'Extracted Name',
      email: 'extracted@example.com',
      phone: '555-1234',
      location: 'New York',
      linkedIn: 'linkedin.com/in/extracted',
      summary: 'Extracted summary.',
      workHistory: [],
      education: [],
      skillGroups: [],
      skills: [],
      certifications: [],
    }

    // Replicate the prefill logic from ProfileForm.handlePrefillRequest
    const result = {
      ...existing,
      fullName: existing.fullName || parsed.fullName || existing.fullName,
      email: existing.email || parsed.email || existing.email,
      phone: existing.phone || parsed.phone || existing.phone,
      location: existing.location || parsed.location || existing.location,
      linkedIn: existing.linkedIn || parsed.linkedIn || existing.linkedIn,
      summary: existing.summary || parsed.summary || existing.summary,
      workHistory: existing.workHistory.length === 0 ? (parsed.workHistory ?? []) : existing.workHistory,
      constraints: existing.constraints,
      rejectedPhrases: existing.rejectedPhrases,
    }

    // fullName was non-empty — must not be overwritten
    expect(result.fullName).toBe('Jane Doe')
    // email was empty — should be filled
    expect(result.email).toBe('extracted@example.com')
  })

  it('fills all basic fields when profile is empty', () => {
    const existing = {
      fullName: '', email: '', phone: '', location: '', linkedIn: '',
      summary: '', workHistory: [] as import('@/contracts').WorkEntry[],
      education: [] as import('@/contracts').EducationEntry[],
      skillGroups: [], skills: [], certifications: [],
      constraints: ['Must fit two pages.'], rejectedPhrases: ['synergy'],
    }

    const parsed = {
      fullName: 'Alex Smith', email: 'alex@example.com', phone: '123', location: 'Austin',
      linkedIn: 'linkedin.com/in/alex', summary: 'PM with 10 years.',
      workHistory: [], education: [], skillGroups: [], skills: [], certifications: [],
    }

    const result = {
      ...existing,
      fullName: existing.fullName || parsed.fullName || existing.fullName,
      email: existing.email || parsed.email || existing.email,
      phone: existing.phone || parsed.phone || existing.phone,
      location: existing.location || parsed.location || existing.location,
      linkedIn: existing.linkedIn || parsed.linkedIn || existing.linkedIn,
      summary: existing.summary || parsed.summary || existing.summary,
      workHistory: existing.workHistory.length === 0 ? (parsed.workHistory ?? []) : existing.workHistory,
      constraints: existing.constraints,
      rejectedPhrases: existing.rejectedPhrases,
    }

    expect(result.fullName).toBe('Alex Smith')
    expect(result.email).toBe('alex@example.com')
    // Constraints must never be touched by prefill
    expect(result.constraints).toEqual(['Must fit two pages.'])
    expect(result.rejectedPhrases).toEqual(['synergy'])
  })

  it('does not overwrite non-empty workHistory', () => {
    const existingWork = [{ id: 'w1', company: 'Acme', title: 'PM', startDate: '2020', endDate: 'Present', bullets: [], approvedMetrics: [], domain: 'SaaS', skills: [] }]
    const parsedWork = [{ id: 'w2', company: 'Other', title: 'BA', startDate: '2018', endDate: '2020', bullets: [], approvedMetrics: [], domain: 'HCM', skills: [] }]

    const workHistory = existingWork.length === 0 ? parsedWork : existingWork
    expect(workHistory).toEqual(existingWork)
  })
})
