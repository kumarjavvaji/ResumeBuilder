import { db } from './db'
import { nanoid } from './nanoid'
import type { Stage1Job, Stage1JobPassState, Stage1PassKey, UserProfile, JDSourceType, ProfileEvidenceIndexItem } from '@/contracts'

export type { Stage1Job, Stage1JobPassState, Stage1PassKey }

const ACTIVE_JOB_KEY = 'stage1_active_job_id'

function makeInitialPassState(): Stage1JobPassState {
  return { status: 'not_started', retryCount: 0 }
}

function makeInitialPasses(): Stage1Job['passes'] {
  return {
    profileMap:       makeInitialPassState(),
    jdMap:            makeInitialPassState(),
    claimValidation:  makeInitialPassState(),
    matchMatrix:      makeInitialPassState(),
    gapFit:           makeInitialPassState(),
    bridgeQuestions:  makeInitialPassState(),
    assembly:         makeInitialPassState(),
  }
}

export async function createStage1Job(opts: {
  company: string
  roleTitle: string
  jdText: string
  jdSourceType: JDSourceType
  domainIQText: string
  profile: UserProfile
  profileEvidenceIndex: ProfileEvidenceIndexItem[]
  bridgeAnswers?: Array<{ question: string; answer: string; questionType: string }>
  acceptedArtifacts?: Array<{ sectionType: string; content: string }>
}): Promise<Stage1Job> {
  const now = new Date().toISOString()
  const job: Stage1Job = {
    id: nanoid(),
    company: opts.company,
    roleTitle: opts.roleTitle,
    jdText: opts.jdText,
    jdSourceType: opts.jdSourceType,
    domainIQText: opts.domainIQText,
    profile: opts.profile,
    profileEvidenceIndex: opts.profileEvidenceIndex,
    bridgeAnswers: opts.bridgeAnswers ?? [],
    acceptedArtifacts: opts.acceptedArtifacts ?? [],
    status: 'running',
    passes: makeInitialPasses(),
    createdAt: now,
    updatedAt: now,
  }
  await db.stage1Jobs.add(job)
  setActiveJobId(job.id)
  return job
}

export async function getStage1Job(id: string): Promise<Stage1Job | undefined> {
  return db.stage1Jobs.get(id)
}

export async function updateStage1JobPass(
  jobId: string,
  passKey: Stage1PassKey,
  updates: Partial<Stage1JobPassState>,
): Promise<Stage1Job | undefined> {
  const job = await db.stage1Jobs.get(jobId)
  if (!job) return undefined
  const updatedJob: Stage1Job = {
    ...job,
    updatedAt: new Date().toISOString(),
    passes: {
      ...job.passes,
      [passKey]: { ...job.passes[passKey], ...updates },
    },
  }
  await db.stage1Jobs.put(updatedJob)
  return updatedJob
}

export async function setStage1JobComplete(jobId: string, finalArtifact: unknown): Promise<void> {
  const job = await db.stage1Jobs.get(jobId)
  if (!job) return
  await db.stage1Jobs.put({
    ...job,
    status: 'completed',
    finalArtifact,
    updatedAt: new Date().toISOString(),
  })
}

export async function setStage1JobFailed(jobId: string): Promise<void> {
  const job = await db.stage1Jobs.get(jobId)
  if (!job) return
  await db.stage1Jobs.put({
    ...job,
    status: 'failed',
    updatedAt: new Date().toISOString(),
  })
}

// localStorage helpers for active job tracking across page refreshes

export function setActiveJobId(id: string) {
  try { localStorage.setItem(ACTIVE_JOB_KEY, id) } catch {}
}

export function getActiveJobId(): string | null {
  try { return localStorage.getItem(ACTIVE_JOB_KEY) } catch { return null }
}

export function clearActiveJobId() {
  try { localStorage.removeItem(ACTIVE_JOB_KEY) } catch {}
}
