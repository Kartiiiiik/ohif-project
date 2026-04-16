import { useState, useEffect, useRef } from "react";

/**
 * Creates and caches a Cornerstone StreamingImageVolume from imageIds.
 *
 * This is the bridge between 2D stack viewing and 3D volume-based modes
 * (MPR, Fusion). Stack viewports display one image at a time from a flat
 * list of imageIds. Volume viewports reconstruct a 3D volume from those
 * same imageIds and can slice it in any orientation (axial, sagittal,
 * coronal, or oblique).
 *
 * Requirements:
 *   - imageIds must all be from the same series (same frame of reference)
 *   - Series must have consistent spacing (CT/MR — not CR/DX/XA)
 *
 * @param {string[]} imageIds - Array of wadouri: or wadors: image IDs
 * @param {string} seriesUID - Used to generate a unique volume ID
 * @returns {{ volumeId, volume, loading, error }}
 */
export function useVolumeLoader(imageIds, seriesUID) {
  const [volumeId, setVolumeId] = useState(null);
  const [volume, setVolume] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const prevSeriesRef = useRef(null);

  useEffect(() => {
    if (!imageIds?.length || !seriesUID) {
      setVolumeId(null);
      setVolume(null);
      return;
    }

    // Don't reload if same series
    if (prevSeriesRef.current === seriesUID && volume) return;
    prevSeriesRef.current = seriesUID;

    let cancelled = false;

    async function loadVolume() {
      setLoading(true);
      setError(null);

      try {
        const cs = await import("@cornerstonejs/core");

        // Unique volume ID per series
        const vId = `cornerstoneStreamingImageVolume:${seriesUID}`;

        // Check if already cached
        let vol;
        try {
          vol = cs.cache.getVolume(vId);
        } catch {
          vol = null;
        }

        if (!vol) {
          // Create and cache the volume from imageIds
          vol = await cs.volumeLoader.createAndCacheVolume(vId, {
            imageIds,
          });

          // Start streaming the pixel data
          await vol.load();
        }

        if (!cancelled) {
          setVolumeId(vId);
          setVolume(vol);
        }
      } catch (err) {
        console.error("Volume loading failed:", err);
        if (!cancelled) {
          setError(err.message || "Failed to load volume");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadVolume();
    return () => {
      cancelled = true;
    };
  }, [imageIds, seriesUID]);

  return { volumeId, volume, loading, error };
}