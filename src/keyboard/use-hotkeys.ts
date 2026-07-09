import { useEffect } from "react";
import { useLatest } from "../hooks/use-latest.ts";
import { useKeyboard } from "./keyboard-provider.tsx";
import type { Binding } from "./types.ts";

interface Options {
  activate?: boolean;
  enabled?: boolean;
}

/**
 * Registers keyboard bindings for a scope while the component is mounted.
 * Binding handlers always see the latest props/state — the live list is read
 * from a ref, so you never need to memoize `bindings`.
 */
export function useHotkeys(
  scope: string,
  bindings: Binding[],
  options: Options = {}
): void {
  const { enabled = true, activate = true } = options;
  const { registerSource, pushScope } = useKeyboard();
  const bindingsRef = useLatest(bindings);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const unregister = registerSource(scope, () => bindingsRef.current);
    const pop = activate ? pushScope(scope) : undefined;
    return () => {
      unregister();
      pop?.();
    };
  }, [registerSource, pushScope, scope, enabled, activate, bindingsRef]);
}
