/**
 * components/dashboard/OptimizationLogTable.tsx
 *
 * Table listing recent optimization runs: when they ran, what triggered them,
 * whether a reallocation happened, and why (or why not).
 * Server-safe component.
 */

import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from '../ui/table';
import { Badge } from '../ui/badge';
import type { DbOptimizationRun } from '../../types/db';
import type { AdBudgetAllocation } from '../../types/campaign';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRunTime(date: Date | string): string {
  try {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(date);
  }
}

function skipReasonLabel(reason: string | null): string {
  if (!reason) return '—';
  switch (reason) {
    case 'TOO_SOON':
      return 'Too soon';
    case 'INSUFFICIENT_DATA':
      return 'Low data';
    case 'DANGER_PACING':
      return 'Danger pacing';
    case 'NO_CHANGE_NEEDED':
      return 'No change needed';
    case 'BUDGET_EXHAUSTED':
      return 'Budget exhausted';
    default:
      return reason;
  }
}

function parseBudgetSummary(json: string | null): string {
  if (!json) return '—';
  try {
    const allocs = JSON.parse(json) as AdBudgetAllocation[];
    if (!Array.isArray(allocs) || allocs.length === 0) return '—';
    return allocs
      .map((a) => `$${a.dailyBudgetUsd.toFixed(0)}`)
      .join(' / ');
  } catch {
    return '—';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface OptimizationLogTableProps {
  runs: DbOptimizationRun[];
}

export function OptimizationLogTable({ runs }: OptimizationLogTableProps) {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-4 text-center">
        No optimization runs yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeader>Time</TableHeader>
          <TableHeader>Trigger</TableHeader>
          <TableHeader>Reallocated</TableHeader>
          <TableHeader>Reason Skipped</TableHeader>
          <TableHeader>Budget Before</TableHeader>
          <TableHeader>Budget After</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="whitespace-nowrap text-gray-400">
              {formatRunTime(run.createdAt)}
            </TableCell>

            <TableCell>
              <Badge variant={run.triggeredBy === 'manual' ? 'info' : 'neutral'}>
                {run.triggeredBy}
              </Badge>
            </TableCell>

            <TableCell>
              {run.reallocated ? (
                <Badge variant="success">Yes</Badge>
              ) : (
                <Badge variant="neutral">No</Badge>
              )}
            </TableCell>

            <TableCell className="text-gray-500">
              {run.reallocated ? '—' : skipReasonLabel(run.skipReason)}
            </TableCell>

            <TableCell className="font-mono text-gray-400">
              {parseBudgetSummary(run.previousAllocationJson)}
            </TableCell>

            <TableCell className="font-mono text-gray-300">
              {run.reallocated
                ? parseBudgetSummary(run.newAllocationJson)
                : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
