import type { Metadata } from 'next'
import { TopNav } from '@/components/shared/top-nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Resume Builder',
  description: 'Staged job-targeting resume tool'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100">
        <TopNav />
        {children}
      </body>
    </html>
  )
}
