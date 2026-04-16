import { useState, useCallback } from "react";
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

/* ── Annotation helpers ──────────────────────────────── */

async function getAnnotationState() {
  const { annotation } = await import("@cornerstonejs/tools");
  return annotation.state;
}

async function rerenderAll() {
  const cs = await import("@cornerstonejs/core");
  const engines = cs.getRenderingEngines();
  engines.forEach((engine) => {
    engine.renderViewports(engine.getViewports().map((vp) => vp.id));
  });
}

/* ── Component ───────────────────────────────────────── */

export default function ViewerPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const { activeTool, layout, setActiveTool, setLayout } = useViewerStore();

  // View mode: "stack" | "mpr" | "fusion"
  const [viewMode, setViewMode] = useState("stack");

  // Per-viewport series management (used in stack mode)
  const {
    activeVp,
    setActiveVp,
    assignments,
    assignSeries,
    getAssignment,
  } = useViewportSeries();

  // For MPR: the series from the active viewport
  const activeAssignment = getAssignment(activeVp);

  // For Fusion: need two series — base (first assigned) and overlay (second)
  // The user assigns them by selecting series while in fusion mode.
  // First selection = base volume, second selection = overlay volume.
  const [fusionBase, setFusionBase] = useState(null);
  const [fusionOverlay, setFusionOverlay] = useState(null);

  // Fetch imageIds for MPR (from active viewport assignment)
  const { imageIds: mprImageIds } = useViewportImageIds(activeAssignment);

  // Fetch imageIds for Fusion base and overlay
  const { imageIds: fusionBaseImageIds } = useViewportImageIds(fusionBase);
  const { imageIds: fusionOverlayImageIds } = useViewportImageIds(fusionOverlay);

  const syncMutation = useMutation(syncStudies, {
    onSuccess: () => queryClient.invalidateQueries("orthanc-studies"),
  });

  /* ── Series selection — routes to the right target ── */
  const handleSelectSeries = useCallback(
    (seriesData) => {
      if (viewMode === "fusion") {
        // In fusion mode: first click = base, second = overlay
        if (!fusionBase) {
          setFusionBase(seriesData);
        } else if (!fusionOverlay) {
          setFusionOverlay(seriesData);
        } else {
          // Both set — replace overlay
          setFusionOverlay(seriesData);
        }
      } else {
        // Stack and MPR: assign to active viewport
        assignSeries(seriesData);
      }
    },
    [viewMode, fusionBase, fusionOverlay, assignSeries]
  );

  /* ── View mode change — reset fusion state ─────────── */
  const handleViewModeChange = useCallback((mode) => {
    setViewMode(mode);
    if (mode === "fusion") {
      setFusionBase(null);
      setFusionOverlay(null);
    }
  }, []);

  /* ── Annotation actions ─────────────────────────────── */
  const handleClear = useCallback(async () => {
    const state = await getAnnotationState();
    const all = state.getAllAnnotations();
    all.forEach((ann) => state.removeAnnotation(ann.annotationUID));
    await rerenderAll();
  }, []);

  const handleUndo = useCallback(async () => {
    const state = await getAnnotationState();
    const all = state.getAllAnnotations();
    if (all.length > 0) {
      state.removeAnnotation(all[all.length - 1].annotationUID);
      await rerenderAll();
    }
  }, []);

  const handleResetViewport = useCallback(async () => {
    const cs = await import("@cornerstonejs/core");
    const engines = cs.getRenderingEngines();
    engines.forEach((engine) => {
      engine.getViewports().forEach((viewport) => {
        viewport.resetCamera();
        if (typeof viewport.resetProperties === "function") {
          viewport.resetProperties();
        }
        viewport.render();
      });
    });
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    navigate("/login");
  }, [logout, navigate]);

  /* ── Banner content varies by mode ──────────────────── */
  function renderBanner() {
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

    // Stack mode
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

  return (
    <div className={styles.shell}>
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
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
        <aside className={styles.sidebar}>
          <StudyList onSelectSeries={handleSelectSeries} />
          <div className={styles.userBar}>
            <span className={styles.userEmail}>{user?.email}</span>
            <button className={styles.logoutBtn} onClick={handleLogout}>
              Logout
            </button>
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.seriesBanner}>{renderBanner()}</div>

          <div className={styles.viewportArea}>
            {/* Stack mode — multi-viewport grid */}
            {viewMode === "stack" && (
              <ViewerLayout
                layout={layout}
                activeTool={activeTool}
                activeVp={activeVp}
                onViewportClick={setActiveVp}
                assignments={assignments}
              />
            )}

            {/* MPR mode — 3-plane reconstruction */}
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
                      MPR requires volumetric data with consistent slice spacing.
                      It does not work with XA, CR, or DX modalities.
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Fusion mode — two overlaid volumes */}
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