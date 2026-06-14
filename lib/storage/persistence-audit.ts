import { db } from './db'
import type { SessionPersistenceAudit, GapClassification } from '@/contracts'
import { getUserProfile } from './user-profile'

export async function getSessionPersistenceAudit(sessionId: string): Promise<SessionPersistenceAudit> {
  const [session, profile, bridgeQuestions, artifactSections, learningSignals] = await Promise.all([
    db.sessions.get(sessionId),
    getUserProfile(),
    db.bridgeQuestions.where('sessionId').equals(sessionId).toArray(),
    db.artifactSections.where('sessionId').equals(sessionId).toArray(),
    db.learningSignals.toArray(),
  ])

  const profileEvidenceBulletsCount = (profile?.workHistory ?? []).reduce(
    (sum, e) => sum + (e.bullets?.length ?? 0),
    0
  )
  const profileSkillsCount = (profile?.skills ?? []).length

  const jdMap = session?.jdRequirementMap
  const jdRequiredCount = jdMap?.required.length ?? 0
  const jdNiceToHaveCount = jdMap?.niceToHave.length ?? 0

  const fitAnalysis = session?.fitAnalysis
  const fitRequirementsCount = fitAnalysis?.requirements.length ?? 0
  const fitAnalysisAvailable = !!fitAnalysis

  const gapReqs = (jdMap?.required ?? []).filter(
    r => r.userCoverageStatus === 'gap' || r.userCoverageStatus === 'partial'
  )
  const gapsCount = gapReqs.length

  const gapBreakdown: Partial<Record<GapClassification, number>> = {}
  for (const req of gapReqs) {
    if (req.gapClassification) {
      gapBreakdown[req.gapClassification] = (gapBreakdown[req.gapClassification] ?? 0) + 1
    }
  }

  const bridgeQuestionsCount = bridgeQuestions.length
  const bridgeAnsweredCount = bridgeQuestions.filter(q => q.status === 'answered').length

  const artifactSectionsGeneratedCount = artifactSections.filter(
    s => s.status === 'generated' || s.status === 'needs_review' || s.status === 'accepted'
  ).length
  const artifactSectionsAcceptedCount = artifactSections.filter(s => s.status === 'accepted').length

  const stage5SignalCount = learningSignals.length

  return {
    sessionId,
    checkedAt: new Date().toISOString(),
    profileEvidenceBulletsCount,
    profileSkillsCount,
    jdRequiredCount,
    jdNiceToHaveCount,
    fitRequirementsCount,
    fitAnalysisAvailable,
    gapsCount,
    gapBreakdown,
    bridgeQuestionsCount,
    bridgeAnsweredCount,
    artifactSectionsGeneratedCount,
    artifactSectionsAcceptedCount,
    stage5SignalCount,
  }
}
