/**
 * Minimal, dependency-free markdown renderer — enough for PR descriptions and
 * comment bodies in the mock: headings, paragraphs, lists, blockquotes, fenced
 * code, and inline code / bold / italic / links. Emits semantic tags inside a
 * `.md` wrapper so each direction can style prose in its own voice.
 */

import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  /**
   * Order matters: code first (so we don't format inside it), then links,
   * bold, italic.
   */

  const out: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (lm)
        out.push(
          <a key={key} href={lm[2]} onClick={(e) => e.preventDefault()}>
            {lm[1]}
          </a>,
        );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  const lines = children.split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ");
      blocks.push(<p key={key++}>{inline(text, `p${key}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const items = list.slice();
      blocks.push(
        <ul key={key++}>
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `li${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw;
    if (code !== null) {
      if (line.trim().startsWith("```")) {
        blocks.push(
          <pre key={key++}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const content = inline(heading[2], `h${key}`);
      const k = key++;
      if (level <= 1) blocks.push(<h2 key={k}>{content}</h2>);
      else if (level === 2) blocks.push(<h3 key={k}>{content}</h3>);
      else blocks.push(<h4 key={k}>{content}</h4>);
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      list.push(li[1]);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote key={key++}>{inline(quote[1], `q${key}`)}</blockquote>,
      );
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    para.push(line);
  }
  flushPara();
  flushList();

  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
