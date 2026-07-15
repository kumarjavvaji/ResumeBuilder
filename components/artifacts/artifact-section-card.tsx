'use client'
import { useState } from 'react'
import type { ArtifactSection, ResumeBullet, BulletPartition, SectionType, ArtifactGenerationProvenance, RefinementEvidenceBoundary } from '@/contracts'
import { isGlobalEvidenceWarning } from '@/lib/evidence-scope'
import { formatCalibrationInfluenceLine } from '@/lib/calibration/influence'
import { Badge } from '@/components/shared/badge'
import { cn } from '@/lib/cn'
import { inputCls, textareaCls } from '@/lib/input-cls'

interface Props {
  section: ArtifactSection
  isGenerating?: boolean
  /** Global domain-gap warnings already shown at session level — filtered out here. */
  globalWarnings?: string[]
  /** The ID of the currently applied calibration state — used to detect stale provenance. */
  currentCalibrationStateId?: string
  onAccept: () => void
  onReject: (reason?: string) => void
  onRefine: (instruction: string) => void
  onBulletApproval: (bulletId: string, approved: boolean) => void
  onManualSave: (content: string, note?: string) => void
}

// ─── Calibration provenance line ──────────────────────────────────────────────

function ProvenanceLine({ provenance, currentCalibrationStateId }: {
  provenance: ArtifactGenerationProvenance | undefined
  currentCalibrationStateId?: string
}) {
  if (!provenance) return null

  const { calibrationUsed, calibrationStatusAtGeneration, calibrationStateId,
          targetReferenceCount, comparableReferenceCount, appliedCalibrationPatterns } = provenance

  // Stale: calibration was used and a newer applied state exists
  const isStale = calibrationUsed && currentCalibrationStateId !== undefined &&
    calibrationStateId !== currentCalibrationStateId

  if (isStale) {
    const priorLabel = calibrationStateId
      ? ` Prior calibration version: ${calibrationStateId.slice(0, 8)}.`
      : ''
    const counts = targetReferenceCount !== undefined || comparableReferenceCount !== undefined
      ? ` Generated with ${targetReferenceCount ?? 0} target / ${comparableReferenceCount ?? 0} comparable refs.`
      : ''
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/20 border border-amber-900/40 rounded text-xs text-amber-500">
        <span>⚠</span>
        <span>Calibration changed after this section was generated.{priorLabel}{counts} Regenerate to apply latest guidance.</span>
      </div>
    )
  }

  if (!calibrationUsed || calibrationStatusAtGeneration === 'none' || calibrationStatusAtGeneration === 'skipped') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900/40 border border-gray-800 rounded text-xs text-gray-600">
        <span>
          {calibrationStatusAtGeneration === 'skipped' ? 'Calibration skipped at generation.' : 'Generated without calibration.'}
        </span>
      </div>
    )
  }

  const partial = calibrationStatusAtGeneration === 'applied_partial'
  const tc = targetReferenceCount ?? 0
  const cc = comparableReferenceCount ?? 0

  const MAX_VISIBLE = 4
  const allPatterns = appliedCalibrationPatterns ?? []
  const visiblePatterns = allPatterns.slice(0, MAX_VISIBLE)
  const extraCount = Math.max(0, allPatterns.length - MAX_VISIBLE)
  const patternText = visiblePatterns.length > 0
    ? visiblePatterns.join(', ') + (extraCount > 0 ? ` +${extraCount} more` : '')
    : ''

  return (
    <div className="flex items-start gap-1.5 px-3 py-1.5 bg-blue-950/15 border border-blue-900/30 rounded text-xs text-blue-400/80">
      <span className="shrink-0">✦</span>
      <span>
        Generated with calibration: {tc} target ref{tc !== 1 ? 's' : ''} / {cc} comparable ref{cc !== 1 ? 's' : ''}
        {partial ? ' · Partial' : ''}
        {patternText ? ` · Patterns: ${patternText}` : ''}
      </span>
    </div>
  )
}

const SECTION_LABELS: Partial<Record<SectionType, string>> = {
  'experience-primary': 'Experience (Product Owner)',
  'experience-secondary': 'Experience (Business Analyst)',
  'experience-supporting': 'Experience (QA / Quality)',
  summary: 'Professional Summary',
  skills: 'Skills',
}

function CalibrationInfluenceAudit({ section }: { section: ArtifactSection }) {
  const line = formatCalibrationInfluenceLine(section.calibrationInfluence)
  if (!line) return null

  const decisions = section.calibrationInfluence?.artifactDecisions ?? []

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1.5 px-3 py-1.5 bg-slate-900/50 border border-slate-700 rounded text-xs text-slate-300">
        <span className="shrink-0">-&gt;</span>
        <span>{line}</span>
      </div>

      {decisions.length > 0 && (
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-300 select-none">
            Calibration decisions ({decisions.length})
          </summary>
          <ul className="mt-1.5 pl-2 space-y-1.5">
            {decisions.map((d, i) => (
              <li key={`${d.pattern}-${i}`} className="text-gray-500 border-l border-slate-700 pl-2">
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-slate-300">{d.pattern}</span>
                  <span className="text-slate-500">[{d.decisionType}]</span>
                  {d.affectedClaimIds?.length ? (
                    <span className="text-slate-600">claims: {d.affectedClaimIds.join(', ')}</span>
                  ) : d.affectedSection ? (
                    <span className="text-slate-600">section: {d.affectedSection}</span>
                  ) : null}
                </div>
                <p className="mt-0.5">{d.decision}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function RefinementReviewPanel({
  changeSummary,
  evidenceBoundary,
  confidence,
}: {
  changeSummary: string[]
  evidenceBoundary?: RefinementEvidenceBoundary
  confidence?: 'high' | 'medium' | 'low'
}) {
  const confidenceColor =
    confidence === 'high' ? 'text-green-400' :
    confidence === 'low' ? 'text-amber-400' : 'text-blue-400'

  return (
    <div className="space-y-2 px-3 py-2.5 bg-blue-950/20 border border-blue-900/40 rounded text-xs">
      <div className="flex items-center gap-2">
        <span className="text-blue-300 font-medium">Refinement review</span>
        {confidence && (
          <span className={cn('font-medium', confidenceColor)}>
            · confidence: {confidence}
          </span>
        )}
      </div>

      {changeSummary.length > 0 && (
        <div>
          <p className="text-gray-400 mb-1">What changed:</p>
          <ul className="space-y-0.5">
            {changeSummary.map((c, i) => (
              <li key={i} className="text-gray-300 pl-2 border-l border-blue-800">· {c}</li>
            ))}
          </ul>
        </div>
      )}

      {evidenceBoundary && (
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-400 select-none">
            Evidence boundary
            {evidenceBoundary.unsupportedRequests.length > 0 && (
              <span className="ml-1 text-amber-500">
                · {evidenceBoundary.unsupportedRequests.length} request{evidenceBoundary.unsupportedRequests.length !== 1 ? 's' : ''} declined
              </span>
            )}
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {evidenceBoundary.preservedClaims.length > 0 && (
              <div>
                <p className="text-gray-600">Preserved claims:</p>
                <ul className="pl-2">
                  {evidenceBoundary.preservedClaims.map((c, i) => (
                    <li key={i} className="text-gray-500">· {c}</li>
                  ))}
                </ul>
              </div>
            )}
            {evidenceBoundary.removedOrSoftenedClaims.length > 0 && (
              <div>
                <p className="text-gray-600">Removed or softened:</p>
                <ul className="pl-2">
                  {evidenceBoundary.removedOrSoftenedClaims.map((c, i) => (
                    <li key={i} className="text-amber-600">· {c}</li>
                  ))}
                </ul>
              </div>
            )}
            {evidenceBoundary.unsupportedRequests.length > 0 && (
              <div>
                <p className="text-amber-500 font-medium">Declined (unsupported):</p>
                <ul className="pl-2">
                  {evidenceBoundary.unsupportedRequests.map((c, i) => (
                    <li key={i} className="text-amber-600">· {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

export function ArtifactSectionCard({
  section, isGenerating = false, globalWarnings = [],
  currentCalibrationStateId,
  onAccept, onReject, onRefine, onBulletApproval, onManualSave
}: Props) {
  const [refineMode, setRefineMode] = useState(false)
  const [refineDraft, setRefineDraft] = useState('')
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editDraft, setEditDraft] = useState(section.content)
  const [editNote, setEditNote] = useState('')

  // ── Partition bullets ────────────────────────────────────────────────────────
  // Old bullets without partition default to 'display' for backward compat.
  const displayBullets    = section.bullets.filter(b => (b.partition ?? 'display') === 'display')
  const confirmBullets    = section.bullets.filter(b => b.partition === 'needs-confirmation')
  const excludedBullets   = section.bullets.filter(b => b.partition === 'excluded')
  const suggestedBullets  = section.bullets.filter(b => b.partition === 'suggested-other')

  // Filter out domain-gap warnings already shown at the session level
  const sectionWarnings = (section.evidenceWarnings ?? []).filter(w =>
    // Always show partition-specific warnings; only suppress global domain-gap ones
    !w.startsWith('Claim partitioned') && (globalWarnings.length === 0 || !isGlobalEvidenceWarning(w))
  )
  const partitionWarnings = (section.evidenceWarnings ?? []).filter(w => w.startsWith('Claim partitioned'))

  const hasEvidenceWarnings = sectionWarnings.length > 0
  const isAccepted = section.status === 'accepted'
  const isRejected = section.status === 'rejected'

  const hasBullets = section.bullets.length > 0
  const hasNonDisplayClaims = confirmBullets.length + excludedBullets.length + suggestedBullets.length > 0

  function closeAllModes() {
    setRefineMode(false)
    setRejectMode(false)
    setEditMode(false)
  }

  return (
    <div className="px-5 py-5 space-y-4">
      {/* Loading overlay */}
      {isGenerating && (
        <div className="text-xs text-blue-400 animate-pulse">Generating…</div>
      )}

      {/* Generation provenance */}
      <ProvenanceLine
        provenance={section.generationProvenance}
        currentCalibrationStateId={currentCalibrationStateId}
      />

      <CalibrationInfluenceAudit section={section} />

      {/* Evidence warnings (section-specific only; domain-gap warnings shown globally) */}
      {hasEvidenceWarnings && (
        <div className="space-y-1 bg-amber-950/30 border border-amber-800/50 rounded px-3 py-2">
          <p className="text-xs font-medium text-amber-400">Evidence warnings</p>
          {sectionWarnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-300/80">· {w}</p>
          ))}
        </div>
      )}

      {/* Content: edit mode vs display */}
      {editMode ? (
        <div className="space-y-3">
          <textarea
            className={`${textareaCls} min-h-[160px] font-mono text-xs text-gray-200 bg-gray-900`}
            value={editDraft}
            onChange={e => setEditDraft(e.target.value)}
          />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Edit note (optional)</label>
            <input
              className={cn(inputCls, 'text-xs')}
              placeholder="Why did you change this?"
              value={editNote}
              onChange={e => setEditNote(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { onManualSave(editDraft, editNote || undefined); closeAllModes() }}
              disabled={!editDraft.trim()}
              className="px-3 py-1.5 bg-gray-200 text-gray-900 rounded text-xs font-medium hover:bg-white disabled:opacity-40"
            >
              Save Edit
            </button>
            <button
              onClick={() => { setEditDraft(section.content); closeAllModes() }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : hasBullets ? (
        <div className="space-y-2">
          {/* ── Primary display bullets — the only content that will be accepted/exported ── */}
          {displayBullets.length > 0 ? (
            <>
              {displayBullets.map(bullet => (
                <BulletRow
                  key={bullet.id}
                  bullet={bullet}
                  onApprove={() => onBulletApproval(bullet.id, true)}
                  onReject={() => onBulletApproval(bullet.id, false)}
                />
              ))}
            </>
          ) : (
            <p className="text-xs text-gray-500 italic px-1">
              All generated claims were partitioned to diagnostics. Use "Refine with note" to regenerate.
            </p>
          )}

          {/* ── Partitioned claim panels ─────────────────────────────────────────── */}
          {hasNonDisplayClaims && (
            <div className="mt-3 space-y-2 border-t border-gray-800 pt-3">
              <p className="text-xs text-gray-600 font-medium">
                Claims below were not added to the section. They do not appear in accepted content.
              </p>

              {/* Needs confirmation */}
              {confirmBullets.length > 0 && (
                <PartitionPanel
                  label={`Needs confirmation (${confirmBullets.length})`}
                  labelCls="text-amber-500"
                  borderCls="border-amber-900/40"
                >
                  {confirmBullets.map(b => (
                    <PartitionBulletRow key={b.id} bullet={b} />
                  ))}
                </PartitionPanel>
              )}

              {/* Suggested for another section */}
              {suggestedBullets.length > 0 && (
                <PartitionPanel
                  label={`Suggested for another section (${suggestedBullets.length})`}
                  labelCls="text-blue-400"
                  borderCls="border-blue-900/40"
                >
                  {suggestedBullets.map(b => (
                    <PartitionBulletRow
                      key={b.id}
                      bullet={b}
                      suffix={b.suggestedSection ? `→ try ${SECTION_LABELS[b.suggestedSection] ?? b.suggestedSection}` : undefined}
                    />
                  ))}
                </PartitionPanel>
              )}

              {/* Excluded */}
              {excludedBullets.length > 0 && (
                <PartitionPanel
                  label={`Excluded by scope (${excludedBullets.length})`}
                  labelCls="text-red-500"
                  borderCls="border-red-900/40"
                >
                  {excludedBullets.map(b => (
                    <PartitionBulletRow key={b.id} bullet={b} />
                  ))}
                </PartitionPanel>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
          {section.content}
        </div>
      )}

      {/* Source mappings */}
      {(section.sourceMappings?.length ?? 0) > 0 && (
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-300 select-none">
            Source mappings ({section.sourceMappings!.length})
          </summary>
          <ul className="mt-1.5 pl-2 space-y-0.5">
            {section.sourceMappings!.map((m, i) => (
              <li key={i} className="text-gray-500 font-mono">· {m}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Signal influence */}
      {section.signalInfluence && (
        <div className="flex items-center gap-1.5 text-xs text-violet-400">
          <span>◈</span>
          <span>{section.signalInfluence}</span>
        </div>
      )}

      {/* Rationale */}
      {section.generationRationale && (
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-300 select-none">Why this was written this way</summary>
          <p className="mt-1 text-gray-500 pl-2">{section.generationRationale}</p>
        </details>
      )}

      {/* JD traceability */}
      {section.jdTraceability.length > 0 && (
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-300 select-none">
            JD requirements addressed ({section.jdTraceability.length})
          </summary>
          <ul className="mt-1 pl-2 space-y-0.5">
            {section.jdTraceability.map((t, i) => (
              <li key={i} className="text-gray-500">· {t}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Blocked claim diagnostics — collapsed by default */}
      {(section.blockedClaimDiagnostics?.length ?? 0) > 0 && (
        <details className="text-xs">
          <summary className="text-gray-600 cursor-pointer hover:text-gray-400 select-none">
            Claim scope diagnostics ({section.blockedClaimDiagnostics!.length})
          </summary>
          <ul className="mt-1.5 pl-2 space-y-1.5">
            {section.blockedClaimDiagnostics!.map((d, i) => (
              <li key={i} className="text-gray-600 border-l border-gray-700 pl-2">
                <span className={cn(
                  'text-xs font-medium mr-1',
                  d.disposition === 'excluded' ? 'text-red-500' :
                  d.disposition === 'downgraded' ? 'text-amber-500' : 'text-blue-400'
                )}>[{d.disposition}]</span>
                <span className="text-gray-500 italic">"{d.blockedClaimText.slice(0, 80)}{d.blockedClaimText.length > 80 ? '…' : ''}"</span>
                <br />
                <span className="text-gray-600">{d.reason}</span>
                {d.suggestedSection && (
                  <span className="text-gray-600"> → try: {d.suggestedSection}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* User note from manual edit */}
      {section.userNote && (
        <p className="text-xs text-gray-500 italic">Edit note: {section.userNote}</p>
      )}

      {/* Controls — hidden during edit mode */}
      {!editMode && !isRejected && (
        <div className="pt-2 border-t border-gray-700">
          {isAccepted ? (
            <p className="text-xs text-green-500 font-medium">
              Accepted{section.acceptedAt ? ` · ${new Date(section.acceptedAt).toLocaleDateString()}` : ''}
              {' — '}use "Request Changes" in the section header to revise with a specific instruction.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { onAccept(); closeAllModes() }}
                className="px-3 py-1.5 bg-green-800 text-green-100 rounded text-xs font-medium hover:bg-green-700"
              >
                Accept{displayBullets.length > 0 ? ` (${displayBullets.length} bullet${displayBullets.length !== 1 ? 's' : ''})` : ''}
              </button>

              <button
                onClick={() => { setEditMode(true); setEditDraft(section.content); setRefineMode(false); setRejectMode(false) }}
                className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded text-xs hover:border-gray-400 hover:text-white"
              >
                Edit manually
              </button>

              <button
                onClick={() => { setRefineMode(r => !r); setRejectMode(false) }}
                className={cn(
                  'px-3 py-1.5 border rounded text-xs',
                  refineMode
                    ? 'border-blue-500 text-blue-300 bg-blue-950/30'
                    : 'border-gray-600 text-gray-300 hover:border-gray-400 hover:text-white'
                )}
              >
                Refine with note
              </button>

              <button
                onClick={() => { setRejectMode(r => !r); setRefineMode(false) }}
                className={cn(
                  'px-3 py-1.5 border rounded text-xs',
                  rejectMode
                    ? 'border-red-500 text-red-400 bg-red-950/30'
                    : 'border-gray-700 text-gray-500 hover:border-red-700 hover:text-red-400'
                )}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {isRejected && (
        <div className="pt-2 border-t border-gray-700 text-xs text-red-500 font-medium">
          Rejected — content preserved but will not be exported.
        </div>
      )}

      {/* Refinement review panel — shown after LLM refinement, before accept */}
      {section.status === 'needs_review' && section.refinementChangeSummary && section.refinementChangeSummary.length > 0 && !refineMode && (
        <RefinementReviewPanel
          changeSummary={section.refinementChangeSummary}
          evidenceBoundary={section.refinementEvidenceBoundary}
          confidence={section.refinementConfidence}
        />
      )}

      {/* Refine panel */}
      {refineMode && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-gray-500">
            Tell the AI what to improve — this is instruction, not replacement text.
          </p>
          <textarea
            className={`${textareaCls} h-20 text-xs text-gray-200 bg-gray-900`}
            placeholder="Tell the AI what to improve: tighter BA framing, more credit-union language, reduce QA by 30%, remove puff language, preserve metrics."
            value={refineDraft}
            onChange={e => setRefineDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => { onRefine(refineDraft); setRefineMode(false); setRefineDraft('') }}
              disabled={!refineDraft.trim()}
              className="px-3 py-1.5 bg-blue-800 text-blue-100 rounded text-xs font-medium disabled:opacity-40 hover:bg-blue-700"
            >
              Apply Refinement
            </button>
            <button onClick={() => setRefineMode(false)} className="text-xs text-gray-500 hover:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reject panel */}
      {rejectMode && (
        <div className="space-y-2 pt-1">
          <input
            className={cn(inputCls, 'text-xs')}
            placeholder="Optional: phrase or pattern to avoid in future generations"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => { onReject(rejectReason || undefined); setRejectMode(false) }}
              className="px-3 py-1.5 bg-red-800 text-red-100 rounded text-xs font-medium hover:bg-red-700"
            >
              Confirm Reject
            </button>
            <button onClick={() => setRejectMode(false)} className="text-xs text-gray-500 hover:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Partition panel ──────────────────────────────────────────────────────────

function PartitionPanel({
  label, labelCls, borderCls, children
}: {
  label: string
  labelCls: string
  borderCls: string
  children: React.ReactNode
}) {
  return (
    <details className={cn('text-xs border rounded px-3 py-2', borderCls)}>
      <summary className={cn('cursor-pointer select-none font-medium', labelCls)}>
        {label}
      </summary>
      <div className="mt-2 space-y-1.5">
        {children}
      </div>
    </details>
  )
}

// ─── Partition bullet row (read-only) ─────────────────────────────────────────

function PartitionBulletRow({ bullet, suffix }: { bullet: ResumeBullet; suffix?: string }) {
  return (
    <div className="text-xs text-gray-500 border-l border-gray-700 pl-2">
      <p className="text-gray-400">{bullet.text}</p>
      {bullet.partitionReason && (
        <p className="text-gray-600 mt-0.5">{bullet.partitionReason}</p>
      )}
      {suffix && <p className="text-blue-500 mt-0.5">{suffix}</p>}
    </div>
  )
}

// ─── Primary display bullet row ───────────────────────────────────────────────

function BulletRow({ bullet, onApprove, onReject }: {
  bullet: ResumeBullet
  onApprove: () => void
  onReject: () => void
}) {
  const claimBadge: Record<ResumeBullet['claimStatus'], React.ReactNode> = {
    supported: <Badge variant="supported">supported</Badge>,
    'supported-with-reframing': <Badge variant="reframing">reframing</Badge>,
    'needs-user-confirmation': <Badge variant="confirm">needs confirmation</Badge>,
    unsupported: <Badge variant="unsupported">unsupported</Badge>
  }

  return (
    <div className={cn(
      'flex items-start gap-3 rounded px-3 py-2',
      bullet.claimStatus === 'unsupported' ? 'bg-red-950/40' :
      bullet.claimStatus === 'needs-user-confirmation' ? 'bg-amber-950/40' : 'bg-gray-800/40'
    )}>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200">{bullet.text}</p>
        <div className="flex items-center gap-2 mt-1">
          {claimBadge[bullet.claimStatus]}
          {bullet.evidenceRef && (
            <span className="text-xs text-gray-500">via {bullet.evidenceRef}</span>
          )}
        </div>
      </div>
      <div className="flex gap-1 shrink-0 mt-0.5">
        <button
          onClick={onApprove}
          className={cn(
            'px-2 py-1 rounded text-xs border',
            bullet.approved === true
              ? 'bg-green-900 border-green-600 text-green-300'
              : 'border-gray-600 text-gray-500 hover:border-green-600 hover:text-green-400'
          )}
          title="Approve bullet"
        >✓</button>
        <button
          onClick={onReject}
          className={cn(
            'px-2 py-1 rounded text-xs border',
            bullet.approved === false
              ? 'bg-red-900 border-red-600 text-red-300'
              : 'border-gray-600 text-gray-500 hover:border-red-600 hover:text-red-400'
          )}
          title="Reject bullet"
        >✗</button>
      </div>
    </div>
  )
}
