'use client'
import { cn } from '@/lib/cn'

type Variant = 'supported' | 'reframing' | 'confirm' | 'unsupported' | 'gap' | 'covered' | 'partial' | 'neutral'

const variantStyles: Record<Variant, string> = {
  supported: 'bg-green-100 text-green-800 border-green-200',
  reframing: 'bg-blue-100 text-blue-800 border-blue-200',
  confirm: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  unsupported: 'bg-red-100 text-red-800 border-red-200',
  gap: 'bg-red-50 text-red-700 border-red-200',
  covered: 'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  neutral: 'bg-gray-100 text-gray-700 border-gray-200'
}

interface BadgeProps {
  variant: Variant
  children: React.ReactNode
  className?: string
}

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
      variantStyles[variant],
      className
    )}>
      {children}
    </span>
  )
}
