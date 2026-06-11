import { BridgeQuestionsPage } from '@/components/artifacts/bridge-questions-page'

export default async function BridgePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <BridgeQuestionsPage sessionId={id} />
}
