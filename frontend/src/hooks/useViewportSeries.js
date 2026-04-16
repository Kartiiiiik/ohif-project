import { useState, useCallback, useMemo } from "react";
import { useImageIds } from "./useImageIds";

/**
 * Manages which series is assigned to which viewport.
 *
 * - Selecting a series from the StudyList assigns it to the
 *   currently active viewport.
 * - Each viewport independently fetches its own imageIds.
 * - Changing layout preserves existing assignments.
 */
export function useViewportSeries() {
  // Which viewport is currently active (receives the next series selection)
  const [activeVp, setActiveVp] = useState("vp-1");

  // Map of viewportId → { studyInstanceUID, seriesInstanceUID, description }
  const [assignments, setAssignments] = useState({});

  // Assign a series to the currently active viewport
  const assignSeries = useCallback(
    (seriesData) => {
      setAssignments((prev) => ({
        ...prev,
        [activeVp]: seriesData,
      }));
    },
    [activeVp]
  );

  // Clear a specific viewport's assignment
  const clearViewport = useCallback((vpId) => {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[vpId];
      return next;
    });
  }, []);

  // Get the series assigned to a specific viewport
  const getAssignment = useCallback(
    (vpId) => assignments[vpId] || null,
    [assignments]
  );

  return {
    activeVp,
    setActiveVp,
    assignments,
    assignSeries,
    clearViewport,
    getAssignment,
  };
}

/**
 * Fetches imageIds for a single viewport based on its assignment.
 * Use this inside each viewport cell.
 */
export function useViewportImageIds(assignment) {
  const { imageIds, loading, error } = useImageIds(
    assignment?.studyInstanceUID,
    assignment?.seriesInstanceUID
  );
  return { imageIds, loading, error };
}