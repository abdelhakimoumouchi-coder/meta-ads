/**
 * components/charts/SpendChart.tsx
 *
 * Vertical bar chart showing spend in USD per ad (or per day).
 * Pure SVG — no chart library required.
 * Server-safe component.
 */

import { formatUsd } from '../../lib/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpendDataPoint {
  label: string;
  /** Spend in USD */
  spendUsd: number;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const CHART_HEIGHT = 140;
const CHART_BOTTOM_LABEL = 20;
const BAR_TOP_LABEL = 16;
const USABLE_HEIGHT = CHART_HEIGHT - CHART_BOTTOM_LABEL - BAR_TOP_LABEL;

// ─── Component ────────────────────────────────────────────────────────────────

interface SpendChartProps {
  data: SpendDataPoint[];
  /** Optional total budget line in USD to draw as a reference. */
  budgetCapUsd?: number;
  /** Total chart width in logical units (viewBox). Default: 480 */
  chartWidth?: number;
}

export function SpendChart({ data, budgetCapUsd, chartWidth = 480 }: SpendChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-4 text-center">No spend data.</p>
    );
  }

  const maxSpend = Math.max(
    ...data.map((d) => d.spendUsd),
    budgetCapUsd ?? 0,
    1,
  );

  const totalHeight = CHART_HEIGHT;
  const barCount = data.length;
  const barWidth = Math.max(20, (chartWidth / barCount) * 0.55);
  const barSpacing = chartWidth / barCount;

  // If a budget cap is provided, render it as a dashed horizontal reference line.
  const capY = budgetCapUsd != null
    ? BAR_TOP_LABEL + USABLE_HEIGHT - (budgetCapUsd / maxSpend) * USABLE_HEIGHT
    : null;

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${totalHeight}`}
      width="100%"
      style={{ maxWidth: chartWidth }}
      aria-label="Spend chart"
    >
      {/* Budget cap reference line */}
      {capY !== null && budgetCapUsd != null && (
        <g>
          <line
            x1={0}
            y1={capY}
            x2={chartWidth}
            y2={capY}
            stroke="#f59e0b"
            strokeWidth="1"
            strokeDasharray="4 3"
            opacity="0.6"
          />
          <text
            x={chartWidth - 2}
            y={capY - 3}
            textAnchor="end"
            fontSize="8"
            fill="#f59e0b"
            opacity="0.8"
          >
            cap {formatUsd(budgetCapUsd)}
          </text>
        </g>
      )}

      {data.map((point, i) => {
        const barH = (point.spendUsd / maxSpend) * USABLE_HEIGHT;
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
              fill="#10b981" // emerald-500
            />

            {/* Value label above bar */}
            {point.spendUsd > 0 && (
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#e5e7eb"
                fontFamily="monospace"
              >
                {formatUsd(point.spendUsd)}
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
