import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Binding,
  KeyboardContextValue,
  RegisteredBinding,
} from "./types";

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

interface Source {
  id: string;
  scope: string;
  get: () => Binding[];
}

interface ScopeEntry {
  id: string;
  scope: string;
}

const SEQUENCE_TIMEOUT = 700;

/** Normalizes a keydown event's primary key into a lowercase descriptor. */
function normalizeKey(e: KeyboardEvent): string {
  switch (e.key) {
    case " ":
      return "space";
    case "Escape":
      return "esc";
    case "Enter":
      return "enter";
    case "ArrowDown":
      return "down";
    case "ArrowUp":
      return "up";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Backspace":
      return "backspace";
    case "Tab":
      return "tab";
    default:
      return e.key.toLowerCase();
  }
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

function asArray(keys: string | string[]): string[] {
  return Array.isArray(keys) ? keys : [keys];
}

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const sourcesRef = useRef<Source[]>([]);
  const scopeStackRef = useRef<ScopeEntry[]>([]);
  const idRef = useRef(0);
  const [activeScope, setActiveScope] = useState("global");
  const [version, setVersion] = useState(0);

  // Sequence buffer for vim-style two-key bindings ("]c", "gg").
  const seqRef = useRef("");
  const seqTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextId = useCallback(() => {
    idRef.current += 1;
    return `kb-${idRef.current}`;
  }, []);

  const registerSource = useCallback(
    (scope: string, get: () => Binding[]) => {
      const id = nextId();
      sourcesRef.current = [...sourcesRef.current, { id, scope, get }];
      setVersion((v) => v + 1);
      return () => {
        sourcesRef.current = sourcesRef.current.filter((s) => s.id !== id);
        setVersion((v) => v + 1);
      };
    },
    [nextId],
  );

  const pushScope = useCallback(
    (scope: string) => {
      const id = nextId();
      scopeStackRef.current = [...scopeStackRef.current, { id, scope }];
      setActiveScope(scope);
      return () => {
        scopeStackRef.current = scopeStackRef.current.filter((s) => s.id !== id);
        const top = scopeStackRef.current[scopeStackRef.current.length - 1];
        setActiveScope(top ? top.scope : "global");
      };
    },
    [nextId],
  );

  const getBindings = useCallback(
    (scope: string): RegisteredBinding[] => {
      const out: RegisteredBinding[] = [];
      let i = 0;
      for (const src of sourcesRef.current) {
        if (src.scope === scope || src.scope === "global") {
          for (const b of src.get()) {
            out.push({ ...b, id: `${src.id}-${i}`, scope: src.scope });
            i += 1;
          }
        }
      }
      return out;
    },
    [],
  );

  // Collect bindings eligible to fire right now: those in the active scope, or
  // marked global. (`version` keeps this fresh as sources mount/unmount.)
  const eligibleBindings = useCallback((): RegisteredBinding[] => {
    const out: RegisteredBinding[] = [];
    let i = 0;
    for (const src of sourcesRef.current) {
      if (src.scope === activeScope || src.scope === "global") {
        for (const b of src.get()) {
          out.push({ ...b, id: `${src.id}-${i}`, scope: src.scope });
          i += 1;
        }
      }
    }
    return out;
  }, [activeScope]);

  const clearSeq = useCallback(() => {
    seqRef.current = "";
    if (seqTimerRef.current) {
      clearTimeout(seqTimerRef.current);
      seqTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    function findByKey(
      bindings: RegisteredBinding[],
      descriptor: string,
    ): RegisteredBinding | undefined {
      return bindings.find((b) => asArray(b.keys).includes(descriptor));
    }

    function isPrefix(bindings: RegisteredBinding[], buf: string): boolean {
      return bindings.some((b) =>
        asArray(b.keys).some((k) => k.length > buf.length && k.startsWith(buf)),
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      const editable = isEditableTarget(e.target);
      const bindings = eligibleBindings();
      const hasMod = e.metaKey || e.ctrlKey;
      const key = normalizeKey(e);

      // While typing in a field, only global modifier-combos (e.g. ⌘K) may
      // fire; the field handles its own Esc / Enter / arrows / plain typing.
      if (editable && !hasMod) return;

      // Modifier combos and alt bypass the sequence buffer entirely.
      if (hasMod || e.altKey) {
        clearSeq();
        if (key === "meta" || key === "control" || key === "alt" || key === "shift") {
          return;
        }
        const parts: string[] = [];
        if (hasMod) parts.push("mod");
        if (e.altKey) parts.push("alt");
        if (e.shiftKey) parts.push("shift");
        parts.push(key);
        const combo = parts.join("+");
        // Also accept the combo without an explicit "shift+" (e.g. "mod+k").
        const altCombo = combo.replace("shift+", "");
        let match = findByKey(bindings, combo) ?? findByKey(bindings, altCombo);
        // From within an editable field, only honor global bindings.
        if (editable && match && !match.global) match = undefined;
        if (match) {
          e.preventDefault();
          match.run(e);
        }
        return;
      }

      // Bare modifier keys: ignore.
      if (key === "shift") return;

      // ---- single keys & two-key sequences ----
      const buf = seqRef.current + key;

      const exact = findByKey(bindings, buf);
      if (exact) {
        e.preventDefault();
        clearSeq();
        exact.run(e);
        return;
      }

      if (isPrefix(bindings, buf)) {
        seqRef.current = buf;
        if (seqTimerRef.current) clearTimeout(seqTimerRef.current);
        seqTimerRef.current = setTimeout(() => {
          seqRef.current = "";
          seqTimerRef.current = null;
        }, SEQUENCE_TIMEOUT);
        return;
      }

      // Buffer didn't extend into anything — restart from this key alone.
      clearSeq();
      const single = findByKey(bindings, key);
      if (single) {
        e.preventDefault();
        single.run(e);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [eligibleBindings, clearSeq]);

  const value = useMemo<KeyboardContextValue>(
    () => ({ registerSource, pushScope, getBindings, version }),
    [registerSource, pushScope, getBindings, version],
  );

  return (
    <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>
  );
}

export function useKeyboard(): KeyboardContextValue {
  const ctx = useContext(KeyboardContext);
  if (!ctx) {
    throw new Error("useKeyboard must be used within a KeyboardProvider");
  }
  return ctx;
}
