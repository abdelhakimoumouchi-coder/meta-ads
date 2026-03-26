/**
 * components/charts/CreativeScoreChart.tsx
 *
 * Horizontal bar chart showing final scores (0–100) per creative.
 * Pure SVG — no chart library required.
 * Server-safe component.
 */

import { formatScore } from '../../lib/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreDataPoint {
  adId: string;
  adName: string;
  /** finalScore in [0, 1] */
  score: number;
  isEligible: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHART_WIDTH = 480;
const BAR_HEIGHT = 22;
const BAR_GAP = 10;
const LABEL_WIDTH = 120;
const BAR_AREA = CHART_WIDTH - LABEL_WIDTH - 60; // 60 for score text right side

function barColor(score: number): string {
  if (score >= 0.65) return '#10b981'; // emerald-500
  if (score >= 0.4) return '#f59e0b';  // amber-500
  return '#ef4444';                    // red-500
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CreativeScoreChartProps {
  data: ScoreDataPoint[];
}

export function CreativeScoreChart({ data }: CreativeScoreChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-4 text-center">No score data.</p>
    );
  }

  const chartHeight = data.length * (BAR_HEIGHT + BAR_GAP) + BAR_GAP;

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${chartHeight}`}
      width="100%"
      style={{ maxWidth: CHART_WIDTH }}
      aria-label="Creative score chart"
    >
      {data.map((point, i) => {
        const y = BAR_GAP + i * (BAR_HEIGHT + BAR_GAP);
        const barWidth = Math.max(0, point.score * BAR_AREA);
        const truncatedName =
          point.adName.length > 16
            ? point.adName.slice(0, 15) + '…'
            : point.adName;

        return (
          <g key={point.adId}>
            {/* Label */}
            <text
              x={LABEL_WIDTH - 6}
              y={y + BAR_HEIGHT / 2 + 4}
              textAnchor="end"
              fontSize="10"
              fill="#9ca3af"
            >
              {truncatedName}
            </text>

            {/* Background track */}
            <rect
              x={LABEL_WIDTH}
              y={y}
              width={BAR_AREA}
              height={BAR_HEIGHT}
              rx="3"
              fill="#1f2937"
            />

            {/* Score bar */}
            <rect
              x={LABEL_WIDTH}
              y={y}
              width={barWidth}
              height={BAR_HEIGHT}
              rx="3"
              fill={barColor(point.score)}
              opacity={point.isEligible ? 1 : 0.45}
            />

            {/* Score label */}
            <text
              x={LABEL_WIDTH + BAR_AREA + 8}
              y={y + BAR_HEIGHT / 2 + 4}
              fontSize="10"
              fill="#e5e7eb"
              fontFamily="monospace"
            >
              {formatScore(point.score)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
