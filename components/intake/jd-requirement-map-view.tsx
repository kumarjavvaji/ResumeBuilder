'use client'
import React from 'react'
import type { JDRequirementMap, JDRequirement, Stage1Finding } from '@/contracts'
import { Badge } from '@/components/shared/badge'
import { findFindingByTopic, TraceChip, TraceableBullet } from './stage1-findings-view'

export type RequirementDisplaySource = {
  requirementId?: string
  requirementText?: string
  text?: string
  rowLabel?: string
  classification?: string
  evidenceNeeded?: string
  stage2Implication?: string
  resumeImplication?: string
}

export type RequirementDisplayItem = {
  original: string
  display: string
}

export function requirementDisplayText(source: RequirementDisplaySource): string {
  return source.requirementText?.trim() || source.text?.trim() || source.rowLabel?.trim() || ''
}

export function canonicalRequirementSources(
  map?: JDRequirementMap,
  fitRequirements: RequirementDisplaySource[] = []
): RequirementDisplaySource[] {
  const sources = [
    ...fitRequirements,
    ...(map?.required ?? []),
    ...(map?.niceToHave ?? []),
  ]
  const seen = new Set<string>()
  return sources.filter(source => {
    const key = requirementDisplayText(source).toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function resolveRequirementDisplayText(
  label: string,
  sources: RequirementDisplaySource[]
): string {
  const exactLabel = label.trim().toLowerCase()
  const match = sources.find(source =>
    [
      source.requirementId,
      source.requirementText,
      source.text,
      source.rowLabel,
      source.evidenceNeeded,
      source.stage2Implication,
      source.resumeImplication,
    ].some(value => value?.trim().toLowerCase() === exactLabel)
  )
  return match ? requirementDisplayText(match) : label
}

export function resolveRequirementDisplayItems(
  labels: string[] | undefined,
  sources: RequirementDisplaySource[]
): RequirementDisplayItem[] {
  return (labels ?? []).map(label => ({
    original: label,
    display: resolveRequirementDisplayText(label, sources),
  }))
}

export function JDRequirementMapView({
  map,
  findings,
  showTrace = false,
  tone = 'light',
}: {
  map: JDRequirementMap
  findings?: Stage1Finding[]
  showTrace?: boolean
  tone?: 'light' | 'dark'
}) {
  // Prefer the new field; fall back to deprecated field for old sessions in storage
  const needsEvidence = map.needsEvidenceItems?.length
    ? map.needsEvidenceItems
    : (map.unsupportedRequirements ?? [])

  const requirementSources = canonicalRequirementSources(map)
  const allRequirementRows = [...map.required, ...map.niceToHave]
  const needsEvidenceRows = allRequirementRows.filter(r =>
    r.stage2Action === 'ask_bridge_question' || r.classification === 'needs_evidence'
  )
  const needsEvidenceItems = needsEvidence.length
    ? resolveRequirementDisplayItems(needsEvidence, requirementSources)
    : needsEvidenceRows.map(r => ({ original: r.text, display: requirementDisplayText(r) }))
  const weaklySupportedRows = allRequirementRows.filter(r =>
    r.classification === 'weakly_supported' || r.classification === 'partially_covered'
  )
  const weaklySupportedItems = weaklySupportedRows.length
    ? weaklySupportedRows.map(r => ({ original: r.text, display: requirementDisplayText(r) }))
    : resolveRequirementDisplayItems(map.weaklySupportedRequirements, requirementSources)
  const retrievalGapRows = map.required.filter(r => r.classification === 'retrieval_gap')
  const isDark = tone === 'dark'
  const headingCls = isDark ? 'text-gray-300' : 'text-gray-500'
  const bodyCls = isDark ? 'text-gray-100' : 'text-gray-700'
  const mutedCls = isDark ? 'text-gray-400' : 'text-gray-500'
  const amberHeadingCls = isDark ? 'text-amber-300' : 'text-amber-600'
  const amberBodyCls = isDark ? 'text-gray-100' : 'text-amber-700'
  const violetHeadingCls = isDark ? 'text-violet-300' : 'text-violet-600'

  return (
    <div className="space-y-6">
      <div>
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${headingCls} mb-1`}>Real Job Function</h3>
        <p className={`text-sm leading-relaxed break-words ${bodyCls}`}>{map.realJobFunction}</p>
      </div>

      <RequirementGroup title="Required" requirements={map.required} findings={findings} showTrace={showTrace} tone={tone} />
      <RequirementGroup title="Nice to Have" requirements={map.niceToHave} findings={findings} showTrace={showTrace} tone={tone} />

      {needsEvidenceItems.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wide ${amberHeadingCls} mb-1`}>
            Needs Evidence
          </h3>
          <p className={`text-sm leading-relaxed ${mutedCls} mb-2`}>
            Not found in your profile yet — bridge-question targets, not hard disqualifiers.
          </p>
          <ul className="space-y-1">
            {needsEvidenceItems.map((r, i) => (
              <TraceableBullet
                key={i}
                text={r.display}
                finding={showTrace ? findFindingByTopic(findings, r.original) ?? findFindingByTopic(findings, r.display) : undefined}
                className={`text-sm leading-relaxed break-words ${amberBodyCls}`}
              />
            ))}
          </ul>
        </div>
      )}

      {weaklySupportedItems.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wide ${amberHeadingCls} mb-2`}>Weakly Supported</h3>
          <ul className="space-y-1">
            {weaklySupportedItems.map((r, i) => (
              <TraceableBullet
                key={i}
                text={r.display}
                finding={showTrace ? findFindingByTopic(findings, r.original) ?? findFindingByTopic(findings, r.display) : undefined}
                className={`text-sm leading-relaxed break-words ${amberBodyCls}`}
              />
            ))}
          </ul>
        </div>
      )}

      {retrievalGapRows.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wide ${violetHeadingCls} mb-1`}>
            Retrieval Gaps
          </h3>
          <p className={`text-sm leading-relaxed ${mutedCls} mb-2`}>
            Deterministic matching found profile evidence for these, but the LLM assessment showed a gap.
            Likely a retrieval miss — verify and confirm in Stage 2 rather than treating as a true gap.
          </p>
          <div className="space-y-2">
            {retrievalGapRows.map((r, i) => (
              <RequirementRow key={i} r={r} finding={showTrace ? findFindingByTopic(findings, r.text) : undefined} tone={tone} />
            ))}
          </div>
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
  tone,
}: {
  title: string
  requirements: JDRequirement[]
  findings?: Stage1Finding[]
  showTrace: boolean
  tone: 'light' | 'dark'
}) {
  if (requirements.length === 0) return null
  const headingCls = tone === 'dark' ? 'text-gray-300' : 'text-gray-500'
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${headingCls} mb-2`}>{title}</h3>
      <div className="space-y-2">
        {requirements.map((r, i) => (
          <RequirementRow
            key={i}
            r={r}
            finding={showTrace ? findFindingByTopic(findings, r.text) : undefined}
            tone={tone}
          />
        ))}
      </div>
    </div>
  )
}

function RequirementRow({ r, finding, tone }: { r: JDRequirement; finding?: Stage1Finding; tone: 'light' | 'dark' }) {
  // Triad grounding is only present once the calibrated artifact contract has been populated.
  const hasTriad = r.jdSignal || r.quickDiqGrounding || r.profileGrounding || r.calibratedFitInterpretation
  const isDark = tone === 'dark'
  const titleCls = isDark ? 'text-gray-100' : 'text-gray-800'
  const metaCls = isDark ? 'text-gray-400' : 'text-gray-500'
  const quoteCls = isDark ? 'text-gray-400' : 'text-gray-500'
  const cardCls = isDark
    ? 'border-gray-700 bg-gray-900/70'
    : 'border-indigo-100 bg-indigo-50/50'
  const cardBodyCls = isDark ? 'text-gray-100' : 'text-gray-800'
  const cardMutedCls = isDark ? 'text-gray-300' : 'text-gray-600'
  const semanticIndigoCls = isDark ? 'text-indigo-200' : 'text-indigo-700'
  const semanticAmberCls = isDark ? 'text-amber-200' : 'text-amber-700'
  const semanticGreenCls = isDark ? 'text-emerald-200' : 'text-green-700'

  return (
    <div className="text-sm leading-relaxed">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <CoverageIndicator status={r.userCoverageStatus} classification={r.classification} />
        <span className={`min-w-0 flex-1 basis-56 break-words [overflow-wrap:anywhere] ${titleCls}`}>
          {requirementDisplayText(r)}
        </span>
        <span className={`shrink-0 text-xs leading-5 ${metaCls}`}>{r.category}</span>
        <TraceChip finding={finding} />
      </div>
      {r.sourceExcerpt && (
        <p className={`mt-1 sm:ml-[68px] text-sm leading-relaxed break-words italic ${quoteCls}`}>"{r.sourceExcerpt}"</p>
      )}
      {!hasTriad && r.profileEvidence && (
        <p className={`mt-1 sm:ml-[68px] text-sm leading-relaxed break-words ${metaCls}`}>{r.profileEvidence}</p>
      )}

      {hasTriad && (
        <div className={`mt-2 sm:ml-[68px] border rounded-md px-3 py-2.5 space-y-2 ${cardCls}`}>
          {r.jdSignal && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${cardMutedCls}`}>JD:</span> {r.jdSignal}</p>
          )}
          {r.quickDiqGrounding && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${semanticIndigoCls}`}>Quick-DIQ:</span> {r.quickDiqGrounding}</p>
          )}
          {r.profileGrounding && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${cardMutedCls}`}>Profile:</span> {r.profileGrounding}</p>
          )}
          {r.calibratedFitInterpretation && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${semanticIndigoCls}`}>Calibrated interpretation:</span> {r.calibratedFitInterpretation}</p>
          )}
          {r.classification && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${cardMutedCls}`}>Classification:</span> {r.classification.replace('_', ' ')}</p>
          )}
          {r.evidenceNeeded && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${semanticAmberCls}`}>Evidence needed:</span> {r.evidenceNeeded}</p>
          )}
          {r.resumeImplication && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${semanticIndigoCls}`}>Resume implication:</span> {r.resumeImplication}</p>
          )}
          {r.stage2Implication && (
            <p className={`text-sm leading-relaxed break-words ${cardBodyCls}`}><span className={`font-semibold ${semanticIndigoCls}`}>Stage 2 implication:</span> {r.stage2Implication}</p>
          )}
          {r.profileEvidenceStrength && r.profileEvidenceStrength !== 'none' && (
            <div className={`text-sm leading-relaxed space-y-1 ${cardBodyCls}`}>
              <p className="break-words">
                <span className={`font-semibold ${semanticGreenCls}`}>Evidence strength:</span>{' '}
                {r.profileEvidenceStrength} ({r.matchedClaimIds?.length ?? 0} matched)
              </p>
              {r.matchedEvidenceTexts?.map((t, i) => (
                <p key={i} className={`italic break-words ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>· {t}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {!hasTriad && r.diqCalibration && (
        <p className={`mt-1 sm:ml-[68px] text-sm leading-relaxed break-words ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
          <span className={`font-medium ${semanticIndigoCls}`}>Quick-DIQ calibration:</span> {r.diqCalibration}
        </p>
      )}
      {!hasTriad && r.resumeImplication && (
        <p className={`mt-1 sm:ml-[68px] text-sm leading-relaxed break-words ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
          <span className={`font-medium ${semanticIndigoCls}`}>Resume implication:</span> {r.resumeImplication}
        </p>
      )}
    </div>
  )
}

function CoverageIndicator({ status, classification }: { status: JDRequirement['userCoverageStatus']; classification?: string }) {
  if (classification === 'retrieval_gap') {
    return <Badge variant="partial" className="shrink-0">retrieval gap</Badge>
  }
  const map: Record<string, React.ReactElement> = {
    covered: <Badge variant="covered" className="shrink-0">covered</Badge>,
    partially_covered: <Badge variant="partial" className="shrink-0">partial</Badge>,
    partial: <Badge variant="partial" className="shrink-0">partial</Badge>,
    gap: <Badge variant="gap" className="shrink-0">gap</Badge>,
    unknown: <Badge variant="neutral" className="shrink-0">?</Badge>,
  }
  return map[status] ?? <Badge variant="neutral" className="shrink-0">?</Badge>
}
