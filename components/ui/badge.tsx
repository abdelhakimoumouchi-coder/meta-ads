/**
 * components/ui/badge.tsx
 *
 * A simple pill badge for status labels.
 */

import type { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-gray-700 text-gray-200',
  success: 'bg-emerald-900 text-emerald-300',
  warning: 'bg-amber-900 text-amber-300',
  danger: 'bg-red-900 text-red-300',
  info: 'bg-indigo-900 text-indigo-300',
  neutral: 'bg-gray-800 text-gray-400',
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
