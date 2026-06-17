import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/storage/user-profile', () => ({
  getUserProfile: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/storage/sessions', () => ({
  saveSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/storage/nanoid', () => ({
  nanoid: () => 'test-id',
}))

const fallbackJson = JSON.stringify({
  export: {
    exportKind: 'diq_stage3_resume_builder_basis',
    domainBasis: { thesis: 'Deterministic fallback basis thesis.', keyThemes: ['fallback'] },
    resumePositioningBasis: { businessConcepts: ['fallback'], bridgeQuestions: [] },
    companyIndustryBasis: {
      calibrationSummary: 'Deterministic fallback basis.',
    },
  },
}, null, 2)

describe('Quick Start Company / Industry Basis UI diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows validation fallback warning, rejected preview, source label, and inserts fallback JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        domainIQJson: fallbackJson,
        mode: 'fallback',
        diagnostic: {
          mode: 'deterministic_fallback',
          providerConfigured: true,
          apiRouteReached: true,
          modelCallAttempted: true,
          modelCallSucceeded: true,
          parseSucceeded: true,
          validationSucceeded: false,
          retryAttempted: true,
          retrySucceeded: false,
          fallbackReason: 'validation_failed',
          validationErrors: ['problemSpace.operatingContext must use compact synthesized labels.'],
          rejectedAttemptNumber: 2,
          rejectedOutputPreview: '{ "problemSpace": { "operatingContext": ["too long"] } }',
          rejectedBasisPreview: '{ "problemSpace": { "operatingContext": ["too long"] } }',
        },
      }),
    }))

    const { IntakeForm } = await import('@/components/intake/intake-form')
    render(<IntakeForm />)

    fireEvent.change(screen.getByPlaceholderText('e.g. Senior Product Owner'), {
      target: { value: 'Technical Product Management Analyst' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Corp'), {
      target: { value: 'McDonalds' },
    })
    fireEvent.change(screen.getByPlaceholderText('Paste full job description here...'), {
      target: { value: 'Supply chain technology role with UAT and stakeholder governance.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Generate Quick Company Basis' }))

    await waitFor(() => {
      expect(screen.getByText('LLM synthesis failed validation; deterministic fallback inserted.')).toBeTruthy()
    })

    expect(screen.getByText(/fallbackReason: validation_failed/)).toBeTruthy()
    expect(screen.getAllByText(/problemSpace\.operatingContext must use compact synthesized labels/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Displayed JSON source: deterministic fallback/)).toBeTruthy()

    fireEvent.click(screen.getByText('Rejected LLM output preview'))
    expect(screen.getByText(/\{ "problemSpace": \{ "operatingContext": \["too long"\] \} \}/)).toBeTruthy()

    const jsonTextarea = Array.from(document.querySelectorAll('textarea'))
      .find(textarea => textarea.value.includes('diq_stage3_resume_builder_basis'))
    expect(jsonTextarea?.value).toContain('Deterministic fallback basis')
  })

  it('labels successful LLM output without fallback preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        domainIQJson: fallbackJson.replace('Deterministic fallback basis', 'LLM synthesis basis'),
        mode: 'llm',
        diagnostic: {
          mode: 'llm',
          providerConfigured: true,
          apiRouteReached: true,
          modelCallAttempted: true,
          modelCallSucceeded: true,
          parseSucceeded: true,
          validationSucceeded: true,
          retryAttempted: false,
          retrySucceeded: false,
          fallbackReason: '',
        },
      }),
    }))

    const { IntakeForm } = await import('@/components/intake/intake-form')
    render(<IntakeForm />)

    fireEvent.change(screen.getByPlaceholderText('e.g. Senior Product Owner'), {
      target: { value: 'Product Analyst' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Corp'), {
      target: { value: 'ExampleCo' },
    })
    fireEvent.change(screen.getByPlaceholderText('Paste full job description here...'), {
      target: { value: 'Product analytics role.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Generate Quick Company Basis' }))

    await waitFor(() => {
      expect(screen.getByText(/Displayed JSON source: LLM synthesis/)).toBeTruthy()
    })

    expect(screen.queryByText('LLM synthesis failed validation; deterministic fallback inserted.')).toBeNull()
    expect(screen.queryByText('Rejected LLM output preview')).toBeNull()
  })

  it('labels normalized LLM output without fallback warning', async () => {
    const normalizedJson = fallbackJson
      .replace('Deterministic fallback basis thesis.', 'Normalized LLM basis thesis.')
      .replace('Deterministic fallback basis.', 'Normalized LLM basis.')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        domainIQJson: normalizedJson,
        mode: 'llm_normalized',
        diagnostic: {
          mode: 'llm_normalized',
          providerConfigured: true,
          apiRouteReached: true,
          modelCallAttempted: true,
          modelCallSucceeded: true,
          parseSucceeded: true,
          validationSucceeded: true,
          normalizationAttempted: true,
          normalizationSucceeded: true,
          retryAttempted: false,
          retrySucceeded: false,
          fallbackReason: '',
          normalizedWarnings: ['Normalized after initial validation issue: problemSpace.operatingContext must use compact synthesized labels.'],
          displayedJsonSource: 'llm_normalized',
        },
      }),
    }))

    const { IntakeForm } = await import('@/components/intake/intake-form')
    render(<IntakeForm />)

    fireEvent.change(screen.getByPlaceholderText('e.g. Senior Product Owner'), {
      target: { value: 'Technical Product Management Analyst' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Corp'), {
      target: { value: 'McDonalds' },
    })
    fireEvent.change(screen.getByPlaceholderText('Paste full job description here...'), {
      target: { value: 'Supply chain technology role with UAT and stakeholder governance.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Generate Quick Company Basis' }))

    await waitFor(() => {
      expect(screen.getByText(/Displayed JSON source: LLM synthesis, normalized/)).toBeTruthy()
    })

    expect(screen.getByText(/normalizationAttempted: true/)).toBeTruthy()
    expect(screen.queryByText('LLM synthesis failed validation; deterministic fallback inserted.')).toBeNull()
    expect(screen.queryByText('Rejected LLM output preview')).toBeNull()

    const jsonTextarea = Array.from(document.querySelectorAll('textarea'))
      .find(textarea => textarea.value.includes('diq_stage3_resume_builder_basis'))
    expect(jsonTextarea?.value).toContain('Normalized LLM basis')
    expect(jsonTextarea?.value).not.toContain('Deterministic fallback basis')
  })
})
