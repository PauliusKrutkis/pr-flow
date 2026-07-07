import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Binding,
  KeyboardContextValue,
  RegisteredBinding,
} from "./types.ts";

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

interface Source {
  get: () => Binding[];
  id: string;
  scope: string;
}

interface ScopeEntry {
  id: string;
  scope: string;
}

const SEQUENCE_TIMEOUT = 700;

const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  Backspace: "backspace",
  Enter: "enter",
  Escape: "esc",
  Tab: "tab",
};

/** Normalizes a keydown event's primary key into a lowercase descriptor. */
function normalizeKey(e: KeyboardEvent): string {
  return KEY_ALIASES[e.key] ?? e.key.toLowerCase();
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
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

function findByKey(
  bindings: RegisteredBinding[],
  descriptor: string
): RegisteredBinding | undefined {
  return bindings.find((b) => asArray(b.keys).includes(descriptor));
}

function isPrefix(bindings: RegisteredBinding[], buf: string): boolean {
  return bindings.some((b) =>
    asArray(b.keys).some((k) => k.length > buf.length && k.startsWith(buf))
  );
}

function isModifierOnlyKey(key: string): boolean {
  return (
    key === "meta" || key === "control" || key === "alt" || key === "shift"
  );
}

function modCombo(e: KeyboardEvent, key: string): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) {
    parts.push("mod");
  }
  if (e.altKey) {
    parts.push("alt");
  }
  if (e.shiftKey) {
    parts.push("shift");
  }
  parts.push(key);
  return parts.join("+");
}

function runMatch(
  e: KeyboardEvent,
  match: RegisteredBinding | undefined
): boolean {
  if (!match) {
    return false;
  }
  e.preventDefault();
  match.run(e);
  return true;
}

function handleModKeyDown(
  e: KeyboardEvent,
  bindings: RegisteredBinding[],
  editable: boolean,
  clearSeq: () => void
): boolean {
  clearSeq();
  const key = normalizeKey(e);
  if (isModifierOnlyKey(key)) {
    return true;
  }
  const combo = modCombo(e, key);
  const altCombo = combo.replace("shift+", "");
  let match = findByKey(bindings, combo) ?? findByKey(bindings, altCombo);
  if (editable && match && !match.global) {
    match = undefined;
  }
  return runMatch(e, match);
}

function handleShiftedKey(
  e: KeyboardEvent,
  bindings: RegisteredBinding[],
  key: string,
  clearSeq: () => void
): boolean {
  const shifted = findByKey(bindings, `shift+${key}`);
  if (!shifted) {
    return false;
  }
  clearSeq();
  return runMatch(e, shifted);
}

function handleSequenceKey(
  e: KeyboardEvent,
  bindings: RegisteredBinding[],
  buf: string,
  seqRef: { current: string },
  seqTimerRef: { current: ReturnType<typeof setTimeout> | null },
  clearSeq: () => void
): boolean {
  const exact = findByKey(bindings, buf);
  if (exact) {
    clearSeq();
    return runMatch(e, exact);
  }
  if (isPrefix(bindings, buf)) {
    seqRef.current = buf;
    if (seqTimerRef.current) {
      clearTimeout(seqTimerRef.current);
    }
    seqTimerRef.current = setTimeout(() => {
      seqRef.current = "";
      seqTimerRef.current = null;
    }, SEQUENCE_TIMEOUT);
    return true;
  }
  return false;
}

function handlePlainKeyDown(
  e: KeyboardEvent,
  bindings: RegisteredBinding[],
  key: string,
  seqRef: { current: string },
  seqTimerRef: { current: ReturnType<typeof setTimeout> | null },
  clearSeq: () => void
): void {
  if (key === "shift") {
    return;
  }

  if (e.shiftKey && handleShiftedKey(e, bindings, key, clearSeq)) {
    return;
  }

  const buf = seqRef.current + key;
  if (handleSequenceKey(e, bindings, buf, seqRef, seqTimerRef, clearSeq)) {
    return;
  }

  clearSeq();
  if (runMatch(e, findByKey(bindings, key))) {
    return;
  }

  if (key === "tab") {
    e.preventDefault();
  }
}

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const sourcesRef = useRef<Source[]>([]);
  const scopeStackRef = useRef<ScopeEntry[]>([]);
  const idRef = useRef(0);
  const [version, setVersion] = useState(0);

  const seqRef = useRef("");
  const seqTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextId = useCallback(() => {
    idRef.current += 1;
    return `kb-${idRef.current}`;
  }, []);

  const registerSource = useCallback(
    (scope: string, get: () => Binding[]) => {
      const id = nextId();
      sourcesRef.current = [...sourcesRef.current, { get, id, scope }];
      setVersion((v) => v + 1);
      return () => {
        sourcesRef.current = sourcesRef.current.filter((s) => s.id !== id);
        setVersion((v) => v + 1);
      };
    },
    [nextId]
  );

  const pushScope = useCallback(
    (scope: string) => {
      const id = nextId();
      scopeStackRef.current = [...scopeStackRef.current, { id, scope }];
      return () => {
        scopeStackRef.current = scopeStackRef.current.filter(
          (s) => s.id !== id
        );
      };
    },
    [nextId]
  );

  const eligibleBindings = useCallback((): RegisteredBinding[] => {
    const stack = scopeStackRef.current;
    const active = stack.length ? stack.at(-1).scope : "global";
    const out: RegisteredBinding[] = [];
    let i = 0;
    for (const src of sourcesRef.current) {
      if (src.scope === active || src.scope === "global") {
        for (const b of src.get()) {
          out.push({ ...b, id: `${src.id}-${i}`, scope: src.scope });
          i += 1;
        }
      }
    }
    return out;
  }, []);

  const clearSeq = useCallback(() => {
    seqRef.current = "";
    if (seqTimerRef.current) {
      clearTimeout(seqTimerRef.current);
      seqTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const editable = isEditableTarget(e.target);
      const bindings = eligibleBindings();
      const hasMod = e.metaKey || e.ctrlKey;
      const key = normalizeKey(e);

      if (editable && !hasMod) {
        return;
      }

      if (hasMod || e.altKey) {
        handleModKeyDown(e, bindings, editable, clearSeq);
        return;
      }

      handlePlainKeyDown(e, bindings, key, seqRef, seqTimerRef, clearSeq);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [eligibleBindings, clearSeq]);

  const value = useMemo<KeyboardContextValue>(
    () => ({
      getBindings: (scope: string): RegisteredBinding[] => {
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
      pushScope,
      registerSource,
      version,
    }),
    [registerSource, pushScope, version]
  );

  return (
    <KeyboardContext.Provider value={value}>
      {children}
    </KeyboardContext.Provider>
  );
}

export function useKeyboard(): KeyboardContextValue {
  const ctx = useContext(KeyboardContext);
  if (!ctx) {
    throw new Error("useKeyboard must be used within a KeyboardProvider");
  }
  return ctx;
}
