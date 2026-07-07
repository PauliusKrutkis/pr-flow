import { useInsertionEffect, useRef } from "react";

/**
 * A ref that always holds the latest `value`, written in an insertion effect
 * instead of during render — the React Compiler-compatible form of the
 * `ref.current = value` render-sync idiom (writing during render makes the
 * compiler skip the whole component). Insertion effects run before layout
 * effects and any user event, so reads from EVENT HANDLERS AND EFFECTS always
 * see the current value; reading during render is still wrong, same as any
 * ref.
 */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
