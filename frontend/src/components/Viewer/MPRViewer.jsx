import { useEffect, useRef, useState, useCallback } from "react";
import { useVolumeLoader } from "../../hooks/useVolumeLoader";
import styles from "./MPRViewer.module.css";

const ORIENTATIONS = [
  { id: "axial", label: "Axial", orientation: "AXIAL" },
  { id: "sagittal", label: "Sagittal", orientation: "SAGITTAL" },
  { id: "coronal", label: "Coronal", orientation: "CORONAL" },
];

const RENDERING_ENGINE_ID = "mprRenderingEngine";
const TOOL_GROUP_ID = "mprToolGroup";

/**
 * MPR (Multi-Planar Reconstruction) viewer.
 *
 * Takes a flat array of imageIds (from a single series), reconstructs
 * them into a 3D volume, then renders three orthogonal slices:
 * Axial, Sagittal, and Coronal — all linked with crosshairs.
 *
 * Works with CT and MR series that have consistent slice spacing.
 * Does NOT work with single-frame modalities (CR, DX, XA).
 */
export default function MPRViewer({ imageIds, seriesUID, activeTool }) {
  const axialRef = useRef(null);
  const sagittalRef = useRef(null);
  const coronalRef = useRef(null);

  const refs = { axial: axialRef, sagittal: sagittalRef, coronal: coronalRef };

  const { volumeId, loading, error } = useVolumeLoader(imageIds, seriesUID);
  const [initialized, setInitialized] = useState(false);
  const engineRef = useRef(null);

  // Setup rendering engine and viewports once volume is ready
  useEffect(() => {
    if (!volumeId || !axialRef.current) return;

    let disposed = false;

    async function setup() {
      const cs = await import("@cornerstonejs/core");
      const csTools = await import("@cornerstonejs/tools");

      const { RenderingEngine, Enums, setVolumesForViewports } = cs;
      const { ViewportType } = Enums;

      // Destroy previous engine if exists
      try {
        const old = cs.getRenderingEngine(RENDERING_ENGINE_ID);
        if (old) old.destroy();
      } catch {}

      const engine = new RenderingEngine(RENDERING_ENGINE_ID);
      engineRef.current = engine;

      // Define viewport inputs
      const viewportInputs = ORIENTATIONS.map((o) => ({
        viewportId: `mpr-${o.id}`,
        type: ViewportType.ORTHOGRAPHIC,
        element: refs[o.id].current,
        defaultOptions: {
          orientation: Enums.OrientationAxis[o.orientation],
        },
      }));

      engine.setViewports(viewportInputs);

      // Set the volume on all viewports
      await setVolumesForViewports(
        engine,
        [{ volumeId }],
        viewportInputs.map((v) => v.viewportId)
      );

      // Setup crosshairs tool for linked navigation
      const {
        CrosshairsTool,
        ToolGroupManager,
        Enums: ToolEnums,
        WindowLevelTool,
        PanTool,
        ZoomTool,
      } = csTools;

      // Add tools if not already added
      [CrosshairsTool, WindowLevelTool, PanTool, ZoomTool].forEach((Tool) => {
        try {
          csTools.addTool(Tool);
        } catch {}
      });

      // Create or get tool group
      let toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
      if (toolGroup) {
        try {
          ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
        } catch {}
      }

      toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);

      // Add viewports to tool group
      viewportInputs.forEach((v) => {
        toolGroup.addViewport(v.viewportId, RENDERING_ENGINE_ID);
      });

      // Add tools to group
      [CrosshairsTool, WindowLevelTool, PanTool, ZoomTool].forEach((Tool) => {
        toolGroup.addTool(Tool.toolName);
      });

      // Activate crosshairs on primary mouse
      toolGroup.setToolActive(CrosshairsTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
      toolGroup.setToolActive(PanTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
      });
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
      });

      // Render
      engine.renderViewports(viewportInputs.map((v) => v.viewportId));

      if (!disposed) setInitialized(true);
    }

    setup().catch((err) => console.error("MPR setup failed:", err));

    return () => {
      disposed = true;
      if (engineRef.current) {
        try {
          engineRef.current.destroy();
        } catch {}
        engineRef.current = null;
      }
    };
  }, [volumeId]);

  return (
    <div className={styles.mprGrid}>
      {ORIENTATIONS.map((o) => (
        <div key={o.id} className={styles.mprCell}>
          <span className={styles.mprLabel}>{o.label}</span>
          <div className={styles.mprViewport} ref={refs[o.id]} />
          {loading && (
            <div className={styles.mprOverlay}>
              <span className={styles.spinner} />
              Loading volume…
            </div>
          )}
        </div>
      ))}

      {error && (
        <div className={styles.mprError}>
          <span>MPR unavailable: {error}</span>
          <span className={styles.mprErrorHint}>
            MPR requires CT/MR series with consistent slice spacing
          </span>
        </div>
      )}
    </div>
  );
}