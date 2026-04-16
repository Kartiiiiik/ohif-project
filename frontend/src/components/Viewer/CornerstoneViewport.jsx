import { useEffect, useRef } from "react";
import * as cornerstone from "@cornerstonejs/core";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { useCornerstoneInit } from "../../hooks/useCornerstoneInit";
import styles from "./CornerstoneViewport.module.css";

let engineCounter = 0;

export default function CornerstoneViewport({
  imageIds = [],
  activeTool = "WindowLevel",
  viewportId = "viewport-1",
}) {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const engineId = useRef(`engine-${++engineCounter}`);
  const ready = useCornerstoneInit();

  useEffect(() => {
    if (!ready || !imageIds.length || !containerRef.current) return;

    async function setup() {
      try {
        const existing = cornerstone.getRenderingEngine(engineId.current);
        if (existing) existing.destroy();

        const engine = new cornerstone.RenderingEngine(engineId.current);
        engineRef.current = engine;

        const viewportInput = {
          viewportId,
          type: cornerstone.Enums.ViewportType.STACK,
          element: containerRef.current,
          defaultOptions: { background: [0, 0, 0] },
        };

        engine.setViewports([viewportInput]);

        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
          "DEFAULT_TOOL_GROUP"
        );
        if (toolGroup) toolGroup.addViewport(viewportId, engineId.current);

        const viewport = engine.getViewport(viewportId);
        await viewport.setStack(imageIds, 0);
        viewport.render();
      } catch (err) {
        console.error("Cornerstone viewport setup error:", err);
      }
    }

    setup();

    return () => {
      try {
        const engine = cornerstone.getRenderingEngine(engineId.current);
        if (engine) engine.destroy();
      } catch {}
    };
  }, [imageIds, ready]);

  useEffect(() => {
    if (!ready) return;
    const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
      "DEFAULT_TOOL_GROUP"
    );
    if (!toolGroup) return;

    const toolMap = {
      WindowLevel: cornerstoneTools.WindowLevelTool.toolName,
      Pan: cornerstoneTools.PanTool.toolName,
      Zoom: cornerstoneTools.ZoomTool.toolName,
      Length: cornerstoneTools.LengthTool.toolName,
      Angle: cornerstoneTools.AngleTool.toolName,
      EllipticalROI: cornerstoneTools.EllipticalROITool.toolName,
      RectangleROI: cornerstoneTools.RectangleROITool.toolName,
      ArrowAnnotate: cornerstoneTools.ArrowAnnotateTool.toolName,
    };

    const toolName = toolMap[activeTool];
    if (!toolName) return;

    Object.values(toolMap).forEach((name) => {
      try { toolGroup.setToolPassive(name); } catch {}
    });

    toolGroup.setToolActive(toolName, {
      bindings: [{ mouseButton: cornerstoneTools.Enums.MouseBindings.Primary }],
    });
    try {
      toolGroup.setToolActive(cornerstoneTools.StackScrollMouseWheelTool.toolName);
    } catch {}
  }, [activeTool, ready]);

  return (
    <div className={styles.wrapper}>
      {!imageIds.length && (
        <div className={styles.placeholder}>
          <span>Select a series to begin</span>
        </div>
      )}
      <div ref={containerRef} className={styles.canvas} />
    </div>
  );
}