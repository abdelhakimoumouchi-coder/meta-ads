/**
 * components/dashboard/CampaignOverviewCard.tsx
 *
 * Top-level campaign summary card: status, dates, aggregate performance,
 * and last sync time. Server-safe (no client hooks).
 */

import type { CampaignStatus } from '../../types/campaign';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { MetricPill } from './MetricPill';
import {
  formatUsd,
  formatNumber,
  formatCompact,
} from '../../lib/utils/format';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return 'success';
    case 'PAUSED':
      return 'warning';
    case 'DELETED':
    case 'ARCHIVED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function formatDate(d: Date | string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return String(d);
  }
}

function formatSyncTime(d: Date | string | null): string {
  if (!d) return 'Never';
  try {
    return new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(d);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface CampaignOverviewData {
  name: string;
  status: CampaignStatus | string;
  startDate: Date | string | null;
  stopDate: Date | string | null;
  objectiveType: string | null;
  syncedAt: Date | string | null;
  /** Aggregate metrics across all ads for the campaign lifetime. */
  totals: {
    impressions: number;
    clicks: number;
    conversationsStarted: number;
    spendUsd: number;
  };
}

interface CampaignOverviewCardProps {
  campaign: CampaignOverviewData;
}

export function CampaignOverviewCard({ campaign }: CampaignOverviewCardProps) {
  const { name, status, startDate, stopDate, objectiveType, syncedAt, totals } =
    campaign;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Campaign</CardTitle>
            <p className="mt-1 text-sm text-gray-200 font-medium truncate max-w-xs">
              {name}
            </p>
            {objectiveType && (
              <p className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wide">
                {objectiveType}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={statusVariant(status)}>{status}</Badge>
            <span className="text-[10px] text-gray-600">
              {formatDate(startDate)} – {formatDate(stopDate)}
            </span>
          </div>
        </div>
      </CardHeader>

      {/* Aggregate performance metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricPill
          label="Total Spend"
          value={formatUsd(totals.spendUsd)}
        />
        <MetricPill
          label="Impressions"
          value={formatCompact(totals.impressions)}
        />
        <MetricPill
          label="Clicks"
          value={formatNumber(totals.clicks)}
        />
        <MetricPill
          label="Conversations"
          value={formatNumber(totals.conversationsStarted)}
        />
      </div>

      {/* Footer: last sync */}
      <div className="mt-4 pt-3 border-t border-gray-800 text-[10px] text-gray-600">
        Last synced: {formatSyncTime(syncedAt)}
      </div>
    </Card>
  );
}
