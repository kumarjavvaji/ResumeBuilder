import Dexie, { type Table } from 'dexie'
import type {
  UserProfile,
  TargetIntake,
  BridgeQuestion,
  ArtifactSection,
  ResumeArtifact,
  LearningSignal,
  ArtifactHistoryRecord,
  OutreachTarget,
  MarketProfile,
  ExportPackage,
  Stage4RawResumeText,
  CalibrationReference,
  CalibrationCandidate,
  CalibrationSynthesisRecord,
  AppliedCalibrationState,
  ProfileSnapshot,
  Stage1Job,
  NormalizedLearning,
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
  artifactHistory!: Table<ArtifactHistoryRecord>
  outreachTargets!: Table<OutreachTarget>
  marketProfiles!: Table<MarketProfile>
  exportPackages!: Table<ExportPackage>
  stage4RawResumeTexts!: Table<Stage4RawResumeText>
  calibrationReferences!: Table<CalibrationReference>
  calibrationCandidates!: Table<CalibrationCandidate>
  calibrationSyntheses!: Table<CalibrationSynthesisRecord>
  appliedCalibrationStates!: Table<AppliedCalibrationState>
  profileSnapshots!: Table<ProfileSnapshot>
  stage1Jobs!: Table<Stage1Job>
  normalizedLearnings!: Table<NormalizedLearning>

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

    // v9: versioned profile snapshots for the layered profile compiler.
    //     profileId is always 'primary' (singleton user). version increments on each intake.
    this.version(9).stores({
      profileSnapshots: 'profileId, version, isActive'
    })

    // v11: adds stage1Jobs table for persisted multi-pass Stage 1 execution.
    this.version(11).stores({
      stage1Jobs: 'id, status, createdAt',
    })

    // v12: adds stage1JobId + jdHash indexes to bridgeQuestions for provenance queries and staleness checks.
    this.version(12).stores({
      bridgeQuestions: 'id, sessionId, stage1JobId, jdHash, type, priority, status',
    })

    // v13: adds normalizedLearnings table for bucket-classified learning records.
    this.version(13).stores({
      normalizedLearnings: 'id, bucket, scope, sourceSessionId, roleFamily, savedAt'
    })

    // v10: adds artifactHistory table for accepted/rejected resume content.
    //      Migrates legacy accepted-bullet and rejected-bullet records out of
    //      learningSignals (where they polluted the generation signal store) and
    //      deletes them from learningSignals.
    this.version(10).stores({
      artifactHistory: 'id, sessionId, kind, sectionType, createdAt'
    }).upgrade(async tx => {
      type LegacyLearningSignal = Omit<LearningSignal, 'type'> & { type: string }
      const polluted = await tx.table('learningSignals')
        .filter((s: LegacyLearningSignal) =>
          s.type === 'accepted-bullet' || s.type === 'rejected-bullet' || s.type === 'approved-metric'
        )
        .toArray()

      if (polluted.length > 0) {
        const historyRecords: ArtifactHistoryRecord[] = polluted.map((s: LegacyLearningSignal) => ({
          id: `migrated_${s.id}`,
          sessionId: '',
          kind: s.type as ArtifactHistoryRecord['kind'],
          content: s.content,
          sectionType: s.sectionType ?? 'unknown',
          roleCategory: s.roleCategory,
          context: s.context,
          createdAt: s.createdAt,
        }))
        await tx.table('artifactHistory').bulkAdd(historyRecords)
        await tx.table('learningSignals').bulkDelete(polluted.map((s: LearningSignal) => s.id))
      }
    })
  }
}

export const db = new ResumeBuilderDB()
