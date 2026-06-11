import Dexie, { type Table } from 'dexie'
import type {
  UserProfile,
  TargetIntake,
  BridgeQuestion,
  ArtifactSection,
  ResumeArtifact,
  LearningSignal,
  OutreachTarget,
  MarketProfile,
  ExportPackage,
  Stage4RawResumeText,
  CalibrationReference,
  CalibrationCandidate,
  CalibrationSynthesisRecord,
  AppliedCalibrationState
} from '@/contracts'
import { deriveStageStatuses } from '@/contracts'
import { migrateToSkillGroups } from '@/lib/skills/classify'

export class ResumeBuilderDB extends Dexie {
  userProfile!: Table<UserProfile>
  sessions!: Table<TargetIntake>
  bridgeQuestions!: Table<BridgeQuestion>
  artifactSections!: Table<ArtifactSection>
  artifacts!: Table<ResumeArtifact>
  learningSignals!: Table<LearningSignal>
  outreachTargets!: Table<OutreachTarget>
  marketProfiles!: Table<MarketProfile>
  exportPackages!: Table<ExportPackage>
  stage4RawResumeTexts!: Table<Stage4RawResumeText>
  calibrationReferences!: Table<CalibrationReference>
  calibrationCandidates!: Table<CalibrationCandidate>
  calibrationSyntheses!: Table<CalibrationSynthesisRecord>
  appliedCalibrationStates!: Table<AppliedCalibrationState>

  constructor() {
    super('resume-builder')

    this.version(1).stores({
      userProfile: 'id',
      sessions: 'id, status, company, roleTitle, createdAt',
      bridgeQuestions: 'id, sessionId, type, priority, status',
      artifactSections: 'id, sessionId, type, status',
      artifacts: 'id, sessionId',
      learningSignals: 'id, type, roleCategory, companyDomain, sectionType, createdAt',
      outreachTargets: 'id, sessionId',
      marketProfiles: 'id, sessionId',
      exportPackages: 'id, sessionId'
    })

    // v2: adds scope + productArea indexes to learningSignals
    this.version(2).stores({
      learningSignals: 'id, type, scope, productArea, roleCategory, companyDomain, sectionType, promotedToGlobal, createdAt'
    }).upgrade(tx =>
      tx.table('learningSignals').toCollection().modify((signal: LearningSignal) => {
        if (!signal.scope) signal.scope = 'personal'
      })
    )

    // v3: adds stageStatuses to sessions; adds skillGroups to userProfile
    this.version(3).stores({
      sessions: 'id, status, company, roleTitle, createdAt, updatedAt'
    }).upgrade(tx => {
      tx.table('sessions').toCollection().modify((session: TargetIntake) => {
        if (!session.stageStatuses) {
          session.stageStatuses = deriveStageStatuses(session.status)
        }
      })
      tx.table('userProfile').toCollection().modify((profile: UserProfile) => {
        if (!profile.skillGroups || profile.skillGroups.length === 0) {
          profile.skillGroups = migrateToSkillGroups(profile.skills ?? [])
        }
      })
    })

    // v4: migrates artifact section status 'draft' → 'generated'; 'needs-refinement' → 'refinement_requested'
    //     adds evidenceWarnings / sourceMappings defaults
    this.version(4).stores({}).upgrade(tx => {
      tx.table('artifactSections').toCollection().modify((section: ArtifactSection) => {
        if ((section.status as string) === 'draft') {
          section.status = 'generated'
        }
        if ((section.status as string) === 'needs-refinement') {
          section.status = 'refinement_requested'
        }
        if (!section.evidenceWarnings) section.evidenceWarnings = []
        if (!section.sourceMappings) section.sourceMappings = []
      })
    })

    // v5: adds calibrationReferences table for Stage 3A
    this.version(5).stores({
      calibrationReferences: 'id, sessionId, matchType, collectedAt'
    })

    // v6: adds calibrationCandidates table for progressive pipeline
    this.version(6).stores({
      calibrationCandidates: 'id, sessionId, status, candidateMatchType, discoveredAt'
    })

    // v7: adds calibrationSyntheses (persisted synthesis output) and
    //     appliedCalibrationStates (persisted apply action)
    this.version(7).stores({
      calibrationSyntheses: 'id, sessionId, generatedAt',
      appliedCalibrationStates: 'id, sessionId, appliedAt'
    })

    // v8: stores Stage 4 raw resume text assemblies.
    this.version(8).stores({
      stage4RawResumeTexts: 'id, sessionId, status, updatedAt'
    })
  }
}

export const db = new ResumeBuilderDB()
