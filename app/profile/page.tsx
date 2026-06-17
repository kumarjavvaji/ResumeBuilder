import { ProfileEvidenceMap } from '@/components/profile/profile-evidence-map'
import { ProfileFormCollapsible } from '@/components/profile/profile-form-collapsible'

export default function ProfilePage() {
  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6">
        <a href="/" className="text-sm text-gray-500 hover:text-gray-300">← Home</a>
        <h1 className="text-2xl font-bold mt-3">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">
          Unified evidence model — resumes, bridge answers, and accepted edits coalesced by capability.
        </p>
      </div>
      <ProfileEvidenceMap />
      <ProfileFormCollapsible />
    </main>
  )
}
