import { RawResumeTextPage } from '@/components/export/raw-resume-text-page'

export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <RawResumeTextPage sessionId={id} />
}
