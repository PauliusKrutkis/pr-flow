/**
 * @pr-flow/ui — "ForkDesign": the shared component layer and design primitives
 * (tokens, buttons, inputs, cards, badges, modal shell, …) used by both the
 * desktop app and the design lab.
 *
 * Dependency rule: ui may depend on core (for shared types) but NEVER on an app
 * (desktop or design-lab). Apps depend on ui; ui stays app-agnostic.
 *
 * Empty for now — the desktop app still owns its `src/components/ui`. Primitives
 * get promoted here in follow-up PRs as the design system consolidates (see
 * docs/DESIGN.md).
 */

export {};
