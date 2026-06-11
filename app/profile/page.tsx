import { ProfileForm } from '@/components/profile/profile-form'

export default function ProfilePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-8">
        <a href="/" className="text-sm text-gray-500 hover:text-gray-700">← Home</a>
        <h1 className="text-2xl font-bold mt-3">Your Profile</h1>
        <p className="text-sm text-gray-500 mt-1">
          Your validated work history, skills, and constraints. Built once, reused across all sessions.
        </p>
      </div>
      <ProfileForm />
    </main>
  )
}
