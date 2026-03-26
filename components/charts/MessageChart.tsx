/**
 * components/charts/MessageChart.tsx
 *
 * Vertical bar chart showing messaging conversations per ad (or per day).
 * Pure SVG — no chart library required.
 * Server-safe component.
 */

import { formatNumber } from '../../lib/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessageDataPoint {
  label: string;
  conversations: number;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const CHART_HEIGHT = 140;
const CHART_BOTTOM_LABEL = 20;
const BAR_TOP_LABEL = 16;
const USABLE_HEIGHT = CHART_HEIGHT - CHART_BOTTOM_LABEL - BAR_TOP_LABEL;

// ─── Component ────────────────────────────────────────────────────────────────

interface MessageChartProps {
  data: MessageDataPoint[];
  /** Total chart width in logical units (viewBox). Default: 480 */
  chartWidth?: number;
}

export function MessageChart({ data, chartWidth = 480 }: MessageChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-4 text-center">
        No conversation data.
      </p>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.conversations), 1);
  const totalHeight = CHART_HEIGHT;
  const barCount = data.length;
  const barWidth = Math.max(20, (chartWidth / barCount) * 0.55);
  const barSpacing = chartWidth / barCount;

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${totalHeight}`}
      width="100%"
      style={{ maxWidth: chartWidth }}
      aria-label="Messaging conversations chart"
    >
      {data.map((point, i) => {
        const barH = (point.conversations / maxVal) * USABLE_HEIGHT;
        const x = i * barSpacing + barSpacing / 2 - barWidth / 2;
        const y = BAR_TOP_LABEL + USABLE_HEIGHT - barH;
        const truncatedLabel =
          point.label.length > 10 ? point.label.slice(0, 9) + '…' : point.label;

        return (
          <g key={i}>
            {/* Bar */}
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barH, 1)}
              rx="2"
              fill="#6366f1" // indigo-500
            />

            {/* Value label above bar */}
            {point.conversations > 0 && (
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#e5e7eb"
                fontFamily="monospace"
              >
                {formatNumber(point.conversations)}
              </text>
            )}

            {/* Bottom label */}
            <text
              x={x + barWidth / 2}
              y={totalHeight - 4}
              textAnchor="middle"
              fontSize="9"
              fill="#6b7280"
            >
              {truncatedLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
