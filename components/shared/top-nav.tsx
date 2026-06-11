'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

const LINKS = [
  { label: 'Profile', href: '/profile' },
  { label: 'Sessions', href: '/sessions' },
  { label: 'Signals', href: '/signals' }
]

export function TopNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950">
      <div className="max-w-screen-xl mx-auto px-6 h-12 flex items-center gap-8">
        <Link href="/" className="text-sm font-semibold text-white tracking-tight shrink-0">
          Resume Builder
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map(l => {
            const active = pathname === l.href || pathname.startsWith(l.href + '/')
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'px-3 py-1.5 rounded text-sm transition-colors',
                  active
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                )}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
