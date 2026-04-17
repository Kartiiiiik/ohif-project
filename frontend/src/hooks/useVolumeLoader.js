// useVolumeLoader.js
// Custom React hook that takes an array of DICOM imageIds and a series UID,
// then constructs a 3D volume in cornerstone's cache for MPR/Fusion rendering.
//
// IMPORTANT: This hook requires cornerstone to be fully initialized before
// it runs. Pass the `ready` flag from useCornerstoneInit() so that volume
// creation doesn't race ahead of image-loader configuration (auth headers,
// web workers, metadata providers). Without this guard, the volume loader's
// internal prefetch requests will fail silently, leaving metadata empty,
// which causes generateVolumePropsFromImageIds to throw.

import { useState, useEffect, useRef } from "react";

/**
 * useVolumeLoader
 *
 * Accepts a flat list of imageIds (one per DICOM slice), a seriesUID that
 * serves as a unique key for the volume, and a `ready` boolean that gates
 * execution until cornerstone is fully initialized.
 *
 * Volume creation flow (cornerstone v4.21.0):
 *   - The volumeLoader module has a built-in unknown loader
 *     (cornerstoneStreamingImageVolumeLoader) that is set at module load time.
 *   - Any volumeId whose scheme is not explicitly registered falls through
 *     to this unknown loader.
 *   - The loader prefetches 3 images (first, middle, last) to populate
 *     metadata, then calls generateVolumePropsFromImageIds to build the
 *     volume geometry from that metadata.
 *   - If the prefetch fails (e.g. because auth headers aren't configured
 *     yet), metadata will be empty and volume creation throws.
 *
 * @param {string[]} imageIds    - Array of wadouri: or wadors: image ID strings.
 * @param {string}   seriesUID   - The DICOM Series Instance UID, used as volume key.
 * @param {boolean}  [ready=true] - Whether cornerstone is initialized. Pass the
 *                                  `ready` value from useCornerstoneInit(). When
 *                                  false, volume creation is deferred.
 * @returns {{ volumeId: string|null, volume: object|null, loading: boolean, error: string|null }}
 */
export function useVolumeLoader(imageIds, seriesUID, ready = true) {
  // The cornerstone volume ID string that was successfully used to create the volume.
  const [volumeId, setVolumeId] = useState(null);

  // The actual volume object returned by createAndCacheVolume.
  const [volume, setVolume] = useState(null);

  // True while the volume is being created and its pixel data is loading.
  const [loading, setLoading] = useState(false);

  // Human-readable error message if volume creation fails.
  const [error, setError] = useState(null);

  // Tracks the last seriesUID we successfully loaded so we don't re-load
  // the same series on every render.
  const prevSeriesRef = useRef(null);

  // The effect depends on imageIds, seriesUID, AND ready. When ready flips
  // from false to true, the effect re-runs and volume creation proceeds.
  useEffect(() => {
    // Guard: cornerstone must be fully initialized before we create volumes.
    // This ensures auth headers, web workers, and metadata providers are
    // all configured. Without this, the volume loader's internal prefetch
    // will send unauthenticated requests that return 401, causing silent
    // failures that result in "No volume loader could handle the imageIds".
    if (!ready) return;

    // Guard: if no imageIds or no seriesUID, reset state and bail out.
    if (!imageIds?.length || !seriesUID) {
      setVolumeId(null);
      setVolume(null);
      return;
    }

    // Guard: if we already loaded this exact series and have a volume, skip.
    if (prevSeriesRef.current === seriesUID && volume) return;

    // Record this series so subsequent renders with the same UID are skipped.
    prevSeriesRef.current = seriesUID;

    // Cancellation flag — set to true in the cleanup function so that if the
    // component unmounts (or deps change) mid-load, we don't call setState
    // on an unmounted component.
    let cancelled = false;

    async function loadVolume() {
      // Signal the UI that loading has started.
      setLoading(true);
      setError(null);

      try {
        // Dynamically import cornerstone core.
        const cs = await import("@cornerstonejs/core");

        // In cornerstone v4.21.0, volumeLoader is a namespace object
        // (import * as volumeLoader from './loaders/volumeLoader') that
        // re-exports all volume-related functions: createAndCacheVolume,
        // registerVolumeLoader, registerUnknownVolumeLoader, etc.
        const vl = cs.volumeLoader;

        // Safety check: volumeLoader must exist on the import.
        if (!vl) {
          throw new Error(
            "cornerstone.volumeLoader does not exist — " +
            "cornerstone core may not be installed correctly."
          );
        }

        // Safety check: createAndCacheVolume must be a function.
        // In v4.21.0 it's a named export on the volumeLoader namespace.
        if (typeof vl.createAndCacheVolume !== "function") {
          throw new Error(
            "volumeLoader.createAndCacheVolume is not a function — " +
            "cornerstone core version may be incompatible. " +
            "Found keys: " + Object.keys(vl).join(", ")
          );
        }

        // Build the volumeId. In v4.21.0, the volumeLoader module has:
        //   const volumeLoaders = {};                             // named scheme registry (empty by default)
        //   let unknownVolumeLoader = cornerstoneStreamingImageVolumeLoader;  // built-in fallback
        //
        // When createAndCacheVolume is called, it extracts the scheme
        // (everything before the first ":") and looks it up in volumeLoaders.
        // If not found, it falls through to unknownVolumeLoader.
        //
        // Since volumeLoaders is empty by default and unknownVolumeLoader is
        // always set, ANY volumeId will route to the built-in streaming loader.
        // We use the "cornerstoneStreamingImageVolume:" prefix by convention,
        // but a bare UID would also work.
        const vid = `cornerstoneStreamingImageVolume:${seriesUID}`;

        // Check if this volume is already in cornerstone's cache.
        // This happens when the user navigates away and back, or when React
        // re-renders without the series actually changing.
        let vol = null;
        try {
          vol = cs.cache.getVolume(vid);
        } catch (_cacheErr) {
          // getVolume may throw if the ID isn't found — that's normal.
        }

        if (vol) {
          // Volume was already cached — skip creation.
          console.log(`[useVolumeLoader] Cache hit for volume: "${vid}"`);
        } else {
          // Create the volume from scratch.
          //
          // Internally, this calls cornerstoneStreamingImageVolumeLoader which:
          //   1. Prefetches 3 images (first, middle, last) via the image loader.
          //      This populates the metadata providers with DICOM header info
          //      (orientation, spacing, pixel format, etc.).
          //   2. Calls generateVolumePropsFromImageIds which reads metadata
          //      from the metadata providers to compute volume geometry.
          //   3. Creates a StreamingImageVolume with that geometry.
          //
          // If the prefetch fails (auth issue, network error), metadata will
          // be missing and step 2 will throw. This is why the `ready` guard
          // at the top of this effect is critical — it ensures auth headers
          // are configured before any image fetches happen.
          try {
            vol = await vl.createAndCacheVolume(vid, { imageIds });
            console.log(`[useVolumeLoader] Volume created with ID: "${vid}"`);
          } catch (createErr) {
            // Provide detailed context about what failed.
            throw new Error(
              `createAndCacheVolume("${vid}") failed: ${createErr.message}. ` +
              `imageIds count: ${imageIds.length}, ` +
              `first imageId: "${imageIds[0]?.substring(0, 80)}..."`
            );
          }
        }

        // The volume object has been created, but pixel data for most slices
        // hasn't been fetched yet. Calling vol.load() triggers the actual
        // HTTP requests to download each DICOM slice and fill the volume's
        // voxel buffer. This is done via the image load pool manager, which
        // fetches images in parallel using web workers.
        if (typeof vol.load === "function") {
          try {
            await vol.load();
          } catch (loadErr) {
            // load() can throw partial errors (e.g. a few slices failed to
            // download). We log a warning but don't treat it as fatal — the
            // volume may still be usable with the successfully-loaded slices.
            // Missing slices will appear as black bands in the rendered output.
            console.warn(
              "[useVolumeLoader] vol.load() partial error:",
              loadErr.message
            );
          }
        }

        // Only update React state if the component is still mounted and this
        // effect hasn't been superseded by a newer one.
        if (!cancelled) {
          setVolumeId(vid);
          setVolume(vol);
        }
      } catch (err) {
        console.error("[useVolumeLoader] Volume loading failed:", err);
        if (!cancelled) {
          setError(err.message || "Failed to load volume");
        }
      } finally {
        // Always clear the loading flag when done, regardless of success/failure.
        if (!cancelled) setLoading(false);
      }
    }

    // Kick off the async volume loading.
    loadVolume();

    // Cleanup: if the component unmounts or deps change before loadVolume
    // finishes, set the cancelled flag so we don't write to stale state.
    return () => {
      cancelled = true;
    };
  }, [imageIds, seriesUID, ready]);

  // Expose the volume state to consuming components.
  return { volumeId, volume, loading, error };
}