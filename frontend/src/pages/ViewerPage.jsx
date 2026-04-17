import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "react-query";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useViewerStore } from "../store/viewerStore";
import { syncStudies } from "../api/studies";
import { useViewportSeries } from "../hooks/useViewportSeries";
import { useViewportImageIds } from "../hooks/useViewportSeries";
import Toolbar from "../components/Toolbar/Toolbar";
import StudyList from "../components/StudyList/StudyList";
import ViewerLayout from "../components/Viewer/ViewerLayout";
import MPRViewer from "../components/Viewer/MPRViewer";
import FusionViewer from "../components/Viewer/FusionViewer";
import styles from "./ViewerPage.module.css";

/* ═══════════════════════════════════════════════════════
 *  ANNOTATION HELPERS
 *
 *  These functions interact with Cornerstone.js v4's
 *  annotation state manager. We lazy-import the modules
 *  so the page can render before the heavy WASM/codec
 *  bundles finish loading.
 *
 *  Key Cornerstone v4 annotation concepts:
 *  ─ Annotations live in a global AnnotationManager
 *  ─ They are grouped by FrameOfReferenceUID (groupKey)
 *  ─ Each annotation has a unique `annotationUID`
 *  ─ Switching the active tool does NOT affect existing
 *    annotations — tools in "Passive" mode still render
 *    and allow handle interaction (grab/move).
 * ═══════════════════════════════════════════════════════ */

/**
 * Returns the default annotation manager instance from
 * Cornerstone Tools. This manager holds every annotation
 * across all viewports and frame-of-reference groups.
 *
 * @returns {Promise<import("@cornerstonejs/tools").annotation.state>}
 */
async function getAnnotationModule() {
  const csTools = await import("@cornerstonejs/tools");
  return csTools.annotation.state;
}

/**
 * Collect *all* annotation UIDs across every group and tool.
 *
 * Cornerstone v4 does NOT expose a single "getAllAnnotations()"
 * helper. Instead we must:
 *   1. Get the annotation manager
 *   2. Use getNumberOfAllAnnotations() to check if any exist
 *   3. Iterate frame-of-reference groups to collect them
 *
 * The manager organises annotations as:
 *   { [frameOfReferenceUID]: { [toolName]: Annotation[] } }
 *
 * We flatten that structure into a single ordered array so
 * we can support both "clear all" and "undo last" operations.
 *
 * @returns {Promise<Array<{annotationUID: string, toolName: string}>>}
 */
async function collectAllAnnotations() {
  const csTools = await import("@cornerstonejs/tools");
  const manager = csTools.annotation.state.getAnnotationManager();

  /* ── Build a flat, chronologically-ordered list ────────
   *
   * Cornerstone stores annotations grouped by FrameOfReference
   * and tool name.  We need to flatten this into a single list
   * for undo (remove the most-recently-created annotation).
   *
   * Unfortunately the manager doesn't track insertion order
   * globally, so the best we can do is iterate all groups
   * and rely on array order within each tool bucket (which
   * *is* insertion order).  We interleave by walking every
   * bucket index-by-index so undo is reasonably accurate.
   * ───────────────────────────────────────────────────── */
  const allAnnotations = [];

  try {
    // Try the v4.21+ API — some builds expose a convenience method
    if (typeof manager.getAllAnnotations === "function") {
      return manager.getAllAnnotations();
    }
  } catch {
    // Fall through to manual collection
  }

  /* Manual collection: iterate the internal state structure.
   * getAnnotations(groupKey, toolName) returns Annotation[]
   * for one tool in one frame-of-reference group.              */
  try {
    // The internal state is keyed by groupKey (FrameOfReferenceUID)
    const state = manager.saveAnnotations();

    if (state && typeof state === "object") {
      Object.values(state).forEach((toolMap) => {
        if (toolMap && typeof toolMap === "object") {
          Object.values(toolMap).forEach((annotations) => {
            if (Array.isArray(annotations)) {
              allAnnotations.push(...annotations);
            }
          });
        }
      });
    }
  } catch (err) {
    console.warn("[ViewerPage] Could not collect annotations:", err);
  }

  return allAnnotations;
}

/**
 * Force every active rendering engine to re-render all of
 * its viewports.  This is necessary after programmatic
 * annotation changes (add / remove) because the rendering
 * loop won't pick them up automatically.
 */
async function rerenderAllViewports() {
  const cs = await import("@cornerstonejs/core");

  // getRenderingEngines() returns every engine that has been
  // created (typically one per viewer component).
  const engines = cs.getRenderingEngines();

  engines.forEach((engine) => {
    const viewports = engine.getViewports();
    if (viewports.length === 0) return;

    // renderViewports expects an array of viewport IDs
    engine.renderViewports(viewports.map((vp) => vp.id));
  });
}

/* ═══════════════════════════════════════════════════════
 *  TOOL SWITCHING HELPER
 *
 *  This is the core fix for "annotations disappear when
 *  I switch tools".
 *
 *  In Cornerstone v4, every tool lives in a ToolGroup.
 *  A tool can be in one of four modes:
 *
 *    Active  → responds to primary mouse bindings, can
 *              create new annotations
 *    Passive → existing annotations are rendered and
 *              their handles can be grabbed/moved, but
 *              no NEW annotations are created
 *    Enabled → tool renders but cannot be interacted with
 *    Disabled→ tool is completely hidden and inert
 *
 *  The CORRECT way to switch the "current" tool is:
 *    1. Set the OLD active tool to Passive (so its
 *       annotations remain visible & editable)
 *    2. Set the NEW tool to Active with the desired
 *       mouse binding
 *
 *  The WRONG way (which causes annotation loss):
 *    - Destroying / recreating the ToolGroup
 *    - Setting old tools to Disabled (hides annotations)
 *    - Re-initialising Cornerstone on every switch
 * ═══════════════════════════════════════════════════════ */

/**
 * All tool names that we register.  Measurement /
 * annotation tools must go to Passive (not Disabled)
 * when de-selected so their annotations stay visible.
 */
const ANNOTATION_TOOL_NAMES = [
  "Length",
  "Angle",
  "EllipticalROI",
  "RectangleROI",
  "ArrowAnnotate",
];

const NAVIGATION_TOOL_NAMES = ["WindowLevel", "Pan", "Zoom"];

const ALL_SWITCHABLE_TOOLS = [
  ...NAVIGATION_TOOL_NAMES,
  ...ANNOTATION_TOOL_NAMES,
];

/**
 * Switch the active primary tool across ALL tool groups.
 *
 * @param {string} newToolName  — the tool to make Active
 *
 * This iterates every registered ToolGroup and:
 *   1. Moves the previously-active primary tool to Passive
 *      (annotations stay visible, handles still draggable)
 *   2. Sets `newToolName` as Active with left-click binding
 *   3. Re-activates background tools (StackScroll on wheel,
 *      Pan on middle-click, Zoom on right-click) that were
 *      swept to Passive in step 1.
 *
 * Because we set unused tools to **Passive** (not Disabled),
 * all previously drawn annotations remain on screen and
 * interactive — which is exactly the behaviour you'd expect
 * in a medical imaging viewer.
 */
async function switchActiveTool(newToolName) {
  const csTools = await import("@cornerstonejs/tools");
  const { ToolGroupManager, Enums, StackScrollTool, PanTool, ZoomTool } =
    csTools;

  // Iterate every tool group (stack viewers, MPR, fusion
  // may each have their own group)
  const allGroupIds = ToolGroupManager.getAllToolGroups
    ? ToolGroupManager.getAllToolGroups().map((g) => g.id)
    : [];

  for (const groupId of allGroupIds) {
    const toolGroup = ToolGroupManager.getToolGroup(groupId);
    if (!toolGroup) continue;

    /* ── Step 1: Demote every switchable tool to Passive ──
     *
     * "Passive" means:
     *   ✓ Existing annotations are rendered
     *   ✓ Handles can be grabbed and moved
     *   ✗ No new annotations are created on click
     *
     * We intentionally avoid setToolDisabled because that
     * hides the annotations entirely — which is why users
     * were seeing angles "reset" when switching to length.
     * ─────────────────────────────────────────────────── */
    ALL_SWITCHABLE_TOOLS.forEach((toolName) => {
      try {
        if (toolGroup.hasTool(toolName)) {
          toolGroup.setToolPassive(toolName);
        }
      } catch {
        // Tool may not be registered in this group — safe to skip
      }
    });

    // Also set StackScrollTool to Passive first so we can
    // cleanly re-activate it below (it's not in
    // ALL_SWITCHABLE_TOOLS because it uses mousewheel, not
    // a primary mouse button — but the Passive sweep above
    // doesn't touch it, so we handle it explicitly).
    if (StackScrollTool && toolGroup.hasTool(StackScrollTool.toolName)) {
      try {
        toolGroup.setToolPassive(StackScrollTool.toolName);
      } catch {}
    }

    /* ── Step 2: Activate the selected tool ───────────────
     *
     * We bind it to the primary (left) mouse button.
     * ─────────────────────────────────────────────────── */
    try {
      if (toolGroup.hasTool(newToolName)) {
        toolGroup.setToolActive(newToolName, {
          bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
        });
      }
    } catch (err) {
      console.warn(
        `[ViewerPage] Could not activate ${newToolName} in group ${groupId}:`,
        err
      );
    }

    /* ── Step 3: Re-activate background tools ─────────────
     *
     * These tools use different input channels (mousewheel,
     * middle-click, right-click) so they don't conflict with
     * whichever tool is on left-click. They must ALWAYS be
     * active so the user can scroll/pan/zoom regardless of
     * which annotation tool is selected.
     *
     * The Passive sweep in Step 1 killed Pan and Zoom.
     * StackScrollTool was explicitly set Passive above.
     * We bring them all back here.
     * ─────────────────────────────────────────────────── */

    // StackScrollTool: mousewheel
    // Requires explicit Wheel binding (MouseBindings.Wheel = 524288).
    if (StackScrollTool && toolGroup.hasTool(StackScrollTool.toolName)) {
      try {
        toolGroup.setToolActive(StackScrollTool.toolName, {
          bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
        });
      } catch {}
    }

    // PanTool: middle-click (Auxiliary)
    // Only bind to middle-click when Pan is NOT the primary tool
    // to avoid duplicate bindings.
    if (
      PanTool &&
      newToolName !== "Pan" &&
      toolGroup.hasTool(PanTool.toolName)
    ) {
      try {
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
        });
      } catch {}
    }

    // ZoomTool: right-click (Secondary)
    // Only bind to right-click when Zoom is NOT the primary tool.
    if (
      ZoomTool &&
      newToolName !== "Zoom" &&
      toolGroup.hasTool(ZoomTool.toolName)
    ) {
      try {
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: Enums.MouseBindings.Secondary }],
        });
      } catch {}
    }
  }
}

/* ═══════════════════════════════════════════════════════
 *  MAIN COMPONENT
 * ═══════════════════════════════════════════════════════ */

export default function ViewerPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const { activeTool, layout, setActiveTool, setLayout } = useViewerStore();

  /* ── View mode state ────────────────────────────────────
   * "stack"  → standard multi-viewport grid, one series each
   * "mpr"    → three orthogonal planes (axial/sagittal/coronal)
   * "fusion" → two co-registered volumes overlaid (e.g. CT+PET)
   * ───────────────────────────────────────────────────── */
  const [viewMode, setViewMode] = useState("stack");

  /* ── Undo stack ─────────────────────────────────────────
   *
   * Cornerstone does not maintain a global "annotation
   * creation order" list.  We keep our own lightweight
   * stack of annotationUIDs so that "Undo" always removes
   * the most recently created annotation regardless of
   * which tool or viewport produced it.
   *
   * Child viewer components (ViewerLayout, MPRViewer,
   * FusionViewer) should push to this ref via the
   * CORNERSTONE_TOOLS_ANNOTATION_COMPLETED event:
   *
   *   eventTarget.addEventListener(
   *     csToolsEnums.Events.ANNOTATION_COMPLETED,
   *     (evt) => undoStackRef.current.push(evt.detail.annotation.annotationUID)
   *   );
   *
   * If you haven't wired that event yet, the fallback
   * "undo" below will pop the last annotation it can
   * find in the manager — which is still better than
   * the broken getAllAnnotations() call.
   * ───────────────────────────────────────────────────── */
  const undoStackRef = useRef([]);

  /* ── Per-viewport series management (stack mode) ─────── */
  const {
    activeVp,
    setActiveVp,
    assignments,
    assignSeries,
    getAssignment,
  } = useViewportSeries();

  /* ── MPR: uses the series from whichever viewport was
   *   last active in stack mode ──────────────────────── */
  const activeAssignment = getAssignment(activeVp);

  /* ── Fusion: two separate series selections ────────────
   * First click in the study list  → base volume (e.g. CT)
   * Second click                   → overlay volume (e.g. PET)
   * Third+ click                   → replaces overlay
   * ───────────────────────────────────────────────────── */
  const [fusionBase, setFusionBase] = useState(null);
  const [fusionOverlay, setFusionOverlay] = useState(null);

  /* ── Fetch imageIds for MPR and Fusion ──────────────── */
  const { imageIds: mprImageIds } = useViewportImageIds(activeAssignment);
  const { imageIds: fusionBaseImageIds } = useViewportImageIds(fusionBase);
  const { imageIds: fusionOverlayImageIds } = useViewportImageIds(fusionOverlay);

  /* ── Orthanc sync mutation ──────────────────────────── */
  const syncMutation = useMutation(syncStudies, {
    onSuccess: () => queryClient.invalidateQueries("orthanc-studies"),
  });

  /* ═══════════════════════════════════════════════════════
   *  TOOL CHANGE HANDLER
   *
   *  This is called from the Toolbar whenever the user
   *  clicks a different tool button.  It does two things:
   *
   *    1. Updates the Zustand store (so the UI highlights
   *       the correct button)
   *    2. Tells Cornerstone to switch the active tool
   *       via our switchActiveTool() helper — which
   *       correctly preserves all existing annotations
   *       by setting old tools to Passive instead of
   *       Disabled, AND re-activates background tools
   *       (StackScroll, Pan, Zoom) so they keep working.
   * ═══════════════════════════════════════════════════════ */
  const handleToolChange = useCallback(
    (toolName) => {
      // Update the store first so the toolbar re-renders
      // with the correct active state immediately
      setActiveTool(toolName);

      // Then update Cornerstone's internal tool state.
      // This is async but we don't need to await it —
      // the visual switch in the toolbar is instant, and
      // the Cornerstone switch happens on the next frame.
      switchActiveTool(toolName);
    },
    [setActiveTool]
  );

  /* ═══════════════════════════════════════════════════════
   *  SERIES SELECTION
   *
   *  Routes the user's study-list click to the appropriate
   *  target depending on the current view mode:
   *
   *  Stack mode  → assign to the active viewport slot
   *  MPR mode    → same (MPR reads from active viewport)
   *  Fusion mode → first click = base, second = overlay
   * ═══════════════════════════════════════════════════════ */
  const handleSelectSeries = useCallback(
    (seriesData) => {
      if (viewMode === "fusion") {
        if (!fusionBase) {
          // First selection → base volume
          setFusionBase(seriesData);
        } else if (!fusionOverlay) {
          // Second selection → overlay volume
          setFusionOverlay(seriesData);
        } else {
          // Both already set → replace overlay with new pick
          setFusionOverlay(seriesData);
        }
      } else {
        // Stack and MPR both route through the same
        // viewport assignment system
        assignSeries(seriesData);
      }
    },
    [viewMode, fusionBase, fusionOverlay, assignSeries]
  );

  /* ═══════════════════════════════════════════════════════
   *  VIEW MODE CHANGE
   *
   *  Resets fusion-specific state when leaving/entering
   *  fusion mode.  We do NOT clear annotations on mode
   *  change — annotations are tied to FrameOfReference,
   *  not to the UI layout.
   * ═══════════════════════════════════════════════════════ */
  const handleViewModeChange = useCallback((mode) => {
    setViewMode(mode);

    // Reset fusion selections when entering fusion mode
    // so the user starts fresh with base/overlay picks
    if (mode === "fusion") {
      setFusionBase(null);
      setFusionOverlay(null);
    }
  }, []);

  /* ═══════════════════════════════════════════════════════
   *  CLEAR ALL ANNOTATIONS
   *
   *  Uses the AnnotationManager's removeAllAnnotations()
   *  method which cleanly removes every annotation across
   *  all frame-of-reference groups and tools.
   *
   *  Previous broken approach used a non-existent
   *  "getAllAnnotations()" method and iterated manually.
   * ═══════════════════════════════════════════════════════ */
  const handleClear = useCallback(async () => {
    try {
      const csTools = await import("@cornerstonejs/tools");
      const manager = csTools.annotation.state.getAnnotationManager();

      // removeAllAnnotations() is the official v4 API for
      // wiping the entire annotation state in one call
      manager.removeAllAnnotations();

      // Also clear our local undo stack since there's
      // nothing left to undo
      undoStackRef.current = [];

      // Force a re-render so the cleared annotations
      // disappear from the canvas immediately
      await rerenderAllViewports();
    } catch (err) {
      console.error("[ViewerPage] Failed to clear annotations:", err);
    }
  }, []);

  /* ═══════════════════════════════════════════════════════
   *  UNDO LAST ANNOTATION
   *
   *  Strategy:
   *    1. If our undoStackRef has entries, pop the last UID
   *       and remove that specific annotation (precise)
   *    2. Fallback: collect all annotations and remove the
   *       last one found (less precise but functional)
   *
   *  The previous code called state.getAllAnnotations()
   *  which does not exist in Cornerstone v4 — it would
   *  silently return undefined and nothing would happen.
   * ═══════════════════════════════════════════════════════ */
  const handleUndo = useCallback(async () => {
    try {
      const csTools = await import("@cornerstonejs/tools");
      const manager = csTools.annotation.state.getAnnotationManager();

      /* ── Try 1: Use our tracked undo stack ────────────
       * This is the most reliable approach because we
       * know the exact creation order.                    */
      if (undoStackRef.current.length > 0) {
        const lastUID = undoStackRef.current.pop();
        manager.removeAnnotation(lastUID);
        await rerenderAllViewports();
        return;
      }

      /* ── Try 2: Fallback — collect and remove last ──── */
      const allAnnotations = await collectAllAnnotations();

      if (allAnnotations.length === 0) {
        // Nothing to undo — bail silently
        return;
      }

      // Remove the last annotation in the collected list
      const lastAnnotation = allAnnotations[allAnnotations.length - 1];
      const uid = lastAnnotation.annotationUID || lastAnnotation;
      manager.removeAnnotation(uid);

      await rerenderAllViewports();
    } catch (err) {
      console.error("[ViewerPage] Failed to undo annotation:", err);
    }
  }, []);

  /* ═══════════════════════════════════════════════════════
   *  RESET VIEWPORT
   *
   *  Resets camera (zoom, pan, rotation) and window/level
   *  for every viewport in every rendering engine.
   *
   *  In Cornerstone v4:
   *   - resetCamera()  → restores default zoom, pan, focal point
   *   - resetProperties() → restores default VOI (window/level),
   *     invert, colormap etc.  Only exists on certain viewport
   *     types (VolumeViewport, StackViewport) so we check first.
   *   - render() → flushes the reset to screen
   * ═══════════════════════════════════════════════════════ */
  const handleResetViewport = useCallback(async () => {
    try {
      const cs = await import("@cornerstonejs/core");
      const engines = cs.getRenderingEngines();

      engines.forEach((engine) => {
        engine.getViewports().forEach((viewport) => {
          // Reset geometric transforms (zoom, pan, rotation)
          viewport.resetCamera();

          // Reset display properties (window/level, colormap)
          // This method exists on Stack and Volume viewports
          // but not on all viewport types, so guard the call.
          if (typeof viewport.resetProperties === "function") {
            viewport.resetProperties();
          }

          // Flush changes to the canvas
          viewport.render();
        });
      });
    } catch (err) {
      console.error("[ViewerPage] Failed to reset viewports:", err);
    }
  }, []);

  /* ═══════════════════════════════════════════════════════
   *  LOGOUT
   * ═══════════════════════════════════════════════════════ */
  const handleLogout = useCallback(() => {
    logout();
    navigate("/login");
  }, [logout, navigate]);

  /* ═══════════════════════════════════════════════════════
   *  BANNER — contextual status bar under the toolbar
   *
   *  Shows different information depending on the active
   *  view mode so the user always knows what state they're
   *  in and what action to take next.
   * ═══════════════════════════════════════════════════════ */
  function renderBanner() {
    /* ── MPR banner ────────────────────────────────────── */
    if (viewMode === "mpr") {
      return (
        <>
          <span className={styles.modeBadge}>MPR</span>
          <span className={styles.seriesLabel}>
            {activeAssignment
              ? activeAssignment.description
              : "Select a CT or MR series for MPR"}
          </span>
        </>
      );
    }

    /* ── Fusion banner ─────────────────────────────────── */
    if (viewMode === "fusion") {
      return (
        <>
          <span className={`${styles.modeBadge} ${styles.modeFusion}`}>
            Fusion
          </span>
          <span className={styles.seriesLabel}>
            {!fusionBase
              ? "① Select base volume (e.g. CT)"
              : !fusionOverlay
              ? "② Select overlay volume (e.g. PET)"
              : `${fusionBase.description} + ${fusionOverlay.description}`}
          </span>
        </>
      );
    }

    /* ── Stack banner (default) ────────────────────────── */
    return (
      <>
        <span className={styles.vpIndicator}>
          VP {activeVp.replace("vp-", "")}
        </span>
        <span className={styles.seriesLabel}>
          {activeAssignment
            ? activeAssignment.description
            : "Select a series to load"}
        </span>
        {activeAssignment && (
          <span className={styles.imageCount}>
            {Object.keys(assignments).length} viewport
            {Object.keys(assignments).length !== 1 ? "s" : ""} active
          </span>
        )}
      </>
    );
  }

  /* ═══════════════════════════════════════════════════════
   *  RENDER
   * ═══════════════════════════════════════════════════════ */
  return (
    <div className={styles.shell}>
      {/* ── Top toolbar ──────────────────────────────────
       * Note: onToolChange now uses our handleToolChange
       * which correctly switches tools via Passive/Active
       * transitions instead of whatever was happening before.
       * ─────────────────────────────────────────────────── */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={handleToolChange}
        layout={layout}
        onLayoutChange={setLayout}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onSync={() => syncMutation.mutate()}
        onClear={handleClear}
        onUndo={handleUndo}
        onResetViewport={handleResetViewport}
        isSyncing={syncMutation.isLoading}
      />

      <div className={styles.body}>
        {/* ── Left sidebar: study browser + user bar ───── */}
        <aside className={styles.sidebar}>
          <StudyList onSelectSeries={handleSelectSeries} />
          <div className={styles.userBar}>
            <span className={styles.userEmail}>{user?.email}</span>
            <button className={styles.logoutBtn} onClick={handleLogout}>
              Logout
            </button>
          </div>
        </aside>

        {/* ── Main content area ────────────────────────── */}
        <main className={styles.main}>
          <div className={styles.seriesBanner}>{renderBanner()}</div>

          <div className={styles.viewportArea}>
            {/* ── STACK MODE ───────────────────────────────
             * Multi-viewport grid.  Each viewport cell can
             * hold a different series.  Layout is controlled
             * by the layout selector (1×1, 1×2, 2×2).
             *
             * The `activeTool` prop tells each viewport which
             * Cornerstone tool is currently bound to left-click.
             * ───────────────────────────────────────────── */}
            {viewMode === "stack" && (
              <ViewerLayout
                layout={layout}
                activeTool={activeTool}
                activeVp={activeVp}
                onViewportClick={setActiveVp}
                assignments={assignments}
              />
            )}

            {/* ── MPR MODE ─────────────────────────────────
             * Three orthogonal reconstructions (axial,
             * sagittal, coronal) from a single volumetric
             * series.  Requires a series with consistent
             * slice spacing — won't work for XA, CR, DX.
             *
             * The MPRViewer component should:
             *   1. Create its own ToolGroup (e.g. "mprToolGroup")
             *   2. Add all tools once on mount
             *   3. Respond to `activeTool` prop changes by
             *      calling setToolPassive/setToolActive —
             *      NOT by re-creating the group.
             * ───────────────────────────────────────────── */}
            {viewMode === "mpr" && (
              <>
                {activeAssignment && mprImageIds.length > 0 ? (
                  <MPRViewer
                    imageIds={mprImageIds}
                    seriesUID={activeAssignment.seriesInstanceUID}
                    activeTool={activeTool}
                  />
                ) : (
                  <div className={styles.modeEmpty}>
                    <span className={styles.modeEmptyIcon}>⊞</span>
                    <span>Select a CT or MR series to view in MPR</span>
                    <span className={styles.modeEmptyHint}>
                      MPR requires volumetric data with consistent slice
                      spacing. It does not work with XA, CR, or DX modalities.
                    </span>
                  </div>
                )}
              </>
            )}

            {/* ── FUSION MODE ──────────────────────────────
             * Overlays two co-registered volumes (typically
             * CT as the base and PET as the coloured overlay).
             *
             * Both series must share the same FrameOfReference
             * or be from the same acquisition session for
             * proper spatial alignment.
             *
             * Selection flow:
             *   Click 1 in study list → base volume
             *   Click 2               → overlay volume
             *   Click 3+              → replaces overlay
             * ───────────────────────────────────────────── */}
            {viewMode === "fusion" && (
              <>
                {fusionBase &&
                fusionOverlay &&
                fusionBaseImageIds.length > 0 &&
                fusionOverlayImageIds.length > 0 ? (
                  <FusionViewer
                    baseImageIds={fusionBaseImageIds}
                    baseSeriesUID={fusionBase.seriesInstanceUID}
                    overlayImageIds={fusionOverlayImageIds}
                    overlaySeriesUID={fusionOverlay.seriesInstanceUID}
                  />
                ) : (
                  <div className={styles.modeEmpty}>
                    <span className={styles.modeEmptyIcon}>◈</span>
                    <span>
                      {!fusionBase
                        ? "Step 1: Select the base volume (e.g. CT)"
                        : "Step 2: Select the overlay volume (e.g. PET)"}
                    </span>
                    <span className={styles.modeEmptyHint}>
                      Both series must share the same Frame of Reference
                      (co-registered or same acquisition session).
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}