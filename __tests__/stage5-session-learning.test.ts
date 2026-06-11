import { describe, expect, it } from 'vitest'
import type {
  AppliedCalibrationState,
  ArtifactSection,
  BridgeQuestion,
  LearningSignal,
  ResumeBullet,
  Stage4RawResumeText,
  TargetIntake,
  UserProfile
} from '@/contracts'
import {
  artifactFactsFromSignals,
  buildStage5LearningReport,
  primaryLearningSignals,
  sanitizeGlobalLearning
} from '@/lib/stage5/session-learning'

function session(): TargetIntake {
  return {
    id: 'sess-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    roleTitle: 'SI Business Analyst',
    company: 'OIP Insurtech',
    domainIQInsights: { rawText: '', companyProfile: '', industrySignals: [], techStack: [], cultureSignals: [] },
    jobDescription: {
      fullText: '',
      summary: 'Systems integration BA role.',
      responsibilities: [],
      requiredSkills: [],
      niceToHaves: [],
      domainSignals: []
    },
    jdRequirementMap: {
      required: [
        { text: 'Insurance billing and claims domain fluency', category: 'domain', userCoverageStatus: 'gap' },
        { text: 'REST/JSON/XML API specification authoring', category: 'technical', userCoverageStatus: 'gap' },
        { text: 'Bachelor degree', category: 'process', userCoverageStatus: 'covered' },
        { text: 'Requirements elicitation', category: 'process', userCoverageStatus: 'partial' }
      ],
      niceToHave: [],
      realJobFunction: 'Systems integration business analysis',
      needsEvidenceItems: ['Insurance billing and claims domain fluency'],
      unsupportedRequirements: ['Insurance billing and claims domain fluency'],
      weaklySupportedRequirements: ['Requirements elicitation']
    },
    companySummary: '',
    fitHypothesis: '',
    riskGaps: ['Insurance domain'],
    emphasisRecommendation: 'BA',
    status: 'artifact',
    stageStatuses: { intake: 'complete', bridge: 'complete', artifacts: 'complete', export: 'complete', signals: 'active' }
  }
}

function profile(): UserProfile {
  return {
    id: 'profile-1',
    fullName: 'Kumar Test',
    email: 'kumar@example.com',
    phone: '555-0100',
    location: '',
    linkedIn: '',
    summary: 'Broad Product Owner / Business Systems Analyst positioning.',
    workHistory: [{
      id: 'work-1',
      company: 'Paylocity',
      title: 'Product Analyst',
      startDate: '2020',
      endDate: '2023',
      bullets: ['Managed 3,000+ support signals.'],
      approvedMetrics: ['3,000+ support signals'],
      domain: 'HCM',
      skills: ['SQL']
    }],
    education: [],
    skillGroups: [],
    skills: [],
    certifications: [],
    constraints: [],
    rejectedPhrases: [],
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function bridgeQuestions(): BridgeQuestion[] {
  return [
    {
      id: 'bridge-1',
      sessionId: 'sess-1',
      question: 'Describe Postman API work.',
      type: 'evidence',
      priority: 'high',
      affectedArtifactSection: 'experience-qa',
      status: 'answered',
      userAnswer: 'I used Postman to validate API endpoints, not author specifications.',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'bridge-2',
      sessionId: 'sess-1',
      question: 'Do you have insurance coverages experience?',
      type: 'domain-translation',
      priority: 'high',
      affectedArtifactSection: 'experience-ba',
      status: 'answered',
      userAnswer: 'I am not sure and do not have direct insurance billing experience.',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ]
}

function bullet(text: string, overrides: Partial<ResumeBullet> = {}): ResumeBullet {
  return {
    id: `bullet-${text.slice(0, 6)}`,
    text,
    claimStatus: 'supported',
    sourceSignal: 'user-history',
    approved: null,
    partition: 'display',
    ...overrides
  }
}

function section(type: ArtifactSection['type'], overrides: Partial<ArtifactSection> = {}): ArtifactSection {
  return {
    id: `section-${type}`,
    sessionId: 'sess-1',
    type,
    content: `${type} content`,
    bullets: [],
    status: 'accepted',
    generationRationale: '',
    evidenceWarnings: [],
    sourceMappings: [],
    jdTraceability: [],
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function artifactSections(): ArtifactSection[] {
  return [
    section('summary', { content: 'SI BA alignment anchored on requirements translation.' }),
    section('skills', { content: 'Analysis: Requirements, Gap Analysis\nData: SQL, Pendo' }),
    section('experience-ba', {
      bullets: [
        bullet('Translated support signals into requirements and gap-analysis priorities.'),
        bullet('Needs confirmation claim.', { partition: 'needs-confirmation' })
      ],
      calibrationInfluence: {
        calibrationAvailable: true,
        calibrationUsed: true,
        useLevel: 'material',
        influenceSummary: 'Ordered BA evidence first.',
        influencedPatterns: ['SI BA ordering'],
        artifactDecisions: [{
          pattern: 'SI BA ordering',
          decisionType: 'ordering',
          decision: 'Ordered Product Analyst bullets before Product Owner context.'
        }]
      },
      blockedClaimDiagnostics: [{
        attemptedSection: 'experience-ba',
        blockedClaimText: 'Calendar Platform ownership.',
        detectedSourceEntry: 'Product Owner at Paylocity',
        detectedSourceRole: 'PO',
        reason: 'Wrong role section.',
        suggestedSection: 'experience-po',
        disposition: 'downgraded'
      }],
      evidenceWarnings: ['Unsupported insurance domain should remain a gap.']
    }),
    section('experience-po', { bullets: [bullet('Owned backlog sequencing.')] }),
    section('experience-qa', { bullets: [bullet('Used QA experience for UAT readiness.')] })
  ]
}

function appliedCalibration(): AppliedCalibrationState {
  return {
    id: 'cal-1',
    sessionId: 'sess-1',
    summary: {
      targetCompanyPatterns: [],
      competitorPatterns: [],
      repeatedTitles: ['Business Analyst'],
      repeatedSkillsTools: ['systems integration', 'stakeholder translation'],
      domainExpectations: ['insurance domain fluency'],
      credibilityBoundaries: ['Do not claim insurance billing without evidence.'],
      artifactGuidance: ['Foreground requirements elicitation before generic PO ownership.'],
      outreachGuidance: [],
      gapsToHandleCarefully: ['API specification authorship'],
      calibrationUsed: true,
      calibrationPatterns: ['Systems Integration'],
      generatedAt: '2026-01-01T00:00:00.000Z'
    },
    applyStatus: 'applied_partial',
    isPartial: true,
    targetReferenceCount: 4,
    comparableReferenceCount: 4,
    appliedCalibrationPatterns: ['Systems Integration'],
    referencedCalibrationIds: ['ref-1'],
    appliedAt: '2026-01-01T00:00:00.000Z',
    calibrationUpdatedAfterApply: false
  }
}

function stage4(): Stage4RawResumeText {
  return {
    id: 'stage4-1',
    sessionId: 'sess-1',
    status: 'generated',
    sourceArtifactSectionIds: ['section-summary'],
    sourceArtifactSnapshots: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    structureSource: 'manual_profile',
    sections: { summary: 'Summary', skills: 'Skills', experiences: [], education: '', fullText: 'SUMMARY\nSummary' },
    warnings: [],
    staleReasons: []
  }
}

function storedSignals(): LearningSignal[] {
  return [
    {
      id: 'sig-1',
      scope: 'personal',
      type: 'accepted-bullet',
      content: 'Raw accepted bullet fact.',
      context: 'accepted',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'sig-2',
      scope: 'personal',
      type: 'rejected-phrase',
      content: 'leverage synergies',
      context: 'rejected',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ]
}

function report() {
  return buildStage5LearningReport({
    session: session(),
    profile: profile(),
    bridgeQuestions: bridgeQuestions(),
    artifactSections: artifactSections(),
    appliedCalibration: appliedCalibration(),
    stage4RawText: stage4(),
    storedSignals: storedSignals()
  })
}

describe('Stage 5 session learning redesign', () => {
  it('does not classify every accepted bullet as a primary learning signal', () => {
    const built = report()
    const primary = primaryLearningSignals(built)
    expect(primary.every(s => s.type !== 'accepted-bullet')).toBe(true)
    expect(primary.length).toBeLessThan(built.artifactFacts.acceptedBullets.length + primary.length)
  })

  it('stores accepted bullets under Artifact Facts, not default Strategy Learnings', () => {
    const built = report()
    expect(built.defaultTab).toBe('strategy')
    expect(built.artifactFacts.acceptedBullets).toContain('Raw accepted bullet fact.')
    expect(primaryLearningSignals(built).map(s => s.content)).not.toContain('Raw accepted bullet fact.')
  })

  it('generates meta-signals from Stage 1 JD gaps', () => {
    const built = report()
    expect(built.signals.some(s => s.stage === 'stage1' && s.content.includes('Insurance billing'))).toBe(true)
  })

  it('generates meta-signals from Stage 2 bridge answers', () => {
    const built = report()
    expect(built.signals.some(s => s.stage === 'stage2' && s.type === 'bridge_question_effectiveness')).toBe(true)
    expect(built.signals.some(s => s.content.includes('uncertainty'))).toBe(true)
  })

  it('generates meta-signals from Stage 3 calibration influence', () => {
    const built = report()
    expect(built.signals.some(s => s.stage === 'stage3a' && s.content.includes('Calibration influence was auditable'))).toBe(true)
  })

  it('generates meta-signals from Stage 3 evidence-scoping decisions', () => {
    const built = report()
    expect(built.signals.some(s => s.stage === 'stage3b' && s.type === 'role_scope_rule')).toBe(true)
  })

  it('generates meta-signals from Stage 4 export assembly', () => {
    const built = report()
    expect(built.signals.some(s => s.stage === 'stage4' && s.type === 'export_assembly_rule')).toBe(true)
  })

  it('personal signals can include user-specific strategy', () => {
    const built = report()
    expect(built.signals.some(s => s.scope === 'personal' && s.content.includes('Accepted section strategy'))).toBe(true)
  })

  it('global signals are anonymized and do not include raw resume facts or user identity', () => {
    const global = sanitizeGlobalLearning('Kumar Test at Paylocity improved 3,000+ support signals.', { profile: profile() })
    expect(global).not.toContain('Kumar')
    expect(global).not.toContain('Paylocity')
    expect(global).not.toContain('3,000')
  })

  it('calibration references become abstracted strategy signals, not profile facts', () => {
    const built = report()
    expect(built.signals.some(s => s.type === 'calibration_pattern')).toBe(true)
    expect(built.artifactFacts.acceptedBullets.join(' ')).not.toContain('Systems Integration')
  })

  it('before/after strategy summary is generated when initial and final artifacts exist', () => {
    const built = report()
    expect(built.beforeAfter[0].before).toContain('Broad Product Owner')
    expect(built.beforeAfter[0].after).toContain('Translated support signals')
    expect(built.beforeAfter[0].why).toContain('Calibration')
  })

  it('default Stage 5 UI model shows Strategy Learnings, not accepted bullet ledger', () => {
    expect(report().defaultTab).toBe('strategy')
  })

  it('Artifact Facts tab still preserves accepted bullets and rejected phrases', () => {
    const facts = report().artifactFacts
    expect(facts.acceptedBullets).toContain('Raw accepted bullet fact.')
    expect(facts.rejectedPhrases).toContain('leverage synergies')
  })

  it('global product signals do not include calibration person names or raw match reasons', () => {
    const global = sanitizeGlobalLearning('Jelena Djordjevic profile at Questrade matched target role.', {
      calibrationPeople: ['Jelena Djordjevic', 'Questrade']
    })
    expect(global).not.toContain('Jelena')
    expect(global).not.toContain('Questrade')
  })

  it('can operate with little manual refinement by using calibration and generation audits', () => {
    const built = buildStage5LearningReport({
      session: session(),
      bridgeQuestions: [],
      artifactSections: artifactSections(),
      appliedCalibration: appliedCalibration(),
      stage4RawText: undefined,
      storedSignals: []
    })
    expect(primaryLearningSignals(built).length).toBeGreaterThan(0)
    expect(built.strategySummary).toContain('Resume Builder shifted')
  })

  it('artifactFactsFromSignals keeps facts out of strategy construction', () => {
    const facts = artifactFactsFromSignals(storedSignals())
    expect(facts.acceptedBullets).toEqual(['Raw accepted bullet fact.'])
    expect(facts.rejectedPhrases).toEqual(['leverage synergies'])
  })
})
