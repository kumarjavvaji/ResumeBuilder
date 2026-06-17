'use client'
import type { JDRequirementMap, JDRequirement, Stage1Finding } from '@/contracts'
import { Badge } from '@/components/shared/badge'
import { findFindingByTopic, TraceChip, TraceableBullet } from './stage1-findings-view'

export function JDRequirementMapView({
  map,
  findings,
  showTrace = false,
}: {
  map: JDRequirementMap
  findings?: Stage1Finding[]
  showTrace?: boolean
}) {
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

      <RequirementGroup title="Required" requirements={map.required} findings={findings} showTrace={showTrace} />
      <RequirementGroup title="Nice to Have" requirements={map.niceToHave} findings={findings} showTrace={showTrace} />

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
              <TraceableBullet
                key={i}
                text={r}
                finding={showTrace ? findFindingByTopic(findings, r) : undefined}
                className="text-sm text-amber-700"
              />
            ))}
          </ul>
        </div>
      )}

      {map.weaklySupportedRequirements.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">Weakly Supported</h3>
          <ul className="space-y-1">
            {map.weaklySupportedRequirements.map((r, i) => (
              <TraceableBullet
                key={i}
                text={r}
                finding={showTrace ? findFindingByTopic(findings, r) : undefined}
                className="text-sm text-amber-700"
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function RequirementGroup({
  title,
  requirements,
  findings,
  showTrace,
}: {
  title: string
  requirements: JDRequirement[]
  findings?: Stage1Finding[]
  showTrace: boolean
}) {
  if (requirements.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      <div className="space-y-2">
        {requirements.map((r, i) => (
          <RequirementRow
            key={i}
            r={r}
            finding={showTrace ? findFindingByTopic(findings, r.text) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function RequirementRow({ r, finding }: { r: JDRequirement; finding?: Stage1Finding }) {
  // Triad grounding is only present once the calibrated artifact contract has been populated.
  const hasTriad = r.jdSignal || r.quickDiqGrounding || r.profileGrounding || r.calibratedFitInterpretation

  return (
    <div className="text-sm">
      <div className="flex items-start gap-2">
        <CoverageIndicator status={r.userCoverageStatus} />
        <span className="text-gray-700 flex-1">{r.rowLabel || r.text}</span>
        <span className="text-xs text-gray-400 shrink-0">{r.category}</span>
        <TraceChip finding={finding} />
      </div>
      {r.sourceExcerpt && (
        <p className="mt-0.5 ml-[68px] text-xs text-gray-400 italic">"{r.sourceExcerpt}"</p>
      )}
      {!hasTriad && r.profileEvidence && (
        <p className="mt-0.5 ml-[68px] text-xs text-gray-500">{r.profileEvidence}</p>
      )}

      {hasTriad && (
        <div className="mt-1.5 ml-[68px] border border-indigo-100 bg-indigo-50/50 rounded-md px-3 py-2 space-y-1">
          {r.jdSignal && (
            <p className="text-xs text-gray-700"><span className="font-semibold text-gray-500">JD:</span> {r.jdSignal}</p>
          )}
          {r.quickDiqGrounding && (
            <p className="text-xs text-gray-700"><span className="font-semibold text-indigo-600">Quick-DIQ:</span> {r.quickDiqGrounding}</p>
          )}
          {r.profileGrounding && (
            <p className="text-xs text-gray-700"><span className="font-semibold text-gray-500">Profile:</span> {r.profileGrounding}</p>
          )}
          {r.calibratedFitInterpretation && (
            <p className="text-xs text-gray-800"><span className="font-semibold text-indigo-700">Calibrated interpretation:</span> {r.calibratedFitInterpretation}</p>
          )}
          {r.classification && (
            <p className="text-xs text-gray-700"><span className="font-semibold text-gray-500">Classification:</span> {r.classification.replace('_', ' ')}</p>
          )}
          {r.evidenceNeeded && (
            <p className="text-xs text-amber-700"><span className="font-semibold">Evidence needed:</span> {r.evidenceNeeded}</p>
          )}
          {r.resumeImplication && (
            <p className="text-xs text-indigo-700"><span className="font-semibold">Resume implication:</span> {r.resumeImplication}</p>
          )}
          {r.stage2Implication && (
            <p className="text-xs text-indigo-700"><span className="font-semibold">Stage 2 implication:</span> {r.stage2Implication}</p>
          )}
        </div>
      )}

      {!hasTriad && r.diqCalibration && (
        <p className="mt-0.5 ml-[68px] text-xs text-indigo-600">
          <span className="font-medium">Quick-DIQ calibration:</span> {r.diqCalibration}
        </p>
      )}
      {!hasTriad && r.resumeImplication && (
        <p className="mt-0.5 ml-[68px] text-xs text-indigo-500">
          <span className="font-medium">Resume implication:</span> {r.resumeImplication}
        </p>
      )}
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
