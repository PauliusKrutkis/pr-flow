import type { ComponentType } from "react";

export type KeyHandler = (e: KeyboardEvent) => void;

export interface Binding {
  description: string;
  global?: boolean;
  group?: string;
  hidden?: boolean;
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  keys: string | string[];
  run: KeyHandler;
}

export interface RegisteredBinding extends Binding {
  id: string;
  scope: string;
}

export interface KeyboardContextValue {
  getBindings: (scope: string) => RegisteredBinding[];
  pushScope: (scope: string) => () => void;
  registerSource: (scope: string, get: () => Binding[]) => () => void;
  version: number;
}
