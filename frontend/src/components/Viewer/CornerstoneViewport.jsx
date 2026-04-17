// CornerstoneViewport.jsx
//
// Renders a single DICOM stack viewport using Cornerstone.js v4.
//
// ┌─────────────────────────────────────────────────────────────────┐
// │  This component is the lowest-level rendering unit. It:        │
// │    1. Waits for Cornerstone to be fully initialized            │
// │    2. Creates a RenderingEngine + StackViewport ONCE on mount  │
// │    3. Adds the viewport to the DEFAULT_TOOL_GROUP              │
// │    4. Loads imageIds into the viewport via setStack()          │
// │    5. Responds to activeTool changes by switching the tool     │
// │       mode (Passive ↔ Active) without recreating anything      │
// │    6. Cleans up the engine on unmount                          │
// └─────────────────────────────────────────────────────────────────┘
//
// IMPORTANT DESIGN DECISIONS:
//
//   • The RenderingEngine is created ONCE per mount and reused.
//     Recreating it on every imageIds change would destroy the
//     tool group association, lose annotations, and cause the
//     "Tool X not added to toolGroup" warnings.
//
//   • When imageIds change, we only call viewport.setStack() on
//     the existing viewport — no engine teardown needed.
//
//   • Tool switching sets the old tool to PASSIVE (not Disabled)
//     so that annotations drawn with previous tools remain visible.
//
//   • A ResizeObserver watches the container element so the canvas
//     stays correctly sized when the window or layout changes.

import { useEffect, useRef } from "react";
import * as cornerstone from "@cornerstonejs/core";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { useCornerstoneInit } from "../../hooks/useCornerstoneInit";
import styles from "./CornerstoneViewport.module.css";

// ═══════════════════════════════════════════════════════════════════
//  STABLE ENGINE ID GENERATOR
//
//  Module-level counter ensures each CornerstoneViewport instance
//  gets a unique engine ID. The ID is captured in a ref on first
//  render so it stays stable across re-renders.
// ═══════════════════════════════════════════════════════════════════
let engineCounter = 0;
function generateEngineId() {
  return `cs-engine-${++engineCounter}`;
}

// ═══════════════════════════════════════════════════════════════════
//  TOOL NAME MAP
//
//  Maps toolbar IDs → Cornerstone v4 tool names.
//  Built from actual tool classes so it's always in sync.
//
//  CRITICAL v4 CHANGE:
//    v3: StackScrollMouseWheelTool → v4: StackScrollTool
// ═══════════════════════════════════════════════════════════════════
function buildToolNameMap() {
  const {
    WindowLevelTool,
    PanTool,
    ZoomTool,
    LengthTool,
    AngleTool,
    EllipticalROITool,
    RectangleROITool,
    ArrowAnnotateTool,
  } = cornerstoneTools;

  const map = {};

  const entries = [
    ["WindowLevel", WindowLevelTool],
    ["Pan", PanTool],
    ["Zoom", ZoomTool],
    ["Length", LengthTool],
    ["Angle", AngleTool],
    ["EllipticalROI", EllipticalROITool],
    ["RectangleROI", RectangleROITool],
    ["ArrowAnnotate", ArrowAnnotateTool],
  ];

  entries.forEach(([id, ToolClass]) => {
    if (ToolClass && ToolClass.toolName) {
      map[id] = ToolClass.toolName;
    } else {
      console.warn(`[CornerstoneViewport] Tool "${id}" not available`);
    }
  });

  return map;
}

// ═══════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function CornerstoneViewport({
  imageIds = [],
  activeTool = "WindowLevel",
  viewportId = "viewport-1",
}) {
  // ── Refs ─────────────────────────────────────────────────────────
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const engineIdRef = useRef(null);
  const toolMapRef = useRef(null);
  const initializedRef = useRef(false);
  const observerRef = useRef(null);

  // ── Cornerstone init state ───────────────────────────────────────
  const { ready, error } = useCornerstoneInit();

  // Generate a stable engine ID on first render only
  if (!engineIdRef.current) {
    engineIdRef.current = generateEngineId();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EFFECT 1: Create the RenderingEngine and viewport ONCE
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    if (initializedRef.current && engineRef.current) return;

    let resizeObserver = null;

    async function createEngine() {
      try {
        const engineId = engineIdRef.current;

        // Clean up any stale engine
        const existing = cornerstone.getRenderingEngine(engineId);
        if (existing) existing.destroy();

        // Create the rendering engine
        const engine = new cornerstone.RenderingEngine(engineId);
        engineRef.current = engine;

        // Define and create the viewport
        const viewportInput = {
          viewportId,
          type: cornerstone.Enums.ViewportType.STACK,
          element: containerRef.current,
          defaultOptions: {
            background: [0, 0, 0],
          },
        };

        engine.setViewports([viewportInput]);

        // Add viewport to the default tool group — CRITICAL
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
          "DEFAULT_TOOL_GROUP"
        );
        if (toolGroup) {
          toolGroup.addViewport(viewportId, engineId);
        } else {
          console.warn("[CornerstoneViewport] DEFAULT_TOOL_GROUP not found");
        }

        initializedRef.current = true;

        // ── Force resize after layout settles ─────────────────
        //
        // When setViewports() runs, the container may not have
        // its final CSS dimensions yet (flex/grid hasn't finished
        // calculating). Cornerstone reads clientWidth/clientHeight
        // at that moment and creates the canvas at whatever size
        // it finds — often 0×0 or very small.
        //
        // requestAnimationFrame waits for the browser to finish
        // layout. Then engine.resize() re-reads the (now correct)
        // container dimensions and resizes the WebGL canvas.
        //
        // resetCamera() re-fits the image to the new canvas size
        // so it displays at the correct scale, not tiny.
        requestAnimationFrame(() => {
          if (engineRef.current) {
            engineRef.current.resize();
            const vp = engineRef.current.getViewport(viewportId);
            if (vp) {
              vp.resetCamera();
              vp.render();
            }
          }
        });

        // ── ResizeObserver — keep canvas in sync ──────────────
        //
        // Handles: window resize, sidebar toggle, layout switch
        // (1×1 → 2×2), DevTools panel open/close, etc.
        //
        // Without this, the canvas stays at whatever size it was
        // when first created, even if the container grows/shrinks.
        resizeObserver = new ResizeObserver(() => {
          if (engineRef.current) {
            engineRef.current.resize();
            const vp = engineRef.current.getViewport(viewportId);
            if (vp) vp.render();
          }
        });
        resizeObserver.observe(containerRef.current);
        observerRef.current = resizeObserver;

        console.log(
          `[CornerstoneViewport] Engine ${engineId}, viewport ${viewportId} ready`
        );
      } catch (err) {
        console.error("[CornerstoneViewport] Engine setup error:", err);
      }
    }

    createEngine();

    // ── Cleanup on unmount ────────────────────────────────
    return () => {
      try {
        // Disconnect resize observer
        if (resizeObserver) resizeObserver.disconnect();
        if (observerRef.current) {
          observerRef.current.disconnect();
          observerRef.current = null;
        }

        // Remove viewport from tool group
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
          "DEFAULT_TOOL_GROUP"
        );
        if (toolGroup) {
          try { toolGroup.removeViewports(engineIdRef.current); } catch {}
        }

        // Destroy the rendering engine
        const engine = cornerstone.getRenderingEngine(engineIdRef.current);
        if (engine) engine.destroy();

        engineRef.current = null;
        initializedRef.current = false;
      } catch {}
    };
  }, [ready, viewportId]);

  // ═══════════════════════════════════════════════════════════════════
  //  EFFECT 2: Load imageIds into the existing viewport
  //
  //  Runs when imageIds change (user selected a new series).
  //  Does NOT recreate the engine — reuses existing viewport.
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!ready || !imageIds.length || !initializedRef.current) return;

    async function loadStack() {
      try {
        const engine = engineRef.current;
        if (!engine) return;

        const viewport = engine.getViewport(viewportId);
        if (!viewport) {
          console.warn(`[CornerstoneViewport] Viewport ${viewportId} not found`);
          return;
        }

        // Load the new image stack, starting at index 0
        await viewport.setStack(imageIds, 0);

        // After loading, resize and reset camera so the image
        // fills the viewport correctly at the right scale.
        requestAnimationFrame(() => {
          if (engineRef.current) {
            engineRef.current.resize();
          }
          if (viewport) {
            viewport.resetCamera();
            viewport.render();
          }
        });

        console.log(
          `[CornerstoneViewport] Loaded ${imageIds.length} images into ${viewportId}`
        );
      } catch (err) {
        console.error("[CornerstoneViewport] setStack error:", err);
      }
    }

    loadStack();
  }, [imageIds, ready, viewportId]);

  // ═══════════════════════════════════════════════════════════════════
  //  EFFECT 3: Switch the active tool
  //
  //  Sets all tools to Passive (annotations stay visible),
  //  then activates the selected tool with left-click binding.
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!ready) return;

    const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
      "DEFAULT_TOOL_GROUP"
    );
    if (!toolGroup) return;

    // Build (or reuse) the tool name map
    if (!toolMapRef.current) {
      toolMapRef.current = buildToolNameMap();
    }
    const toolMap = toolMapRef.current;

    const newToolName = toolMap[activeTool];
    if (!newToolName) {
      console.warn(`[CornerstoneViewport] Unknown tool: "${activeTool}"`);
      return;
    }

    // Step 1: Set all switchable tools to Passive
    Object.values(toolMap).forEach((csToolName) => {
      try { toolGroup.setToolPassive(csToolName); } catch {}
    });

    // Step 2: Activate the selected tool
    try {
      toolGroup.setToolActive(newToolName, {
        bindings: [
          { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary },
        ],
      });
    } catch (err) {
      console.warn(`[CornerstoneViewport] Could not activate ${newToolName}:`, err);
    }

    // Ensure StackScrollTool stays active for mousewheel
    // v4 name: StackScrollTool (NOT StackScrollMouseWheelTool)
    const StackScrollTool = cornerstoneTools.StackScrollTool;
    if (StackScrollTool) {
      try { toolGroup.setToolActive(StackScrollTool.toolName); } catch {}
    }
  }, [activeTool, ready]);

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════

  if (error) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.placeholder}>
          <span>Cornerstone failed to initialize: {error}</span>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.placeholder}>
          <span>Initializing viewer…</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {/* Placeholder — visible when no series is loaded */}
      {!imageIds.length && (
        <div className={styles.placeholder}>
          <span>Select a series to begin</span>
        </div>
      )}

      {/* Cornerstone viewport canvas container.
       *
       *  CSS: position:absolute fills the wrapper even before
       *  Cornerstone injects the <canvas>. This is what fixes
       *  the "tiny canvas" bug — without absolute positioning,
       *  this div has zero intrinsic height (no content yet)
       *  and Cornerstone creates a 0×0 canvas. */}
      <div ref={containerRef} className={styles.canvas} />
    </div>
  );
}