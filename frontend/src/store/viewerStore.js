import { create } from "zustand";

export const useViewerStore = create((set) => ({
  activeTool: "WindowLevel",
  layout: "1x1", // '1x1' | '1x2' | '2x2'
  selectedStudy: null,
  selectedSeries: null,

  setActiveTool: (tool) => set({ activeTool: tool }),
  setLayout: (layout) => set({ layout }),
  setSelectedStudy: (study) => set({ selectedStudy: study }),
  setSelectedSeries: (series) => set({ selectedSeries: series }),
}));
