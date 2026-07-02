import { useEffect, useRef } from "react";
import { useKeyboard } from "./KeyboardProvider";
import type { Binding } from "./types";

interface Options {
  /** When false, the bindings are not registered (e.g. screen not focused). */
  enabled?: boolean;
  /**
   * When true (default), mounting this hook makes `scope` the active scope, so
   * its bindings (and globals) fire and lower scopes are suppressed. Pass false
   * to register bindings without changing the active scope (used for globals).
   */
  activate?: boolean;
}

/**
 * Registers keyboard bindings for a scope while the component is mounted.
 * Binding handlers always see the latest props/state — the live list is read
 * from a ref, so you never need to memoize `bindings`.
 */
export function useHotkeys(
  scope: string,
  bindings: Binding[],
  options: Options = {},
): void {
  const { enabled = true, activate = true } = options;
  const { registerSource, pushScope } = useKeyboard();
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const unregister = registerSource(scope, () => ref.current);
    const pop = activate ? pushScope(scope) : undefined;
    return () => {
      unregister();
      pop?.();
    };
  }, [registerSource, pushScope, scope, enabled, activate]);
}
