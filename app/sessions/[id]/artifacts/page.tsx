import { ArtifactsPage } from '@/components/artifacts/artifacts-page'

export default async function ArtifactsRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ArtifactsPage sessionId={id} />
}
