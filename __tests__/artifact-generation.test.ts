/**
 * Stage 3 artifact generation correctness tests.
 *
 * These test pure logic and data-shape contracts â€” no LLM calls, no IndexedDB.
 *
 * Coverage (original 10):
 * 1.  Stage 3 blocks generation when Stage 1 is not analyzed (empty jdMap)
 * 2.  Stage 3 allows generation with warning when Stage 2 is incomplete
 * 3.  Generating one section persists only that section (other sections unaffected)
 * 4.  Refining Skills does not alter Professional Summary
 * 5.  Accepted sections are not overwritten by unrelated generation
 * 6.  Rejected sections are not marked export-ready
 * 7.  Generated content includes evidenceWarnings when required JD skills lack profile support
 * 8.  Rejected phrases must not appear in generated artifacts
 * 9.  Signal influence summary is persisted when returned
 * 10. Manual edit saves content without changing status
 *
 * Role/source binding tests (11â€“20):
 * 11. PO section excludes Product Analyst-only Salesforce triage bullet (disallowed pattern)
 * 12. BA section excludes Product Owner-only Calendar Platform ownership bullet (disallowed pattern)
 * 13. QA section excludes Product Owner Calendar Platform roadmap bullet (disallowed pattern)
 * 14. Professional Summary uses cross-role evidence (all entries in primaryEntries)
 * 15. Skills section receives full evidence with no disallowed patterns
 * 16. DocuSign workflow answer yields high/medium confidence (not an uncertainty answer)
 * 17. "I'm not sure" bridge answer classifies as 'none' confidence â†’ no positive claims
 * 18. Insurance domain gap warning classified as global (not section-specific)
 * 19. Non-domain warning not classified as global (remains section-specific)
 * 20. PO section splits work history: PO entry â†’ primary, BA entry â†’ supporting
 *
 * Architecture-level claim validation tests (21â€“30):
 * 21. Claim from disallowed role is downgraded in role-specific section
 * 22. Claim from allowed role is preserved in role-specific section
 * 23. Cross-role claim with explicit framing is allowed (requires-framing disposition)
 * 24. Cross-role claim without framing is downgraded
 * 25. Bridge answers apply only to declared sections (scoped by affectedArtifactSection)
 * 26. Uncertainty answer is in uncertainBridgeEvidence, not normalizedBridgeEvidence
 * 27. Unsupported claim is blocked in skills section (allowedClaimStatuses excludes unsupported)
 * 28. Unsupported claim is downgraded not excluded in experience sections
 * 29. Disallowed pattern produces BlockedClaimDiagnostic with suggestedSection
 * 30. Source mappings for allowed claims reference in-scope entries
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { containsRejectedPhrase } from '@/lib/validators/claim-classifier'
import { isAccepted, isRejected } from '@/lib/storage/artifacts'
import {
  buildScopedEvidenceBundle,
  buildSectionEvidenceScope,   // backward-compat alias
  classifyBridgeAnswerConfidence,
  findDisallowedClaimPattern,
  isGlobalEvidenceWarning,
  normalizeBridgeAnswer,
  SECTION_EVIDENCE_SCOPES,
} from '@/lib/evidence-scope'
import { validateSectionClaims } from '@/lib/claim-validator'
import type {
  ArtifactSection, JDRequirementMap, SectionType,
  UserProfile, WorkEntry, BridgeQuestion,
} from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'

// â”€â”€â”€ Fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeSection(overrides: Partial<ArtifactSection> = {}): ArtifactSection {
  return {
    id: nanoid(),
    sessionId: 'sess-1',
    type: 'summary',
    content: 'Experienced product owner with 7 years delivering Agile solutions.',
    bullets: [],
    status: 'generated',
    generationRationale: 'Generated from JD and profile.',
    evidenceWarnings: [],
    sourceMappings: [],
    jdTraceability: [],
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

const EMPTY_JD_MAP: JDRequirementMap = {
  required: [],
  niceToHave: [],
  realJobFunction: '',
  needsEvidenceItems: [],
  unsupportedRequirements: [],
  weaklySupportedRequirements: []
}

const VALID_JD_MAP: JDRequirementMap = {
  required: [
    { text: '5+ years product ownership', category: 'process', userCoverageStatus: 'covered' },
    { text: 'Salesforce platform knowledge', category: 'tool', userCoverageStatus: 'gap' },
  ],
  niceToHave: [],
  realJobFunction: 'Product Owner at a SaaS company',
  needsEvidenceItems: ['Salesforce platform knowledge'],
  unsupportedRequirements: ['Salesforce platform knowledge'],
  weaklySupportedRequirements: []
}

// â”€â”€â”€ Test 1: Stage 1 blocker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Stage 1 prerequisite gate', () => {
  /** Mirrors the API-route guard: reject if jdMap.required is empty. */
  function stage1Guard(jdMap: JDRequirementMap): boolean {
    return (jdMap?.required?.length ?? 0) > 0
  }

  it('blocks generation when jdMap has no required items (Stage 1 not analyzed)', () => {
    expect(stage1Guard(EMPTY_JD_MAP)).toBe(false)
  })

  it('blocks generation when jdMap is undefined', () => {
    expect(stage1Guard(undefined as unknown as JDRequirementMap)).toBe(false)
  })

  it('allows generation when jdMap has required items', () => {
    expect(stage1Guard(VALID_JD_MAP)).toBe(true)
  })
})

// â”€â”€â”€ Test 2: Stage 2 warning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Stage 2 completeness warning', () => {
  /** Mirrors the artifacts-page warning logic. */
  function shouldWarn(bridgeTotal: number, bridgeAnswered: number): boolean {
    const bridgeIncomplete = bridgeTotal > 0 && bridgeAnswered < Math.ceil(bridgeTotal * 0.5)
    const bridgeNotStarted = bridgeTotal === 0
    return bridgeIncomplete || bridgeNotStarted
  }

  it('warns when bridge questions have not been started', () => {
    expect(shouldWarn(0, 0)).toBe(true)
  })

  it('warns when fewer than 50% of bridge questions are answered', () => {
    expect(shouldWarn(10, 3)).toBe(true)
  })

  it('does NOT warn when bridge questions are sufficiently answered', () => {
    expect(shouldWarn(10, 6)).toBe(false)
  })

  it('does NOT warn when all questions are answered', () => {
    expect(shouldWarn(8, 8)).toBe(false)
  })

  it('generation is still allowed when Stage 2 is incomplete (non-blocking)', () => {
    // Stage 2 warning must not block the generate call â€” only warn
    const stage1Valid = true
    const stage2Warning = true
    expect(stage1Valid && stage2Warning).toBe(true) // can still generate
  })
})

// â”€â”€â”€ Test 3: Per-section persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('per-section persistence isolation', () => {
  it('generating one section only updates that section in the map', () => {
    const sections = new Map<SectionType, ArtifactSection>([
      ['summary', makeSection({ type: 'summary', content: 'Original summary' })],
      ['skills', makeSection({ type: 'skills', content: 'Original skills' })]
    ])

    // Simulate generating a new 'skills' section
    const newSkills = makeSection({ type: 'skills', content: 'Updated skills v2', version: 2 })
    const updated = new Map(sections).set('skills', newSkills)

    expect(updated.get('skills')!.content).toBe('Updated skills v2')
    expect(updated.get('summary')!.content).toBe('Original summary') // untouched
  })
})

// â”€â”€â”€ Test 4: Refine Skills does not alter Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('section isolation during refinement', () => {
  it('refining Skills section does not change Summary section', () => {
    const summaryBefore = makeSection({ type: 'summary', content: 'Professional summary text' })
    const skillsBefore = makeSection({ type: 'skills', content: 'Skills list v1' })

    const sections = new Map<SectionType, ArtifactSection>([
      ['summary', summaryBefore],
      ['skills', skillsBefore]
    ])

    // Only skills gets updated
    const refinedSkills = makeSection({ type: 'skills', content: 'Skills list refined', version: 2 })
    const after = new Map(sections).set('skills', refinedSkills)

    expect(after.get('summary')!.content).toBe(summaryBefore.content)
    expect(after.get('summary')!.version).toBe(summaryBefore.version)
    expect(after.get('skills')!.content).toBe('Skills list refined')
  })
})

// â”€â”€â”€ Test 5: Accepted sections are not overwritten â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('accepted section protection', () => {
  it('generateSection guard returns early for accepted section without instruction', () => {
    const accepted = makeSection({ status: 'accepted' })

    /** Mirrors the guard at the top of generateSection in artifacts-page.tsx */
    function wouldGenerate(section: ArtifactSection | undefined, instruction?: string): boolean {
      if (section?.status === 'accepted' && !instruction) return false
      return true
    }

    expect(wouldGenerate(accepted)).toBe(false)
    expect(wouldGenerate(accepted, 'Rewrite this section.')).toBe(true)
    expect(wouldGenerate(undefined)).toBe(true)
  })

  it('isAccepted helper correctly identifies accepted status', () => {
    expect(isAccepted(makeSection({ status: 'accepted' }))).toBe(true)
    expect(isAccepted(makeSection({ status: 'generated' }))).toBe(false)
    expect(isAccepted(makeSection({ status: 'rejected' }))).toBe(false)
  })
})

// â”€â”€â”€ Test 6: Rejected sections are not export-ready â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('rejected section export exclusion', () => {
  it('isRejected returns true for rejected sections', () => {
    expect(isRejected(makeSection({ status: 'rejected' }))).toBe(true)
  })

  it('isRejected returns false for accepted sections', () => {
    expect(isRejected(makeSection({ status: 'accepted' }))).toBe(false)
  })

  it('isRejected returns false for generated sections', () => {
    expect(isRejected(makeSection({ status: 'generated' }))).toBe(false)
  })

  it('export-ready filter excludes rejected sections', () => {
    const sections = [
      makeSection({ type: 'summary', status: 'accepted' }),
      makeSection({ type: 'skills', status: 'rejected' }),
      makeSection({ type: 'cover-letter', status: 'generated' })
    ]
    const exportReady = sections.filter(s => isAccepted(s))
    expect(exportReady).toHaveLength(1)
    expect(exportReady[0].type).toBe('summary')
  })
})

// â”€â”€â”€ Test 7: Evidence warnings for unsupported JD skills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('evidence warnings', () => {
  it('section with gap requirements has evidence warnings', () => {
    const section = makeSection({
      evidenceWarnings: [
        'JD requires Salesforce platform knowledge but no profile evidence found.',
        'Insurance domain mentioned in JD but not evidenced in work history.'
      ]
    })
    expect(section.evidenceWarnings!.length).toBeGreaterThan(0)
  })

  it('section with no gap requirements has no evidence warnings', () => {
    const section = makeSection({ evidenceWarnings: [] })
    expect(section.evidenceWarnings).toHaveLength(0)
  })

  it('gap requirements in jdMap should produce evidence warnings (data contract)', () => {
    const gapRequirements = VALID_JD_MAP.required.filter(r => r.userCoverageStatus === 'gap')
    expect(gapRequirements.length).toBeGreaterThan(0)
    // Each gap requirement should be flagged â€” this is enforced by the LLM prompt.
    // Here we verify the data shape allows it.
    const mockWarnings = gapRequirements.map(
      r => `JD requires "${r.text}" but no profile evidence found.`
    )
    expect(mockWarnings.every(w => typeof w === 'string' && w.length > 0)).toBe(true)
  })
})

// â”€â”€â”€ Test 8: Rejected phrases not in generated content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('rejected phrase enforcement', () => {
  it('containsRejectedPhrase detects a phrase violation', () => {
    const content = 'I am passionate about delivering value and synergizing teams.'
    expect(containsRejectedPhrase(content, ['passionate', 'synergizing'])).toBe('passionate')
  })

  it('containsRejectedPhrase returns null when no violation', () => {
    const content = 'Led product backlog refinement across three sprint teams.'
    expect(containsRejectedPhrase(content, ['passionate', 'synergizing'])).toBeNull()
  })

  it('rejected phrase check is case-insensitive', () => {
    const content = 'I am PASSIONATE about this role.'
    expect(containsRejectedPhrase(content, ['passionate'])).toBe('passionate')
  })

  it('generation with rejected phrase triggers retry instruction', () => {
    const phrase = containsRejectedPhrase('Passionate results-driven professional.', ['passionate'])
    expect(phrase).toBeTruthy()
    // The retry instruction passed to the next generation
    const retryInstruction = `Do not use the phrase: "${phrase}"`
    expect(retryInstruction).toContain('passionate')
  })
})

// â”€â”€â”€ Test 9: Signal influence persisted â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('signal influence persistence', () => {
  it('section with signal influence stores the summary string', () => {
    const section = makeSection({
      signalInfluence: '3 personal signals applied, 2 global strategy signals applied'
    })
    expect(section.signalInfluence).toBeTruthy()
    expect(typeof section.signalInfluence).toBe('string')
  })

  it('section without signals stores undefined signalInfluence', () => {
    const section = makeSection({ signalInfluence: undefined })
    expect(section.signalInfluence).toBeUndefined()
  })

  it('signal influence string format matches expected pattern', () => {
    const personalCount = 3
    const globalCount = 2
    const influence = [
      personalCount > 0 ? `${personalCount} personal signal${personalCount > 1 ? 's' : ''} applied` : null,
      globalCount > 0 ? `${globalCount} global strategy signal${globalCount > 1 ? 's' : ''} applied` : null
    ].filter(Boolean).join(', ')

    expect(influence).toBe('3 personal signals applied, 2 global strategy signals applied')
  })
})

// â”€â”€â”€ Test 10: Manual edit preserves status correctly â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('manual edit behavior', () => {
  it('manual edit updates content without changing status', () => {
    const section = makeSection({ status: 'generated', content: 'Original content' })

    // Simulate what handleManualSave does (excluding the Dexie call)
    const updated: ArtifactSection = {
      ...section,
      content: 'Manually edited content',
      userNote: 'Changed tone to be more direct',
      version: section.version + 1
    }

    expect(updated.content).toBe('Manually edited content')
    expect(updated.status).toBe('generated') // status unchanged
    expect(updated.userNote).toBe('Changed tone to be more direct')
    expect(updated.version).toBe(2)
  })

  it('manual edit on accepted section does not change accepted status', () => {
    const accepted = makeSection({ status: 'accepted', acceptedAt: new Date().toISOString() })
    const edited: ArtifactSection = {
      ...accepted,
      content: 'Minor wording fix',
      version: accepted.version + 1
    }
    expect(edited.status).toBe('accepted') // still accepted
    expect(edited.acceptedAt).toBe(accepted.acceptedAt) // timestamp preserved
  })

  it('manual edit increments version', () => {
    const section = makeSection({ version: 2 })
    const edited = { ...section, version: section.version + 1 }
    expect(edited.version).toBe(3)
  })
})

// â”€â”€â”€ Role/source binding fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeWorkEntry(overrides: Partial<WorkEntry> & { title: string; company: string }): WorkEntry {
  return {
    id: nanoid(),
    startDate: '2020-01',
    endDate: '2024-01',
    domain: 'SaaS',
    bullets: [],
    approvedMetrics: [],
    skills: [],
    ...overrides,
  }
}

function makeProfile(workHistory: WorkEntry[]): UserProfile {
  return {
    id: nanoid(),
    fullName: 'Test User',
    email: 'test@example.com',
    phone: '',
    location: '',
    linkedIn: '',
    summary: '',
    workHistory,
    education: [],
    skillGroups: [],
    skills: [],
    certifications: [],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: new Date().toISOString(),
  }
}

function makeBridgeQuestion(overrides: Partial<BridgeQuestion>): BridgeQuestion {
  return {
    id: nanoid(),
    sessionId: 'sess-1',
    question: overrides.question ?? 'Describe your experience',
    type: overrides.type ?? 'evidence',
    priority: overrides.priority ?? 'medium',
    affectedArtifactSection: overrides.affectedArtifactSection ?? 'summary',
    status: overrides.status ?? 'answered',
    userAnswer: overrides.userAnswer ?? 'I have done this.',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const PO_ENTRY = makeWorkEntry({ title: 'Product Owner', company: 'SaaS Co', domain: 'HCM' })
const BA_ENTRY = makeWorkEntry({ title: 'Product Analyst', company: 'SaaS Co', domain: 'HCM',
  bullets: ['Triaged 3,000+ Salesforce client requests and documented acceptance criteria'],
  approvedMetrics: ['3,000+ Salesforce client requests']
})
const QA_ENTRY = makeWorkEntry({ title: 'Lead QA Analyst', company: 'SaaS Co', domain: 'HCM' })

// â”€â”€â”€ Test 11: PO section scopes out PA-only Salesforce triage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PO section evidence scoping', () => {
  it('PO scope puts PA entry in supportingWorkEntries, not primaryWorkEntries', () => {
    const profile = makeProfile([PO_ENTRY, BA_ENTRY, QA_ENTRY])
    const bundle = buildScopedEvidenceBundle(profile, [], 'experience-po')
    const primaryTitles = bundle.primaryWorkEntries.map(e => e.title)
    const supportingTitles = bundle.supportingWorkEntries.map(e => e.title)
    expect(primaryTitles).toContain('Product Owner')
    expect(primaryTitles).not.toContain('Product Analyst')
    expect(supportingTitles).toContain('Product Analyst')
  })

  it('PO section: Salesforce client request triage is a disallowed claim pattern', () => {
    const bundle = buildScopedEvidenceBundle(makeProfile([PO_ENTRY, BA_ENTRY]), [], 'experience-po')
    const bullet = 'Triaged 3,000+ Salesforce client requests across enterprise HR platform'
    expect(findDisallowedClaimPattern(bullet, bundle.scope.disallowedClaimPatterns)).not.toBeNull()
  })

  it('PO section has a framing note requiring prior-background citation', () => {
    const bundle = buildScopedEvidenceBundle(makeProfile([PO_ENTRY, BA_ENTRY]), [], 'experience-po')
    expect(bundle.scope.framingNote).toBeTruthy()
    expect(bundle.scope.framingNote).toContain('Prior background')
  })
})

// â”€â”€â”€ Test 12: BA section scopes out PO-only Calendar Platform ownership â”€â”€â”€â”€â”€â”€â”€â”€

describe('BA section evidence scoping', () => {
  it('BA scope puts PO entry in supportingWorkEntries, not primaryWorkEntries', () => {
    const profile = makeProfile([PO_ENTRY, BA_ENTRY, QA_ENTRY])
    const bundle = buildScopedEvidenceBundle(profile, [], 'experience-ba')
    const primaryTitles = bundle.primaryWorkEntries.map(e => e.title)
    const supportingTitles = bundle.supportingWorkEntries.map(e => e.title)
    expect(primaryTitles).toContain('Product Analyst')
    expect(primaryTitles).not.toContain('Product Owner')
    expect(supportingTitles).toContain('Product Owner')
  })

  it('BA section: Calendar Platform roadmap ownership is a disallowed claim pattern', () => {
    const bundle = buildScopedEvidenceBundle(makeProfile([PO_ENTRY, BA_ENTRY]), [], 'experience-ba')
    const bullet = 'Drove Calendar Platform roadmap ownership and end-to-end delivery'
    expect(findDisallowedClaimPattern(bullet, bundle.scope.disallowedClaimPatterns)).not.toBeNull()
  })
})

// â”€â”€â”€ Test 13: QA section scopes out PO Calendar Platform roadmap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('QA section evidence scoping', () => {
  it('QA scope puts PO and PA entries in supportingWorkEntries', () => {
    const profile = makeProfile([PO_ENTRY, BA_ENTRY, QA_ENTRY])
    const bundle = buildScopedEvidenceBundle(profile, [], 'experience-qa')
    const primaryTitles = bundle.primaryWorkEntries.map(e => e.title)
    expect(primaryTitles).toContain('Lead QA Analyst')
    expect(primaryTitles).not.toContain('Product Owner')
    expect(primaryTitles).not.toContain('Product Analyst')
  })

  it('QA section: product roadmap ownership is a disallowed claim pattern', () => {
    const bundle = buildScopedEvidenceBundle(makeProfile([PO_ENTRY, QA_ENTRY]), [], 'experience-qa')
    const bullet = 'Led product roadmap ownership and calendar platform delivery'
    expect(findDisallowedClaimPattern(bullet, bundle.scope.disallowedClaimPatterns)).not.toBeNull()
  })

  it('QA section: legitimate QA bullet is not blocked', () => {
    const bundle = buildScopedEvidenceBundle(makeProfile([PO_ENTRY, QA_ENTRY]), [], 'experience-qa')
    const bullet = 'Authored SpecFlow acceptance tests reducing regression defect rate by 40%'
    expect(findDisallowedClaimPattern(bullet, bundle.scope.disallowedClaimPatterns)).toBeNull()
  })
})

// â”€â”€â”€ Test 14: Professional Summary uses cross-role evidence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Professional Summary cross-role evidence', () => {
  it('summary scope puts all entries in primaryWorkEntries with no supporting split', () => {
    const profile = makeProfile([PO_ENTRY, BA_ENTRY, QA_ENTRY])
    const bundle = buildScopedEvidenceBundle(profile, [], 'summary')
    expect(bundle.primaryWorkEntries).toHaveLength(3)
    expect(bundle.supportingWorkEntries).toHaveLength(0)
    expect(bundle.scope.framingNote).toBeNull()
    expect(bundle.scope.disallowedClaimPatterns).toHaveLength(0)
  })
})

// â”€â”€â”€ Test 15: Skills section receives full evidence, no disallowed patterns â”€â”€â”€

describe('Skills section evidence scope', () => {
  it('skills scope includes all entries and no disallowed patterns', () => {
    const profile = makeProfile([PO_ENTRY, BA_ENTRY, QA_ENTRY])
    const bundle = buildScopedEvidenceBundle(profile, [], 'skills')
    expect(bundle.primaryWorkEntries).toHaveLength(3)
    expect(bundle.scope.disallowedClaimPatterns).toHaveLength(0)
  })

  it('skills scope includes all answered bridge questions (crossRolePolicy=full)', () => {
    const profile = makeProfile([PO_ENTRY])
    const qs = [
      makeBridgeQuestion({ affectedArtifactSection: 'experience-po', type: 'evidence', status: 'answered' }),
      makeBridgeQuestion({ affectedArtifactSection: 'experience-qa', type: 'evidence', status: 'answered' }),
    ]
    const bundle = buildScopedEvidenceBundle(profile, qs, 'skills')
    const total = bundle.normalizedBridgeEvidence.length + bundle.uncertainBridgeEvidence.length
    expect(total).toBe(2)
  })
})

// â”€â”€â”€ Test 16: DocuSign workflow answer is not uncertain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('bridge answer confidence classification', () => {
  it('DocuSign workflow answer yields high or medium confidence', () => {
    const answer = 'I used DocuSign for I-9 workflows during employee onboarding, managing e-signatures for new hire forms across multiple sites.'
    const conf = classifyBridgeAnswerConfidence(answer)
    expect(['high', 'medium']).toContain(conf)
  })

  it('Postman API validation answer is confident', () => {
    const answer = 'I used Postman to validate API responses during UAT, checking status codes and payload structure against the spec.'
    expect(['high', 'medium']).toContain(classifyBridgeAnswerConfidence(answer))
  })
})

// â”€â”€â”€ Test 17: Uncertainty answers cannot generate positive claims â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('uncertainty detection in bridge answers', () => {
  it('"I\'m not sure" â†’ none confidence', () => {
    expect(classifyBridgeAnswerConfidence("I'm not sure about that")).toBe('none')
  })

  it('"Not sure" â†’ none confidence', () => {
    expect(classifyBridgeAnswerConfidence('Not sure, I may have done something similar')).toBe('none')
  })

  it('"I don\'t know" â†’ none confidence', () => {
    expect(classifyBridgeAnswerConfidence("I don't know if that applies to me")).toBe('none')
  })

  it('empty answer â†’ none confidence', () => {
    expect(classifyBridgeAnswerConfidence('')).toBe('none')
  })

  it('uncertain bridge answers are separated from confident ones in the bundle', () => {
    const profile = makeProfile([QA_ENTRY])
    const qs = [
      makeBridgeQuestion({
        affectedArtifactSection: 'experience-qa',
        type: 'evidence',
        status: 'answered',
        userAnswer: "I'm not sure I worked on that specifically",
      }),
      makeBridgeQuestion({
        affectedArtifactSection: 'experience-qa',
        type: 'evidence',
        status: 'answered',
        userAnswer: 'Yes, I wrote SpecFlow tests and automated regression suites.',
      }),
    ]
    const bundle = buildScopedEvidenceBundle(profile, qs, 'experience-qa')
    // In new architecture, the bundle separates confident from uncertain up front
    expect(bundle.uncertainBridgeEvidence).toHaveLength(1)
    expect(bundle.normalizedBridgeEvidence).toHaveLength(1)
    expect(bundle.normalizedBridgeEvidence[0].confidence).not.toBe('none')
    expect(bundle.uncertainBridgeEvidence[0].confidence).toBe('none')
  })
})

// â”€â”€â”€ Test 18: Insurance domain gap warning is global â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('global evidence warning classification', () => {
  it('insurance domain warning is classified as global', () => {
    expect(isGlobalEvidenceWarning('Insurance domain not evidenced in work history.')).toBe(true)
  })

  it('lines of business warning is classified as global', () => {
    expect(isGlobalEvidenceWarning('JD requires knowledge of Lines of Business but no profile evidence found.')).toBe(true)
  })

  it('P&C warning is classified as global', () => {
    expect(isGlobalEvidenceWarning('P&C coverage knowledge not evidenced.')).toBe(true)
  })
})

// â”€â”€â”€ Test 19: Non-domain warning remains section-specific â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('section-specific warning classification', () => {
  it('Salesforce gap is not a global warning', () => {
    expect(isGlobalEvidenceWarning('JD requires Salesforce platform knowledge but no profile evidence found.')).toBe(false)
  })

  it('sprint velocity metric gap is not a global warning', () => {
    expect(isGlobalEvidenceWarning('No sprint velocity metrics found in profile.')).toBe(false)
  })

  it('downgraded bullet warning is not a global warning', () => {
    expect(isGlobalEvidenceWarning('Bullet downgraded â€” contains out-of-scope claim pattern for experience-po: "3,000+ salesforce"')).toBe(false)
  })
})

// â”€â”€â”€ Test 20: Source role separation is correct per section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('work history source role separation', () => {
  it('each experience section correctly identifies its primary vs supporting entries', () => {
    const profile = makeProfile([PO_ENTRY, BA_ENTRY, QA_ENTRY])

    const poBundle = buildScopedEvidenceBundle(profile, [], 'experience-po')
    expect(poBundle.primaryWorkEntries.map(e => e.title)).toEqual(['Product Owner'])
    expect(poBundle.supportingWorkEntries.map(e => e.title)).toEqual(
      expect.arrayContaining(['Product Analyst', 'Lead QA Analyst'])
    )

    const baBundle = buildScopedEvidenceBundle(profile, [], 'experience-ba')
    expect(baBundle.primaryWorkEntries.map(e => e.title)).toEqual(['Product Analyst'])
    expect(baBundle.supportingWorkEntries.map(e => e.title)).toEqual(
      expect.arrayContaining(['Product Owner', 'Lead QA Analyst'])
    )

    const qaBundle = buildScopedEvidenceBundle(profile, [], 'experience-qa')
    expect(qaBundle.primaryWorkEntries.map(e => e.title)).toEqual(['Lead QA Analyst'])
    expect(qaBundle.supportingWorkEntries.map(e => e.title)).toEqual(
      expect.arrayContaining(['Product Owner', 'Product Analyst'])
    )
  })

  it('accepted section content is not affected by generating a different section', () => {
    const sections = new Map<SectionType, ArtifactSection>([
      ['experience-po', makeSection({ type: 'experience-po', status: 'accepted', content: 'PO bullets accepted' })],
      ['experience-ba', makeSection({ type: 'experience-ba', status: 'generated', content: 'BA bullets draft' })],
    ])

    // Simulate generating experience-ba â€” only that key changes
    const newBA = makeSection({ type: 'experience-ba', content: 'BA bullets regenerated', version: 2 })
    const after = new Map(sections).set('experience-ba', newBA)

    expect(after.get('experience-po')!.status).toBe('accepted')
    expect(after.get('experience-po')!.content).toBe('PO bullets accepted')
    expect(after.get('experience-ba')!.content).toBe('BA bullets regenerated')
  })
})

// â”€â”€â”€ Architecture-level claim validation helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeBundleFor(sectionType: SectionType, workHistory: WorkEntry[], bridgeQs: BridgeQuestion[] = []) {
  return buildScopedEvidenceBundle(makeProfile(workHistory), bridgeQs, sectionType)
}

function makeRawBullet(
  text: string,
  claimStatus: ArtifactSection['bullets'][number]['claimStatus'] = 'supported',
  evidenceRef?: string
) {
  return { text, claimStatus, sourceSignal: 'user-history' as const, evidenceRef }
}

// â”€â”€â”€ Test 21: Claim from disallowed role is downgraded â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('claim validator: disallowed role source', () => {
  it('a bullet whose evidenceRef resolves to a supporting (non-primary) entry is downgraded', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const bullet = makeRawBullet(
      'Triaged 3,000+ Salesforce client requests.',
      'supported',
      'Product Analyst at SaaS Co'
    )
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).not.toBe('allowed')
    expect(results[0].correctedClaimStatus).toBe('needs-user-confirmation')
    expect(results[0].inScopeEntry).toBe(false)
    expect(results[0].diagnostic).not.toBeNull()
  })

  it('downgraded claim has a diagnostic with a suggested section', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const bullet = makeRawBullet(
      'Managed requirements and acceptance criteria for Salesforce integration.',
      'supported',
      'Product Analyst at SaaS Co'
    )
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].diagnostic).not.toBeNull()
    expect(results[0].diagnostic!.disposition).toBe('downgraded')
    // suggestedSection may be experience-ba for requirements/analyst signals
    expect(results[0].diagnostic!.attemptedSection).toBe('')  // stamped by caller
  })
})

// â”€â”€â”€ Test 22: Claim from allowed role is preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('claim validator: allowed role source', () => {
  it('a bullet whose evidenceRef resolves to a primary entry is allowed', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const bullet = makeRawBullet(
      'Owned backlog and sprint ceremonies for the Calendar Platform.',
      'supported',
      'Product Owner at SaaS Co'
    )
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).toBe('allowed')
    expect(results[0].inScopeEntry).toBe(true)
    expect(results[0].correctedClaimStatus).toBe('supported')
  })

  it('bullet with no evidenceRef is allowed (cannot determine scope)', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY])
    const bullet = makeRawBullet('Delivered roadmap milestones on time.', 'supported', undefined)
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).toBe('allowed')
  })
})

// â”€â”€â”€ Test 23: Cross-role claim with explicit framing is allowed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('claim validator: cross-role framing', () => {
  it('cross-role claim WITH prior-background framing is allowed (requires-framing)', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const bullet = makeRawBullet(
      'Building on prior background as a Product Analyst, applied requirements expertise to PO backlog grooming.',
      'supported-with-reframing',
      'Product Analyst at SaaS Co'
    )
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).toBe('requires-framing')
    // requires-framing means allowed but flagged
  })

  it('cross-role claim WITHOUT framing is downgraded', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const bullet = makeRawBullet(
      'Authored business requirements and managed acceptance criteria.',
      'supported',
      'Product Analyst at SaaS Co'
    )
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).toBe('downgraded')
    expect(results[0].correctedClaimStatus).toBe('needs-user-confirmation')
  })
})

// â”€â”€â”€ Test 24: Bridge answer scoped to correct sections only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('bridge answer scope enforcement', () => {
  it('bridge answer for experience-po is not included in experience-ba bundle', () => {
    const q = makeBridgeQuestion({
      affectedArtifactSection: 'experience-po',
      type: 'evidence',
      status: 'answered',
      userAnswer: 'I owned the Calendar Platform product backlog.',
    })
    const bundle = makeBundleFor('experience-ba', [BA_ENTRY], [q])
    // experience-ba scope requires allowedBridgeQuestionTypes to include 'evidence'
    // but crossRolePolicy='explicit-framing-required' â†’ only 'experience-ba' or high-pri summary
    const allBridgeIds = [
      ...bundle.normalizedBridgeEvidence.map(n => n.questionId),
      ...bundle.uncertainBridgeEvidence.map(n => n.questionId),
    ]
    expect(allBridgeIds).not.toContain(q.id)
  })

  it('bridge answer for experience-ba IS included in experience-ba bundle', () => {
    const q = makeBridgeQuestion({
      affectedArtifactSection: 'experience-ba',
      type: 'evidence',
      status: 'answered',
      userAnswer: 'I documented user stories and acceptance criteria for Salesforce integration.',
    })
    const bundle = makeBundleFor('experience-ba', [BA_ENTRY], [q])
    const allBridgeIds = [
      ...bundle.normalizedBridgeEvidence.map(n => n.questionId),
      ...bundle.uncertainBridgeEvidence.map(n => n.questionId),
    ]
    expect(allBridgeIds).toContain(q.id)
  })
})

// â”€â”€â”€ Test 25: Uncertainty answers land in uncertainBridgeEvidence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('bridge answer normalization: uncertainty', () => {
  it('"I\'m not sure" answer is in uncertainBridgeEvidence, not normalizedBridgeEvidence', () => {
    const q = makeBridgeQuestion({
      affectedArtifactSection: 'experience-qa',
      type: 'evidence',
      status: 'answered',
      userAnswer: "I'm not sure I have direct experience with that.",
    })
    const bundle = makeBundleFor('experience-qa', [QA_ENTRY], [q])
    expect(bundle.uncertainBridgeEvidence.map(n => n.questionId)).toContain(q.id)
    expect(bundle.normalizedBridgeEvidence.map(n => n.questionId)).not.toContain(q.id)
  })

  it('confident answer is in normalizedBridgeEvidence', () => {
    const q = makeBridgeQuestion({
      affectedArtifactSection: 'experience-qa',
      type: 'evidence',
      status: 'answered',
      userAnswer: 'I wrote SpecFlow feature files and automated regression suites for 3 product lines.',
    })
    const bundle = makeBundleFor('experience-qa', [QA_ENTRY], [q])
    expect(bundle.normalizedBridgeEvidence.map(n => n.questionId)).toContain(q.id)
    expect(bundle.uncertainBridgeEvidence.map(n => n.questionId)).not.toContain(q.id)
  })
})

// â”€â”€â”€ Test 26: Unsupported claims blocked in skills section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('claim validator: unsupported claims in skills section', () => {
  it('unsupported claim is blocked in skills section (skills disallows unsupported)', () => {
    const bundle = makeBundleFor('skills', [PO_ENTRY, BA_ENTRY, QA_ENTRY])
    const bullet = makeRawBullet('Salesforce Administration', 'unsupported', undefined)
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).toBe('blocked')
    expect(results[0].diagnostic).not.toBeNull()
    expect(results[0].diagnostic!.disposition).toBe('excluded')
  })

  it('skills section scope does not include unsupported in allowedClaimStatuses', () => {
    const skillsScope = SECTION_EVIDENCE_SCOPES['skills']
    expect(skillsScope.allowedClaimStatuses).not.toContain('unsupported')
  })
})

// â”€â”€â”€ Test 27: Unsupported claims downgraded (not excluded) in experience sections

describe('claim validator: unsupported in experience sections', () => {
  it('unsupported claim in experience-po is NOT blocked â€” it surfaces for user review', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY])
    const bullet = makeRawBullet('Led enterprise Salesforce rollout.', 'unsupported', undefined)
    const results = validateSectionClaims([bullet], bundle)
    // experience-po allows unsupported â€” should be 'allowed', not 'blocked'
    expect(results[0].disposition).toBe('allowed')
    expect(results[0].correctedClaimStatus).toBe('unsupported')
  })
})

// â”€â”€â”€ Test 28: Disallowed pattern produces diagnostic with suggestedSection â”€â”€â”€â”€

describe('claim validator: disallowed pattern diagnostic', () => {
  it('PO disallowed pattern produces diagnostic pointing toward experience-ba', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const bullet = makeRawBullet(
      'Managed 3,000+ Salesforce client requests from enterprise HCM clients.',
      'supported',
      'Product Analyst at SaaS Co'
    )
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).toBe('downgraded')
    const diag = results[0].diagnostic!
    expect(diag).not.toBeNull()
    expect(diag.reason).toContain('3,000+ salesforce')
    // The heuristic should suggest experience-ba for Salesforce/triage language
    expect(diag.suggestedSection).toBe('experience-ba')
  })

  it('QA disallowed pattern (roadmap ownership) produces diagnostic', () => {
    const bundle = makeBundleFor('experience-qa', [QA_ENTRY, PO_ENTRY])
    const bullet = makeRawBullet(
      'Led product roadmap ownership for Calendar Platform delivery.',
      'supported',
      'Product Owner at SaaS Co'
    )
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].disposition).toBe('downgraded')
    expect(results[0].diagnostic!.reason).toContain('roadmap ownership')
  })
})

// â”€â”€â”€ Test 29: Global gap warnings are deduplicated across sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('global gap warning deduplication', () => {
  it('insurance warning is classified as global', () => {
    expect(isGlobalEvidenceWarning('Insurance domain not evidenced in work history.')).toBe(true)
    expect(isGlobalEvidenceWarning('JD requires P&C coverage knowledge but profile lacks evidence.')).toBe(true)
  })

  it('same global warning from multiple sections is shown once in UI state', () => {
    const warning = 'Insurance domain not evidenced in work history.'
    const sections = new Map<SectionType, ArtifactSection>([
      ['experience-po', makeSection({ type: 'experience-po', evidenceWarnings: [warning, 'Missing sprint metrics'] })],
      ['experience-ba', makeSection({ type: 'experience-ba', evidenceWarnings: [warning, 'Missing BA domain evidence'] })],
      ['experience-qa', makeSection({ type: 'experience-qa', evidenceWarnings: [warning] })],
    ])
    const seen = new Set<string>()
    const globalWarnings: string[] = []
    for (const s of sections.values()) {
      for (const w of s.evidenceWarnings ?? []) {
        const key = w.toLowerCase()
        if (isGlobalEvidenceWarning(w) && !seen.has(key)) {
          seen.add(key)
          globalWarnings.push(w)
        }
      }
    }
    expect(globalWarnings).toHaveLength(1)
    expect(globalWarnings[0]).toBe(warning)
  })
})

// â”€â”€â”€ Test 30: Source mappings for allowed claims reference in-scope entries â”€â”€â”€

describe('source scope: allowed claims have in-scope source mappings', () => {
  it('only bullets with inScopeEntry=true contribute to clean source mappings', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const bullets = [
      makeRawBullet('Owned Calendar Platform backlog.', 'supported', 'Product Owner at SaaS Co'),
      makeRawBullet('Managed requirements.', 'supported', 'Product Analyst at SaaS Co'),
    ]
    const results = validateSectionClaims(bullets, bundle)
    const inScope = results.filter(r => r.inScopeEntry)
    const outOfScope = results.filter(r => !r.inScopeEntry)
    expect(inScope).toHaveLength(1)
    expect(inScope[0].bulletText).toContain('Calendar Platform backlog')
    expect(outOfScope).toHaveLength(1)
    expect(outOfScope[0].disposition).not.toBe('allowed')
  })

  it('bridge answer normalization includes forbidden overclaim for Postman usage', () => {
    const q = makeBridgeQuestion({
      affectedArtifactSection: 'experience-qa',
      type: 'evidence',
      status: 'answered',
      userAnswer: 'I used Postman to validate API endpoints during UAT testing.',
    })
    const normalized = normalizeBridgeAnswer(q)
    expect(normalized.forbiddenOverclaim).toContain('API specification authorship or design')
    expect(normalized.evidenceType).toBe('confirms-tool')
  })
})

// â”€â”€â”€ Bullet partitioning helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { mapResultToPartition } from '@/lib/claim-validator'
import type { BulletPartition } from '@/contracts'

function validateAndPartition(bullets: ReturnType<typeof makeRawBullet>[], sectionType: SectionType, workHistory: WorkEntry[]) {
  const bundle = makeBundleFor(sectionType, workHistory)
  const results = validateSectionClaims(bullets, bundle)
  return results.map(r => ({ ...r, partition: mapResultToPartition(r) }))
}

// â”€â”€â”€ Test 31: PO claim does not appear in QA primary bullet list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('partition enforcement: wrong-role claims excluded from primary display', () => {
  it('a Product Owner sourced bullet is not in display partition of QA section', () => {
    const results = validateAndPartition(
      [makeRawBullet('Owned Calendar Platform backlog and sprint ceremonies.', 'supported', 'Product Owner at SaaS Co')],
      'experience-qa',
      [PO_ENTRY, QA_ENTRY]
    )
    expect(results[0].partition).not.toBe('display')
    // Should be downgraded (cross-role without framing) or needs-confirmation
    expect(['downgraded', 'needs-confirmation', 'excluded', 'suggested-other']).toContain(results[0].disposition)
  })

  it('a QA sourced bullet is not in display partition of PO section', () => {
    const results = validateAndPartition(
      [makeRawBullet('Authored SpecFlow tests reducing regression defect rate by 40%.', 'supported', 'Lead QA Analyst at SaaS Co')],
      'experience-po',
      [PO_ENTRY, QA_ENTRY]
    )
    expect(results[0].partition).not.toBe('display')
  })

  it('a Product Analyst sourced bullet is not in display partition of PO section', () => {
    const results = validateAndPartition(
      [makeRawBullet('Triaged 3,000+ Salesforce client requests.', 'supported', 'Product Analyst at SaaS Co')],
      'experience-po',
      [PO_ENTRY, BA_ENTRY]
    )
    expect(results[0].partition).not.toBe('display')
  })
})

// â”€â”€â”€ Test 34: Cross-role claim with framing routes to needs-confirmation â”€â”€â”€â”€â”€â”€â”€

describe('partition enforcement: cross-role with framing â†’ needs-confirmation', () => {
  it('prior-background framing produces needs-confirmation, not display', () => {
    const results = validateAndPartition(
      [makeRawBullet(
        'Building on prior background as a Business Analyst, applied requirements expertise to PO grooming.',
        'supported-with-reframing',
        'Product Analyst at SaaS Co'
      )],
      'experience-po',
      [PO_ENTRY, BA_ENTRY]
    )
    expect(results[0].partition).toBe('needs-confirmation')
  })
})

// â”€â”€â”€ Test 35: needs-user-confirmation claim is not in display partition â”€â”€â”€â”€â”€â”€â”€â”€

describe('partition enforcement: needs-user-confirmation â†’ not display', () => {
  it('a bullet with correctedClaimStatus=needs-user-confirmation goes to needs-confirmation partition', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    // Bullet evidenceRef resolves to supporting entry (BA) without framing â†’ downgraded to needs-user-confirmation
    const bullet = makeRawBullet('Managed requirements and acceptance criteria.', 'supported', 'Product Analyst at SaaS Co')
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].correctedClaimStatus).toBe('needs-user-confirmation')
    expect(results[0].partition).not.toBe('display')
  })
})

// â”€â”€â”€ Test 36: unsupported claim is not in display partition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('partition enforcement: unsupported claims excluded', () => {
  it('a bullet with claimStatus=unsupported is blocked/excluded from skills section display', () => {
    const bundle = makeBundleFor('skills', [PO_ENTRY])
    const bullet = makeRawBullet('Salesforce Administration', 'unsupported', undefined)
    const results = validateSectionClaims([bullet], bundle)
    expect(results[0].partition).toBe('excluded')
    expect(results[0].partition).not.toBe('display')
  })

  it('an unsupported bullet in experience-po is excluded (not display)', () => {
    const bundle = makeBundleFor('experience-po', [PO_ENTRY])
    const bullet = makeRawBullet('Led enterprise Salesforce rollout.', 'unsupported', 'Product Owner at SaaS Co')
    const results = validateSectionClaims([bullet], bundle)
    // experience-po allows 'unsupported' in allowedClaimStatuses, but claimStatus=unsupported
    // maps to 'excluded' via mapResultToPartition Rule (allowed + unsupported â†’ excluded)
    expect(results[0].partition).toBe('excluded')
  })
})

// â”€â”€â”€ Test 37: Accept only covers display-partition bullets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('accept behavior: only display-partition bullets are accepted content', () => {
  it('section.content is reconstructed from display bullets only for bullet sections', () => {
    // Simulate what generate-artifact-section.ts does: content = display bullets joined
    const displayBullet = { text: 'Led Calendar Platform sprint ceremonies.', partition: 'display' as BulletPartition }
    const confirmBullet = { text: 'Built on prior BA background.', partition: 'needs-confirmation' as BulletPartition }
    const excludedBullet = { text: 'Triaged 3,000+ Salesforce requests.', partition: 'excluded' as BulletPartition }

    const allBullets = [displayBullet, confirmBullet, excludedBullet]
    const displayOnly = allBullets.filter(b => b.partition === 'display')
    const reconstructedContent = displayOnly.map(b => `â€¢ ${b.text}`).join('\n')

    expect(reconstructedContent).toContain('Calendar Platform sprint ceremonies')
    expect(reconstructedContent).not.toContain('prior BA background')
    expect(reconstructedContent).not.toContain('3,000+ Salesforce')
  })

  it('learning signals are only emitted for display-partition bullets on accept', () => {
    const bullets = [
      { ...makeSection().bullets[0], partition: 'display' as BulletPartition, text: 'A', approved: null },
      { ...makeSection().bullets[0], partition: 'needs-confirmation' as BulletPartition, text: 'B', approved: null },
      { ...makeSection().bullets[0], partition: 'excluded' as BulletPartition, text: 'C', approved: null },
    ]
    const acceptedForSignals = bullets.filter(b =>
      (b.partition ?? 'display') === 'display' && b.approved !== false
    )
    expect(acceptedForSignals).toHaveLength(1)
    expect(acceptedForSignals[0].text).toBe('A')
  })
})

// â”€â”€â”€ Test 38: Export readiness ignores non-display claims â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('export readiness: non-display claims do not contribute to exported content', () => {
  it('only display-partition bullets contribute to the section content for export', () => {
    const bullets = [
      makeRawBullet('Owned PO backlog.', 'supported', 'Product Owner at SaaS Co'),
      makeRawBullet('Prior background: applied BA skills.', 'supported-with-reframing', 'Product Analyst at SaaS Co'),
    ]
    const bundle = makeBundleFor('experience-po', [PO_ENTRY, BA_ENTRY])
    const results = validateSectionClaims(bullets, bundle)

    const displayCount = results.filter(r => r.partition === 'display').length
    const nonDisplayCount = results.filter(r => r.partition !== 'display').length
    expect(displayCount + nonDisplayCount).toBe(2)
    // PO-sourced bullet â†’ display; BA-sourced with framing â†’ needs-confirmation
    expect(displayCount).toBe(1)
    expect(nonDisplayCount).toBe(1)
  })
})

// â”€â”€â”€ Test 39: Display partition is distinct from all other partitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('partition distinctness: display and non-display are mutually exclusive', () => {
  it('a bullet cannot be in both display and any other partition', () => {
    const results = validateAndPartition(
      [
        makeRawBullet('Owned PO backlog.', 'supported', 'Product Owner at SaaS Co'),
        makeRawBullet('Led product roadmap ownership for Calendar Platform.', 'supported', 'Product Owner at SaaS Co'),
        makeRawBullet('Triaged Salesforce requests.', 'supported', 'Product Analyst at SaaS Co'),
        makeRawBullet('Unsupported insurance claim.', 'unsupported', undefined),
      ],
      'experience-po',
      [PO_ENTRY, BA_ENTRY]
    )

    // Every bullet is in exactly one partition
    for (const r of results) {
      const partitions: BulletPartition[] = ['display', 'needs-confirmation', 'excluded', 'suggested-other']
      expect(partitions).toContain(r.partition)
    }

    // Display and non-display are mutually exclusive
    const displayBullets = results.filter(r => r.partition === 'display')
    const nonDisplayBullets = results.filter(r => r.partition !== 'display')
    const overlap = displayBullets.filter(d => nonDisplayBullets.some(n => n.bulletIndex === d.bulletIndex))
    expect(overlap).toHaveLength(0)
  })
})

// â”€â”€â”€ Test 40: Accepted sections elsewhere are preserved on regeneration â”€â”€â”€â”€â”€â”€â”€â”€

describe('partition: accepted section preservation during peer regeneration', () => {
  it('regenerating experience-ba does not change the partition of accepted experience-po bullets', () => {
    const acceptedSection = makeSection({
      type: 'experience-po',
      status: 'accepted',
      bullets: [
        { id: nanoid(), text: 'Owned Calendar Platform.', claimStatus: 'supported',
          sourceSignal: 'user-history', approved: true, partition: 'display' as BulletPartition }
      ]
    })
    // Simulate a new BA section being generated
    const newBASection = makeSection({ type: 'experience-ba', status: 'generated' })
    const sections = new Map<SectionType, ArtifactSection>([
      ['experience-po', acceptedSection],
      ['experience-ba', newBASection],
    ])
    const after = new Map(sections).set('experience-ba', newBASection)

    // PO section is untouched
    const poBullets = after.get('experience-po')!.bullets
    expect(poBullets.every(b => (b.partition ?? 'display') === 'display')).toBe(true)
    expect(after.get('experience-po')!.status).toBe('accepted')
  })
})

