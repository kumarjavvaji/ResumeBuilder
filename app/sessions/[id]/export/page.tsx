export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await params // id reserved for future export implementation
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Stage 4 — Export</h1>
        <p className="text-sm text-gray-400 mt-1">
          Export DOCX / PDF, cover letter, submission checklist, and find similar roles.
        </p>
      </div>
      <div className="border border-gray-700 rounded-lg px-5 py-8 text-sm text-gray-500 text-center">
        Export coming soon. Complete Stage 3 artifact review first.
      </div>
    </div>
  )
}
