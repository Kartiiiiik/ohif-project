import { useEffect, useState } from "react";

let initState = "idle";
let initPromise = null;
let initError = null;

const ORTHANC_AUTH = "Basic " + btoa("admin:orthanc");

async function initCornerstone() {
  if (initState === "done") return;
  if (initState === "pending") return initPromise;

  initState = "pending";

  initPromise = (async () => {
    try {
      // ── 1. Expose dicom-parser globally ───────────────
      const dicomParserModule = await import("dicom-parser");
      const dicomParser = dicomParserModule.default ?? dicomParserModule;
      window.dicomParser = dicomParser;

      // ── 2. Load cornerstone core ──────────────────────
      const cornerstone = await import("@cornerstonejs/core");

      // Log the version so we know what we're working with
      console.log(
        "@cornerstonejs/core version:",
        cornerstone.VERSION ?? cornerstone.default?.VERSION ?? "unknown"
      );

      await cornerstone.init();

      // ── 3. Load + init DICOM image loader ─────────────
      const dicomImageLoader = await import(
        "@cornerstonejs/dicom-image-loader"
      );

      // Wire externals (needed for v1.x builds, harmless on v2)
      if (dicomImageLoader.external) {
        dicomImageLoader.external.cornerstone = cornerstone;
        dicomImageLoader.external.dicomParser = dicomParser;
      }

      // Call init — in true v2 (4.x), this registers everything
      if (typeof dicomImageLoader.init === "function") {
        dicomImageLoader.init({
          maxWebWorkers: Math.min(navigator.hardwareConcurrency || 4, 8),
        });
      }

      // Configure auth
      if (typeof dicomImageLoader.configure === "function") {
        dicomImageLoader.configure({
          beforeSend: (xhr) => {
            xhr.setRequestHeader("Authorization", ORTHANC_AUTH);
          },
        });
      }

      // Ensure image loaders are registered (belt + suspenders)
      if (dicomImageLoader.wadouri) {
        try {
          cornerstone.imageLoader.registerImageLoader(
            "wadouri",
            dicomImageLoader.wadouri.loadImage
          );
        } catch {}
      }
      if (dicomImageLoader.wadors) {
        try {
          cornerstone.imageLoader.registerImageLoader(
            "wadors",
            dicomImageLoader.wadors.loadImage
          );
        } catch {}
      }

      // ── 4. Volume loader — diagnose and register ──────
      console.log("=== VOLUME LOADER DIAGNOSTICS ===");
      console.log(
        "cornerstone.volumeLoader exists:",
        !!cornerstone.volumeLoader
      );

      if (cornerstone.volumeLoader) {
        console.log(
          "volumeLoader keys:",
          Object.keys(cornerstone.volumeLoader)
        );
      }

      // Search for the streaming volume loader function in ALL exports
      const allKeys = Object.keys(cornerstone);
      const volumeKeys = allKeys.filter(
        (k) => k.toLowerCase().includes("volume")
      );
      const streamingKeys = allKeys.filter(
        (k) => k.toLowerCase().includes("streaming")
      );

      console.log("Volume-related exports:", volumeKeys);
      console.log("Streaming-related exports:", streamingKeys);

      // Try every possible location for the loader function
      let loaderFn = null;
      const candidates = [
        cornerstone.cornerstoneStreamingImageVolumeLoader,
        cornerstone.cornerstoneStreamingDynamicImageVolumeLoader,
        cornerstone.StreamingImageVolume,
      ];

      // Also check if it's nested under volumeLoader
      if (cornerstone.volumeLoader) {
        candidates.push(
          cornerstone.volumeLoader.cornerstoneStreamingImageVolumeLoader
        );
      }

      // Check dicomImageLoader exports too
      const dicomKeys = Object.keys(dicomImageLoader);
      const dicomStreamingKeys = dicomKeys.filter(
        (k) => k.toLowerCase().includes("streaming")
      );
      console.log("dicomImageLoader streaming exports:", dicomStreamingKeys);

      candidates.push(
        dicomImageLoader.cornerstoneStreamingImageVolumeLoader
      );

      for (const candidate of candidates) {
        if (typeof candidate === "function") {
          loaderFn = candidate;
          break;
        }
      }

      if (loaderFn && cornerstone.volumeLoader) {
        try {
          cornerstone.volumeLoader.registerVolumeLoader(
            "cornerstoneStreamingImageVolume",
            loaderFn
          );
          cornerstone.volumeLoader.registerUnknownVolumeLoader(loaderFn);
          console.log("Volume loader registered manually!");
        } catch (e) {
          console.log("Manual registration failed:", e.message);
        }
      } else {
        // In v2 (4.x), init() may have already auto-registered it.
        // Test by checking if createAndCacheVolume works
        if (
          cornerstone.volumeLoader &&
          typeof cornerstone.volumeLoader.createAndCacheVolume === "function"
        ) {
          console.log(
            "createAndCacheVolume exists — volume loader likely auto-registered"
          );
        } else {
          console.warn(
            "NO VOLUME LOADER FOUND.",
            "All cornerstone exports (" + allKeys.length + "):",
            allKeys.sort().join(", ")
          );
        }
      }
      console.log("=== END DIAGNOSTICS ===");

      // ── 5. Init tools ─────────────────────────────────
      const cornerstoneTools = await import("@cornerstonejs/tools");
      await cornerstoneTools.init();

      const {
        WindowLevelTool,
        PanTool,
        ZoomTool,
        StackScrollMouseWheelTool,
        LengthTool,
        AngleTool,
        EllipticalROITool,
        RectangleROITool,
        ArrowAnnotateTool,
        CrosshairsTool,
        ToolGroupManager,
        Enums: ToolEnums,
      } = cornerstoneTools;

      const allTools = [
        WindowLevelTool,
        PanTool,
        ZoomTool,
        StackScrollMouseWheelTool,
        LengthTool,
        AngleTool,
        EllipticalROITool,
        RectangleROITool,
        ArrowAnnotateTool,
        CrosshairsTool,
      ];

      allTools.forEach((Tool) => {
        try {
          cornerstoneTools.addTool(Tool);
        } catch {}
      });

      let toolGroup = ToolGroupManager.getToolGroup("DEFAULT_TOOL_GROUP");
      if (!toolGroup) {
        toolGroup = ToolGroupManager.createToolGroup("DEFAULT_TOOL_GROUP");
        allTools.forEach((Tool) => toolGroup.addTool(Tool.toolName));

        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
        });
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
        });
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
        });
        toolGroup.setToolActive(StackScrollMouseWheelTool.toolName);
      }

      initState = "done";
      initError = null;
      console.log("Cornerstone initialized successfully");
    } catch (err) {
      initState = "error";
      initError = err;
      console.error("Cornerstone init failed:", err);
      throw err;
    }
  })();

  return initPromise;
}

export function useCornerstoneInit() {
  const [ready, setReady] = useState(initState === "done");
  const [error, setError] = useState(initError?.message || null);

  useEffect(() => {
    if (initState === "done") {
      setReady(true);
      return;
    }
    if (initState === "error") {
      setError(initError?.message || "Cornerstone initialization failed");
      return;
    }
    initCornerstone()
      .then(() => setReady(true))
      .catch((err) => {
        setReady(false);
        setError(err.message || "Cornerstone initialization failed");
      });
  }, []);

  return { ready, error };
}