/**
 * components/ui/card.tsx
 *
 * Container card for dashboard panels.
 */

import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`bg-gray-900 border border-gray-800 rounded-lg p-4 ${className}`}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export function CardHeader({ children, className = '' }: CardHeaderProps) {
  return (
    <div className={`mb-4 pb-3 border-b border-gray-800 ${className}`}>
      {children}
    </div>
  );
}

interface CardTitleProps {
  children: ReactNode;
  className?: string;
}

export function CardTitle({ children, className = '' }: CardTitleProps) {
  return (
    <h3
      className={`text-xs font-semibold uppercase tracking-wider text-gray-400 ${className}`}
    >
      {children}
    </h3>
  );
}
