import { useCallback } from "react";
import CornerstoneViewport from "./CornerstoneViewport";
import { useViewportImageIds } from "../../hooks/useViewportSeries";
import styles from "./ViewerLayout.module.css";

const LAYOUTS = {
  "1x1": [{ id: "vp-1" }],
  "1x2": [{ id: "vp-1" }, { id: "vp-2" }],
  "2x2": [{ id: "vp-1" }, { id: "vp-2" }, { id: "vp-3" }, { id: "vp-4" }],
};

export default function ViewerLayout({
  layout = "1x1",
  activeTool,
  activeVp,
  onViewportClick,
  assignments,
}) {
  const viewports = LAYOUTS[layout] || LAYOUTS["1x1"];
  const cols = layout === "1x1" ? 1 : 2;

  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {viewports.map((vp, i) => (
        <ViewportCell
          key={vp.id}
          vpId={vp.id}
          index={i}
          isActive={activeVp === vp.id}
          assignment={assignments[vp.id] || null}
          activeTool={activeTool}
          onClick={onViewportClick}
        />
      ))}
    </div>
  );
}

/* ── Individual viewport cell ──────────────────────────
   Each cell manages its own imageIds fetch so that
   multiple viewports can show different series
   simultaneously without blocking each other.
   ─────────────────────────────────────────────────── */

function ViewportCell({ vpId, index, isActive, assignment, activeTool, onClick }) {
  const { imageIds, loading } = useViewportImageIds(assignment);

  const handleClick = useCallback(() => {
    onClick(vpId);
  }, [onClick, vpId]);

  const hasImages = imageIds.length > 0;

  return (
    <div
      className={`${styles.cell} ${isActive ? styles.cellActive : ""}`}
      onClick={handleClick}
    >
      {/* Viewport badge */}
      <div className={styles.vpHeader}>
        <span className={styles.vpBadge}>{index + 1}</span>
        {assignment && (
          <span className={styles.vpSeries}>
            {assignment.description}
            {loading && <span className={styles.vpLoading}>●</span>}
          </span>
        )}
      </div>

      {hasImages ? (
        <CornerstoneViewport
          viewportId={vpId}
          imageIds={imageIds}
          activeTool={activeTool}
        />
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>◻</span>
          <span className={styles.emptyText}>
            {loading
              ? "Loading…"
              : isActive
              ? "Select a series from the left panel"
              : "Click to activate, then select a series"}
          </span>
        </div>
      )}
    </div>
  );
}