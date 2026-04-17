// useCornerstoneInit.js
//
// Singleton initialization hook for Cornerstone.js v4 core, DICOM image
// loader, volume loader, and cornerstone tools.
//
// ┌─────────────────────────────────────────────────────────────────┐
// │  This hook ensures all libraries are set up EXACTLY ONCE,       │
// │  regardless of how many React components import it.             │
// │                                                                 │
// │  It uses module-level state (outside React) so that even if     │
// │  multiple components mount/unmount, the heavy WASM + WebGL      │
// │  initialization only happens on the first call.                 │
// └─────────────────────────────────────────────────────────────────┘
//
// IMPORTANT: All cornerstone packages are imported STATICALLY (top-level)
// rather than dynamically (await import()). This is required because:
//
//   1. Vite resolves static imports through its pre-bundling pipeline,
//      which correctly handles the package's barrel exports and WASM.
//
//   2. Dynamic import() triggers Vite's import-analysis plugin which
//      rejects subpath imports and can't resolve circular deps properly.
//
//   3. The official Cornerstone v4 examples all use static imports.

import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════
//  STATIC IMPORTS — resolved at bundle time through Vite pre-bundler
// ═══════════════════════════════════════════════════════════════════

import * as cornerstone from "@cornerstonejs/core";
import * as cornerstoneTools from "@cornerstonejs/tools";
import * as dicomImageLoader from "@cornerstonejs/dicom-image-loader";
import dicomParser from "dicom-parser";

// cornerstoneStreamingImageVolumeLoader is the factory function that
// creates StreamingImageVolume instances — required for MPR and Fusion.
// Importing it as a named export lets Vite resolve it correctly.
import {
  cornerstoneStreamingImageVolumeLoader,
} from "@cornerstonejs/core";

// ═══════════════════════════════════════════════════════════════════
//  MODULE-LEVEL SINGLETON STATE
//
//  These variables live outside React and persist for the lifetime
//  of the browser tab. They ensure init() runs at most once.
//
//  Possible states:
//    "idle"    → init hasn't started yet
//    "pending" → init is in progress (Promise is in flight)
//    "done"    → init completed successfully
//    "error"   → init failed (initError holds the Error object)
// ═══════════════════════════════════════════════════════════════════

let initState = "idle";
let initPromise = null;
let initError = null;

// Base64-encoded HTTP Basic credentials for Orthanc.
// Default Orthanc username/password is "admin"/"orthanc".
const ORTHANC_AUTH = "Basic " + btoa("admin:orthanc");

// ═══════════════════════════════════════════════════════════════════
//  INITIALIZATION FUNCTION
//
//  Execution order:
//    Step 1 → Expose dicom-parser globally (dicom-image-loader needs it)
//    Step 2 → Initialize cornerstone core (WebGL, caches, events)
//    Step 3 → Initialize the DICOM image loader (wadouri/wadors)
//    Step 4 → Register the streaming volume loader (MPR/Fusion)
//    Step 5 → Initialize cornerstone tools + register all tools
//    Step 6 → Create the default ToolGroup with proper bindings
// ═══════════════════════════════════════════════════════════════════

async function initCornerstone() {
  // Already done — return immediately
  if (initState === "done") return;

  // Already in progress — return the same Promise so callers
  // don't kick off a second parallel init
  if (initState === "pending") return initPromise;

  initState = "pending";

  initPromise = (async () => {
    try {
      // ─────────────────────────────────────────────────────────
      //  STEP 1: Expose dicom-parser on window
      //
      //  @cornerstonejs/dicom-image-loader internally does:
      //    const parser = window.dicomParser || external.dicomParser
      //
      //  Without this, every DICOM file load will throw
      //  "dicomParser is not defined".
      // ─────────────────────────────────────────────────────────
      window.dicomParser = dicomParser;

      // ─────────────────────────────────────────────────────────
      //  STEP 2: Initialize cornerstone core
      //
      //  This sets up:
      //    • WebGL rendering contexts and GPU detection
      //    • The image cache (LRU, configurable max size)
      //    • The volume cache
      //    • The internal eventTarget system
      //    • RenderingEngine factory
      // ─────────────────────────────────────────────────────────
      await cornerstone.init();
      console.log("[init] Cornerstone core initialized");

      // ─────────────────────────────────────────────────────────
      //  STEP 3: Initialize the DICOM image loader
      //
      //  This registers two image loader schemes:
      //    • "wadouri:" — WADO-URI (fetch single DICOM by SOP UID)
      //    • "wadors:"  — WADO-RS  (DICOMweb RESTful retrieval)
      //
      //  It also spins up Web Workers for DICOM decoding
      //  (JPEG, JPEG-LS, JPEG2000, RLE, deflate, etc.)
      // ─────────────────────────────────────────────────────────

      // Wire externals — required for backwards compatibility with
      // some dicom-image-loader builds that use external references
      if (dicomImageLoader.external) {
        dicomImageLoader.external.cornerstone = cornerstone;
        dicomImageLoader.external.dicomParser = dicomParser;
      }

      // init() registers image loaders and starts web workers.
      // maxWebWorkers caps at the number of logical CPU cores,
      // but never more than 8 (diminishing returns past that).
      if (typeof dicomImageLoader.init === "function") {
        await dicomImageLoader.init({
          maxWebWorkers: Math.min(navigator.hardwareConcurrency || 4, 8),
        });
      }

      // Configure HTTP auth headers for all WADO requests.
      // This callback fires before every XHR the loader makes,
      // so Orthanc receives the Basic auth header automatically.
      if (typeof dicomImageLoader.configure === "function") {
        dicomImageLoader.configure({
          beforeSend: (xhr) => {
            xhr.setRequestHeader("Authorization", ORTHANC_AUTH);
          },
        });
      }

      // Belt-and-suspenders: explicitly register the wadouri and
      // wadors image loaders in case init() didn't do it
      // (varies by build/version).
      if (dicomImageLoader.wadouri) {
        try {
          cornerstone.imageLoader.registerImageLoader(
            "wadouri",
            dicomImageLoader.wadouri.loadImage
          );
          console.log("[init] wadouri image loader registered");
        } catch (e) {
          console.warn("[init] wadouri registration skipped:", e.message);
        }
      }
      if (dicomImageLoader.wadors) {
        try {
          cornerstone.imageLoader.registerImageLoader(
            "wadors",
            dicomImageLoader.wadors.loadImage
          );
          console.log("[init] wadors image loader registered");
        } catch (e) {
          console.warn("[init] wadors registration skipped:", e.message);
        }
      }

      // ─────────────────────────────────────────────────────────
      //  STEP 4: Register the streaming volume loader
      //
      //  This is required for:
      //    • MPR mode (3-plane volume reconstruction)
      //    • Fusion mode (overlaying two volumes)
      //
      //  The official v4 pattern:
      //    volumeLoader.registerVolumeLoader(
      //      'cornerstoneStreamingImageVolume',
      //      cornerstoneStreamingImageVolumeLoader
      //    );
      //    volumeLoader.registerUnknownVolumeLoader(
      //      cornerstoneStreamingImageVolumeLoader
      //    );
      //
      //  registerUnknownVolumeLoader is the fallback for any
      //  volume ID scheme that doesn't have a specific loader.
      // ─────────────────────────────────────────────────────────
      if (typeof cornerstoneStreamingImageVolumeLoader === "function") {
        cornerstone.volumeLoader.registerVolumeLoader(
          "cornerstoneStreamingImageVolume",
          cornerstoneStreamingImageVolumeLoader
        );
        cornerstone.volumeLoader.registerUnknownVolumeLoader(
          cornerstoneStreamingImageVolumeLoader
        );
        console.log("[init] Volume loader registered (streaming + unknown fallback)");
      } else {
        console.error(
          "[init] cornerstoneStreamingImageVolumeLoader is not a function.",
          "Type:", typeof cornerstoneStreamingImageVolumeLoader,
          "— MPR and Fusion modes will not work."
        );
      }

      // ─────────────────────────────────────────────────────────
      //  STEP 5: Initialize cornerstone tools
      //
      //  This sets up:
      //    • The tool state manager (annotation storage)
      //    • SVG annotation rendering layer
      //    • Mouse/touch/keyboard event dispatchers
      //    • Cursor management
      // ─────────────────────────────────────────────────────────
      await cornerstoneTools.init();
      console.log("[init] Cornerstone Tools initialized");

      // ─────────────────────────────────────────────────────────
      //  STEP 5a: Destructure tool classes
      //
      //  CRITICAL v4 CHANGES from v3:
      //
      //    ┌──────────────────────────────┬──────────────────────┐
      //    │  v3 (old / broken)           │  v4 (correct)        │
      //    ├──────────────────────────────┼──────────────────────┤
      //    │  StackScrollMouseWheelTool   │  StackScrollTool     │
      //    │  (some builds) ArrowAnnot... │  ArrowAnnotateTool   │
      //    └──────────────────────────────┴──────────────────────┘
      //
      //  The v3 name StackScrollMouseWheelTool does NOT exist in
      //  v4 and will be `undefined`. Attempting to read .toolName
      //  on `undefined` is what caused the crash:
      //    "Cannot read properties of undefined (reading 'toolName')"
      //
      //  The v4 API docs confirm these tool class names:
      //  https://www.cornerstonejs.org/docs/api/tools/classes/
      // ─────────────────────────────────────────────────────────

      const {
        // Navigation / manipulation tools
        WindowLevelTool,
        PanTool,
        ZoomTool,
        StackScrollTool,          // ← v4 name (was StackScrollMouseWheelTool in v3)

        // Annotation / measurement tools
        LengthTool,
        AngleTool,
        EllipticalROITool,
        RectangleROITool,
        ArrowAnnotateTool,        // ← confirmed in v4 docs

        // MPR crosshairs
        CrosshairsTool,           // ← confirmed in v4 docs

        // Tool group management
        ToolGroupManager,
        Enums: ToolEnums,
      } = cornerstoneTools;

      // ─────────────────────────────────────────────────────────
      //  STEP 5b: Build the tool list with defensive filtering
      //
      //  If a future version renames or removes a tool, we skip
      //  it gracefully instead of crashing the entire init chain.
      //
      //  Every tool class has a static `.toolName` property
      //  (e.g. LengthTool.toolName === "Length"). We verify
      //  both the class and the property exist.
      // ─────────────────────────────────────────────────────────

      const allTools = [
        WindowLevelTool,
        PanTool,
        ZoomTool,
        StackScrollTool,
        LengthTool,
        AngleTool,
        EllipticalROITool,
        RectangleROITool,
        ArrowAnnotateTool,
        CrosshairsTool,
      ].filter((Tool) => {
        if (!Tool) {
          console.warn("[init] A tool import resolved to undefined — skipping");
          return false;
        }
        if (!Tool.toolName) {
          console.warn("[init] Tool missing .toolName property — skipping:", Tool);
          return false;
        }
        return true;
      });

      console.log(
        "[init] Tools to register:",
        allTools.map((T) => T.toolName).join(", ")
      );

      // ─────────────────────────────────────────────────────────
      //  STEP 5c: Register all tools globally
      //
      //  addTool() makes a tool class available to ALL tool groups.
      //  It's a global registration — you only do it once.
      //
      //  If a tool is already registered (e.g. from HMR re-run),
      //  addTool throws — we catch and ignore that.
      // ─────────────────────────────────────────────────────────

      allTools.forEach((Tool) => {
        try {
          cornerstoneTools.addTool(Tool);
        } catch (e) {
          // "Tool X is already added" — safe to ignore
          console.warn(`[init] addTool(${Tool.toolName}):`, e.message);
        }
      });

      // ─────────────────────────────────────────────────────────
      //  STEP 6: Create the default ToolGroup
      //
      //  A ToolGroup is a container that:
      //    • Associates a set of tools with a set of viewports
      //    • Controls which tool is Active (creating annotations),
      //      Passive (annotations visible + draggable, but no new
      //      ones on click), Enabled (visible only), or Disabled
      //
      //  We create one shared group "DEFAULT_TOOL_GROUP" used by
      //  all viewport components (Stack, MPR, Fusion).
      //
      //  ┌─────────────────────────────────────────────────────┐
      //  │  TOOL MODES — critical for annotation persistence:  │
      //  │                                                     │
      //  │  Active   → responds to mouse bindings, creates     │
      //  │             new annotations on click/drag            │
      //  │  Passive  → existing annotations are VISIBLE and    │
      //  │             handles can be grabbed/moved, but NO    │
      //  │             new annotations are created              │
      //  │  Enabled  → annotations render but can't interact   │
      //  │  Disabled → annotations HIDDEN, tool is inert       │
      //  │                                                     │
      //  │  The KEY insight: when switching tools, set the OLD │
      //  │  tool to PASSIVE (not Disabled). This keeps its     │
      //  │  annotations visible. Setting to Disabled is what   │
      //  │  caused annotations to "disappear" on tool switch.  │
      //  └─────────────────────────────────────────────────────┘
      // ─────────────────────────────────────────────────────────

      let toolGroup = ToolGroupManager.getToolGroup("DEFAULT_TOOL_GROUP");

      if (!toolGroup) {
        toolGroup = ToolGroupManager.createToolGroup("DEFAULT_TOOL_GROUP");

        // Add every registered tool to this group
        allTools.forEach((Tool) => {
          try {
            toolGroup.addTool(Tool.toolName);
          } catch (e) {
            console.warn(`[init] toolGroup.addTool(${Tool.toolName}):`, e.message);
          }
        });

        // ── Navigation tools: Active with specific mouse bindings ──
        //
        // Primary (left click)   → Window/Level
        // Auxiliary (middle click)→ Pan
        // Secondary (right click) → Zoom
        // Mousewheel              → Stack Scroll (no binding needed)

        if (WindowLevelTool) {
          toolGroup.setToolActive(WindowLevelTool.toolName, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
          });
        }

        if (PanTool) {
          toolGroup.setToolActive(PanTool.toolName, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
          });
        }

        if (ZoomTool) {
          toolGroup.setToolActive(ZoomTool.toolName, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
          });
        }

        // StackScrollTool listens on the mousewheel by default —
        // no explicit mouse button binding needed, just activate it.
        if (StackScrollTool) {
          toolGroup.setToolActive(StackScrollTool.toolName);
        }

        // ── Annotation tools: Passive by default ──────────────────
        //
        // Passive means:
        //   ✓ Existing annotations are rendered on the canvas
        //   ✓ Annotation handles can be grabbed and moved
        //   ✗ No new annotations are created on click
        //
        // The toolbar switches one of these to Active (with Primary
        // binding) when the user selects it. All others stay Passive.
        //
        // NEVER set these to Disabled — that hides all annotations
        // drawn with that tool, which is the "annotations disappear
        // when I switch tools" bug.

        const annotationTools = [
          LengthTool,
          AngleTool,
          EllipticalROITool,
          RectangleROITool,
          ArrowAnnotateTool,
          CrosshairsTool,
        ];

        annotationTools.forEach((Tool) => {
          if (!Tool) return;
          try {
            toolGroup.setToolPassive(Tool.toolName);
          } catch (e) {
            console.warn(`[init] setToolPassive(${Tool.toolName}):`, e.message);
          }
        });

        console.log("[init] Default tool group created with bindings");
      }

      // ─────────────────────────────────────────────────────────
      //  ALL DONE
      // ─────────────────────────────────────────────────────────
      initState = "done";
      initError = null;
      console.log("[init] ✓ Cornerstone fully initialized");

    } catch (err) {
      initState = "error";
      initError = err;
      console.error("[init] ✗ Cornerstone initialization failed:", err);
      throw err;
    }
  })();

  return initPromise;
}

// ═══════════════════════════════════════════════════════════════════
//  REACT HOOK
//
//  Components call:
//    const { ready, error } = useCornerstoneInit();
//
//  And gate their rendering on `ready`:
//    if (!ready) return <LoadingSpinner />;
//    if (error) return <ErrorMessage message={error} />;
//
//  The hook is idempotent — calling it from 10 components still
//  only runs initCornerstone() once.
// ═══════════════════════════════════════════════════════════════════

export function useCornerstoneInit() {
  const [ready, setReady] = useState(initState === "done");
  const [error, setError] = useState(initError?.message || null);

  useEffect(() => {
    // If init already completed (e.g. navigated away and came back),
    // immediately mark as ready without re-running init.
    if (initState === "done") {
      setReady(true);
      return;
    }

    // If init previously failed, surface the error immediately.
    if (initState === "error") {
      setError(initError?.message || "Cornerstone initialization failed");
      return;
    }

    // Otherwise kick off init (or attach to the in-flight Promise
    // if another component already started it).
    initCornerstone()
      .then(() => setReady(true))
      .catch((err) => {
        setReady(false);
        setError(err.message || "Cornerstone initialization failed");
      });
  }, []);

  return { ready, error };
}