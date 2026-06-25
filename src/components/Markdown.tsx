import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "../lib/cn";

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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: Anchor }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
