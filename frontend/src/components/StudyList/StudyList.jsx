import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "react-query";
import { getOrthancStudies } from "../../api/studies";
import styles from "./StudyList.module.css";

const ORTHANC_AUTH = "Basic " + btoa("admin:orthanc");

/**
 * Thumbnail that fetches via fetch() with auth header,
 * then displays as a blob URL. This avoids the browser's
 * native basic-auth popup that <img src="..."> triggers
 * when Orthanc returns 401.
 */
function AuthenticatedThumbnail({ instanceId, modality }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!instanceId) {
      setFailed(true);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/orthanc/instances/${instanceId}/preview`, {
      headers: { Authorization: ORTHANC_AUTH },
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.blob();
      })
      .then((blob) => {
        setSrc(URL.createObjectURL(blob));
      })
      .catch((err) => {
        if (err.name !== "AbortError") setFailed(true);
      });

    return () => {
      controller.abort();
      // Revoke blob URL on cleanup
      setSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [instanceId]);

  if (failed || !src) {
    return (
      <div className={styles.thumbFallback} style={{ display: "flex" }}>
        {modality || "?"}
      </div>
    );
  }

  return (
    <img
      className={styles.thumb}
      src={src}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

export default function StudyList({ onSelectSeries }) {
  const [expandedStudy, setExpandedStudy] = useState(null);
  const [selectedSeriesUID, setSelectedSeriesUID] = useState(null);
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery(
    "orthanc-studies",
    getOrthancStudies,
    { refetchInterval: 60_000 }
  );

  const studies = data?.data || [];

  const filtered = studies.filter((s) => {
    const q = search.toLowerCase();
    if (!q) return true;
    const name = (s.PatientMainDicomTags?.PatientName || "").toLowerCase();
    const id = (s.PatientMainDicomTags?.PatientID || "").toLowerCase();
    const desc = (s.MainDicomTags?.StudyDescription || "").toLowerCase();
    return name.includes(q) || id.includes(q) || desc.includes(q);
  });

  const toggleStudy = useCallback(
    (id) => setExpandedStudy((prev) => (prev === id ? null : id)),
    []
  );

  const handleSelectSeries = useCallback(
    (seriesData) => {
      setSelectedSeriesUID(seriesData.seriesInstanceUID);
      onSelectSeries(seriesData);
    },
    [onSelectSeries]
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Studies</span>
        <span className={styles.count}>{studies.length}</span>
      </div>

      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}>⌕</span>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Patient, ID, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
        {search && (
          <button
            className={styles.searchClear}
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      <div className={styles.list}>
        {isLoading && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>◌</span>
            <span>Loading studies…</span>
          </div>
        )}

        {error && (
          <div className={`${styles.empty} ${styles.emptyError}`}>
            <span className={styles.emptyIcon}>!</span>
            <span>Failed to load studies</span>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>∅</span>
            <span>{search ? "No matching studies" : "No studies yet"}</span>
          </div>
        )}

        {filtered.map((study) => {
          const tags = study.MainDicomTags || {};
          const patient = study.PatientMainDicomTags || {};
          const seriesArr = study.Series || [];
          const isExpanded = expandedStudy === study.ID;

          return (
            <div
              key={study.ID}
              className={`${styles.card} ${isExpanded ? styles.cardExpanded : ""}`}
            >
              {/* Study header */}
              <button
                className={styles.cardHeader}
                onClick={() => toggleStudy(study.ID)}
                aria-expanded={isExpanded}
              >
                <div className={styles.cardInfo}>
                  <span className={styles.patientName}>
                    {patient.PatientName || "Unknown"}
                  </span>
                  <span className={styles.studyMeta}>
                    {tags.StudyDescription || "No description"}
                    <span className={styles.dot}>·</span>
                    {tags.StudyDate || "—"}
                    <span className={styles.dot}>·</span>
                    {seriesArr.length} series
                  </span>
                </div>
                <span
                  className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ""}`}
                >
                  ‹
                </span>
              </button>

              {isExpanded && (
                <SeriesList
                  studyId={study.ID}
                  studyInstanceUID={tags.StudyInstanceUID}
                  onSelectSeries={handleSelectSeries}
                  selectedSeriesUID={selectedSeriesUID}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Series sub-list with thumbnails ─────────────────── */

function SeriesList({
  studyId,
  studyInstanceUID,
  onSelectSeries,
  selectedSeriesUID,
}) {
  const { data, isLoading } = useQuery(
    ["series", studyId],
    () =>
      import("../../api/studies").then((m) => m.getOrthancSeries(studyId)),
    { staleTime: 60_000 }
  );

  const series = data?.data || [];

  if (isLoading) {
    return <div className={styles.seriesLoading}>Loading series…</div>;
  }

  if (series.length === 0) {
    return <div className={styles.seriesLoading}>No series found</div>;
  }

  return (
    <div className={styles.seriesWrap}>
      {series.map((s) => {
        const tags = s.MainDicomTags || {};
        const uid = tags.SeriesInstanceUID;
        const isSelected = selectedSeriesUID === uid;
        const instanceCount = s.Instances?.length || 0;

        // Orthanc provides a preview endpoint for each series
        const thumbnailUrl = `/orthanc/series/${s.ID}/media`;
        // Use the middle instance for a representative thumbnail
        const middleInstanceIdx = Math.floor(instanceCount / 2);
        const previewInstanceId =
          s.Instances && s.Instances.length > 0
            ? s.Instances[Math.min(middleInstanceIdx, s.Instances.length - 1)]
            : null;

        return (
          <button
            key={s.ID}
            className={`${styles.seriesRow} ${isSelected ? styles.seriesActive : ""}`}
            onClick={() =>
              onSelectSeries({
                studyInstanceUID,
                seriesInstanceUID: uid,
                description:
                  tags.SeriesDescription || tags.Modality || "Series",
              })
            }
          >
            {/* Thumbnail */}
            <div className={styles.thumbWrap}>
              <AuthenticatedThumbnail
                instanceId={previewInstanceId}
                modality={tags.Modality}
              />
              <span className={styles.thumbCount}>{instanceCount}</span>
            </div>

            {/* Info */}
            <div className={styles.seriesInfo}>
              <div className={styles.seriesTop}>
                <span className={styles.modality}>
                  {tags.Modality || "?"}
                </span>
                <span className={styles.seriesNumber}>
                  {tags.SeriesNumber || "—"}/{instanceCount}
                </span>
              </div>
              <span className={styles.seriesDesc}>
                {tags.SeriesDescription || "No description"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}