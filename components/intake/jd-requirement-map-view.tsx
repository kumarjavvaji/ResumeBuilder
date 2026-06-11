'use client'
import type { JDRequirementMap, JDRequirement } from '@/contracts'
import { Badge } from '@/components/shared/badge'

export function JDRequirementMapView({ map }: { map: JDRequirementMap }) {
  // Prefer the new field; fall back to deprecated field for old sessions in storage
  const needsEvidence = map.needsEvidenceItems?.length
    ? map.needsEvidenceItems
    : (map.unsupportedRequirements ?? [])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Real Job Function</h3>
        <p className="text-sm text-gray-700">{map.realJobFunction}</p>
      </div>

      <RequirementGroup title="Required" requirements={map.required} />
      <RequirementGroup title="Nice to Have" requirements={map.niceToHave} />

      {needsEvidence.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-1">
            Needs Evidence
          </h3>
          <p className="text-xs text-gray-400 mb-2">
            Not found in your profile yet — bridge-question targets, not hard disqualifiers.
          </p>
          <ul className="space-y-1">
            {needsEvidence.map((r, i) => (
              <li key={i} className="text-sm text-amber-700 flex gap-2">
                <span>·</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {map.weaklySupportedRequirements.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">Weakly Supported</h3>
          <ul className="space-y-1">
            {map.weaklySupportedRequirements.map((r, i) => (
              <li key={i} className="text-sm text-amber-700 flex gap-2"><span>·</span>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function RequirementGroup({ title, requirements }: { title: string; requirements: JDRequirement[] }) {
  if (requirements.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      <div className="space-y-2">
        {requirements.map((r, i) => (
          <div key={i} className="text-sm">
            <div className="flex items-start gap-2">
              <CoverageIndicator status={r.userCoverageStatus} />
              <span className="text-gray-700 flex-1">{r.text}</span>
              <span className="text-xs text-gray-400 shrink-0">{r.category}</span>
            </div>
            {r.sourceExcerpt && (
              <p className="mt-0.5 ml-[68px] text-xs text-gray-400 italic">"{r.sourceExcerpt}"</p>
            )}
            {r.profileEvidence && (
              <p className="mt-0.5 ml-[68px] text-xs text-gray-500">{r.profileEvidence}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function CoverageIndicator({ status }: { status: JDRequirement['userCoverageStatus'] }) {
  const map = {
    covered: <Badge variant="covered">covered</Badge>,
    partial: <Badge variant="partial">partial</Badge>,
    gap: <Badge variant="gap">gap</Badge>,
    unknown: <Badge variant="neutral">?</Badge>,
  }
  return map[status]
}
