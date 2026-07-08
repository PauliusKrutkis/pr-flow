// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { create } from "zustand";

interface PerfState {
  _fileStart: number | null;

  _openStart: number | null;
  completeFile: () => void;
  completeOpen: () => void;
  lastFileSwitchMs: number | null;
  lastPROpenMs: number | null;
  markFileStart: () => void;

  markOpenStart: () => void;
  toggle: () => void;
  visible: boolean;
}

export const usePerfStore = create<PerfState>((set, get) => ({
  _fileStart: null,

  _openStart: null,
  completeFile: () => {
    const start = get()._fileStart;
    if (start === null) {
      return;
    }
    set({ _fileStart: null, lastFileSwitchMs: performance.now() - start });
  },
  completeOpen: () => {
    const start = get()._openStart;
    if (start === null) {
      return;
    }
    set({ _openStart: null, lastPROpenMs: performance.now() - start });
  },
  lastFileSwitchMs: null,
  lastPROpenMs: null,
  markFileStart: () => set({ _fileStart: performance.now() }),

  markOpenStart: () => set({ _openStart: performance.now() }),
  toggle: () => set((s) => ({ visible: !s.visible })),
  visible: true,
}));
