/**
 * components/dashboard/CreativePerformanceTable.tsx
 *
 * Table showing per-ad performance: spend, score, conversations, CTR,
 * current daily budget, and eligibility for reallocation.
 * Server-safe component.
 */

import type { AdScore } from '../../types/optimizer';
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from '../ui/table';
import { Badge } from '../ui/badge';
import {
  formatUsd,
  formatScore,
  formatPct,
  formatNumber,
} from '../../lib/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreativeRow {
  adId: string;
  adName: string;
  adStatus: string;
  /** Current daily budget in USD (from DB ad set). */
  dailyBudgetUsd: number;
  score: AdScore | null;
  /** Aggregate metrics from DB (lifetime of campaign). */
  metrics: {
    spendUsd: number;
    impressions: number;
    ctr: number;
    conversationsStarted: number;
    costPerConversationUsd: number | null;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adStatusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return 'success';
    case 'PAUSED':
      return 'warning';
    case 'DISAPPROVED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function scoreColor(score: number): string {
  if (score >= 0.65) return 'text-emerald-400';
  if (score >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CreativePerformanceTableProps {
  rows: CreativeRow[];
}

export function CreativePerformanceTable({ rows }: CreativePerformanceTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-4 text-center">
        No creative data available. Run a sync first.
      </p>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeader>Creative</TableHeader>
          <TableHeader>Status</TableHeader>
          <TableHeader>Daily Budget</TableHeader>
          <TableHeader>Spend</TableHeader>
          <TableHeader>Impressions</TableHeader>
          <TableHeader>CTR</TableHeader>
          <TableHeader>Convs</TableHeader>
          <TableHeader>Cost/Conv</TableHeader>
          <TableHeader>Score</TableHeader>
          <TableHeader>Eligible</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => {
          const finalScore = row.score?.finalScore ?? null;
          const eligible = row.score?.isEligible ?? false;

          return (
            <TableRow key={row.adId}>
              {/* Creative name */}
              <TableCell className="max-w-[160px] truncate font-medium text-gray-100">
                {row.adName}
              </TableCell>

              {/* Status */}
              <TableCell>
                <Badge variant={adStatusVariant(row.adStatus)}>
                  {row.adStatus}
                </Badge>
              </TableCell>

              {/* Daily budget */}
              <TableCell className="font-mono">
                {formatUsd(row.dailyBudgetUsd)}
              </TableCell>

              {/* Total spend */}
              <TableCell className="font-mono">
                {formatUsd(row.metrics.spendUsd)}
              </TableCell>

              {/* Impressions */}
              <TableCell className="font-mono">
                {formatNumber(row.metrics.impressions)}
              </TableCell>

              {/* CTR */}
              <TableCell className="font-mono">
                {formatPct(row.metrics.ctr, 2)}
              </TableCell>

              {/* Conversations */}
              <TableCell className="font-mono">
                {formatNumber(row.metrics.conversationsStarted)}
              </TableCell>

              {/* Cost per conversation */}
              <TableCell className="font-mono">
                {row.metrics.costPerConversationUsd != null
                  ? formatUsd(row.metrics.costPerConversationUsd)
                  : '—'}
              </TableCell>

              {/* Score */}
              <TableCell>
                {finalScore !== null ? (
                  <span className={`font-mono font-semibold ${scoreColor(finalScore)}`}>
                    {formatScore(finalScore)}
                  </span>
                ) : (
                  <span className="text-gray-600">—</span>
                )}
              </TableCell>

              {/* Eligible for reallocation */}
              <TableCell>
                {row.score === null ? (
                  <span className="text-gray-600">—</span>
                ) : eligible ? (
                  <Badge variant="success">Yes</Badge>
                ) : (
                  <Badge variant="neutral">No</Badge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
