'use client';

import styles from './charts.module.css';

export interface TrendPoint {
  label: string;
  score: number;
}

/**
 * Score-over-attempts line. Geometry matches the prototype: gridlines every 40 marks,
 * dots on each attempt, labels under the axis.
 */
export function TrendChart({
  points,
  width = 520,
  height = 190,
  padding = 26,
  showGrid = true,
}: {
  points: TrendPoint[];
  width?: number;
  height?: number;
  padding?: number;
  showGrid?: boolean;
}) {
  if (points.length === 0) {
    return <div className={styles.chartEmpty}>No attempts yet.</div>;
  }

  const max = Math.max(140, ...points.map((p) => p.score)) + 20;
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const dots = points.map((point, i) => ({
    ...point,
    x: Math.round(padding + i * step),
    y: Math.round(height - 20 - (point.score / max) * (height - 46)),
  }));

  const polyline = dots.map((d) => `${d.x},${d.y}`).join(' ');
  const gridLines = [0, 1, 2, 3].map((i) => ({
    y: 24 + i * 38,
    ty: 20 + i * 38,
    label: String(160 - i * 40),
  }));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={styles.chartSvg}
      style={{ height }}
      role="img"
      aria-label={`Score trend across ${points.length} attempts`}
    >
      {showGrid
        ? gridLines.map((line) => (
            <g key={line.y}>
              <line
                x1="0"
                y1={line.y}
                x2={width}
                y2={line.y}
                stroke="var(--line2)"
                strokeWidth="1"
              />
              <text x="0" y={line.ty} fill="var(--ink3)" className={styles.gridLabel}>
                {line.label}
              </text>
            </g>
          ))
        : null}

      <polyline
        points={polyline}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {dots.map((dot, i) => (
        <g key={`${dot.label}-${i}`}>
          <circle
            cx={dot.x}
            cy={dot.y}
            r="4.5"
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth="2.4"
          />
          <title>{`${dot.label}: ${dot.score} marks`}</title>
          <text
            x={dot.x}
            y={height - 8}
            textAnchor="middle"
            fill="var(--ink3)"
            className={styles.dotLabel}
          >
            {dot.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
