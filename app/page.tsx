import Link from 'next/link'

const STAGES = [
  {
    n: '1',
    label: 'Profile + Resume',
    description: 'Upload your existing resume or fill in your work history. Reused across all job targets.',
    href: '/profile',
    cta: 'Set up profile',
  },
  {
    n: '2',
    label: 'Target Intake',
    description: 'Provide the job description via link, paste, or structured fields. Optionally paste company research.',
    href: '/sessions/new',
    cta: 'New session',
  },
  {
    n: '3',
    label: 'Fit Intelligence',
    description: 'Answer targeted bridge questions that close gaps between your profile and the JD. Or skip straight to generation.',
    href: null,
  },
  {
    n: '4',
    label: 'Artifact Generation',
    description: 'Review generated resume bullets, cover letter, recruiter message, and talking points. Approve or reject each claim.',
    href: null,
  },
  {
    n: '5',
    label: 'Export + Signals',
    description: 'Export your package, run the submission checklist, and surface adjacent roles. Signals persist to improve future sessions.',
    href: null,
  },
]

export default function HomePage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-1">Resume Builder</h1>
      <p className="text-gray-500 mb-10 text-sm">
        Evidence-backed. No invented claims. Five stages per job target.
      </p>

      <div className="relative">
        {/* Connector line */}
        <div className="absolute left-[19px] top-8 bottom-8 w-px bg-gray-200" aria-hidden />

        <ol className="space-y-0">
          {STAGES.map((s, i) => (
            <li key={s.n} className="flex gap-5 pb-8 last:pb-0">
              <div className="shrink-0 w-10 h-10 rounded-full border-2 border-gray-300 bg-white flex items-center justify-center text-sm font-semibold text-gray-600 relative z-10">
                {s.n}
              </div>
              <div className="pt-1.5 min-w-0">
                <div className="font-semibold text-sm text-gray-900">{s.label}</div>
                <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{s.description}</p>
                {s.href && (
                  <Link
                    href={s.href}
                    className="inline-block mt-2 text-xs font-medium text-gray-900 underline underline-offset-2 hover:text-gray-600"
                  >
                    {s.cta} →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-12 pt-8 border-t border-gray-100 flex gap-6 text-sm text-gray-400">
        <Link href="/sessions" className="hover:text-gray-700">All sessions</Link>
        <Link href="/signals" className="hover:text-gray-700">Learning signals</Link>
      </div>
    </main>
  )
}
