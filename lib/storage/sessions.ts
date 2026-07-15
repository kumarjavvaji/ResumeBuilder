import { db } from './db'
import type { TargetIntake, SessionStageStatuses, StageKey, FitAnalysis } from '@/contracts'
import { deriveStageStatuses } from '@/contracts'
import type { Stage1PipelineResult } from '@/lib/llm/stage1/pipeline'

export async function saveSession(session: TargetIntake): Promise<void> {
  // Ensure stageStatuses is always present
  if (!session.stageStatuses) {
    session.stageStatuses = deriveStageStatuses(session.status)
  }
  await db.sessions.put(session)
}

export async function getSession(id: string): Promise<TargetIntake | undefined> {
  // Guard: Dexie throws "Invalid argument to Table.get()" for empty/non-string keys.
  if (!id || typeof id !== 'string' || !id.trim()) {
    return undefined
  }
  const s = await db.sessions.get(id)
  if (s && !s.stageStatuses) {
    s.stageStatuses = deriveStageStatuses(s.status)
  }
  return s
}

export async function getAllSessions(): Promise<TargetIntake[]> {
  const all = await db.sessions.orderBy('createdAt').reverse().toArray()
  return all.map(s => ({
    ...s,
    stageStatuses: s.stageStatuses ?? deriveStageStatuses(s.status)
  }))
}

export async function updateSessionStatus(
  id: string,
  status: TargetIntake['status']
): Promise<void> {
  const stageStatuses = deriveStageStatuses(status)
  await db.sessions.update(id, { status, stageStatuses, updatedAt: new Date().toISOString() })
}

export async function updateStageStatus(
  id: string,
  stage: StageKey,
  stageStatus: SessionStageStatuses[StageKey]
): Promise<void> {
  const session = await db.sessions.get(id)
  if (!session) return
  const current = session.stageStatuses ?? deriveStageStatuses(session.status)
  await db.sessions.update(id, {
    stageStatuses: { ...current, [stage]: stageStatus },
    updatedAt: new Date().toISOString()
  })
}

export async function updateFitAnalysis(
  id: string,
  fitAnalysis: FitAnalysis
): Promise<void> {
  await db.sessions.update(id, { fitAnalysis, updatedAt: new Date().toISOString() })
}

export async function updateSessionFromStage1Artifact(
  sessionId: string,
  artifact: Stage1PipelineResult,
  stage1JobId?: string,
): Promise<void> {
  await db.sessions.update(sessionId, {
    stage1Status: 'complete',
    domainIQInsights: artifact.domainIQ,
    jobDescription: artifact.rawJD,
    jdRequirementMap: artifact.requirementMap,
    companySummary: artifact.synthesis.companySummary,
    fitHypothesis: artifact.synthesis.fitHypothesis,
    riskGaps: artifact.synthesis.riskGaps,
    emphasisRecommendation: artifact.synthesis.emphasisRecommendation,
    fitAnalysis: artifact.fitAnalysis,
    ...(stage1JobId ? { stage1JobId } : {}),
    updatedAt: new Date().toISOString(),
  })
}

export async function updateSessionStage1Job(
  sessionId: string,
  stage1JobId: string,
): Promise<void> {
  await db.sessions.update(sessionId, { stage1JobId, updatedAt: new Date().toISOString() })
}

export async function updateOverallRefinementPrompt(
  id: string,
  prompt: string
): Promise<void> {
  await db.sessions.update(id, { overallRefinementPrompt: prompt, updatedAt: new Date().toISOString() })
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', [
    db.sessions,
    db.bridgeQuestions,
    db.artifactSections,
    db.artifacts,
    db.outreachTargets,
    db.marketProfiles,
    db.exportPackages,
    db.stage4RawResumeTexts,
    db.calibrationReferences,
    db.calibrationCandidates,
    db.calibrationSyntheses,
    db.appliedCalibrationStates
  ], async () => {
    await db.sessions.delete(id)
    await db.bridgeQuestions.where('sessionId').equals(id).delete()
    await db.artifactSections.where('sessionId').equals(id).delete()
    await db.artifacts.where('sessionId').equals(id).delete()
    await db.outreachTargets.where('sessionId').equals(id).delete()
    await db.marketProfiles.where('sessionId').equals(id).delete()
    await db.exportPackages.where('sessionId').equals(id).delete()
    await db.stage4RawResumeTexts.where('sessionId').equals(id).delete()
    await db.calibrationReferences.where('sessionId').equals(id).delete()
    await db.calibrationCandidates.where('sessionId').equals(id).delete()
    await db.calibrationSyntheses.where('sessionId').equals(id).delete()
    await db.appliedCalibrationStates.where('sessionId').equals(id).delete()
  })
}
