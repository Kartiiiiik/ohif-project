import { useState, useEffect } from "react";

const ORTHANC_AUTH = "Basic " + btoa("admin:orthanc");

// These paths go through nginx → rewrite strips /orthanc → Orthanc sees /dicom-web/ and /wado
const DICOMWEB_ROOT = "/orthanc/dicom-web";
const WADO_ROOT = "/orthanc/wado";

/**
 * Fetch with a single retry on transient failures (502, 503, 504).
 */
async function fetchWithRetry(url, options, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    if (res.ok || i === retries || ![502, 503, 504].includes(res.status)) {
      return res;
    }
    // Wait 500ms before retry
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function useImageIds(studyInstanceUID, seriesInstanceUID) {
  const [imageIds, setImageIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!studyInstanceUID || !seriesInstanceUID) {
      setImageIds([]);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchImageIds() {
      setLoading(true);
      setError(null);
      setImageIds([]);

      try {
        // ── Step 1: Verify Orthanc is reachable ─────────
        const pingRes = await fetchWithRetry("/orthanc/system", {
          headers: { Authorization: ORTHANC_AUTH },
        });

        if (!pingRes.ok) {
          const body = await pingRes.text().catch(() => "");
          throw new Error(
            `Orthanc unreachable (HTTP ${pingRes.status}). ` +
              `Check that the orthanc container is running and nginx ` +
              `is proxying /orthanc/ correctly. Response: ${body.slice(0, 300)}`
          );
        }

        // Sanity-check: the response should be JSON with a Version field
        const systemInfo = await pingRes.json().catch(() => null);
        if (!systemInfo?.Version) {
          throw new Error(
            "Orthanc /system returned unexpected response. " +
              "Nginx may be forwarding to the wrong upstream."
          );
        }

        if (cancelled) return;

        // ── Step 2: Fetch instances via QIDO-RS ─────────
        const qidoUrl =
          `${DICOMWEB_ROOT}/studies/${studyInstanceUID}` +
          `/series/${seriesInstanceUID}/instances`;

        const res = await fetchWithRetry(qidoUrl, {
          headers: {
            Accept: "application/dicom+json",
            Authorization: ORTHANC_AUTH,
          },
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `QIDO-RS failed (HTTP ${res.status}). ` +
              `Study: ${studyInstanceUID}, Series: ${seriesInstanceUID}. ` +
              `Response: ${text.slice(0, 300)}`
          );
        }

        const instances = await res.json();

        if (!Array.isArray(instances) || instances.length === 0) {
          throw new Error(
            `No instances found for series ${seriesInstanceUID}. ` +
              `Verify the DICOM data has been uploaded to Orthanc.`
          );
        }

        if (cancelled) return;

        // ── Step 3: Sort by Instance Number (0020,0013) ─
        instances.sort((a, b) => {
          const aNum = parseInt(a["00200013"]?.Value?.[0] ?? "0", 10);
          const bNum = parseInt(b["00200013"]?.Value?.[0] ?? "0", 10);
          return aNum - bNum;
        });

        // ── Step 4: Build wadouri image IDs ─────────────
        const ids = instances
          .map((instance) => {
            const sopUID = instance["00080018"]?.Value?.[0];
            if (!sopUID) {
              console.warn("Instance missing SOP Instance UID, skipping:", instance);
              return null;
            }
            const params = new URLSearchParams({
              requestType: "WADO",
              studyUID: studyInstanceUID,
              seriesUID: seriesInstanceUID,
              objectUID: sopUID,
              contentType: "application/dicom",
            });
            return `wadouri:${WADO_ROOT}?${params.toString()}`;
          })
          .filter(Boolean);

        if (ids.length === 0) {
          throw new Error(
            "All instances were missing SOP Instance UIDs. " +
              "The QIDO-RS response may be incomplete — try setting " +
              '"StudiesMetadata": "Full" in orthanc.json.'
          );
        }

        console.log(`Built ${ids.length} imageIds for series ${seriesInstanceUID}`);

        if (!cancelled) setImageIds(ids);
      } catch (err) {
        console.error("useImageIds error:", err);
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchImageIds();
    return () => {
      cancelled = true;
    };
  }, [studyInstanceUID, seriesInstanceUID]);

  return { imageIds, loading, error };
}