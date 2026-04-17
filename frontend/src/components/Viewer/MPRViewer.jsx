// MPRViewer.jsx
// Multi-Planar Reconstruction viewer component.
// Renders three orthogonal cross-sections (Axial, Sagittal, Coronal) of a
// 3D DICOM volume, linked together with interactive crosshairs so that
// clicking in one viewport updates the slice position in the other two.

import { useEffect, useRef, useState, useCallback } from "react";
import { useVolumeLoader } from "../../hooks/useVolumeLoader";
import { useCornerstoneInit } from "../../hooks/useCornerstoneInit";
import styles from "./MPRViewer.module.css";

// Define the three anatomical planes we'll display.
// Each entry maps to a cornerstone OrientationAxis enum value.
//   Axial    = top-down view (looking from head to feet)
//   Sagittal = side view (looking from left to right)
//   Coronal  = front view (looking from front to back)
const ORIENTATIONS = [
  { id: "axial", label: "Axial", orientation: "AXIAL" },
  { id: "sagittal", label: "Sagittal", orientation: "SAGITTAL" },
  { id: "coronal", label: "Coronal", orientation: "CORONAL" },
];

// Unique identifier for this component's rendering engine instance.
// Cornerstone allows multiple rendering engines; each needs a unique ID.
const RENDERING_ENGINE_ID = "mprRenderingEngine";

// Unique identifier for the tool group that manages mouse interactions
// (crosshairs, pan, zoom) across all three MPR viewports.
const TOOL_GROUP_ID = "mprToolGroup";

/**
 * MPRViewer component.
 *
 * Takes a flat array of imageIds from a single DICOM series, reconstructs
 * them into a 3D volume, and renders three orthogonal slice views with
 * linked crosshairs for synchronized navigation.
 *
 * Requirements:
 *   - The series must be volumetric (CT, MR) with consistent slice spacing.
 *   - Single-frame modalities (CR, DX, XA) cannot be reconstructed into
 *     a volume and will show an error message.
 *   - cornerstone must be initialized (via useCornerstoneInit) before this
 *     component mounts.
 *
 * @param {string[]} imageIds   - Array of wadouri: or wadors: DICOM image IDs.
 * @param {string}   seriesUID  - The DICOM Series Instance UID.
 * @param {string}   activeTool - Currently active tool name (unused here but
 *                                passed through for consistency with toolbar).
 */
export default function MPRViewer({ imageIds, seriesUID, activeTool }) {
  // Wait for cornerstone to be fully initialized (image loaders registered,
  // auth headers configured, tools ready) before doing anything.
  // This prevents the race condition where volume creation tries to prefetch
  // images before the wadouri loader has its auth headers set.
  const { ready: csReady, error: csError } = useCornerstoneInit();

  // Create refs for the three DOM elements that cornerstone will render into.
  // Each ref is passed to a <div> that becomes a cornerstone viewport.
  const axialRef = useRef(null);
  const sagittalRef = useRef(null);
  const coronalRef = useRef(null);

  // Convenience lookup so we can access refs by orientation ID string.
  const refs = { axial: axialRef, sagittal: sagittalRef, coronal: coronalRef };

  // Use the volume loader hook to create a 3D volume from the imageIds.
  // The third argument `csReady` ensures volume creation is deferred until
  // cornerstone init is complete. Without this, the internal prefetch
  // would fail because auth headers aren't configured yet.
  const { volumeId, loading, error } = useVolumeLoader(
    imageIds,
    seriesUID,
    csReady
  );

  // Tracks whether the rendering engine and viewports have been set up.
  const [initialized, setInitialized] = useState(false);

  // Holds a reference to the cornerstone RenderingEngine so we can
  // destroy it on cleanup (unmount or series change).
  const engineRef = useRef(null);

  // Set up the rendering engine, viewports, and tools once the volume is ready.
  // This effect runs when volumeId changes (i.e., a new volume was loaded).
  useEffect(() => {
    // Guard: don't proceed until we have a volumeId AND the axial DOM element
    // is mounted (refs aren't populated until after the first render).
    if (!volumeId || !axialRef.current) return;

    // Disposal flag to prevent setState calls after cleanup runs.
    let disposed = false;

    async function setup() {
      // Import cornerstone core and tools dynamically.
      const cs = await import("@cornerstonejs/core");
      const csTools = await import("@cornerstonejs/tools");

      // Destructure the APIs we need from cornerstone core.
      const { RenderingEngine, Enums, setVolumesForViewports } = cs;

      // ViewportType.ORTHOGRAPHIC tells cornerstone to render a 2D slice
      // from a 3D volume (as opposed to PERSPECTIVE for 3D rendering).
      const { ViewportType } = Enums;

      // If a previous rendering engine exists with this ID, destroy it
      // to free GPU resources before creating a new one.
      try {
        const old = cs.getRenderingEngine(RENDERING_ENGINE_ID);
        if (old) old.destroy();
      } catch (_noEngine) {
        // getRenderingEngine throws if the ID doesn't exist — that's fine.
      }

      // Create a new rendering engine. This allocates WebGL contexts and
      // sets up the rendering pipeline.
      const engine = new RenderingEngine(RENDERING_ENGINE_ID);

      // Store the engine in a ref so cleanup can destroy it later.
      engineRef.current = engine;

      // Build the viewport configuration array — one entry per orientation.
      // Each viewport is an orthographic (2D slice) view of the volume,
      // oriented along one of the three anatomical axes.
      const viewportInputs = ORIENTATIONS.map((o) => ({
        viewportId: `mpr-${o.id}`,
        type: ViewportType.ORTHOGRAPHIC,
        element: refs[o.id].current,
        defaultOptions: {
          orientation: Enums.OrientationAxis[o.orientation],
        },
      }));

      // Register the viewports with the rendering engine.
      // This creates the internal viewport objects and attaches them
      // to the DOM elements specified in each input.
      engine.setViewports(viewportInputs);

      // Assign the volume to all three viewports. This tells cornerstone
      // which 3D data to slice into each viewport.
      // The volumeId must match a volume that's already in cornerstone's cache
      // (created by useVolumeLoader).
      await setVolumesForViewports(
        engine,
        [{ volumeId }],
        viewportInputs.map((v) => v.viewportId)
      );

      // ── Tool setup ──────────────────────────────────────────────
      // Import the specific tool classes we need for MPR interaction.
      const {
        CrosshairsTool,     // Linked crosshairs across all three planes.
        ToolGroupManager,   // Creates and manages groups of tools.
        Enums: ToolEnums,   // Mouse button constants.
        WindowLevelTool,    // Brightness/contrast adjustment.
        PanTool,            // Image panning.
        ZoomTool,           // Image zooming.
      } = csTools;

      // Register each tool globally with cornerstone tools.
      // addTool() throws if the tool is already registered (e.g. from
      // useCornerstoneInit or a hot reload), so we catch and ignore.
      [CrosshairsTool, WindowLevelTool, PanTool, ZoomTool].forEach((Tool) => {
        try {
          csTools.addTool(Tool);
        } catch (_alreadyAdded) {
          // Already registered — safe to ignore.
        }
      });

      // Destroy any existing tool group with this ID to start fresh.
      // This prevents "tool group already exists" errors on re-renders.
      let toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
      if (toolGroup) {
        try {
          ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
        } catch (_destroyErr) {
          // If destruction fails, we'll create a new one anyway.
        }
      }

      // Create a fresh tool group for MPR viewports.
      toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);

      // Associate each viewport with this tool group so that tool
      // interactions in any viewport are handled by the same group.
      viewportInputs.forEach((v) => {
        toolGroup.addViewport(v.viewportId, RENDERING_ENGINE_ID);
      });

      // Add each tool to the group. This makes the tool available but
      // not yet active — we activate specific tools below.
      [CrosshairsTool, WindowLevelTool, PanTool, ZoomTool].forEach((Tool) => {
        toolGroup.addTool(Tool.toolName);
      });

      // Activate crosshairs on left-click (primary mouse button).
      // When active, clicking in one viewport moves the crosshair reference
      // point, which updates the slice position in the other two viewports.
      toolGroup.setToolActive(CrosshairsTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });

      // Activate pan on middle-click (auxiliary mouse button).
      toolGroup.setToolActive(PanTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
      });

      // Activate zoom on right-click (secondary mouse button).
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
      });

      // Trigger the initial render of all three viewports.
      // Without this call, the viewports would be blank until the first
      // user interaction.
      engine.renderViewports(viewportInputs.map((v) => v.viewportId));

      // Mark setup as complete if the component hasn't been disposed.
      if (!disposed) setInitialized(true);
    }

    // Run the async setup and log any errors.
    setup().catch((err) => console.error("[MPRViewer] Setup failed:", err));

    // Cleanup function: runs when the component unmounts or when volumeId
    // changes (which triggers a new setup).
    return () => {
      disposed = true;

      // Destroy the rendering engine to free GPU memory and detach
      // from DOM elements.
      if (engineRef.current) {
        try {
          engineRef.current.destroy();
        } catch (_destroyErr) {
          // Destruction can fail if the engine was already cleaned up.
        }
        engineRef.current = null;
      }
    };
  }, [volumeId]);

  // Combine cornerstone init errors with volume loading errors for display.
  const displayError = csError || error;

  // Render the three-panel MPR grid.
  return (
    <div className={styles.mprGrid}>
      {ORIENTATIONS.map((o) => (
        <div key={o.id} className={styles.mprCell}>
          {/* Label overlay showing which anatomical plane this viewport displays. */}
          <span className={styles.mprLabel}>{o.label}</span>

          {/* The actual viewport element — cornerstone renders into this div.
              The ref connects it to the rendering engine setup above. */}
          <div className={styles.mprViewport} ref={refs[o.id]} />

          {/* Loading overlay — shown while cornerstone initializes or
              the volume's pixel data is being fetched. */}
          {(loading || !csReady) && (
            <div className={styles.mprOverlay}>
              <span className={styles.spinner} />
              {!csReady ? "Initializing…" : "Loading volume…"}
            </div>
          )}
        </div>
      ))}

      {/* Error overlay — shown when init or volume creation fails. */}
      {displayError && (
        <div className={styles.mprError}>
          <span>MPR unavailable: {displayError}</span>
          <span className={styles.mprErrorHint}>
            MPR requires CT/MR series with consistent slice spacing
          </span>
        </div>
      )}
    </div>
  );
}