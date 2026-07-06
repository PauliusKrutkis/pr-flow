import {
  useImperativeHandle,
  useInsertionEffect,
  useState,
  type Ref,
} from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Diff } from "lucide-react";
import { Kbd } from "../ui/Kbd";

export interface ComposerEditorHandle {
  /** The composed comment, serialized to the hosts' wire format. */
  getMarkdown(): string;
  clear(): void;
  focus(): void;
}

interface ComposerEditorProps {
  ref?: Ref<ComposerEditorHandle>;
  placeholder: string;
  autoFocus?: boolean;
  /** The commented line's head-side text — enables the Suggestion block. */
  suggestionText?: string;
  /** ⌘↵ — the parent decides what "submit" means (mode, pending, clearing). */
  onSubmitRequest: () => void;
  /** Esc. */
  onCancel: () => void;
  /** Tab, outside lists — flips the parent's batch/now mode when provided. */
  onModeFlip?: () => void;
  /** Editor emptiness, for the parent's submit affordance. */
  onEmptyChange: (empty: boolean) => void;
}

/** Toolbar buttons swallow mousedown so a click never steals the editor's
    focus (click still fires) — with focus on a button, every typed letter
    becomes a global hotkey (`s` = submit review…). */
function keepEditorFocus(e: { preventDefault(): void }) {
  e.preventDefault();
}

/** The ⌘K url input takes the caret the moment it appears (stable identity —
    the callback must not re-run on every keystroke's re-render). */
function focusOnMount(el: HTMLInputElement | null) {
  el?.focus();
}

type ComposerKeyHandlers = {
  submit: () => void;
  cancel: () => void;
  flip: (() => void) | undefined;
  openLink: (ed: Editor) => boolean;
  emptyChange: (empty: boolean) => void;
};

/**
 * Per-editor handlers for the shared keymap below, kept current by each
 * composer's insertion effect. A module WeakMap (the fileRenderMeta idiom)
 * instead of a ref: every shortcut receives its editor, so handlers key off
 * that — nothing render-frozen is mutated, no ref crosses a render boundary.
 */
const HANDLERS = new WeakMap<Editor, ComposerKeyHandlers>();

const ComposerKeys = Extension.create({
  name: "composerKeys",
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": ({ editor }) => {
        HANDLERS.get(editor)?.submit();
        return true;
      },
      Escape: ({ editor }) => {
        HANDLERS.get(editor)?.cancel();
        return true;
      },
      "Mod-k": ({ editor }) =>
        HANDLERS.get(editor)?.openLink(editor) ?? false,
      // Tab keeps its composer meaning (flip batch/now) except inside a
      // list, where indenting is what an editor user expects.
      Tab: ({ editor }) => {
        const flip = HANDLERS.get(editor)?.flip;
        if (!flip || editor.isActive("listItem")) return false;
        flip();
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        const flip = HANDLERS.get(editor)?.flip;
        if (!flip || editor.isActive("listItem")) return false;
        flip();
        return true;
      },
    };
  },
});

/**
 * The rich comment surface: WYSIWYG in, markdown out. ⌘B/⌘I/⌘E toggle real
 * formatting, ⌘K links the selection, and markdown typing shortcuts
 * (`**bold**`, `- `, ``` …) autoconvert as you type — nothing is lost for
 * markdown muscle memory, the symbols just resolve instead of sitting there.
 * The hint bar below the surface stays: every entry names its hotkey and is
 * the button, now with a lit state following the selection.
 */
export function ComposerEditor({
  ref,
  placeholder,
  autoFocus,
  suggestionText,
  onSubmitRequest,
  onCancel,
  onModeFlip,
  onEmptyChange,
}: ComposerEditorProps) {
  // ⌘K swaps the hint bar for a URL input aimed at the current selection.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");

  // Needs something to link — a selection, or an existing link to edit. Takes
  // the editor as an argument (not from scope) so the keymap, which is built
  // before the editor exists, can call it.
  function openLink(ed: Editor): boolean {
    if (ed.state.selection.empty && !ed.isActive("link")) return false;
    setLinkHref((ed.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
    return true;
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Underline has no markdown form; links must not navigate in-app.
        underline: false,
        link: { openOnClick: false },
      }),
      Placeholder.configure({ placeholder }),
      Markdown,
      ComposerKeys,
    ],
    content: "",
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor: e }) => HANDLERS.get(e)?.emptyChange(e.isEmpty),
    editorProps: {
      attributes: {
        class: "qa-editor-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": placeholder,
      },
      handleKeyDown: (_view, event) => {
        // The global hotkey listener honors mod-combos even from editable
        // targets — the editor's ⌘K must not reach it (palette).
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          event.key === "k"
        ) {
          event.stopPropagation();
        }
        return false;
      },
    },
  });

  // Keep this editor's keymap handlers current — insertion effects run
  // before any user event, so shortcuts never see a stale closure.
  useInsertionEffect(() => {
    HANDLERS.set(editor, {
      submit: onSubmitRequest,
      cancel: onCancel,
      flip: onModeFlip,
      openLink,
      emptyChange: onEmptyChange,
    });
  });

  useImperativeHandle(
    ref,
    (): ComposerEditorHandle => ({
      getMarkdown: () => editor.getMarkdown(),
      clear: () => editor.commands.clearContent(true),
      focus: () => editor.commands.focus(),
    }),
    [editor],
  );

  // Lit states for the hint-bar toggles, updated per transaction.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      link: e.isActive("link"),
    }),
  });

  // A real block, rendered like the shipped suggestion card and serialized to
  // the ```suggestion fence both hosts apply natively. The prefilled line is
  // left selected so typing replaces it in place.
  function insertSuggestion() {
    const line = suggestionText ?? "";
    editor
      .chain()
      .focus()
      .insertContent({
        type: "codeBlock",
        attrs: { language: "suggestion" },
        content: line ? [{ type: "text", text: line }] : undefined,
      })
      .run();
    if (line) {
      const to = editor.state.selection.to;
      editor.commands.setTextSelection({ from: to - line.length, to });
    }
  }

  function applyLink() {
    setLinkOpen(false);
    const href = linkHref.trim();
    // focus() restores the selection the input borrowed; extendMarkRange
    // covers editing an existing link from a caret inside it.
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) {
      chain.setLink({ href }).run();
    } else {
      chain.unsetLink().run();
    }
  }

  function closeLink() {
    setLinkOpen(false);
    editor.commands.focus();
  }

  return (
    <div className="qa-editor">
      <EditorContent editor={editor} />

      {/* The hint bar IS the toolbar: each entry names its hotkey and is a
          real button, lit when the selection carries that mark. */}
      <div className="qa-tools">
        {linkOpen ? (
          <input
            ref={focusOnMount}
            value={linkHref}
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeLink();
              }
            }}
            placeholder="https://…  ↵ applies · Esc backs out"
            aria-label="Link URL"
            className="q-input qa-link-input"
          />
        ) : (
          <>
            {suggestionText != null && (
              <button
                type="button"
                onMouseDown={keepEditorFocus}
                onClick={insertSuggestion}
                className="qa-tool qa-tool-suggest q-focus"
                aria-label="Insert suggestion"
                title="Insert a code suggestion prefilled with this line"
              >
                <Diff size={12} aria-hidden />
                Suggestion
              </button>
            )}
            <button
              type="button"
              onMouseDown={keepEditorFocus}
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={"qa-tool q-focus" + (active.bold ? " qa-tool-on" : "")}
              aria-pressed={active.bold}
              aria-label="Bold"
              title="Bold"
            >
              <Kbd combo="mod+b" />
              bold
            </button>
            <button
              type="button"
              onMouseDown={keepEditorFocus}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={
                "qa-tool q-focus" + (active.italic ? " qa-tool-on" : "")
              }
              aria-pressed={active.italic}
              aria-label="Italic"
              title="Italic"
            >
              <Kbd combo="mod+i" />
              italic
            </button>
            <button
              type="button"
              onMouseDown={keepEditorFocus}
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={"qa-tool q-focus" + (active.code ? " qa-tool-on" : "")}
              aria-pressed={active.code}
              aria-label="Code"
              title="Inline code"
            >
              <Kbd combo="mod+e" />
              code
            </button>
            <button
              type="button"
              onMouseDown={keepEditorFocus}
              onClick={() => {
                if (!openLink(editor)) editor.commands.focus();
              }}
              className={"qa-tool q-focus" + (active.link ? " qa-tool-on" : "")}
              aria-pressed={active.link}
              aria-label="Link"
              title="Link the selection"
            >
              <Kbd combo="mod+k" />
              link
            </button>
          </>
        )}
      </div>
    </div>
  );
}
