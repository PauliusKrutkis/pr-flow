import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "../lib/cn";

// GitHub PR/issue bodies routinely contain raw HTML (Dependabot's <details>
// release notes, <blockquote>, tables, etc.) and treat single newlines as
// line breaks. Plain react-markdown + remark-gfm renders neither, which made
// such descriptions look malformed. So we:
//   - remark-breaks: soft line breaks -> <br> (GitHub-style)
//   - rehype-raw: actually render embedded HTML
//   - rehype-sanitize: strip anything unsafe (GitHub-like allowlist),
//     extended to permit <details>/<summary> collapsibles.
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
        components={{ a: Anchor }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
