// Design Lab — the chosen direction.
//
// "Quiet": PR Flow's Review screen done in the Superhuman north-star register —
// a calm, indigo-tinted dark canvas, one iris accent reserved for selection /
// the line cursor / the primary action, and a flow rail that turns "N/M viewed"
// into ambient progress. Rendered full-bleed against the shared mock review so
// it can be refined here before the component layer is promoted to @pr-flow/ui.
import { REVIEW } from "./mock";
import Quiet from "./directions/quiet";

export function App() {
  return <Quiet review={REVIEW} />;
}
