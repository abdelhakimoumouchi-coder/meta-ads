/**
 * components/dashboard/BudgetStatusCard.tsx
 *
 * Displays campaign-level pacing status: spend vs expected, remaining budget,
 * days remaining, and a progress bar. Color-coded by pacing state.
 */

import type { PacingStatus, PacingState } from '../../types/optimizer';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { MetricPill } from './MetricPill';
import { formatUsd, formatPct, formatDaysRemaining } from '../../lib/utils/format';

// ─── Pacing state helpers ─────────────────────────────────────────────────────

function pacingBadgeVariant(
  state: PacingState,
): 'success' | 'info' | 'warning' | 'danger' {
  switch (state) {
    case 'UNDER_PACING':
      return 'info';
    case 'ON_TRACK':
      return 'success';
    case 'OVER_PACING':
      return 'warning';
    case 'DANGER':
      return 'danger';
  }
}

function pacingProgressColor(
  state: PacingState,
): 'emerald' | 'indigo' | 'amber' | 'red' {
  switch (state) {
    case 'UNDER_PACING':
      return 'indigo';
    case 'ON_TRACK':
      return 'emerald';
    case 'OVER_PACING':
      return 'amber';
    case 'DANGER':
      return 'red';
  }
}

function pacingLabel(state: PacingState): string {
  switch (state) {
    case 'UNDER_PACING':
      return 'Under Pacing';
    case 'ON_TRACK':
      return 'On Track';
    case 'OVER_PACING':
      return 'Over Pacing';
    case 'DANGER':
      return 'Danger';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface BudgetStatusCardProps {
  pacing: PacingStatus;
  /** Total campaign budget in USD (for computing spend percentage). */
  totalBudgetUsd: number;
}

export function BudgetStatusCard({ pacing, totalBudgetUsd }: BudgetStatusCardProps) {
  const spentPct = totalBudgetUsd > 0
    ? Math.min(100, (pacing.totalSpentUsd / totalBudgetUsd) * 100)
    : 0;

  const deviationSign = pacing.deviationFraction >= 0 ? '+' : '';
  const deviationStr = `${deviationSign}${formatPct(pacing.deviationFraction * 100, 1)} vs expected`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Budget Pacing</CardTitle>
          <Badge variant={pacingBadgeVariant(pacing.state)}>
            {pacingLabel(pacing.state)}
          </Badge>
        </div>
      </CardHeader>

      {/* Progress bar: total spend as % of campaign budget */}
      <div className="mb-4">
        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
          <span>Spent</span>
          <span>{formatUsd(pacing.totalSpentUsd)} / {formatUsd(totalBudgetUsd)}</span>
        </div>
        <Progress
          value={spentPct}
          color={pacingProgressColor(pacing.state)}
        />
        <div className="mt-1 text-[10px] text-gray-500 text-right">
          {spentPct.toFixed(1)}% of total budget
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricPill
          label="Total Spent"
          value={formatUsd(pacing.totalSpentUsd)}
        />
        <MetricPill
          label="Expected"
          value={formatUsd(pacing.expectedSpendUsd)}
          sub={deviationStr}
        />
        <MetricPill
          label="Remaining"
          value={formatUsd(pacing.remainingBudgetUsd)}
        />
        <MetricPill
          label="Days Left"
          value={formatDaysRemaining(pacing.daysRemaining)}
        />
      </div>
    </Card>
  );
}
