import { SessionShell } from '@/components/sessions/session-shell'

export default async function SessionLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SessionShell sessionId={id}>{children}</SessionShell>
}
