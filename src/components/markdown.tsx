import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { imageMimeFor } from "../lib/mime.ts";
import {
  parseGitlabUploadPath,
  stripImageAttributeLists,
} from "../lib/provider.ts";
import { Spinner } from "./ui/spinner.tsx";

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

const TRAILING_NEWLINE_RE = /\n$/;

type AnchorProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function Anchor({ href, children, node: _node, ...rest }: AnchorProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (href) {
      openUrl(href).catch(() => undefined);
    }
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
  if (!Array.isArray(cls)) {
    return null;
  }
  const lang = cls.find(
    (c): c is string => typeof c === "string" && c.startsWith("language-")
  );
  return lang ? lang.slice("language-".length) : null;
}

function isSuggestionLang(lang: string | null): boolean {
  return (
    lang !== null && (lang === "suggestion" || lang.startsWith("suggestion:"))
  );
}

/** Flatten a code element's children to the raw fenced text. */
function codeText(children: unknown): string {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(codeText).join("");
  }
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
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );

  const body = text.replace(TRAILING_NEWLINE_RE, "");
  const lines = body.split("\n");

  const onCopy = () => {
    navigator.clipboard?.writeText(body).catch(() => undefined);
    setCopied(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="md-suggestion">
      <div className="md-suggestion-head">
        <span>Suggested change</span>
        <button
          className={cn("md-suggestion-copy", copied && "md-suggestion-copied")}
          onClick={onCopy}
          type="button"
        >
          {copied ? (
            <Check aria-hidden size={12} />
          ) : (
            <Copy aria-hidden size={12} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="md-suggestion-body">
        {lines.map((line) => (
          <div className="md-suggestion-line" key={line}>
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
  if (isSuggestionLang(fenceLang(codeNode))) {
    return <>{children}</>;
  }
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

type ImgProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };
type RawImgProps = ComponentPropsWithoutRef<"img">;

function RawImg({ alt, ...rest }: RawImgProps) {
  return (
    // biome-ignore lint/correctness/useImageSize: source markdown carries no dimensions
    <img alt={alt ?? ""} {...rest} />
  );
}

/** Fetches a GitLab upload through the authenticated Uploads API — the
 * bearer token never reaches the webview — and renders it as a data URL. */
function AuthenticatedImg({
  owner,
  repo,
  secret,
  filename,
  ...rest
}: RawImgProps & {
  owner: string;
  repo: string;
  secret: string;
  filename: string;
}) {
  const { data, error, isError, isLoading } = useQuery({
    queryFn: () => api.getUploadBlob(owner, repo, secret, filename),
    queryKey: ["uploadBlob", owner, repo, secret, filename],
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (isLoading) {
    return <Spinner label="Loading image…" />;
  }
  if (isError || !data) {
    return (
      <span className="text-faint text-sm">
        Couldn't load this image. {String(error)}
      </span>
    );
  }
  const mime = imageMimeFor(filename) ?? "application/octet-stream";
  return <RawImg src={`data:${mime};base64,${data.base64}`} {...rest} />;
}

function makeImg(owner: string | undefined, repo: string | undefined) {
  return function Img({ src, node: _node, ...rest }: ImgProps) {
    const upload = parseGitlabUploadPath(src);
    if (upload && owner && repo) {
      return (
        <AuthenticatedImg
          filename={upload.filename}
          owner={owner}
          repo={repo}
          secret={upload.secret}
          {...rest}
        />
      );
    }
    return <RawImg src={src} {...rest} />;
  };
}

export function Markdown({
  children,
  className,
  owner,
  repo,
}: {
  children: string;
  className?: string;
  owner?: string;
  repo?: string;
}) {
  const Img = makeImg(owner, repo);
  if (!children) {
    return null;
  }
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        components={{ a: Anchor, code: Code, img: Img, pre: Pre }}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        remarkPlugins={[remarkGfm, remarkBreaks]}
      >
        {stripImageAttributeLists(children)}
      </ReactMarkdown>
    </div>
  );
}
