import { SessionDetail } from '@/components/sessions/session-detail'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SessionDetail sessionId={id} />
}
