import type { ComponentType } from "react";

export type KeyHandler = (e: KeyboardEvent) => void;

export interface Binding {
  keys: string | string[];
  description: string;
  group?: string;
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  run: KeyHandler;
  global?: boolean;
  hidden?: boolean;
}

export interface RegisteredBinding extends Binding {
  id: string;
  scope: string;
}

export interface KeyboardContextValue {
  registerSource: (scope: string, get: () => Binding[]) => () => void;
  pushScope: (scope: string) => () => void;
  getBindings: (scope: string) => RegisteredBinding[];
  version: number;
}
