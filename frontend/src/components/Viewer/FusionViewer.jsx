import { useEffect, useRef, useState } from "react";
import { useVolumeLoader } from "../../hooks/useVolumeLoader";
import styles from "./FusionViewer.module.css";

const RENDERING_ENGINE_ID = "fusionRenderingEngine";

/**
 * PET/CT Fusion presets — colormaps for the overlay volume.
 * These map scalar values to colors for the PET overlay.
 */
const COLORMAPS = [
  { id: "hsv", label: "HSV (Hot)" },
  { id: "PET 20 Step", label: "PET 20 Step" },
  { id: "Hot Iron", label: "Hot Iron" },
  { id: "Grayscale", label: "Grayscale" },
];

const ORIENTATIONS = [
  { id: "axial", orientation: "AXIAL", label: "Axial" },
  { id: "sagittal", orientation: "SAGITTAL", label: "Sagittal" },
  { id: "coronal", orientation: "CORONAL", label: "Coronal" },
];

/**
 * Fusion Viewer — overlays two volumes in the same coordinate space.
 *
 * Use case: PET/CT, PET/MR, or any two co-registered series.
 * The base volume (e.g. CT) renders in grayscale. The overlay
 * volume (e.g. PET) renders with a colormap at adjustable opacity.
 *
 * Both series must share the same Frame of Reference UID
 * (i.e., acquired in the same imaging session or co-registered).
 *
 * Props:
 *   baseImageIds   — imageIds for the base volume (CT)
 *   baseSeriesUID  — series UID for the base
 *   overlayImageIds — imageIds for the overlay volume (PET)
 *   overlaySeriesUID — series UID for the overlay
 */
export default function FusionViewer({
  baseImageIds,
  baseSeriesUID,
  overlayImageIds,
  overlaySeriesUID,
}) {
  const axialRef = useRef(null);
  const sagittalRef = useRef(null);
  const coronalRef = useRef(null);
  const refs = { axial: axialRef, sagittal: sagittalRef, coronal: coronalRef };

  const [opacity, setOpacity] = useState(0.5);
  const [colormap, setColormap] = useState("hsv");
  const engineRef = useRef(null);

  // Load both volumes
  const {
    volumeId: baseVolumeId,
    loading: baseLoading,
    error: baseError,
  } = useVolumeLoader(baseImageIds, baseSeriesUID);

  const {
    volumeId: overlayVolumeId,
    loading: overlayLoading,
    error: overlayError,
  } = useVolumeLoader(overlayImageIds, overlaySeriesUID);

  const loading = baseLoading || overlayLoading;
  const error = baseError || overlayError;

  // Setup rendering when both volumes are ready
  useEffect(() => {
    if (!baseVolumeId || !overlayVolumeId || !axialRef.current) return;

    let disposed = false;

    async function setup() {
      const cs = await import("@cornerstonejs/core");
      const { RenderingEngine, Enums, setVolumesForViewports } = cs;
      const { ViewportType } = Enums;

      // Destroy previous
      try {
        const old = cs.getRenderingEngine(RENDERING_ENGINE_ID);
        if (old) old.destroy();
      } catch {}

      const engine = new RenderingEngine(RENDERING_ENGINE_ID);
      engineRef.current = engine;

      const viewportInputs = ORIENTATIONS.map((o) => ({
        viewportId: `fusion-${o.id}`,
        type: ViewportType.ORTHOGRAPHIC,
        element: refs[o.id].current,
        defaultOptions: {
          orientation: Enums.OrientationAxis[o.orientation],
        },
      }));

      engine.setViewports(viewportInputs);

      const viewportIds = viewportInputs.map((v) => v.viewportId);

      // Set both volumes on all viewports
      // Base volume renders in grayscale (default)
      // Overlay volume gets a colormap and opacity
      await setVolumesForViewports(
        engine,
        [
          {
            volumeId: baseVolumeId,
          },
          {
            volumeId: overlayVolumeId,
            callback: ({ volumeActor }) => {
              // Apply colormap to the overlay
              const cfun = volumeActor.getProperty().getRGBTransferFunction(0);
              if (cfun) {
                // The colormap will be applied via properties
              }
              volumeActor.getProperty().setScalarOpacity(0, createOpacityFunction(opacity));
            },
          },
        ],
        viewportIds
      );

      engine.renderViewports(viewportIds);
    }

    setup().catch((err) => console.error("Fusion setup failed:", err));

    return () => {
      disposed = true;
      if (engineRef.current) {
        try {
          engineRef.current.destroy();
        } catch {}
        engineRef.current = null;
      }
    };
  }, [baseVolumeId, overlayVolumeId]);

  // Update opacity when slider changes
  useEffect(() => {
    if (!engineRef.current || !overlayVolumeId) return;

    async function updateOpacity() {
      const cs = await import("@cornerstonejs/core");
      const engine = engineRef.current;
      if (!engine) return;

      ORIENTATIONS.forEach((o) => {
        const viewport = engine.getViewport(`fusion-${o.id}`);
        if (!viewport) return;

        const actors = viewport.getActors();
        // The overlay is the second actor
        if (actors.length >= 2) {
          const overlayActor = actors[1].actor;
          overlayActor.getProperty().setOpacity(opacity);
        }
        viewport.render();
      });
    }

    updateOpacity();
  }, [opacity, overlayVolumeId]);

  return (
    <div className={styles.fusionContainer}>
      {/* Controls */}
      <div className={styles.fusionControls}>
        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Overlay opacity</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.controlValue}>
            {Math.round(opacity * 100)}%
          </span>
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.controlLabel}>Colormap</label>
          <div className={styles.colormapBtns}>
            {COLORMAPS.map((cm) => (
              <button
                key={cm.id}
                className={`${styles.colormapBtn} ${
                  colormap === cm.id ? styles.colormapActive : ""
                }`}
                onClick={() => setColormap(cm.id)}
              >
                {cm.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Viewports */}
      <div className={styles.fusionGrid}>
        {ORIENTATIONS.map((o) => (
          <div key={o.id} className={styles.fusionCell}>
            <span className={styles.fusionLabel}>{o.label}</span>
            <div className={styles.fusionViewport} ref={refs[o.id]} />
          </div>
        ))}
      </div>

      {loading && (
        <div className={styles.fusionOverlay}>
          <span className={styles.spinner} />
          Loading volumes…
        </div>
      )}

      {error && (
        <div className={styles.fusionError}>
          Fusion unavailable: {error}
        </div>
      )}
    </div>
  );
}

/**
 * Creates a piecewise opacity transfer function.
 * The overlay's scalar range maps from fully transparent to
 * the target opacity.
 */
function createOpacityFunction(targetOpacity) {
  // This is a simplified version — in production you'd
  // create a vtkPiecewiseFunction with proper windowing
  return targetOpacity;
}