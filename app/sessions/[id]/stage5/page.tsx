import { SessionSignalsPage } from '@/components/signals/session-signals-page'

export default async function Stage5Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SessionSignalsPage sessionId={id} />
}
