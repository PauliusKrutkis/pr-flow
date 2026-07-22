import { type Editor, Extension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold as BoldIcon,
  Code as CodeIcon,
  Diff,
  Italic as ItalicIcon,
  Link as LinkIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
  useImperativeHandle,
  useInsertionEffect,
  useState,
} from "react";
import { cn } from "../../lib/cn.ts";
import { suggestionHighlight } from "../../lib/suggestion-highlight.ts";
import { Tooltip } from "../ui/tooltip.tsx";

export interface ComposerEditorHandle {
  clear: () => void;
  focus: () => void;
  getMarkdown: () => string;
}

interface ComposerEditorProps {
  autoFocus?: boolean;
  initialMarkdown?: string;
  onCancel: () => void;
  onEmptyChange: (empty: boolean) => void;
  onModeFlip?: () => void;
  onSubmitRequest: () => void;
  placeholder: string;
  ref?: Ref<ComposerEditorHandle>;
  suggestionFile?: string;
  suggestionText?: string;
}

/** Toolbar buttons swallow mousedown so a click never steals the editor's
    focus (click still fires) — with focus on a button, every typed letter
    becomes a global hotkey (`s` = submit review…). */
function keepEditorFocus(e: { preventDefault: () => void }) {
  e.preventDefault();
}

/** The ⌘K url input takes the caret the moment it appears (stable identity —
    the callback must not re-run on every keystroke's re-render). */
function focusOnMount(el: HTMLInputElement | null) {
  el?.focus();
}

interface ComposerKeyHandlers {
  cancel: () => void;
  emptyChange: (empty: boolean) => void;
  flip: (() => void) | undefined;
  insertSuggestion: (() => void) | undefined;
  openLink: (ed: Editor) => boolean;
  submit: () => void;
}

const INDENT = "  ";
const LEADING_INDENT = /^ {1,2}/;

/**
 * Parent-relative start offsets of the code-block lines the selection touches.
 * Code blocks hold one text node with literal newlines, so line geometry is
 * plain string arithmetic on the parent's textContent.
 */
function touchedLineStarts(editor: Editor): number[] | null {
  const { $from, $to } = editor.state.selection;
  if (!$from.sameParent($to)) {
    return null;
  }
  const text = $from.parent.textContent;
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts.filter((start, i) => {
    const end = (starts[i + 1] ?? text.length + 1) - 1;
    return start <= $to.parentOffset && end >= $from.parentOffset;
  });
}

/** Tab in a code block: indent at the caret, or every selected line. */
function indentCodeBlock(editor: Editor): boolean {
  const { from, to, $from } = editor.state.selection;
  if (from === to) {
    editor.commands.insertContent(INDENT);
    return true;
  }
  const lines = touchedLineStarts(editor);
  if (!lines) {
    return true;
  }
  const blockStart = $from.start();
  editor.commands.command(({ tr }) => {
    for (const start of [...lines].reverse()) {
      tr.insertText(INDENT, blockStart + start);
    }
    return true;
  });
  return true;
}

/** Shift-Tab in a code block: remove up to one indent from each touched line. */
function dedentCodeBlock(editor: Editor): boolean {
  const lines = touchedLineStarts(editor);
  if (!lines) {
    return true;
  }
  const { $from } = editor.state.selection;
  const blockStart = $from.start();
  const text = $from.parent.textContent;
  editor.commands.command(({ tr }) => {
    for (const start of [...lines].reverse()) {
      const spaces = LEADING_INDENT.exec(text.slice(start))?.[0].length ?? 0;
      if (spaces > 0) {
        tr.delete(blockStart + start, blockStart + start + spaces);
      }
    }
    return true;
  });
  return true;
}

/**
 * Per-editor handlers for the shared keymap below, kept current by each
 * composer's insertion effect. A module WeakMap (the fileRenderMeta idiom)
 * instead of a ref: every shortcut receives its editor, so handlers key off
 * that — nothing render-frozen is mutated, no ref crosses a render boundary.
 */
const HANDLERS = new WeakMap<Editor, ComposerKeyHandlers>();

const ComposerKeys = Extension.create({
  addKeyboardShortcuts() {
    return {
      Escape: ({ editor }) => {
        HANDLERS.get(editor)?.cancel();
        return true;
      },
      "Mod-b": ({ editor }) => {
        editor.chain().focus().toggleBold().run();
        return true;
      },
      "Mod-Enter": ({ editor }) => {
        HANDLERS.get(editor)?.submit();
        return true;
      },
      "Mod-e": ({ editor }) => {
        editor.chain().focus().toggleCode().run();
        return true;
      },
      "Mod-i": ({ editor }) => {
        editor.chain().focus().toggleItalic().run();
        return true;
      },
      "Mod-k": ({ editor }) => HANDLERS.get(editor)?.openLink(editor) ?? false,
      "Mod-Shift-g": ({ editor }) => {
        const insert = HANDLERS.get(editor)?.insertSuggestion;
        if (!insert) {
          return false;
        }
        insert();
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          return dedentCodeBlock(editor);
        }
        const flip = HANDLERS.get(editor)?.flip;
        if (!flip || editor.isActive("listItem")) {
          return false;
        }
        flip();
        return true;
      },
      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          return indentCodeBlock(editor);
        }
        const flip = HANDLERS.get(editor)?.flip;
        if (!flip || editor.isActive("listItem")) {
          return false;
        }
        flip();
        return true;
      },
    };
  },
  name: "composerKeys",
});

/**
 * The rich comment surface: WYSIWYG in, markdown out. ⌘B/⌘I/⌘E toggle real
 * formatting, ⌘K links the selection, and markdown typing shortcuts
 * (`**bold**`, `- `, ``` …) autoconvert as you type — nothing is lost for
 * markdown muscle memory, the symbols just resolve instead of sitting there.
 * The toolbar below the surface is the familiar icon strip; each button's
 * hotkey lives in its hover tooltip (the app-wide Tooltip + Kbd language),
 * with a lit state following the selection. Suggestion keeps its text label —
 * the one domain-specific tool with no universal glyph — and only renders
 * when suggestionText (the commented line, its prefill) is provided:
 * composers without line context (replies, edits, PR-level comments) have
 * nowhere a suggestion could apply. suggestionFile is that line's file path;
 * it drives syntax highlighting inside ```suggestion fences.
 */
export function ComposerEditor({
  ref,
  placeholder,
  autoFocus,
  initialMarkdown,
  suggestionFile,
  suggestionText,
  onSubmitRequest,
  onCancel,
  onModeFlip,
  onEmptyChange,
}: ComposerEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");

  const openLink = (ed: Editor) => {
    if (ed.state.selection.empty && !ed.isActive("link")) {
      return false;
    }
    setLinkHref((ed.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
    return true;
  };

  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    content: initialMarkdown ?? "",
    contentType: "markdown",
    editorProps: {
      attributes: {
        "aria-label": placeholder,
        "aria-multiline": "true",
        class: "qa-editor-content",
        role: "textbox",
      },
      handleKeyDown: (_view, event): boolean => {
        const mod = (event.metaKey || event.ctrlKey) && !event.shiftKey;
        if (mod && event.key.toLowerCase() === "k") {
          event.stopPropagation();
        }
        return false;
      },
    },
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false },
        underline: false,
      }),
      Placeholder.configure({ placeholder }),
      Markdown,
      ComposerKeys,
      suggestionHighlight(suggestionFile),
    ],
    onUpdate: ({ editor: e }) => HANDLERS.get(e)?.emptyChange(e.isEmpty),
  });

  /**
   * A real block, rendered like the shipped suggestion card and serialized to
   * the ```suggestion fence both hosts apply natively. The caret lands at the
   * end of the prefilled line — nothing pre-selected, it edits like code.
   */
  const insertSuggestion = () => {
    const line = suggestionText ?? "";
    editor
      .chain()
      .focus()
      .insertContent({
        attrs: { language: "suggestion" },
        content: line ? [{ text: line, type: "text" }] : undefined,
        type: "codeBlock",
      })
      .run();
  };

  useInsertionEffect(() => {
    HANDLERS.set(editor, {
      cancel: onCancel,
      emptyChange: onEmptyChange,
      flip: onModeFlip,
      insertSuggestion:
        suggestionText === undefined ? undefined : insertSuggestion,
      openLink,
      submit: onSubmitRequest,
    });
  });

  useImperativeHandle(
    ref,
    (): ComposerEditorHandle => ({
      clear: () => editor.commands.clearContent(true),
      focus: () => editor.commands.focus(),
      getMarkdown: () => editor.getMarkdown(),
    }),
    [editor]
  );

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      code: e.isActive("code"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
    }),
  });

  const applyLink = () => {
    setLinkOpen(false);
    const href = linkHref.trim();

    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) {
      chain.setLink({ href }).run();
    } else {
      chain.unsetLink().run();
    }
  };

  const closeLink = () => {
    setLinkOpen(false);
    editor.commands.focus();
  };

  const handleLinkChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLinkHref(e.target.value);
  };

  const handleLinkKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyLink();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeLink();
    }
  };

  const handleToggleBold = () => {
    editor.chain().focus().toggleBold().run();
  };

  const handleToggleItalic = () => {
    editor.chain().focus().toggleItalic().run();
  };

  const handleToggleCode = () => {
    editor.chain().focus().toggleCode().run();
  };

  const handleToggleLink = () => {
    if (!openLink(editor)) {
      editor.commands.focus();
    }
  };

  return (
    <div className="qa-editor">
      <EditorContent editor={editor} />

      <div className="qa-tools">
        {linkOpen ? (
          <input
            aria-label="Link URL"
            className="q-input qa-link-input"
            onChange={handleLinkChange}
            onKeyDown={handleLinkKeyDown}
            placeholder="https://…  ↵ applies · Esc backs out"
            ref={focusOnMount}
            value={linkHref}
          />
        ) : (
          <>
            {suggestionText !== undefined && (
              <Tooltip
                combo="mod+shift+g"
                label="Insert a code suggestion for this line"
              >
                <button
                  aria-label="Insert suggestion"
                  className="qa-tool qa-tool-suggest q-focus"
                  onClick={insertSuggestion}
                  onMouseDown={keepEditorFocus}
                  type="button"
                >
                  <Diff aria-hidden size={12} />
                  Suggestion
                </button>
              </Tooltip>
            )}
            <Tooltip combo="mod+b" label="Bold">
              <button
                aria-label="Bold"
                aria-pressed={active.bold}
                className={cn("qa-tool q-focus", active.bold && "qa-tool-on")}
                onClick={handleToggleBold}
                onMouseDown={keepEditorFocus}
                type="button"
              >
                <BoldIcon aria-hidden size={13} />
              </button>
            </Tooltip>
            <Tooltip combo="mod+i" label="Italic">
              <button
                aria-label="Italic"
                aria-pressed={active.italic}
                className={cn("qa-tool q-focus", active.italic && "qa-tool-on")}
                onClick={handleToggleItalic}
                onMouseDown={keepEditorFocus}
                type="button"
              >
                <ItalicIcon aria-hidden size={13} />
              </button>
            </Tooltip>
            <Tooltip combo="mod+e" label="Inline code">
              <button
                aria-label="Code"
                aria-pressed={active.code}
                className={cn("qa-tool q-focus", active.code && "qa-tool-on")}
                onClick={handleToggleCode}
                onMouseDown={keepEditorFocus}
                type="button"
              >
                <CodeIcon aria-hidden size={13} />
              </button>
            </Tooltip>
            <Tooltip combo="mod+k" label="Link the selection">
              <button
                aria-label="Link"
                aria-pressed={active.link}
                className={cn("qa-tool q-focus", active.link && "qa-tool-on")}
                onClick={handleToggleLink}
                onMouseDown={keepEditorFocus}
                type="button"
              >
                <LinkIcon aria-hidden size={13} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
