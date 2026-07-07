import { create } from "zustand";

interface PerfState {
  lastPROpenMs: number | null;
  lastFileSwitchMs: number | null;
  visible: boolean;

  _openStart: number | null;
  _fileStart: number | null;

  markOpenStart: () => void;
  completeOpen: () => void;
  markFileStart: () => void;
  completeFile: () => void;
  toggle: () => void;
}

export const usePerfStore = create<PerfState>((set, get) => ({
  lastPROpenMs: null,
  lastFileSwitchMs: null,
  visible: true,

  _openStart: null,
  _fileStart: null,

  markOpenStart: () => set({ _openStart: performance.now() }),
  completeOpen: () => {
    const start = get()._openStart;
    if (start == null) return;
    set({ lastPROpenMs: performance.now() - start, _openStart: null });
  },
  markFileStart: () => set({ _fileStart: performance.now() }),
  completeFile: () => {
    const start = get()._fileStart;
    if (start == null) return;
    set({ lastFileSwitchMs: performance.now() - start, _fileStart: null });
  },
  toggle: () => set((s) => ({ visible: !s.visible })),
}));
