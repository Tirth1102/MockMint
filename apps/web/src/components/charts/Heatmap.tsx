'use client';

import type { HeatCell } from '@mockmint/shared';
import styles from './charts.module.css';

/** Practice heatmap. `columns` sets the grid width — 14 on the dashboard, 26 on the calendar. */
export function Heatmap({ cells, columns }: { cells: HeatCell[]; columns: number }) {
  return (
    <div
      className={styles.heat}
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      role="img"
      aria-label={`Practice activity across the last ${cells.length} days`}
    >
      {cells.map((cell) => (
        <div
          key={cell.date}
          className={styles.heatCell}
          data-level={cell.level || undefined}
          title={`${cell.date} — ${cell.title}`}
        />
      ))}
    </div>
  );
}

export function HeatScale() {
  return (
    <div className={styles.heatScale}>
      less
      {[0, 1, 2, 3, 4].map((level) => (
        <div
          key={level}
          className={`${styles.heatCell} ${styles.heatScaleCell}`}
          data-level={level || undefined}
        />
      ))}
      more
    </div>
  );
}
