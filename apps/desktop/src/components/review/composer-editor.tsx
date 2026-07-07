// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { type Editor, Extension } from "@tiptap/core";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { Placeholder } from "@tiptap/extensions";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { Markdown } from "@tiptap/markdown";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import StarterKit from "@tiptap/starter-kit";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { Diff } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
  useCallback,
  useImperativeHandle,
  useInsertionEffect,
  useState,
} from "react";
import { Kbd } from "../ui/kbd.tsx";

export interface ComposerEditorHandle {
  clear: () => void;
  focus: () => void;
  /** The composed comment, serialized to the hosts' wire format. */
  getMarkdown: () => string;
}

interface ComposerEditorProps {
  autoFocus?: boolean;
  onCancel: () => void;
  onEmptyChange: (empty: boolean) => void;
  onModeFlip?: () => void;
  onSubmitRequest: () => void;
  placeholder: string;
  ref?: Ref<ComposerEditorHandle>;
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
  openLink: (ed: Editor) => boolean;
  submit: () => void;
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
      "Mod-Enter": ({ editor }) => {
        HANDLERS.get(editor)?.submit();
        return true;
      },
      "Mod-k": ({ editor }) => HANDLERS.get(editor)?.openLink(editor) ?? false,
      "Shift-Tab": ({ editor }) => {
        const flip = HANDLERS.get(editor)?.flip;
        if (!flip || editor.isActive("listItem")) {
          return false;
        }
        flip();
        return true;
      },
      Tab: ({ editor }) => {
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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");

  const openLink = useCallback((ed: Editor): boolean => {
    if (ed.state.selection.empty && !ed.isActive("link")) {
      return false;
    }
    setLinkHref((ed.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
    return true;
  }, []);

  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    content: "",
    editorProps: {
      attributes: {
        "aria-label": placeholder,
        "aria-multiline": "true",
        class: "qa-editor-content",
        role: "textbox",
      },
      handleKeyDown: (_view, event) => {
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
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false },
        underline: false,
      }),
      Placeholder.configure({ placeholder }),
      Markdown,
      ComposerKeys,
    ],
    onUpdate: ({ editor: e }) => HANDLERS.get(e)?.emptyChange(e.isEmpty),
  });

  useInsertionEffect(() => {
    HANDLERS.set(editor, {
      cancel: onCancel,
      emptyChange: onEmptyChange,
      flip: onModeFlip,
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

  /**
   * A real block, rendered like the shipped suggestion card and serialized to
   * the ```suggestion fence both hosts apply natively. The prefilled line is
   * left selected so typing replaces it in place.
   */

  const insertSuggestion = useCallback(() => {
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
    if (line) {
      const { to: selectionEnd } = editor.state.selection;
      editor.commands.setTextSelection({
        from: selectionEnd - line.length,
        to: selectionEnd,
      });
    }
  }, [editor, suggestionText]);

  const applyLink = useCallback(() => {
    setLinkOpen(false);
    const href = linkHref.trim();

    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) {
      chain.setLink({ href }).run();
    } else {
      chain.unsetLink().run();
    }
  }, [editor, linkHref]);

  const closeLink = useCallback(() => {
    setLinkOpen(false);
    editor.commands.focus();
  }, [editor]);

  const handleLinkChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setLinkHref(e.target.value);
  }, []);

  const handleLinkKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyLink();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeLink();
      }
    },
    [applyLink, closeLink]
  );

  const handleToggleBold = useCallback(() => {
    editor.chain().focus().toggleBold().run();
  }, [editor]);

  const handleToggleItalic = useCallback(() => {
    editor.chain().focus().toggleItalic().run();
  }, [editor]);

  const handleToggleCode = useCallback(() => {
    editor.chain().focus().toggleCode().run();
  }, [editor]);

  const handleToggleLink = useCallback(() => {
    if (!openLink(editor)) {
      editor.commands.focus();
    }
  }, [editor, openLink]);

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
            {suggestionText !== null && (
              <button
                aria-label="Insert suggestion"
                className="qa-tool qa-tool-suggest q-focus"
                onClick={insertSuggestion}
                onMouseDown={keepEditorFocus}
                title="Insert a code suggestion prefilled with this line"
                type="button"
              >
                <Diff aria-hidden size={12} />
                Suggestion
              </button>
            )}
            <button
              aria-label="Bold"
              aria-pressed={active.bold}
              className={`qa-tool q-focus${active.bold ? "qa-tool-on" : ""}`}
              onClick={handleToggleBold}
              onMouseDown={keepEditorFocus}
              title="Bold"
              type="button"
            >
              <Kbd combo="mod+b" />
              bold
            </button>
            <button
              aria-label="Italic"
              aria-pressed={active.italic}
              className={`qa-tool q-focus${active.italic ? "qa-tool-on" : ""}`}
              onClick={handleToggleItalic}
              onMouseDown={keepEditorFocus}
              title="Italic"
              type="button"
            >
              <Kbd combo="mod+i" />
              italic
            </button>
            <button
              aria-label="Code"
              aria-pressed={active.code}
              className={`qa-tool q-focus${active.code ? "qa-tool-on" : ""}`}
              onClick={handleToggleCode}
              onMouseDown={keepEditorFocus}
              title="Inline code"
              type="button"
            >
              <Kbd combo="mod+e" />
              code
            </button>
            <button
              aria-label="Link"
              aria-pressed={active.link}
              className={`qa-tool q-focus${active.link ? "qa-tool-on" : ""}`}
              onClick={handleToggleLink}
              onMouseDown={keepEditorFocus}
              title="Link the selection"
              type="button"
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
