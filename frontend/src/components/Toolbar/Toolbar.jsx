import { useCallback } from "react";
import styles from "./Toolbar.module.css";

const NAV_TOOLS = [
  { id: "WindowLevel", label: "W/L",  icon: "◐", title: "Window / Level" },
  { id: "Pan",         label: "Pan",  icon: "✥", title: "Pan" },
  { id: "Zoom",        label: "Zoom", icon: "⊕", title: "Zoom" },
];

const MEASURE_TOOLS = [
  { id: "Length",        label: "Len",   icon: "┃", title: "Length" },
  { id: "Angle",         label: "Ang",   icon: "∠", title: "Angle" },
  { id: "EllipticalROI", label: "Ellip", icon: "◯", title: "Elliptical ROI" },
  { id: "RectangleROI",  label: "Rect",  icon: "▭", title: "Rectangle ROI" },
  { id: "ArrowAnnotate",  label: "Arrow", icon: "↗", title: "Arrow Annotate" },
];

const VIEW_MODES = [
  { id: "stack",  label: "Stack",  icon: "≡", title: "Stack — scroll through slices" },
  { id: "mpr",    label: "MPR",    icon: "⊞", title: "MPR — axial / sagittal / coronal" },
  { id: "fusion", label: "Fusion", icon: "◈", title: "Fusion — overlay two volumes" },
];

const LAYOUTS = [
  { id: "1x1", label: "1×1", icon: "◻" },
  { id: "1x2", label: "1×2", icon: "◫" },
  { id: "2x2", label: "2×2", icon: "⊞" },
];

export default function Toolbar({
  activeTool,
  onToolChange,
  layout,
  onLayoutChange,
  viewMode,
  onViewModeChange,
  onSync,
  onClear,
  onUndo,
  onResetViewport,
  isSyncing,
}) {
  const renderToolButton = useCallback(
    (tool) => (
      <button
        key={tool.id}
        className={`${styles.btn} ${activeTool === tool.id ? styles.active : ""}`}
        title={tool.title}
        onClick={() => onToolChange(tool.id)}
      >
        <span className={styles.btnIcon}>{tool.icon}</span>
        <span className={styles.btnLabel}>{tool.label}</span>
      </button>
    ),
    [activeTool, onToolChange]
  );

  return (
    <header className={styles.toolbar}>
      {/* Brand */}
      <div className={styles.brand}>
        <span className={styles.brandPulse} />
        <span className={styles.brandText}>
          OHIF<span className={styles.brandAccent}>viewer</span>
        </span>
      </div>

      <span className={styles.sep} />

      {/* View mode */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>View</span>
        <div className={styles.groupBtns}>
          {VIEW_MODES.map((m) => (
            <button
              key={m.id}
              className={`${styles.btn} ${viewMode === m.id ? styles.active : ""}`}
              title={m.title}
              onClick={() => onViewModeChange(m.id)}
            >
              <span className={styles.btnIcon}>{m.icon}</span>
              <span className={styles.btnLabel}>{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      <span className={styles.sep} />

      {/* Navigation tools */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>Navigate</span>
        <div className={styles.groupBtns}>
          {NAV_TOOLS.map(renderToolButton)}
        </div>
      </div>

      <span className={styles.sep} />

      {/* Measurement tools */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>Measure</span>
        <div className={styles.groupBtns}>
          {MEASURE_TOOLS.map(renderToolButton)}
        </div>
      </div>

      <span className={styles.sep} />

      {/* Annotation actions */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>Actions</span>
        <div className={styles.groupBtns}>
          <button
            className={styles.actionBtn}
            onClick={onUndo}
            title="Undo last annotation"
          >
            <span className={styles.btnIcon}>↶</span>
            <span className={styles.btnLabel}>Undo</span>
          </button>
          <button
            className={`${styles.actionBtn} ${styles.danger}`}
            onClick={onClear}
            title="Clear all annotations"
          >
            <span className={styles.btnIcon}>✕</span>
            <span className={styles.btnLabel}>Clear</span>
          </button>
          <button
            className={styles.actionBtn}
            onClick={onResetViewport}
            title="Reset viewport (zoom, pan, W/L)"
          >
            <span className={styles.btnIcon}>⊙</span>
            <span className={styles.btnLabel}>Reset</span>
          </button>
        </div>
      </div>

      <span className={styles.sep} />

      {/* Layout (only in stack mode) */}
      {viewMode === "stack" && (
        <div className={styles.group}>
          <span className={styles.groupLabel}>Layout</span>
          <div className={styles.groupBtns}>
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={`${styles.btn} ${layout === l.id ? styles.active : ""}`}
                title={`Layout ${l.label}`}
                onClick={() => onLayoutChange(l.id)}
              >
                <span className={styles.btnIcon}>{l.icon}</span>
                <span className={styles.btnLabel}>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.spacer} />

      {/* Sync */}
      <button
        className={`${styles.syncBtn} ${isSyncing ? styles.syncing : ""}`}
        onClick={onSync}
        title="Sync studies from Orthanc"
        disabled={isSyncing}
      >
        <span className={`${styles.syncIcon} ${isSyncing ? styles.spinning : ""}`}>
          ↻
        </span>
        {isSyncing ? "Syncing…" : "Sync"}
      </button>
    </header>
  );
}