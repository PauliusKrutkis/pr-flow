// jsdom (v29) no longer ships localStorage; the store layer persists through
// it at module load, so install a Map-backed stand-in before anything imports.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const ls: Storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { value: ls, writable: true });
  }
}
