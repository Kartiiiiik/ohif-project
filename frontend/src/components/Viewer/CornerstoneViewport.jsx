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

import { useEffect, useRef, useCallback } from "react";
import * as cornerstone from "@cornerstonejs/core";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { useCornerstoneInit } from "../../hooks/useCornerstoneInit";
import styles from "./CornerstoneViewport.module.css";

// ═══════════════════════════════════════════════════════════════════
//  STABLE ENGINE ID GENERATOR
//
//  We use a module-level counter to generate unique engine IDs.
//  The ID is captured in a ref on first render so it stays stable
//  across re-renders (unlike putting ++counter inline which would
//  increment on every render in StrictMode).
// ═══════════════════════════════════════════════════════════════════
let engineCounter = 0;
function generateEngineId() {
  return `cs-engine-${++engineCounter}`;
}

// ═══════════════════════════════════════════════════════════════════
//  TOOL NAME MAP
//
//  Maps the toolbar's tool ID strings to Cornerstone v4 tool names.
//
//  The toolbar uses short IDs like "Length", "WindowLevel", etc.
//  Cornerstone tools have a static .toolName property that may
//  differ slightly (e.g. "WindowLevel" vs "WindowLevelTool").
//
//  We build this map from the actual tool classes so it's always
//  in sync with whatever version of @cornerstonejs/tools is
//  installed.
//
//  CRITICAL v4 CHANGE:
//    v3: StackScrollMouseWheelTool
//    v4: StackScrollTool
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

  // Map from toolbar ID → Cornerstone toolName
  // Only include tools that actually exist in this build
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
      console.warn(`[CornerstoneViewport] Tool "${id}" not available in this build`);
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
  const containerRef = useRef(null);  // DOM element for the viewport
  const engineRef = useRef(null);     // RenderingEngine instance
  const engineIdRef = useRef(null);   // Stable engine ID string
  const toolMapRef = useRef(null);    // Cached tool name map
  const initializedRef = useRef(false); // Whether engine has been set up

  // ── Cornerstone init state ───────────────────────────────────────
  // useCornerstoneInit returns { ready: boolean, error: string|null }
  // We destructure `ready` — the previous code used the whole object
  // as a boolean, which was always truthy (object !== false).
  const { ready, error } = useCornerstoneInit();

  // Generate a stable engine ID on first render only
  if (!engineIdRef.current) {
    engineIdRef.current = generateEngineId();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EFFECT 1: Create the RenderingEngine and viewport ONCE
  //
  //  This runs when:
  //    • Cornerstone becomes ready (ready transitions false→true)
  //    • Component mounts for the first time
  //
  //  It does NOT re-run when imageIds change — that's handled
  //  by Effect 2. Separating these prevents the engine from being
  //  destroyed and recreated on every series switch, which was
  //  causing tool group disassociation and annotation loss.
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    // Don't re-initialize if we already have a working engine
    if (initializedRef.current && engineRef.current) return;

    async function createEngine() {
      try {
        const engineId = engineIdRef.current;

        // ── Clean up any stale engine with this ID ──────────
        const existing = cornerstone.getRenderingEngine(engineId);
        if (existing) {
          existing.destroy();
        }

        // ── Create the rendering engine ─────────────────────
        // A RenderingEngine manages one or more viewports.
        // For a stack viewer, we typically have one engine per
        // viewport cell in the grid.
        const engine = new cornerstone.RenderingEngine(engineId);
        engineRef.current = engine;

        // ── Define the viewport ─────────────────────────────
        // ViewportType.STACK = 2D scrollable stack of images
        // ViewportType.ORTHOGRAPHIC = 3D volume with orientation
        const viewportInput = {
          viewportId,
          type: cornerstone.Enums.ViewportType.STACK,
          element: containerRef.current,
          defaultOptions: {
            background: [0, 0, 0], // Black background
          },
        };

        // setViewports creates the viewport and attaches it
        // to the DOM element. The element gets a <canvas> child.
        engine.setViewports([viewportInput]);

        // ── Add viewport to the default tool group ──────────
        // This is CRITICAL — without this, no tools will work
        // on this viewport. The tool group was created in
        // useCornerstoneInit.js during Step 6.
        //
        // addViewport(viewportId, renderingEngineId) links this
        // viewport to the group so all tool state (active,
        // passive, disabled) applies to it.
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
          "DEFAULT_TOOL_GROUP"
        );
        if (toolGroup) {
          toolGroup.addViewport(viewportId, engineId);
        } else {
          console.warn(
            "[CornerstoneViewport] DEFAULT_TOOL_GROUP not found.",
            "Tools will not work. Check useCornerstoneInit.js."
          );
        }

        initializedRef.current = true;
        console.log(`[CornerstoneViewport] Engine ${engineId} created, viewport ${viewportId} ready`);
      } catch (err) {
        console.error("[CornerstoneViewport] Engine setup error:", err);
      }
    }

    createEngine();

    // ── Cleanup on unmount ────────────────────────────────
    return () => {
      try {
        // Remove viewport from tool group before destroying
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(
          "DEFAULT_TOOL_GROUP"
        );
        if (toolGroup) {
          try {
            toolGroup.removeViewports(engineIdRef.current);
          } catch {}
        }

        const engine = cornerstone.getRenderingEngine(engineIdRef.current);
        if (engine) {
          engine.destroy();
        }
        engineRef.current = null;
        initializedRef.current = false;
      } catch {}
    };
  }, [ready, viewportId]);

  // ═══════════════════════════════════════════════════════════════════
  //  EFFECT 2: Load imageIds into the existing viewport
  //
  //  This runs when imageIds change (user selected a new series).
  //  It does NOT recreate the engine — it reuses the existing
  //  viewport and just swaps the image stack.
  //
  //  viewport.setStack(imageIds, initialIndex) is the correct v4
  //  API for loading a new set of images into a StackViewport.
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

        // setStack loads the new image IDs and displays the first image.
        // The second argument (0) is the initial image index to display.
        await viewport.setStack(imageIds, 0);

        // Force a render to display the first image immediately
        viewport.render();

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
  //  When the user clicks a different tool in the toolbar, this
  //  effect fires. It:
  //    1. Sets ALL switchable tools to Passive (keeps annotations
  //       visible, handles still grabbable)
  //    2. Sets the newly selected tool to Active with left-click
  //       binding
  //
  //  This NEVER destroys or recreates the tool group. It only
  //  changes tool modes, which is the correct v4 pattern for
  //  preserving annotations across tool switches.
  //
  //  CRITICAL v4 CHANGE:
  //    StackScrollMouseWheelTool → StackScrollTool
  //    The old name is undefined in v4 and would crash here.
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

    // Look up the Cornerstone tool name for the selected toolbar ID
    const newToolName = toolMap[activeTool];
    if (!newToolName) {
      console.warn(`[CornerstoneViewport] Unknown tool: "${activeTool}"`);
      return;
    }

    // ── Step 1: Set all switchable tools to Passive ──────────
    // This keeps their annotations visible while preventing
    // them from capturing mouse clicks.
    Object.values(toolMap).forEach((csToolName) => {
      try {
        toolGroup.setToolPassive(csToolName);
      } catch {
        // Tool might not be in this group — safe to skip
      }
    });

    // ── Step 2: Activate the selected tool ───────────────────
    // Bind it to the primary (left) mouse button.
    try {
      toolGroup.setToolActive(newToolName, {
        bindings: [
          { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary },
        ],
      });
    } catch (err) {
      console.warn(`[CornerstoneViewport] Could not activate ${newToolName}:`, err);
    }

    // ── Ensure StackScrollTool stays active ──────────────────
    // StackScrollTool handles mousewheel scrolling through slices.
    // It should always be active regardless of which primary tool
    // is selected (it doesn't conflict because it uses wheel, not
    // mouse buttons).
    //
    // v4 name: StackScrollTool (NOT StackScrollMouseWheelTool)
    const StackScrollTool = cornerstoneTools.StackScrollTool;
    if (StackScrollTool) {
      try {
        toolGroup.setToolActive(StackScrollTool.toolName);
      } catch {
        // Already active or not in group — fine
      }
    }
  }, [activeTool, ready]);

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════

  // Show error state if Cornerstone failed to initialize
  if (error) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.placeholder}>
          <span>Cornerstone failed to initialize: {error}</span>
        </div>
      </div>
    );
  }

  // Show loading state while Cornerstone initializes
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
      {/* Placeholder shown when no series is loaded */}
      {!imageIds.length && (
        <div className={styles.placeholder}>
          <span>Select a series to begin</span>
        </div>
      )}

      {/* The actual Cornerstone viewport canvas container.
       *  Cornerstone injects a <canvas> element into this div
       *  when the engine is created. It must always be in the
       *  DOM (not conditionally rendered) so the ref is stable. */}
      <div ref={containerRef} className={styles.canvas} />
    </div>
  );
}