/**
 * Live syntax highlighting inside the composer's ```suggestion fences, using
 * the same per-line highlighter (and cache) as the diff and shipped suggestion
 * cards — one highlight system, so the block you type reads like the card it
 * becomes. hljs emits HTML strings; ProseMirror wants ranges, so each line's
 * output is walked once to recover token offsets as inline decorations, with
 * the spans memoized per HTML string (decorations rebuild on every doc or
 * selection change).
 */
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Selection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { highlightLine, isHighlightable } from "./highlight.ts";

interface TokenSpan {
  cls: string;
  from: number;
  to: number;
}

const SPAN_CACHE_LIMIT = 10_000;
const spanCache = new Map<string, TokenSpan[]>();

/** Recovers `[from, to, class)` token ranges from one line's hljs HTML. */
function htmlToSpans(html: string): TokenSpan[] {
  if (!html.includes("<")) {
    return [];
  }
  const hit = spanCache.get(html);
  if (hit !== undefined) {
    return hit;
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const spans: TokenSpan[] = [];
  let offset = 0;
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return;
    }
    const el = node as HTMLElement;
    const start = offset;
    for (const child of el.childNodes) {
      walk(child);
    }
    if (el.className && offset > start) {
      spans.push({ cls: el.className, from: start, to: offset });
    }
  };
  for (const child of tpl.content.childNodes) {
    walk(child);
  }
  if (spanCache.size > SPAN_CACHE_LIMIT) {
    spanCache.clear();
  }
  spanCache.set(html, spans);
  return spans;
}

/**
 * Token spans intersecting a non-collapsed selection are skipped: the browser
 * natively replaces selected text on the next keystroke, and Chromium's edit
 * across decoration spans re-parses as a bare deletion — the typed character
 * vanished (first keystroke after selecting a suggestion line to retype it).
 * Undecorated selected text is a plain text node, which replaces cleanly;
 * tokens return on the rebuild after the selection collapses.
 */
function buildDecorations(
  doc: PmNode,
  filename: string,
  selection: Selection
): DecorationSet {
  const decos: Decoration[] = [];
  const { from: selFrom, to: selTo, empty } = selection;
  doc.descendants((node: PmNode, pos: number) => {
    if (
      node.type.name !== "codeBlock" ||
      node.attrs.language !== "suggestion"
    ) {
      return;
    }
    let offset = pos + 1;
    for (const line of node.textContent.split("\n")) {
      if (line.length > 0) {
        for (const span of htmlToSpans(highlightLine(line, filename))) {
          const from = offset + span.from;
          const to = offset + span.to;
          if (!empty && from < selTo && to > selFrom) {
            continue;
          }
          decos.push(Decoration.inline(from, to, { class: span.cls }));
        }
      }
      offset += line.length + 1;
    }
  });
  return DecorationSet.create(doc, decos);
}

/**
 * Highlights ```suggestion fences as the commented file's language. A no-op
 * without a highlightable filename — composers with no line context (replies,
 * edits, PR-level comments) don't get the extension's plugin at all.
 */
export function suggestionHighlight(filename: string | undefined) {
  return Extension.create({
    addProseMirrorPlugins() {
      if (filename === undefined || !isHighlightable(filename)) {
        return [];
      }
      const key = new PluginKey<DecorationSet>("suggestionHighlight");
      return [
        new Plugin<DecorationSet>({
          key,
          props: {
            decorations: (state: EditorState) => key.getState(state),
          },
          state: {
            apply: (
              tr: Transaction,
              old: DecorationSet,
              _oldState: EditorState,
              newState: EditorState
            ) =>
              tr.docChanged || tr.selectionSet
                ? buildDecorations(newState.doc, filename, newState.selection)
                : old,
            init: (_config: unknown, state: EditorState) =>
              buildDecorations(state.doc, filename, state.selection),
          },
        }),
      ];
    },
    name: "suggestionHighlight",
  });
}
