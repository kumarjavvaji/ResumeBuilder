import { SessionList } from '@/components/sessions/session-list'

export default function SessionsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-8">
        <a href="/" className="text-sm text-gray-500 hover:text-gray-700">← Home</a>
        <div className="flex items-center justify-between mt-3">
          <h1 className="text-2xl font-bold">Job Sessions</h1>
          <a
            href="/sessions/new"
            className="px-4 py-2 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-700"
          >
            New Session
          </a>
        </div>
      </div>
      <SessionList />
    </main>
  )
}
