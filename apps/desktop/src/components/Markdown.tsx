import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * GitHub PR/issue bodies routinely contain raw HTML (Dependabot's <details>
 * release notes, <blockquote>, tables, etc.) and treat single newlines as
 * line breaks. Plain react-markdown + remark-gfm renders neither, which made
 * such descriptions look malformed. So we:
 * - remark-breaks: soft line breaks -> <br> (GitHub-style)
 * - rehype-raw: actually render embedded HTML
 * - rehype-sanitize: strip anything unsafe (GitHub-like allowlist),
 * extended to permit <details>/<summary> collapsibles.
 */

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
};

type AnchorProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function Anchor({ href, children, node: _node, ...rest }: AnchorProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (href) void openUrl(href);
  };
  return (
    <a {...rest} href={href} onClick={onClick}>
      {children}
    </a>
  );
}

/** The fence language of a hast <code> node, or null. */
function fenceLang(node: unknown): string | null {
  const cls = (node as { properties?: { className?: unknown } } | undefined)
    ?.properties?.className;
  if (!Array.isArray(cls)) return null;
  const lang = cls.find(
    (c): c is string => typeof c === "string" && c.startsWith("language-"),
  );
  return lang ? lang.slice("language-".length) : null;
}

function isSuggestionLang(lang: string | null): boolean {
  return lang != null && (lang === "suggestion" || lang.startsWith("suggestion:"));
}

/** Flatten a code element's children to the raw fenced text. */
function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeText).join("");
  return "";
}

/**
 * A suggested change: header + the proposed lines styled like added diff
 * lines, and a copy button (applying suggestions from Nod is out of scope —
 * the hosts expose no public REST endpoint for it).
 */
function SuggestionCard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const body = text.replace(/\n$/, "");
  const lines = body.split("\n");
  return (
    <div className="md-suggestion">
      <div className="md-suggestion-head">
        <span>Suggested change</span>
        <button
          type="button"
          className={cn("md-suggestion-copy", copied && "md-suggestion-copied")}
          onClick={() => {
            void navigator.clipboard?.writeText(body).catch(() => {});
            setCopied(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="md-suggestion-body">
        {lines.map((line, i) => (
          <div key={i} className="md-suggestion-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

type PreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: { children?: unknown[] };
};

/** Unwrap suggestion fences from <pre> so the card isn't nested in a code box. */
function Pre({ node, children, ...rest }: PreProps) {
  const codeNode = node?.children?.[0];
  if (isSuggestionLang(fenceLang(codeNode))) return <>{children}</>;
  return <pre {...rest}>{children}</pre>;
}

type CodeProps = ComponentPropsWithoutRef<"code"> & { node?: unknown };

function Code({ node, className, children, ...rest }: CodeProps) {
  if (isSuggestionLang(fenceLang(node))) {
    return <SuggestionCard text={codeText(children)} />;
  }
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  if (!children) return null;
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{ a: Anchor, pre: Pre, code: Code }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
