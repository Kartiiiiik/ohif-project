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
// DESIGN DECISIONS:
//
//   • RenderingEngine created ONCE per mount and reused. Recreating
//     it on every imageIds change destroys tool group associations,
//     loses annotations, and causes "Tool X not added" warnings.
//
//   • When imageIds change, we only call viewport.setStack() on
//     the existing viewport — no engine teardown needed.
//
//   • Tool switching sets old tool to PASSIVE (not Disabled) so
//     annotations drawn with previous tools remain visible.
//
//   • StackScrollTool, PanTool (middle-click), and ZoomTool
//     (right-click) are ALWAYS re-activated after every tool switch
//     because the Passive sweep would otherwise kill them.
//
//   • A ResizeObserver watches the container so the canvas stays
//     correctly sized on window resize, layout change, etc.

import { useEffect, useRef } from "react";
import * as cornerstone from "@cornerstonejs/core";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { useCornerstoneInit } from "../../hooks/useCornerstoneInit";
import styles from "./CornerstoneViewport.module.css";

// ═══════════════════════════════════════════════════════════════════
//  STABLE ENGINE ID GENERATOR
// ═══════════════════════════════════════════════════════════════════
let engineCounter = 0;
function generateEngineId() {
  return `cs-engine-${++engineCounter}`;
}

// ═══════════════════════════════════════════════════════════════════
//  PRIMARY TOOL NAME MAP
//
//  Maps toolbar IDs → Cornerstone v4 tool names.
//  Only includes tools that compete for the PRIMARY (left-click)
//  mouse binding. Pan/Zoom/StackScroll are "background" tools
//  that use middle-click, right-click, and mousewheel respectively
//  — they're handled separately so they don't get swept to Passive.
// ═══════════════════════════════════════════════════════════════════
function buildPrimaryToolMap() {
  const {
    WindowLevelTool,
    LengthTool,
    AngleTool,
    EllipticalROITool,
    RectangleROITool,
    ArrowAnnotateTool,
    PanTool,
    ZoomTool,
  } = cornerstoneTools;

  const map = {};

  // These tools compete for the left-click binding.
  // When one is activated, all others go to Passive.
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
  // useCornerstoneInit returns { ready, error } — destructure both.
  // The old code used the object itself as a boolean, which was
  // always truthy and broke the !ready guards.
  const { ready, error } = useCornerstoneInit();

  // Generate a stable engine ID on first render only
  if (!engineIdRef.current) {
    engineIdRef.current = generateEngineId();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EFFECT 1: Create the RenderingEngine and viewport ONCE
  //
  //  Runs when Cornerstone becomes ready or component mounts.
  //  Does NOT re-run on imageIds change — that's Effect 2.
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    if (initializedRef.current && engineRef.current) return;

    let resizeObserver = null;

    async function createEngine() {
      try {
        const engineId = engineIdRef.current;

        // Clean up any stale engine with this ID
        const existing = cornerstone.getRenderingEngine(engineId);
        if (existing) existing.destroy();

        // Create the rendering engine
        const engine = new cornerstone.RenderingEngine(engineId);
        engineRef.current = engine;

        // Define and create the stack viewport
        const viewportInput = {
          viewportId,
          type: cornerstone.Enums.ViewportType.STACK,
          element: containerRef.current,
          defaultOptions: {
            background: [0, 0, 0],
          },
        };

        engine.setViewports([viewportInput]);

        // ── Add viewport to the default tool group ──────────
        // Without this, NO tools work on this viewport.
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
          "DEFAULT_TOOL_GROUP"
        );
        if (toolGroup) {
          toolGroup.addViewport(viewportId, engineId);
          console.log(
            `[CornerstoneViewport] Added ${viewportId} to DEFAULT_TOOL_GROUP`
          );

          // Verify StackScrollTool is in this group
          const { StackScrollTool } = cornerstoneTools;
          if (StackScrollTool) {
            const hasTool = toolGroup.hasTool(StackScrollTool.toolName);
            console.log(
              `[CornerstoneViewport] StackScrollTool in group: ${hasTool}`
            );
          }
        } else {
          console.warn("[CornerstoneViewport] DEFAULT_TOOL_GROUP not found");
        }

        initializedRef.current = true;

        // ── Force resize after CSS layout settles ─────────────
        //
        // When setViewports() runs, the container may not have
        // its final dimensions yet. Cornerstone reads clientWidth
        // / clientHeight at that moment and creates the canvas at
        // whatever size it finds — often 0×0 or very small.
        //
        // requestAnimationFrame waits for the browser to finish
        // layout, then engine.resize() re-reads the correct
        // dimensions and resizes the WebGL canvas to match.
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
        // (1×1 → 2×2), DevTools panel, etc.
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
        if (resizeObserver) resizeObserver.disconnect();
        if (observerRef.current) {
          observerRef.current.disconnect();
          observerRef.current = null;
        }

        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
          "DEFAULT_TOOL_GROUP"
        );
        if (toolGroup) {
          try { toolGroup.removeViewports(engineIdRef.current); } catch {}
        }

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

        // Resize and reset camera so the image fills the viewport
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
  //  This is the most critical effect for correct tool behaviour.
  //
  //  When the user clicks a tool in the toolbar:
  //
  //    1. ALL primary tools go to Passive (annotations stay visible)
  //    2. The selected tool becomes Active on left-click
  //    3. "Background" tools are ALWAYS re-activated:
  //       • StackScrollTool → mousewheel (scroll through slices)
  //       • PanTool         → middle-click (unless Pan is primary)
  //       • ZoomTool        → right-click (unless Zoom is primary)
  //
  //  Step 3 is the key fix. The Passive sweep in Step 1 kills ALL
  //  tools including Pan/Zoom/StackScroll. Without re-activating
  //  them, scrolling/panning/zooming would break after the first
  //  tool switch — which is exactly what was happening.
  //
  //  NEVER set tools to Disabled — that hides their annotations.
  //  Always use Passive (visible + handles draggable, but no new
  //  annotations on click).
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!ready) return;

    const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
      "DEFAULT_TOOL_GROUP"
    );
    if (!toolGroup) return;

    // Build (or reuse) the primary tool name map
    if (!toolMapRef.current) {
      toolMapRef.current = buildPrimaryToolMap();
    }
    const toolMap = toolMapRef.current;

    // Look up the Cornerstone tool name for the toolbar ID
    const newToolName = toolMap[activeTool];
    if (!newToolName) {
      console.warn(`[CornerstoneViewport] Unknown tool: "${activeTool}"`);
      return;
    }

    // Destructure the tools and enums we need
    const {
      StackScrollTool,
      PanTool,
      ZoomTool,
      Enums,
    } = cornerstoneTools;

    // ── Step 1: Set ALL primary tools to Passive ──────────────
    //
    // This clears the left-click binding from whatever tool was
    // previously active, while keeping its annotations visible.
    Object.values(toolMap).forEach((csToolName) => {
      try {
        toolGroup.setToolPassive(csToolName);
      } catch {
        // Tool might not be in this group — safe to skip
      }
    });

    // ── Step 2: Activate the selected tool on left-click ──────
    try {
      toolGroup.setToolActive(newToolName, {
        bindings: [
          { mouseButton: Enums.MouseBindings.Primary },
        ],
      });
    } catch (err) {
      console.warn(
        `[CornerstoneViewport] Could not activate ${newToolName}:`,
        err
      );
    }

    // ── Step 3: Re-activate background tools ──────────────────
    //
    // These tools use different input channels (mousewheel,
    // middle-click, right-click) so they don't conflict with
    // whichever tool is on left-click. They must ALWAYS be
    // active so the user can scroll/pan/zoom regardless of
    // which annotation tool is selected.
    //
    // The Passive sweep in Step 1 killed them — we bring them
    // back here.

    // ── StackScrollTool: mousewheel ──────────────────────────
    //
    // This build requires an explicit Wheel binding (524288).
    // Without it, the tool is Active but listens to nothing.
    //
    // v4 name: StackScrollTool (NOT StackScrollMouseWheelTool)
    if (StackScrollTool && toolGroup.hasTool(StackScrollTool.toolName)) {
      try {
        toolGroup.setToolActive(StackScrollTool.toolName, {
          bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
        });
        console.log(
          `[CornerstoneViewport] StackScrollTool re-activated after tool switch to ${activeTool}`
        );
      } catch (err) {
        console.error(
          "[CornerstoneViewport] FAILED to re-activate StackScrollTool:", err
        );
      }
    } else {
      console.warn(
        "[CornerstoneViewport] StackScrollTool not available in tool group.",
        "StackScrollTool:", !!StackScrollTool,
        "hasTool:", StackScrollTool ? toolGroup.hasTool(StackScrollTool.toolName) : "N/A"
      );
    }

    // ── PanTool: middle-click ────────────────────────────────
    //
    // If Pan is the selected PRIMARY tool (left-click), don't
    // also bind it to middle-click — that would create a
    // duplicate binding. Only re-activate on Auxiliary (middle)
    // when Pan is NOT the primary selection.
    if (
      PanTool &&
      activeTool !== "Pan" &&
      toolGroup.hasTool(PanTool.toolName)
    ) {
      try {
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [
            { mouseButton: Enums.MouseBindings.Auxiliary },
          ],
        });
      } catch (err) {
        console.error("[CornerstoneViewport] FAILED to re-activate PanTool:", err);
      }
    }

    // ── ZoomTool: right-click ────────────────────────────────
    //
    // Same logic as Pan — only bind to Secondary (right-click)
    // when Zoom is NOT the primary tool.
    if (
      ZoomTool &&
      activeTool !== "Zoom" &&
      toolGroup.hasTool(ZoomTool.toolName)
    ) {
      try {
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [
            { mouseButton: Enums.MouseBindings.Secondary },
          ],
        });
      } catch (err) {
        console.error("[CornerstoneViewport] FAILED to re-activate ZoomTool:", err);
      }
    }
  }, [activeTool, ready]);

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════

  // Error state
  if (error) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.placeholder}>
          <span>Cornerstone failed to initialize: {error}</span>
        </div>
      </div>
    );
  }

  // Loading state
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
       *  Cornerstone injects its <canvas> element. Without this,
       *  the div has zero intrinsic height and Cornerstone creates
       *  a tiny 0×0 canvas — the "tiny rendering" bug. */}
      <div ref={containerRef} className={styles.canvas} />
    </div>
  );
}