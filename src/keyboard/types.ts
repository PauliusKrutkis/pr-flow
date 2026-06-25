export type KeyHandler = (e: KeyboardEvent) => void;

export interface Binding {
  /**
   * One or more key descriptors. Supported forms:
   *  - single key:      "j", "k", "enter", "esc", "/", "?"
   *  - modifier combo:  "mod+k" (mod = ⌘ on macOS / Ctrl elsewhere), "alt+x"
   *  - two-key sequence: "]c", "[c", "gg" (vim-style)
   */
  keys: string | string[];
  description: string;
  /** Grouping label for the help overlay / command palette (e.g. "Navigation"). */
  group?: string;
  run: KeyHandler;
  /** Global bindings fire regardless of which scope is active (e.g. ⌘K). */
  global?: boolean;
  /** Hide from the help overlay and command palette. */
  hidden?: boolean;
}

export interface RegisteredBinding extends Binding {
  id: string;
  scope: string;
}

export interface KeyboardContextValue {
  /** Register a live source of bindings for a scope. Returns an unregister fn. */
  registerSource: (scope: string, get: () => Binding[]) => () => void;
  /** Mark a scope active (pushes onto the scope stack). Returns a pop fn. */
  pushScope: (scope: string) => () => void;
  /** All currently active + global bindings for a given scope, for display. */
  getBindings: (scope: string) => RegisteredBinding[];
  /** Bumps whenever sources change, so consumers can re-read getBindings. */
  version: number;
}
