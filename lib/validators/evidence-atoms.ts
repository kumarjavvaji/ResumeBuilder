import type {
  EvidenceAllowedUse,
  EvidenceAtom,
  EvidenceAtomType,
  EvidenceAtomWarning,
  JDRequirementMap,
  UserProfile,
} from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'
import { classifyMetric } from './metric-quality'

const IMPACT_RE: RegExp[] = [
  /\brevenue\b/i,
  /\bretention\b/i,
  /\badoption\b/i,
  /\butiliz/i,
  /\bredu(?:ced|cing|ction)\b/i,
  /\bimprove[dm]?\b/i,
  /\bgrowth\b/i,
  /\bsaving[s]?\b/i,
  /\befficiency\b/i,
  /\bcycle.?time\b/i,
  /\bacceler/i,
]

const VOLUME_RE: RegExp[] = [
  /\b\d+\+?\s+(?:requests?|tickets?|issues?|stories?|cases?|records?|meetings?)\b/i,
  /\bmanaged?\s+\d+/i,
  /\bcompleted?\s+\d+/i,
]

export function classifyProfileEvidence(
  profile: UserProfile,
  jdMap: JDRequirementMap,
): EvidenceAtom[] {
  const atoms: EvidenceAtom[] = []
  const jdToolSet = new Set(
    jdMap.required
      .filter(r => r.category === 'tool')
      .map(r => r.text.toLowerCase()),
  )

  // Work history
  for (const entry of profile.workHistory) {
    // Role label
    atoms.push(makeAtom(
      entry.title,
      'role',
      'work_history',
      entry.id,
      'high',
      ['summary', 'po_bullet', 'pa_bullet', 'qa_bullet'],
      false,
      false,
      [],
    ))

    // Bullets
    for (const bullet of entry.bullets) {
      const mc = classifyMetric(bullet)
      const isImpact = IMPACT_RE.some(p => p.test(bullet)) || mc === 'impact'
      const isVolume = VOLUME_RE.some(p => p.test(bullet)) || mc === 'volume'
      const atomType: EvidenceAtomType = isImpact ? 'outcome' : 'responsibility'
      const warnings: EvidenceAtomWarning[] = []
      if (isVolume && !isImpact) warnings.push('too_volume_led')
      if (bullet.trim().length < 20) warnings.push('vague')
      atoms.push(makeAtom(
        bullet,
        atomType,
        'work_history',
        entry.id,
        'high',
        roleAllowedUses(entry.title),
        isImpact,
        isVolume,
        warnings,
      ))
    }

    // Approved metrics
    for (const metric of entry.approvedMetrics) {
      const mc = classifyMetric(metric)
      const isImpact = mc === 'impact' || IMPACT_RE.some(p => p.test(metric))
      const isVolume = mc === 'volume' && !isImpact
      const warnings: EvidenceAtomWarning[] = isVolume ? ['too_volume_led'] : []
      atoms.push(makeAtom(
        metric,
        'metric',
        'work_history',
        entry.id,
        'high',
        ['po_bullet', 'pa_bullet', 'summary'],
        isImpact,
        isVolume,
        warnings,
      ))
    }

    // Entry-level skills
    for (const skill of (entry.skills ?? [])) {
      atoms.push(makeAtom(
        skill,
        'tool',
        'work_history',
        entry.id,
        'high',
        ['skills', 'po_bullet', 'pa_bullet', 'qa_bullet'],
        false,
        false,
        jdToolSet.has(skill.toLowerCase()) ? [] : [],
      ))
    }

    // Domain
    if (entry.domain) {
      atoms.push(makeAtom(
        entry.domain,
        'domain',
        'work_history',
        entry.id,
        'high',
        ['summary', 'cover_letter'],
        false,
        false,
        [],
      ))
    }
  }

  // Flat profile skills (medium confidence — not proven in bullets)
  for (const skill of (profile.skills ?? [])) {
    atoms.push(makeAtom(skill, 'tool', 'skill', undefined, 'medium', ['skills'], false, false, []))
  }

  // Certifications
  for (const cert of (profile.certifications ?? [])) {
    atoms.push(makeAtom(cert, 'certification', 'certification', undefined, 'high', ['summary', 'education'], false, false, []))
  }

  // Education
  for (const edu of (profile.education ?? [])) {
    const text = [edu.degree, edu.field, edu.institution].filter(Boolean).join(', ')
    atoms.push(makeAtom(text, 'education', 'education', edu.id, 'high', ['education', 'summary'], false, false, []))
  }

  return atoms
}

function makeAtom(
  text: string,
  atomType: EvidenceAtomType,
  sourceSection: EvidenceAtom['sourceSection'],
  sourceEntryId: string | undefined,
  confidence: EvidenceAtom['confidence'],
  allowedUses: EvidenceAllowedUse[],
  isImpactEvidence: boolean,
  isVolumeEvidence: boolean,
  warnings: EvidenceAtomWarning[],
): EvidenceAtom {
  return {
    id: nanoid(),
    text,
    atomType,
    sourceSection,
    sourceEntryId,
    confidence,
    allowedUses,
    isImpactEvidence,
    isVolumeEvidence,
    isCandidateSpecificFact: true,
    warnings,
  }
}

function roleAllowedUses(title: string): EvidenceAllowedUse[] {
  const isPO = /product owner|product manager/i.test(title)
  const isPA = /product analyst|business analyst/i.test(title)
  const isQA = /\bqa\b|quality|test engineer/i.test(title)
  const roleBuckets: EvidenceAllowedUse[] = isPO
    ? ['po_bullet']
    : isPA
    ? ['pa_bullet']
    : isQA
    ? ['qa_bullet']
    : ['po_bullet', 'pa_bullet', 'qa_bullet']
  return [...roleBuckets, 'cover_letter']
}
