import { db } from './db'
import type { UserProfile } from '@/contracts'
import { flattenSkillGroups } from '@/contracts'
import { migrateToSkillGroups } from '@/lib/skills/classify'

const PROFILE_ID = 'primary'

export async function getUserProfile(): Promise<UserProfile | undefined> {
  const p = await db.userProfile.get(PROFILE_ID)
  if (!p) return undefined
  // Backfill skillGroups for profiles saved before v3
  if (!p.skillGroups || p.skillGroups.length === 0) {
    p.skillGroups = migrateToSkillGroups(p.skills ?? [])
  }
  return p
}

export async function saveUserProfile(
  profile: Omit<UserProfile, 'id' | 'updatedAt'>
): Promise<void> {
  // Keep flat skills in sync with skillGroups
  const derivedSkills = flattenSkillGroups(profile.skillGroups ?? [])
  await db.userProfile.put({
    ...profile,
    skills: derivedSkills.length > 0 ? derivedSkills : profile.skills,
    id: PROFILE_ID,
    updatedAt: new Date().toISOString()
  })
}

export async function updateUserProfile(partial: Partial<UserProfile>): Promise<void> {
  const updates: Partial<UserProfile> & { updatedAt: string } = {
    ...partial,
    updatedAt: new Date().toISOString()
  }
  if (partial.skillGroups) {
    updates.skills = flattenSkillGroups(partial.skillGroups)
  }
  await db.userProfile.update(PROFILE_ID, updates)
}

export async function profileExists(): Promise<boolean> {
  return (await db.userProfile.count()) > 0
}
