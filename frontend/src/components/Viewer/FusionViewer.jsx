// FusionViewer.jsx
// PET/CT (or PET/MR) fusion viewer component.
// Overlays two co-registered DICOM volumes in the same coordinate space:
//   - A base volume (e.g. CT) rendered in grayscale.
//   - An overlay volume (e.g. PET) rendered with a colormap at adjustable opacity.
// Both series must share the same Frame of Reference UID (acquired together
// or co-registered) so that their voxel grids align spatially.

import { useEffect, useRef, useState } from "react";
import { useVolumeLoader } from "../../hooks/useVolumeLoader";
import { useCornerstoneInit } from "../../hooks/useCornerstoneInit";
import styles from "./FusionViewer.module.css";

// Unique identifier for this component's rendering engine.
const RENDERING_ENGINE_ID = "fusionRenderingEngine";

// Available colormaps for the overlay volume (e.g. PET).
// Each colormap maps scalar voxel values to a color gradient.
//   "hsv"         — A warm rainbow from red to yellow (common for PET).
//   "PET 20 Step" — Discrete 20-color scale used in nuclear medicine.
//   "Hot Iron"    — Black → red → orange → yellow → white.
//   "Grayscale"   — Standard gray scale (useful for debugging alignment).
const COLORMAPS = [
  { id: "hsv", label: "HSV (Hot)" },
  { id: "PET 20 Step", label: "PET 20 Step" },
  { id: "Hot Iron", label: "Hot Iron" },
  { id: "Grayscale", label: "Grayscale" },
];

// The three anatomical planes displayed in the fusion grid.
const ORIENTATIONS = [
  { id: "axial", orientation: "AXIAL", label: "Axial" },
  { id: "sagittal", orientation: "SAGITTAL", label: "Sagittal" },
  { id: "coronal", orientation: "CORONAL", label: "Coronal" },
];

/**
 * FusionViewer component.
 *
 * Loads two volumes (base + overlay), renders them superimposed in three
 * orthogonal viewports, and provides controls for adjusting overlay
 * opacity and colormap.
 *
 * @param {string[]} baseImageIds      - DICOM image IDs for the base volume (CT).
 * @param {string}   baseSeriesUID     - Series Instance UID for the base.
 * @param {string[]} overlayImageIds   - DICOM image IDs for the overlay volume (PET).
 * @param {string}   overlaySeriesUID  - Series Instance UID for the overlay.
 */
export default function FusionViewer({
  baseImageIds,
  baseSeriesUID,
  overlayImageIds,
  overlaySeriesUID,
}) {
  // Wait for cornerstone to be fully initialized before doing anything.
  // This prevents the race condition where volume creation tries to prefetch
  // images before the wadouri loader has its auth headers configured.
  const { ready: csReady, error: csError } = useCornerstoneInit();

  // DOM refs for the three viewport elements. Cornerstone renders into these.
  const axialRef = useRef(null);
  const sagittalRef = useRef(null);
  const coronalRef = useRef(null);

  // Convenience lookup for refs by orientation ID string.
  const refs = { axial: axialRef, sagittal: sagittalRef, coronal: coronalRef };

  // Overlay opacity (0 = fully transparent, 1 = fully opaque).
  // Default 0.5 provides a balanced blend of base and overlay.
  const [opacity, setOpacity] = useState(0.5);

  // Currently selected colormap ID for the overlay volume.
  const [colormap, setColormap] = useState("hsv");

  // Ref to the cornerstone RenderingEngine instance for cleanup.
  const engineRef = useRef(null);

  // Load the base volume (e.g. CT) using the shared volume loader hook.
  // The third argument `csReady` defers loading until cornerstone is initialized.
  const {
    volumeId: baseVolumeId,
    loading: baseLoading,
    error: baseError,
  } = useVolumeLoader(baseImageIds, baseSeriesUID, csReady);

  // Load the overlay volume (e.g. PET) using the same hook.
  // Also gated by csReady to prevent prefetch auth failures.
  const {
    volumeId: overlayVolumeId,
    loading: overlayLoading,
    error: overlayError,
  } = useVolumeLoader(overlayImageIds, overlaySeriesUID, csReady);

  // Aggregate loading and error states for the UI.
  const loading = baseLoading || overlayLoading;
  const error = csError || baseError || overlayError;

  // ── Primary setup effect ────────────────────────────────────────────
  // Runs when both volumes are ready. Creates the rendering engine,
  // viewports, and assigns both volumes to each viewport.
  useEffect(() => {
    // Guard: both volumes must be loaded and the DOM must be ready.
    if (!baseVolumeId || !overlayVolumeId || !axialRef.current) return;

    // Disposal flag for cleanup.
    let disposed = false;

    async function setup() {
      // Import cornerstone core dynamically.
      const cs = await import("@cornerstonejs/core");
      const { RenderingEngine, Enums, setVolumesForViewports } = cs;
      const { ViewportType } = Enums;

      // Destroy any previous rendering engine with this ID.
      try {
        const old = cs.getRenderingEngine(RENDERING_ENGINE_ID);
        if (old) old.destroy();
      } catch (_noEngine) {
        // No existing engine — that's expected on first render.
      }

      // Create a fresh rendering engine.
      const engine = new RenderingEngine(RENDERING_ENGINE_ID);
      engineRef.current = engine;

      // Build viewport configs for all three anatomical planes.
      const viewportInputs = ORIENTATIONS.map((o) => ({
        viewportId: `fusion-${o.id}`,
        type: ViewportType.ORTHOGRAPHIC,
        element: refs[o.id].current,
        defaultOptions: {
          orientation: Enums.OrientationAxis[o.orientation],
        },
      }));

      // Register viewports with the engine.
      engine.setViewports(viewportInputs);

      // Collect viewport IDs for the setVolumesForViewports call.
      const viewportIds = viewportInputs.map((v) => v.viewportId);

      // Assign both volumes to all viewports.
      // The base volume (CT) renders with default grayscale settings.
      // The overlay volume (PET) gets a callback that configures its
      // initial opacity. The callback fires after the volume actor (VTK.js
      // rendering object) is created, giving us access to its properties.
      await setVolumesForViewports(
        engine,
        [
          {
            volumeId: baseVolumeId,
            // No callback needed — CT renders in grayscale by default.
          },
          {
            volumeId: overlayVolumeId,
            callback: ({ volumeActor }) => {
              // Set the overlay's global opacity.
              // In VTK.js, getProperty().setOpacity() on a volume property
              // sets the overall opacity of the entire volume actor.
              // The first argument (0) is the component index (always 0 for
              // single-component scalar data like PET SUV values).
              volumeActor.getProperty().setOpacity(0, opacity);
            },
          },
        ],
        viewportIds
      );

      // Apply the initial colormap to the overlay volume in each viewport.
      applyColormapToViewports(engine, colormap);

      // Trigger the initial render.
      engine.renderViewports(viewportIds);
    }

    setup().catch((err) => console.error("[FusionViewer] Setup failed:", err));

    // Cleanup: destroy the engine when the component unmounts or volumes change.
    return () => {
      disposed = true;
      if (engineRef.current) {
        try {
          engineRef.current.destroy();
        } catch (_destroyErr) {
          // Engine already destroyed — safe to ignore.
        }
        engineRef.current = null;
      }
    };
  }, [baseVolumeId, overlayVolumeId]);

  // ── Opacity update effect ───────────────────────────────────────────
  // When the user moves the opacity slider, update the overlay actor's
  // opacity in each viewport and re-render.
  useEffect(() => {
    // Guard: engine must exist and overlay must be loaded.
    if (!engineRef.current || !overlayVolumeId) return;

    const engine = engineRef.current;

    // Iterate over all three viewports.
    ORIENTATIONS.forEach((o) => {
      // Get the viewport object by its ID.
      const viewport = engine.getViewport(`fusion-${o.id}`);
      if (!viewport) return;

      // Each viewport has an array of "actors" — one per volume.
      // actors[0] = base (CT), actors[1] = overlay (PET).
      const actors = viewport.getActors();

      // Only update if both actors exist.
      if (actors.length >= 2) {
        // Access the overlay's VTK actor.
        const overlayActor = actors[1].actor;

        // Update the global opacity of the overlay actor.
        // This makes the PET volume more or less transparent over the CT.
        overlayActor.getProperty().setOpacity(0, opacity);
      }

      // Re-render this viewport to reflect the opacity change.
      viewport.render();
    });
  }, [opacity, overlayVolumeId]);

  // ── Colormap update effect ──────────────────────────────────────────
  // When the user selects a different colormap, apply it to the overlay
  // actor in all viewports.
  useEffect(() => {
    // Guard: engine must exist and overlay must be loaded.
    if (!engineRef.current || !overlayVolumeId) return;

    applyColormapToViewports(engineRef.current, colormap);

    // Re-render all viewports after the colormap change.
    ORIENTATIONS.forEach((o) => {
      const viewport = engineRef.current.getViewport(`fusion-${o.id}`);
      if (viewport) viewport.render();
    });
  }, [colormap, overlayVolumeId]);

  // Render the fusion UI: controls bar + three-panel viewport grid.
  return (
    <div className={styles.fusionContainer}>
      {/* ── Controls bar ─────────────────────────────────────────── */}
      <div className={styles.fusionControls}>
        {/* Opacity slider */}
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
          {/* Display current opacity as a percentage. */}
          <span className={styles.controlValue}>
            {Math.round(opacity * 100)}%
          </span>
        </div>

        {/* Colormap selector — a row of toggle buttons. */}
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

      {/* ── Viewport grid (Axial, Sagittal, Coronal) ─────────── */}
      <div className={styles.fusionGrid}>
        {ORIENTATIONS.map((o) => (
          <div key={o.id} className={styles.fusionCell}>
            {/* Label showing which plane this viewport displays. */}
            <span className={styles.fusionLabel}>{o.label}</span>

            {/* The viewport element — cornerstone renders the fused image here. */}
            <div className={styles.fusionViewport} ref={refs[o.id]} />
          </div>
        ))}
      </div>

      {/* Loading overlay — shown while cornerstone initializes or
          either volume is still loading. */}
      {(loading || !csReady) && (
        <div className={styles.fusionOverlay}>
          <span className={styles.spinner} />
          {!csReady ? "Initializing…" : "Loading volumes…"}
        </div>
      )}

      {/* Error overlay — shown if init or either volume fails to load. */}
      {error && (
        <div className={styles.fusionError}>Fusion unavailable: {error}</div>
      )}
    </div>
  );
}

/**
 * Applies a named colormap to the overlay (PET) actor in all fusion viewports.
 *
 * Cornerstone v4.21.0 exposes the overlay volume actor as the second actor
 * in each viewport. We access its VTK.js RGB transfer function and replace
 * the color mapping to match the selected colormap.
 *
 * @param {RenderingEngine} engine     - The active cornerstone rendering engine.
 * @param {string}          colormapId - One of the COLORMAPS ids (e.g. "hsv").
 */
async function applyColormapToViewports(engine, colormapId) {
  try {
    // Import cornerstone utilities which may contain colormap helpers.
    const cs = await import("@cornerstonejs/core");

    ORIENTATIONS.forEach((o) => {
      // Get the viewport for this orientation.
      const viewport = engine.getViewport(`fusion-${o.id}`);
      if (!viewport) return;

      // Get the list of actors. actors[0] = base, actors[1] = overlay.
      const actors = viewport.getActors();
      if (actors.length < 2) return;

      // Access the overlay actor's VTK.js property object.
      const overlayActor = actors[1].actor;
      const property = overlayActor.getProperty();

      // Get the RGB transfer function (color lookup) for the first component.
      // This function maps scalar values (PET SUV) to RGB colors.
      const cfun = property.getRGBTransferFunction(0);
      if (!cfun) return;

      // Try to use cornerstone's built-in colormap utilities if available.
      // The utilities.colormap module can apply named colormaps to a
      // VTK RGB transfer function.
      if (cs.utilities && cs.utilities.colormap) {
        try {
          const colormapData = cs.utilities.colormap.getColormap(colormapId);
          if (colormapData) {
            // Get the current scalar range of the transfer function.
            // This is the range of PET SUV values in the volume.
            const range = cfun.getMappingRange();

            // Apply the colormap's color nodes to the transfer function.
            // Each node is an [R, G, B] triplet (0-255 range).
            // We map them linearly across the scalar range.
            colormapData.forEach((node, i) => {
              // Calculate the scalar value for this color stop.
              const scalar =
                range[0] +
                (i / (colormapData.length - 1)) * (range[1] - range[0]);

              // Add the RGB point. VTK expects values in 0-1 range.
              cfun.addRGBPoint(
                scalar,
                node[0] / 255,
                node[1] / 255,
                node[2] / 255
              );
            });
          }
        } catch (cmErr) {
          console.warn(
            "[FusionViewer] Colormap application failed:",
            cmErr.message
          );
        }
      }
    });
  } catch (err) {
    console.warn("[FusionViewer] Could not apply colormap:", err.message);
  }
}