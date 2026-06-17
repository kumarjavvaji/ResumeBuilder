'use client'
import { useEffect, useMemo, useState } from 'react'
import { getActiveSnapshot } from '@/lib/profile/profileSnapshotStore'
import { getUserProfile } from '@/lib/storage/user-profile'
import { backfillBridgeAnswersToProfile } from '@/lib/profile/backfillBridgeAnswersToProfile'
import type { ProfileSnapshot, ProfileClaim, ProfileSkill, ProfileTool, ProfileSource, UserProfile } from '@/contracts'

// ─── Capability classification ─────────────────────────────────────────────────

type CapabilityId =
  | 'product-ownership' | 'product-analysis' | 'requirements' | 'data-reporting'
  | 'uat-release' | 'security-iam' | 'stakeholder' | 'agile' | 'tools'
  | 'metrics-outcomes' | 'domain' | 'other'

const CAPABILITIES: { id: CapabilityId; name: string; tokens: string[] }[] = [
  { id: 'product-ownership',  name: 'Product Ownership',
    tokens: ['product owner', 'backlog', 'roadmap', 'prioritiz', 'product strateg', 'go-to-market', 'product lifecycle', 'product vision', 'product management', 'product roadmap'] },
  { id: 'product-analysis',   name: 'Product Analysis / Business Analysis',
    tokens: ['product analyst', 'business analyst', 'analyz', 'enhancement request', 'defect request', 'triage', 'client feedback', 'pendo', 'voice of customer', 'feature request', 'user research', 'salesforce request'] },
  { id: 'requirements',       name: 'Requirements / Documentation',
    tokens: ['user stor', 'acceptance criteria', 'functional spec', 'requirement', 'process doc', 'brd', 'confluence', 'documentation', 'release note', 'spec writing'] },
  { id: 'data-reporting',     name: 'Data / Reporting',
    tokens: ['dashboard', 'sql', 'report', 'excel', 'tableau', 'power bi', 'looker', 'analytics', 'kpi', 'adoption metric', 'usage data', 'data query', 'data analysis'] },
  { id: 'uat-release',        name: 'UAT / Release Readiness',
    tokens: ['uat', 'quality assur', 'regression', 'release', 'sign-off', 'post-release', 'defect track', 'patch', 'hotfix', 'production validation', 'release readiness', 'test plan'] },
  { id: 'security-iam',       name: 'Security / IAM / Access Control',
    tokens: ['security', 'iam', 'identity', 'sso', 'mfa', 'access control', 'permission', 'authentica', 'compliance', 'audit', 'vulnerability'] },
  { id: 'stakeholder',        name: 'Stakeholder / Executive Communication',
    tokens: ['stakeholder', 'executive', 'leadership', 'present', 'cross-functional', 'align', 'director', 'c-suite', 'communic', 'roadmap review', 'vp', 'senior management'] },
  { id: 'agile',              name: 'Agile Delivery',
    tokens: ['agile', 'scrum', 'sprint', 'kanban', 'ceremon', 'retrospective', 'standup', 'stand-up', 'velocity', 'backlog refinement', 'epic', 'story point', 'pi planning', 'safe'] },
  { id: 'tools',              name: 'Tools / Platforms',
    tokens: ['jira', 'sharepoint', 'azure devops', 'figma', 'miro', 'servicenow', 'zendesk', 'slack', 'microsoft', 'lucidchart', 'visio', 'notion'] },
  { id: 'metrics-outcomes',   name: 'Metrics / Business Outcomes',
    tokens: ['million', 'revenue', 'retention', 'reduction', 'cost sav', 'roi', 'monthly active', 'mau', 'nps', 'churn', 'growth', 'increase', '$', 'percent', '%', 'annual'] },
  { id: 'domain',             name: 'Domain / Industry Context',
    tokens: ['healthcare', 'fintech', 'banking', 'insurance', 'retail', 'saas', 'b2b', 'hcm', 'payroll', 'hr tech', 'supply chain', 'hospitality', 'industry', 'vertical'] },
]

function classifyText(text: string): CapabilityId {
  const lower = text.toLowerCase()
  for (const cap of CAPABILITIES) {
    if (cap.tokens.some(t => lower.includes(t))) return cap.id
  }
  return 'other'
}

// ─── Source badges ─────────────────────────────────────────────────────────────

const SOURCE_STYLE: Record<string, { label: string; cls: string }> = {
  resume_upload:     { label: 'Resume Upload',  cls: 'bg-blue-900/50 text-blue-300 border-blue-700' },
  bridge_answer:     { label: 'Bridge Answer',  cls: 'bg-purple-900/50 text-purple-300 border-purple-700' },
  accepted_artifact: { label: 'Accepted Edit',  cls: 'bg-green-900/50 text-green-300 border-green-700' },
  manual_intake:     { label: 'Manual',         cls: 'bg-gray-700 text-gray-300 border-gray-600' },
  prior_session:     { label: 'Prior Session',  cls: 'bg-gray-700 text-gray-300 border-gray-600' },
}

function resolveSourceTypes(sourceIds: string[], sourceIndex: ProfileSource[]): string[] {
  const types = new Set<string>()
  for (const id of sourceIds) {
    const src = sourceIndex.find(s => s.sourceId === id)
    if (src) types.add(src.sourceType)
  }
  return [...types]
}

function SourceBadge({ type }: { type: string }) {
  const s = SOURCE_STYLE[type] ?? { label: type, cls: 'bg-gray-700 text-gray-300 border-gray-600' }
  return <span className={`text-xs px-2 py-0.5 rounded border ${s.cls}`}>{s.label}</span>
}

// ─── Strength helpers ──────────────────────────────────────────────────────────

const STRENGTH_CLS: Record<string, string> = {
  Strong: 'bg-green-900/50 text-green-400 border-green-700',
  Medium: 'bg-amber-900/50 text-amber-400 border-amber-700',
  Weak:   'bg-red-900/50 text-red-400 border-red-700',
}

function deriveStrength(claims: ProfileClaim[]): 'Strong' | 'Medium' | 'Weak' {
  if (claims.length === 0) return 'Weak'
  const strong = claims.filter(c => c.evidenceStrength === 'strong').length
  const med    = claims.filter(c => c.evidenceStrength === 'medium').length
  if (strong >= 2 || (strong >= 1 && claims.length >= 3)) return 'Strong'
  if (med >= 2 || strong >= 1) return 'Medium'
  return 'Weak'
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CapGroup {
  id: CapabilityId
  name: string
  claims: ProfileClaim[]
  skills: ProfileSkill[]
  tools: ProfileTool[]
  strength: 'Strong' | 'Medium' | 'Weak'
}

// ─── Capability Card ───────────────────────────────────────────────────────────

function CapabilityCard({ group, sourceIndex }: { group: CapGroup; sourceIndex: ProfileSource[] }) {
  const totalEvidence = group.claims.length + group.skills.length + group.tools.length
  const resumeCount = group.claims.filter(c =>
    c.sourceIds.some(id => sourceIndex.find(s => s.sourceId === id)?.sourceType === 'resume_upload')
  ).length
  const bridgeCount = group.claims.filter(c =>
    c.sourceIds.some(id => sourceIndex.find(s => s.sourceId === id)?.sourceType === 'bridge_answer')
  ).length
  const topClaims = group.claims.slice(0, 5)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-white leading-snug">{group.name}</h4>
        <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${STRENGTH_CLS[group.strength]}`}>
          {group.strength}
        </span>
      </div>

      <ul className="space-y-1.5">
        {topClaims.map(claim => (
          <li key={claim.claimId} className="flex items-start gap-2">
            <span className="text-gray-600 mt-0.5 shrink-0">•</span>
            <span className="text-xs text-gray-300 leading-relaxed">{claim.text}</span>
          </li>
        ))}
        {group.claims.length === 0 && group.skills.length > 0 && (
          <li className="text-xs text-gray-400">
            {group.skills.map(s => s.name).join(' · ')}
          </li>
        )}
        {group.tools.length > 0 && group.claims.length === 0 && group.skills.length === 0 && (
          <li className="text-xs text-gray-400">
            {group.tools.map(t => t.name).join(' · ')}
          </li>
        )}
      </ul>

      <div className="pt-2 border-t border-gray-800 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500">Evidence ({totalEvidence})</span>
        {resumeCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-blue-400">
            <span className="w-2.5 h-2.5 rounded bg-blue-900 border border-blue-700 inline-block shrink-0" />
            Resume Upload ({resumeCount})
          </span>
        )}
        {bridgeCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-purple-400">
            <span className="w-2.5 h-2.5 rounded bg-purple-900 border border-purple-700 inline-block shrink-0" />
            Bridge Answer ({bridgeCount})
          </span>
        )}
        {group.skills.length > 0 && (
          <span className="text-xs text-gray-600">+{group.skills.length} skill{group.skills.length !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ProfileEvidenceMap() {
  const [snapshot, setSnapshot]   = useState<ProfileSnapshot | null>(null)
  const [profile, setProfile]     = useState<UserProfile | null>(null)
  const [query, setQuery]         = useState('')
  const [loading, setLoading]     = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    async function load() {
      // Backfill any answered bridge questions not yet in the snapshot (idempotent).
      // Runs silently — if it writes, the subsequent getActiveSnapshot picks up the result.
      await backfillBridgeAnswersToProfile().catch(() => {})
      const [snap, prof] = await Promise.all([getActiveSnapshot(), getUserProfile()])
      setSnapshot(snap ?? null)
      setProfile(prof ?? null)
      setLoading(false)
    }
    load()
  }, [refreshKey])

  // ─── Capability groups ───────────────────────────────────────────────────────
  const groups = useMemo<CapGroup[]>(() => {
    if (!snapshot) return []
    const dims = snapshot.dimensions
    const buckets = new Map<CapabilityId, CapGroup>()
    for (const cap of CAPABILITIES) {
      buckets.set(cap.id, { id: cap.id, name: cap.name, claims: [], skills: [], tools: [], strength: 'Weak' })
    }
    buckets.set('other', { id: 'other', name: 'General / Other', claims: [], skills: [], tools: [], strength: 'Weak' })

    for (const claim of dims.experienceClaims) {
      if (claim.status !== 'active') continue
      buckets.get(classifyText(claim.text))!.claims.push(claim)
    }
    for (const skill of dims.skills) {
      buckets.get(classifyText(skill.name))!.skills.push(skill)
    }
    for (const tool of dims.tools) {
      buckets.get('tools')!.tools.push(tool)
    }

    const result: CapGroup[] = []
    for (const [, g] of buckets) {
      const total = g.claims.length + g.skills.length + g.tools.length
      if (total === 0) continue
      g.strength = deriveStrength(g.claims)
      result.push(g)
    }
    return result.sort((a, b) =>
      (b.claims.length + b.skills.length) - (a.claims.length + a.skills.length)
    )
  }, [snapshot])

  // ─── Search ──────────────────────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !snapshot) return null
    type Result = { kind: string; text: string; types: string[] }
    const hits: Result[] = []
    const dims = snapshot.dimensions

    for (const c of dims.experienceClaims) {
      if (c.status === 'active' && c.text.toLowerCase().includes(q))
        hits.push({ kind: 'Claim', text: c.text, types: resolveSourceTypes(c.sourceIds, snapshot.sourceIndex) })
    }
    for (const s of dims.skills) {
      if (s.name.toLowerCase().includes(q))
        hits.push({ kind: 'Skill', text: s.name, types: resolveSourceTypes(s.sourceIds, snapshot.sourceIndex) })
    }
    for (const m of dims.metrics) {
      if (m.text.toLowerCase().includes(q))
        hits.push({ kind: 'Metric', text: m.text, types: resolveSourceTypes(m.sourceIds, snapshot.sourceIndex) })
    }
    for (const t of dims.tools) {
      if (t.name.toLowerCase().includes(q))
        hits.push({ kind: 'Tool', text: t.name, types: resolveSourceTypes(t.sourceIds, snapshot.sourceIndex) })
    }
    if (profile) {
      for (const w of (profile.workHistory ?? [])) {
        if (w.title.toLowerCase().includes(q) || w.company.toLowerCase().includes(q))
          hits.push({ kind: 'Role', text: `${w.title} at ${w.company}`, types: [] })
        for (const b of (w.bullets ?? []))
          if (b.toLowerCase().includes(q)) hits.push({ kind: 'Bullet', text: b, types: [] })
        for (const m of (w.approvedMetrics ?? []))
          if (m.toLowerCase().includes(q)) hits.push({ kind: 'Metric', text: m, types: [] })
      }
      for (const c of (profile.constraints ?? []))
        if (c.toLowerCase().includes(q)) hits.push({ kind: 'Constraint', text: c, types: [] })
      for (const r of (profile.rejectedPhrases ?? []))
        if (r.toLowerCase().includes(q)) hits.push({ kind: 'Rejected Phrase', text: r, types: [] })
    }
    return hits
  }, [query, snapshot, profile])

  // ─── Loading / empty states ───────────────────────────────────────────────────
  if (loading) return (
    <div className="py-24 text-center text-sm text-gray-500">Loading evidence map…</div>
  )

  if (!snapshot) return (
    <div className="py-12 text-center space-y-2">
      <p className="text-sm text-gray-400">No profile evidence yet.</p>
      <p className="text-xs text-gray-600">Upload a resume below to build your evidence model.</p>
    </div>
  )

  const dims = snapshot.dimensions
  const si   = snapshot.sourceIndex
  const resumeCount  = si.filter(s => s.sourceType === 'resume_upload').length
  const bridgeCount  = si.filter(s => s.sourceType === 'bridge_answer').length
  const activeClaims = dims.experienceClaims.filter(c => c.status === 'active').length
  const weakClaims   = dims.experienceClaims.filter(c => c.status === 'active' && c.evidenceStrength === 'weak').length
  const updatedAt    = new Date(snapshot.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

  const recentBridge = [...si]
    .filter(s => s.sourceType === 'bridge_answer')
    .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
    .slice(0, 3)
    .map(src => ({
      src,
      claims: dims.experienceClaims.filter(c => c.sourceIds.includes(src.sourceId) && c.status === 'active'),
    }))

  const sourceLedger = si.map(src => ({
    src,
    claimCount:
      dims.experienceClaims.filter(c => c.sourceIds.includes(src.sourceId)).length +
      dims.skills.filter(s => s.sourceIds.includes(src.sourceId)).length +
      dims.tools.filter(t => t.sourceIds.includes(src.sourceId)).length,
  }))

  const wellSupported = groups.filter(g => g.strength === 'Strong').map(g => g.name)
  const needsMore     = groups.filter(g => g.strength === 'Weak' && g.claims.length > 0).map(g => g.name)

  return (
    <div className="space-y-6">

      {/* ── Overview Strip ── */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Profile Evidence Map</h2>
            <p className="text-xs text-gray-500 mt-0.5">Unified view of your professional evidence</p>
          </div>
          <div className="flex items-center gap-3 text-right">
            <div className="text-xs text-gray-400 leading-snug">
              Active Snapshot: v{snapshot.version}<br />
              <span className="text-gray-600">Updated: {updatedAt}</span>
            </div>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="text-xs px-3 py-1.5 border border-gray-700 rounded hover:border-gray-500 text-gray-400 hover:text-white transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Active Snapshot',         value: `v${snapshot.version}`, sub: updatedAt.split(',')[0] },
            { label: 'Total Evidence Sources',  value: si.length,              sub: 'Across resumes & bridge answers' },
            { label: 'Resume Upload Sources',   value: resumeCount,            sub: 'Parsed resumes' },
            { label: 'Bridge Answer Sources',   value: bridgeCount,            sub: 'From fit assessments' },
            { label: 'Active Claims',           value: activeClaims,           sub: 'Supporting your profile' },
            { label: 'Weak / Needs Review',     value: weakClaims,             sub: 'May need more proof' },
          ].map(stat => (
            <div key={stat.label} className="bg-gray-800/60 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1 leading-tight">{stat.label}</div>
              <div className="text-xl font-bold text-white">{stat.value}</div>
              <div className="text-xs text-gray-600 mt-0.5 leading-tight">{stat.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search skills, tools, achievements, metrics, constraints…"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
          >
            ✕ clear
          </button>
        )}
      </div>

      {/* ── Search Results ── */}
      {searchResults !== null && (
        <div className="space-y-2">
          {searchResults.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No matching profile evidence found.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</p>
              {searchResults.map((r, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-start gap-3">
                  <span className="text-xs text-gray-600 mt-0.5 shrink-0 w-24">{r.kind}</span>
                  <span className="text-sm text-gray-300 flex-1">{r.text}</span>
                  <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                    {r.types.map(t => <SourceBadge key={t} type={t} />)}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Main: Evidence Map + Right Rail ── */}
      {searchResults === null && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Evidence Map — 2/3 */}
          <div className="lg:col-span-2 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Evidence Map by Capability</h3>
              <p className="text-xs text-gray-500 mt-0.5">Coalesced evidence from uploaded resumes, bridge answers, and edits.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {groups.map(g => <CapabilityCard key={g.id} group={g} sourceIndex={si} />)}
            </div>
          </div>

          {/* Right Rail — 1/3 */}
          <div className="space-y-5">

            {/* Recent Bridge Evidence */}
            {recentBridge.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-white">Recent Bridge Evidence</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Latest answers added to your profile</p>
                </div>
                {recentBridge.map(({ src, claims }) => (
                  <div key={src.sourceId} className="pb-3 border-b border-gray-800 last:border-0 last:pb-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SourceBadge type="bridge_answer" />
                      <span className="text-xs text-gray-500">
                        {new Date(src.extractedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                    {claims.slice(0, 2).map(c => (
                      <p key={c.claimId} className="text-xs text-gray-300 leading-relaxed">{c.text}</p>
                    ))}
                    {claims.length === 0 && (
                      <p className="text-xs text-gray-600 italic">No linked claims found</p>
                    )}
                    {src.sessionId && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {resolveSourceTypes(
                          dims.experienceClaims
                            .filter(c => c.sourceIds.includes(src.sourceId))
                            .flatMap(c => c.sourceIds)
                            .filter((id, i, a) => a.indexOf(id) === i),
                          si
                        ).filter(t => t !== 'bridge_answer').map(t => <SourceBadge key={t} type={t} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Coverage at a Glance */}
            {(wellSupported.length > 0 || needsMore.length > 0) && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-white">Coverage at a Glance</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Where your profile is strong vs gaps</p>
                </div>
                {wellSupported.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-green-400">Well Supported</p>
                    {wellSupported.map(name => (
                      <div key={name} className="flex items-center gap-2 text-xs text-gray-300">
                        <span className="text-green-500 shrink-0">✓</span>{name}
                      </div>
                    ))}
                  </div>
                )}
                {needsMore.length > 0 && (
                  <div className="space-y-1.5 mt-1">
                    <p className="text-xs font-medium text-amber-400">Needs More Evidence</p>
                    {needsMore.map(name => (
                      <div key={name} className="flex items-center gap-2 text-xs text-gray-300">
                        <span className="text-amber-500 shrink-0">△</span>{name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Generation Guardrails */}
            {profile && ((profile.constraints ?? []).length > 0 || (profile.rejectedPhrases ?? []).length > 0) && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-semibold text-white">Generation Guardrails</h4>
                <p className="text-xs text-gray-500">Rules that guide every resume</p>
                {(profile.constraints ?? []).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-400">Format Rules</p>
                    {(profile.constraints ?? []).map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
                        <span className="text-green-500 mt-0.5 shrink-0">✓</span>{c}
                      </div>
                    ))}
                  </div>
                )}
                {(profile.rejectedPhrases ?? []).length > 0 && (
                  <div className="space-y-2 mt-1">
                    <p className="text-xs font-medium text-gray-400">Rejected Phrases</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(profile.rejectedPhrases ?? []).map((r, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-red-900/40 border border-red-800 text-red-400 rounded line-through">{r}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Source Ledger */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-white">Source Ledger</h4>
                <p className="text-xs text-gray-500 mt-0.5">All evidence sources and claim counts</p>
              </div>
              <div className="space-y-2">
                {sourceLedger.map(({ src, claimCount }) => {
                  const s = SOURCE_STYLE[src.sourceType] ?? { label: src.sourceType, cls: 'bg-gray-700 text-gray-300 border-gray-600' }
                  const label = src.sourceType === 'bridge_answer'
                    ? (src.questionText ? src.questionText.slice(0, 60) + (src.questionText.length > 60 ? '…' : '') : src.sessionId?.slice(0, 12) + '…')
                    : (src.filename ?? (src.sessionId ? src.sessionId.slice(0, 12) + '…' : src.sourceId.slice(0, 10) + '…'))
                  const date  = new Date(src.extractedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  return (
                    <div key={src.sourceId} className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${s.cls}`}>{s.label}</span>
                        <span className="text-xs text-gray-400 flex-1 truncate">{label}</span>
                        <span className="text-xs text-gray-600 shrink-0">{claimCount}</span>
                      </div>
                      {src.sourceType === 'bridge_answer' && src.answerSnippet && (
                        <div className="text-xs text-gray-600 pl-1 truncate italic">"{src.answerSnippet}"</div>
                      )}
                      <div className="text-xs text-gray-600 pl-1">{date}{src.questionType ? ` · ${src.questionType}` : ''}</div>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Role Evidence ── */}
      {searchResults === null && profile && (profile.workHistory ?? []).length > 0 && (
        <div className="space-y-3 pt-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Role Evidence</h3>
            <p className="text-xs text-gray-500 mt-0.5">What each role in your career proves</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(profile.workHistory ?? []).map(w => {
              const roleClaims = dims.experienceClaims.filter(c =>
                c.status === 'active' && c.text.toLowerCase().includes(w.company.toLowerCase())
              )
              const roleSourceTypes = [...new Set(
                roleClaims.flatMap(c => resolveSourceTypes(c.sourceIds, si))
              )]
              const topMetrics = (w.approvedMetrics ?? []).slice(0, 3)
              const supportedCaps = groups
                .filter(g => g.strength === 'Strong' && g.claims.some(c =>
                  c.text.toLowerCase().includes(w.company.toLowerCase()) ||
                  c.text.toLowerCase().includes(w.title.toLowerCase().split(' ')[0].toLowerCase())
                ))
                .map(g => g.name)
                .slice(0, 3)

              return (
                <div key={w.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{w.title}</p>
                      <p className="text-xs text-gray-400">{w.company}</p>
                    </div>
                    <span className="text-xs text-gray-600 shrink-0 text-right leading-tight">
                      {w.startDate}<br/>–{w.endDate}
                    </span>
                  </div>
                  {w.domain && <p className="text-xs text-gray-500">Domain: {w.domain}</p>}
                  {supportedCaps.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {supportedCaps.map(cap => (
                        <span key={cap} className="text-xs px-1.5 py-0.5 bg-gray-800 border border-gray-700 text-gray-400 rounded">{cap}</span>
                      ))}
                    </div>
                  )}
                  {topMetrics.length > 0 && (
                    <ul className="space-y-0.5">
                      {topMetrics.map((m, i) => (
                        <li key={i} className="text-xs text-gray-400">· {m}</li>
                      ))}
                    </ul>
                  )}
                  {roleSourceTypes.length > 0 && (
                    <div className="flex gap-1 flex-wrap pt-1">
                      {roleSourceTypes.map(t => <SourceBadge key={t} type={t} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
