/**
 * components/ui/progress.tsx
 *
 * A simple horizontal progress bar.
 */

interface ProgressProps {
  /** Value from 0 to 100 */
  value: number;
  /** Optional color override */
  color?: 'indigo' | 'emerald' | 'amber' | 'red';
  className?: string;
}

const COLOR_CLASSES: Record<NonNullable<ProgressProps['color']>, string> = {
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

export function Progress({ value, color = 'indigo', className = '' }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      className={`w-full h-2 bg-gray-800 rounded-full overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${COLOR_CLASSES[color]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
