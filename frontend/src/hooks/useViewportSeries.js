// useViewportSeries.js
// Manages the mapping between viewports and DICOM series.
// When a user clicks a series in the study browser, it gets assigned to
// whichever viewport is currently "active" (selected). Each viewport
// independently fetches its own imageIds based on its assignment.

import { useState, useCallback, useMemo } from "react";
import { useImageIds } from "./useImageIds";

/**
 * useViewportSeries hook.
 *
 * Maintains a dictionary of viewport-to-series assignments and tracks
 * which viewport is currently active (will receive the next selection).
 *
 * This supports multi-viewport layouts (1×1, 1×2, 2×2, etc.) where
 * each viewport can display a different series independently.
 *
 * @returns {{
 *   activeVp:      string,   - ID of the currently active viewport (e.g. "vp-1").
 *   setActiveVp:   Function, - Setter to change the active viewport.
 *   assignments:   Object,   - Map of viewportId → series data.
 *   assignSeries:  Function, - Assigns a series to the active viewport.
 *   clearViewport: Function, - Removes the series from a specific viewport.
 *   getAssignment: Function, - Gets the series assigned to a given viewport.
 * }}
 */
export function useViewportSeries() {
  // The ID of the viewport that will receive the next series selection.
  // Defaults to "vp-1" (the first/primary viewport).
  const [activeVp, setActiveVp] = useState("vp-1");

  // A dictionary mapping viewport IDs to series data objects.
  // Each value has the shape:
  //   { studyInstanceUID: string, seriesInstanceUID: string, description: string }
  // Empty object means no viewports have series assigned yet.
  const [assignments, setAssignments] = useState({});

  // Assigns the given series data to whichever viewport is currently active.
  // Uses useCallback with activeVp as a dependency so the function reference
  // only changes when the active viewport changes (optimizes child re-renders).
  const assignSeries = useCallback(
    (seriesData) => {
      setAssignments((prev) => ({
        // Spread all existing assignments to preserve other viewports.
        ...prev,
        // Overwrite (or add) the entry for the active viewport.
        [activeVp]: seriesData,
      }));
    },
    [activeVp]
  );

  // Removes the series assignment from a specific viewport by ID.
  // This is used when the user wants to clear a viewport, or when
  // changing layouts and a viewport is removed.
  const clearViewport = useCallback((vpId) => {
    setAssignments((prev) => {
      // Create a shallow copy of the assignments.
      const next = { ...prev };
      // Remove the entry for the specified viewport.
      delete next[vpId];
      return next;
    });
  }, []);

  // Retrieves the series assignment for a specific viewport.
  // Returns null if the viewport has no series assigned.
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
 * useViewportImageIds hook.
 *
 * Given a viewport's series assignment (from getAssignment above), this hook
 * calls useImageIds to fetch the DICOM instance list and build image IDs.
 *
 * Use this inside each individual viewport cell component. It will
 * automatically re-fetch when the assignment changes (i.e., when the user
 * assigns a different series to this viewport).
 *
 * @param {object|null} assignment - Series assignment object with
 *                                   studyInstanceUID and seriesInstanceUID,
 *                                   or null if no series is assigned.
 * @returns {{ imageIds: string[], loading: boolean, error: string|null }}
 */
export function useViewportImageIds(assignment) {
  // Pass the UIDs from the assignment to useImageIds.
  // If assignment is null, both UIDs will be undefined, and useImageIds
  // will return an empty array without making any HTTP requests.
  const { imageIds, loading, error } = useImageIds(
    assignment?.studyInstanceUID,
    assignment?.seriesInstanceUID
  );

  return { imageIds, loading, error };
}