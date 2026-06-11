'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/storage/sessions'
import type { TargetIntake, StageKey, StageStatus } from '@/contracts'
import { deriveStageStatuses } from '@/contracts'
import { cn } from '@/lib/cn'
import { Breadcrumb } from '@/components/shared/breadcrumb'

interface Stage {
  key: StageKey
  label: string
  description: string
  href: (id: string) => string
}

const STAGES: Stage[] = [
  { key: 'intake',    label: 'Stage 1', description: 'Target Intake',        href: id => `/sessions/${id}` },
  { key: 'bridge',   label: 'Stage 2', description: 'Fit Intelligence',      href: id => `/sessions/${id}/bridge` },
  { key: 'artifacts',label: 'Stage 3', description: 'Artifact Refinement',   href: id => `/sessions/${id}/artifacts` },
  { key: 'export',   label: 'Stage 4', description: 'Export',                href: id => `/sessions/${id}/export` },
  { key: 'signals',  label: 'Stage 5', description: 'Session Signals',       href: id => `/sessions/${id}/stage5` },
]

function StatusDot({ status }: { status: StageStatus }) {
  return (
    <span className={cn(
      'shrink-0 w-2 h-2 rounded-full',
      status === 'complete' ? 'bg-green-400' :
      status === 'active'   ? 'bg-blue-400 ring-2 ring-blue-400/30' :
                              'bg-gray-600'
    )} />
  )
}

export function SessionShell({
  sessionId,
  children
}: {
  sessionId: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [session, setSession] = useState<TargetIntake | null>(null)

  useEffect(() => {
    getSession(sessionId).then(s => setSession(s ?? null))
  }, [sessionId])

  const stageStatuses = session?.stageStatuses ?? deriveStageStatuses('intake')

  // Determine active stage from pathname
  function isActiveStage(stage: Stage): boolean {
    const target = stage.href(sessionId)
    if (stage.key === 'intake') return pathname === target
    return pathname.startsWith(target)
  }

  const breadcrumbItems = [
    { label: 'Sessions', href: '/sessions' },
    { label: session ? `${session.roleTitle} at ${session.company}` : '…' }
  ]

  return (
    <div className="flex min-h-[calc(100vh-3rem)]">
      {/* Stage sidebar */}
      <aside className="w-56 shrink-0 border-r border-gray-800 bg-gray-950 pt-6 pb-10 px-3 flex flex-col gap-1">
        {/* Session identity */}
        <div className="px-3 mb-4">
          {session ? (
            <>
              <div className="text-xs font-semibold text-white leading-tight truncate">{session.roleTitle}</div>
              <div className="text-xs text-gray-400 truncate">{session.company}</div>
            </>
          ) : (
            <div className="text-xs text-gray-600">Loading...</div>
          )}
        </div>

        {STAGES.map(stage => {
          const active = isActiveStage(stage)
          const status = stageStatuses[stage.key]

          return (
            <Link
              key={stage.key}
              href={stage.href(sessionId)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
              )}
            >
              <StatusDot status={status} />
              <div className="min-w-0">
                <div className="text-xs text-gray-500 leading-none mb-0.5">{stage.label}</div>
                <div className={cn('text-sm leading-tight truncate', active ? 'text-white' : 'text-gray-300')}>
                  {stage.description}
                </div>
              </div>
            </Link>
          )
        })}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <Breadcrumb items={breadcrumbItems} />
          {children}
        </div>
      </div>
    </div>
  )
}
