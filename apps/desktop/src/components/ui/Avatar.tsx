import { useState } from "react";

/** Deterministic avatar background for the initials fallback. */
const COLORS = [
  "#7c6cff",
  "#2f9bd4",
  "#e0683b",
  "#3f9d57",
  "#c15fb0",
  "#d9a13b",
];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(h) % COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Quiet avatar — a real GitHub image when available, falling back to initials
 * on a deterministic tint (offline, broken URL, or empty src). Renders the
 * shared `.q-avatar` shape at any size.
 */
export function Avatar({
  url,
  name,
  size = 22,
}: {
  url?: string | null;
  name: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!url && !broken;

  if (showImage) {
    return (
      <img
        alt=""
        aria-hidden
        className="q-avatar"
        height={size}
        onError={() => setBroken(true)}
        src={url ?? undefined}
        style={{ height: size, width: size }}
        title={name}
        width={size}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="q-avatar"
      style={{
        background: colorFor(name),
        fontSize: Math.round(size * 0.42),
        height: size,
        width: size,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
