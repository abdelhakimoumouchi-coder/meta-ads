/**
 * components/dashboard/MetricPill.tsx
 *
 * Small inline metric display: label + value pair.
 * Used in overview cards and performance tables.
 */

interface MetricPillProps {
  label: string;
  value: string | number;
  /** Optional sub-text (e.g. change from previous) */
  sub?: string;
  className?: string;
}

export function MetricPill({ label, value, sub, className = '' }: MetricPillProps) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </span>
      <span className="text-sm font-mono text-gray-100">{value}</span>
      {sub && (
        <span className="text-[10px] text-gray-500">{sub}</span>
      )}
    </div>
  );
}
