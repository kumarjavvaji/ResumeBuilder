import { IntakeForm } from '@/components/intake/intake-form'

export default function NewSessionPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-8">
        <a href="/sessions" className="text-sm text-gray-500 hover:text-gray-700">← Sessions</a>
        <h1 className="text-2xl font-bold mt-3">Stage 1 — Target Intake</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set your resume context (Step 1), then provide the job description (Step 2). Analysis runs before saving.
        </p>
      </div>
      <IntakeForm />
    </main>
  )
}
