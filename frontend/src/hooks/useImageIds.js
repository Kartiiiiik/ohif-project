// useImageIds.js
// Custom React hook that fetches the list of DICOM instances for a given
// study + series from an Orthanc PACS server via DICOMweb (QIDO-RS),
// then constructs wadouri: image ID strings that cornerstone can load.

import { useState, useEffect } from "react";

// Base64-encoded HTTP Basic credentials for Orthanc.
// The default Orthanc username/password is "admin"/"orthanc".
const ORTHANC_AUTH = "Basic " + btoa("admin:orthanc");

// The DICOMweb endpoint base path. Requests go through an nginx reverse proxy:
//   browser → nginx (/orthanc/dicom-web/...) → Orthanc (/dicom-web/...)
// Nginx strips the /orthanc prefix before forwarding.
const DICOMWEB_ROOT = "/orthanc/dicom-web";

// The WADO-URI endpoint base path. Used to construct per-instance download URLs.
// WADO-URI is the older (but widely supported) standard for retrieving a single
// DICOM object by its Study/Series/SOP Instance UIDs.
const WADO_ROOT = "/orthanc/wado";

/**
 * Fetch wrapper that retries once on transient HTTP errors (502, 503, 504).
 *
 * These errors typically occur when Orthanc is briefly restarting or when
 * the nginx proxy times out on a slow response. A single 500ms retry is
 * usually enough to ride through these blips.
 *
 * @param {string}  url     - The URL to fetch.
 * @param {object}  options - Standard fetch options (headers, method, etc.).
 * @param {number}  retries - Number of retry attempts (default 1).
 * @returns {Promise<Response>} The fetch Response object.
 */
async function fetchWithRetry(url, options, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Perform the HTTP request.
    const res = await fetch(url, options);

    // If the request succeeded, or we've exhausted retries, or the error
    // isn't a transient server error, return the response as-is.
    if (res.ok || attempt === retries || ![502, 503, 504].includes(res.status)) {
      return res;
    }

    // Wait 500ms before retrying to give the server time to recover.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * useImageIds hook.
 *
 * Given a Study Instance UID and Series Instance UID, this hook:
 *   1. Verifies that Orthanc is reachable by pinging /orthanc/system.
 *   2. Fetches the list of instances (slices) via QIDO-RS.
 *   3. Sorts instances by Instance Number (DICOM tag 0020,0013).
 *   4. Constructs a wadouri: image ID for each instance.
 *
 * The returned imageIds array can be passed directly to cornerstone's
 * stack viewport or to useVolumeLoader for MPR/Fusion rendering.
 *
 * @param {string} studyInstanceUID  - DICOM Study Instance UID.
 * @param {string} seriesInstanceUID - DICOM Series Instance UID.
 * @returns {{ imageIds: string[], loading: boolean, error: string|null }}
 */
export function useImageIds(studyInstanceUID, seriesInstanceUID) {
  // Array of wadouri: image ID strings, one per DICOM instance/slice.
  const [imageIds, setImageIds] = useState([]);

  // True while the QIDO-RS query is in progress.
  const [loading, setLoading] = useState(false);

  // Error message string if any step of the fetch pipeline fails.
  const [error, setError] = useState(null);

  useEffect(() => {
    // Guard: both UIDs are required. If either is missing, reset state.
    if (!studyInstanceUID || !seriesInstanceUID) {
      setImageIds([]);
      setError(null);
      return;
    }

    // Cancellation flag — prevents setState on unmounted components.
    let cancelled = false;

    async function fetchImageIds() {
      // Signal loading start and reset previous state.
      setLoading(true);
      setError(null);
      setImageIds([]);

      try {
        // ── Step 1: Verify Orthanc connectivity ─────────────────
        // Ping the /system endpoint which returns Orthanc's version info.
        // This catches common deployment issues (container down, wrong proxy
        // config) with a clear error message rather than a cryptic QIDO failure.
        const pingRes = await fetchWithRetry("/orthanc/system", {
          headers: { Authorization: ORTHANC_AUTH },
        });

        // If the ping fails, provide a detailed error with troubleshooting hints.
        if (!pingRes.ok) {
          const body = await pingRes.text().catch(() => "");
          throw new Error(
            `Orthanc unreachable (HTTP ${pingRes.status}). ` +
            `Check that the orthanc container is running and nginx ` +
            `is proxying /orthanc/ correctly. Response: ${body.slice(0, 300)}`
          );
        }

        // Parse the system info response and verify it looks like valid Orthanc JSON.
        const systemInfo = await pingRes.json().catch(() => null);

        // Orthanc's /system endpoint returns an object with a "Version" field.
        // If that's missing, nginx might be forwarding to the wrong upstream.
        if (!systemInfo?.Version) {
          throw new Error(
            "Orthanc /system returned unexpected response. " +
            "Nginx may be forwarding to the wrong upstream."
          );
        }

        // Early exit if the component was unmounted during the ping.
        if (cancelled) return;

        // ── Step 2: Fetch DICOM instances via QIDO-RS ───────────
        // QIDO-RS (Query based on ID for DICOM Objects - RESTful Services)
        // returns metadata for all instances in a series.
        // URL pattern: /studies/{study}/series/{series}/instances
        const qidoUrl =
          `${DICOMWEB_ROOT}/studies/${studyInstanceUID}` +
          `/series/${seriesInstanceUID}/instances`;

        const res = await fetchWithRetry(qidoUrl, {
          headers: {
            // Request DICOM+JSON format — Orthanc returns instance metadata
            // as an array of JSON objects with DICOM tag keys.
            Accept: "application/dicom+json",
            Authorization: ORTHANC_AUTH,
          },
        });

        // Handle QIDO-RS failures with a detailed error message.
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `QIDO-RS failed (HTTP ${res.status}). ` +
            `Study: ${studyInstanceUID}, Series: ${seriesInstanceUID}. ` +
            `Response: ${text.slice(0, 300)}`
          );
        }

        // Parse the JSON response — should be an array of instance metadata objects.
        const instances = await res.json();

        // Verify we actually got instances back.
        if (!Array.isArray(instances) || instances.length === 0) {
          throw new Error(
            `No instances found for series ${seriesInstanceUID}. ` +
            `Verify the DICOM data has been uploaded to Orthanc.`
          );
        }

        // Early exit if unmounted during the QIDO fetch.
        if (cancelled) return;

        // ── Step 3: Sort instances by Instance Number ───────────
        // DICOM tag (0020,0013) = Instance Number.
        // In DICOM+JSON, tags are represented as 8-character hex strings
        // without commas or parentheses: "00200013".
        // Sorting by instance number ensures slices are in spatial order
        // (head-to-feet for axial CT, etc.), which is critical for
        // correct volume reconstruction.
        instances.sort((a, b) => {
          // Extract the Instance Number value. The Value field is always
          // an array in DICOM+JSON; we take the first element.
          // Default to "0" if the tag is missing.
          const aNum = parseInt(a["00200013"]?.Value?.[0] ?? "0", 10);
          const bNum = parseInt(b["00200013"]?.Value?.[0] ?? "0", 10);
          return aNum - bNum;
        });

        // ── Step 4: Build wadouri image IDs ─────────────────────
        // Each image ID is a URL that tells cornerstone's wadouri image
        // loader how to fetch a specific DICOM instance.
        // Format: wadouri:/orthanc/wado?requestType=WADO&studyUID=...&seriesUID=...&objectUID=...&contentType=application/dicom
        const ids = instances
          .map((instance) => {
            // Extract the SOP Instance UID — the unique identifier for
            // this specific DICOM object (slice/frame).
            // DICOM tag (0008,0018) = SOP Instance UID.
            const sopUID = instance["00080018"]?.Value?.[0];

            // Skip instances that are missing their SOP UID — the QIDO
            // response may be incomplete if Orthanc's metadata level is
            // set to "MainDicomTags" instead of "Full".
            if (!sopUID) {
              console.warn(
                "[useImageIds] Instance missing SOP Instance UID, skipping:",
                instance
              );
              return null;
            }

            // Build the WADO-URI query parameters.
            const params = new URLSearchParams({
              requestType: "WADO",
              studyUID: studyInstanceUID,
              seriesUID: seriesInstanceUID,
              objectUID: sopUID,
              contentType: "application/dicom",
            });

            // Prefix with "wadouri:" so cornerstone routes this to the
            // wadouri image loader (registered in useCornerstoneInit).
            return `wadouri:${WADO_ROOT}?${params.toString()}`;
          })
          // Remove any null entries from instances that lacked SOP UIDs.
          .filter(Boolean);

        // If ALL instances were missing SOP UIDs, something is wrong
        // with the QIDO configuration.
        if (ids.length === 0) {
          throw new Error(
            "All instances were missing SOP Instance UIDs. " +
            "The QIDO-RS response may be incomplete — try setting " +
            '"StudiesMetadata": "Full" in orthanc.json.'
          );
        }

        console.log(
          `[useImageIds] Built ${ids.length} imageIds for series ${seriesInstanceUID}`
        );

        // Update state with the constructed image IDs if still mounted.
        if (!cancelled) setImageIds(ids);
      } catch (err) {
        console.error("[useImageIds] Error:", err);
        if (!cancelled) setError(err.message);
      } finally {
        // Always clear loading flag when done.
        if (!cancelled) setLoading(false);
      }
    }

    // Kick off the async fetch pipeline.
    fetchImageIds();

    // Cleanup: set cancelled flag if deps change or component unmounts.
    return () => {
      cancelled = true;
    };
  }, [studyInstanceUID, seriesInstanceUID]);

  return { imageIds, loading, error };
}