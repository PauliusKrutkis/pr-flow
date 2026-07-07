/**
 * Shared, theme-agnostic syntax renderer. Each token gets a `tk-<type>` class;
 * every direction themes those classes inside its own scoped stylesheet, so the
 * highlighting logic is shared while the colours stay per-direction.
 */

import { Fragment } from "react";
import { tokenize, type TokenType } from "./mock";

const CLASS: Record<TokenType, string> = {
  kw: "tk-kw",
  str: "tk-str",
  num: "tk-num",
  com: "tk-com",
  fn: "tk-fn",
  type: "tk-type",
  punct: "tk-punct",
  plain: "tk-plain",
};

export function Tokens({
  line,
  language,
}: {
  line: string;
  language: string;
}) {
  const tokens = tokenize(line, language);
  return (
    <>
      {tokens.map((t, i) => (
        <Fragment key={i}>
          <span className={CLASS[t.type]}>{t.value}</span>
        </Fragment>
      ))}
    </>
  );
}
