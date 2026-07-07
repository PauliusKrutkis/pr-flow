/**
 * App icon exploration — five candidate marks in the Quiet palette, shown at
 * dock sizes on light and dark desktops. Each card exports a 1024×1024 PNG
 * (the input `pnpm tauri icon <png>` wants) straight from the browser.
 */

import { useRef } from "react";

const IRIS = "#8b80ff";
const IRIS_DEEP = "#6f63e6";
const ADD = "#5fd08a";
const DEL = "#ff7088";
const INK = "#e8e8f3";

/** Shared canvas: macOS-style squircle, indigo depth gradient, iris bloom. */
function Base({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#20202f" />
          <stop offset="1" stopColor="#0d0d15" />
        </linearGradient>
        <radialGradient id={`${id}-bloom`} cx="0.3" cy="0.12" r="0.9">
          <stop offset="0" stopColor={IRIS} stopOpacity="0.28" />
          <stop offset="0.55" stopColor={IRIS} stopOpacity="0.05" />
          <stop offset="1" stopColor={IRIS} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-iris`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={IRIS} />
          <stop offset="1" stopColor={IRIS_DEEP} />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="108" fill={`url(#${id}-bg)`} />
      <rect x="16" y="16" width="480" height="480" rx="108" fill={`url(#${id}-bloom)`} />
      <rect
        x="17.5"
        y="17.5"
        width="477"
        height="477"
        rx="106.5"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="3"
      />
      {children}
    </>
  );
}

/* 1 — DIFF: the review itself. A gutter of +/− and two code bars. */
function IconDiff() {
  return (
    <Base id="diff">
      <g strokeLinecap="round">
        {/* + row */}
        <g stroke={ADD} strokeWidth="26">
          <line x1="128" y1="192" x2="180" y2="192" />
          <line x1="154" y1="166" x2="154" y2="218" />
        </g>
        <rect x="222" y="176" width="168" height="32" rx="16" fill={ADD} opacity="0.92" />
        {/* − row */}
        <line x1="128" y1="320" x2="180" y2="320" stroke={DEL} strokeWidth="26" />
        <rect x="222" y="304" width="112" height="32" rx="16" fill={DEL} opacity="0.92" />
        {/* the reviewed line: iris cursor rail */}
        <rect x="96" y="240" width="14" height="64" rx="7" fill="url(#diff-iris)" />
        <rect x="128" y="240" width="262" height="32" rx="16" fill={INK} opacity="0.2" />
      </g>
    </Base>
  );
}

/* 2 — KEYCAP: keyboard-first. One key, one action: ship the review. */
function IconKeycap() {
  return (
    <Base id="key">
      <defs>
        <linearGradient id="key-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2b3e" />
          <stop offset="1" stopColor="#191926" />
        </linearGradient>
      </defs>
      {/* key body (side) + face */}
      <rect x="116" y="140" width="280" height="252" rx="52" fill="#0a0a12" />
      <rect x="116" y="124" width="280" height="240" rx="52" fill="url(#key-face)" />
      <rect
        x="118"
        y="126"
        width="276"
        height="236"
        rx="50"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="3"
      />
      {/* return glyph in iris */}
      <g
        fill="none"
        stroke="url(#key-iris)"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M330 200 v46 a20 20 0 0 1 -20 20 H196" />
        <path d="M232 224 L190 266 L232 308" />
      </g>
    </Base>
  );
}

/* 2b — KEYCAP, PRESSED: the key mid-press — the nod itself. */
function IconKeycapNod() {
  return (
    <Base id="keynod">
      <defs>
        <linearGradient id="keynod-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2b3e" />
          <stop offset="1" stopColor="#191926" />
        </linearGradient>
        <linearGradient id="keynod-iris" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={IRIS} />
          <stop offset="1" stopColor={IRIS_DEEP} />
        </linearGradient>
      </defs>
      {/* well the key sits in — the travel is visible above the face */}
      <rect
        x="104"
        y="120"
        width="304"
        height="288"
        rx="60"
        fill="#08080f"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth="3"
      />
      {/* pressed face: sits low in the well, thin side sliver below */}
      <rect x="128" y="176" width="256" height="216" rx="46" fill="#0a0a12" />
      <rect x="128" y="168" width="256" height="212" rx="46" fill="url(#keynod-face)" />
      <rect
        x="130"
        y="170"
        width="252"
        height="208"
        rx="44"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="3"
      />
      {/* return glyph in iris */}
      <g
        fill="none"
        stroke="url(#keynod-iris)"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M322 232 v40 a18 18 0 0 1 -18 18 H202" />
        <path d="M234 254 L196 290 L234 326" />
      </g>
    </Base>
  );
}

/* 3 — IRIS: the reviewer's eye; the accent become the brand. */
function IconIris() {
  return (
    <Base id="iris">
      <circle
        cx="256"
        cy="256"
        r="128"
        fill="none"
        stroke="url(#iris-iris)"
        strokeWidth="42"
      />
      <circle cx="256" cy="256" r="46" fill={INK} opacity="0.95" />
      {/* aperture notch — a hint of motion */}
      <path
        d="M256 86 a170 170 0 0 1 147 85"
        fill="none"
        stroke={IRIS}
        strokeWidth="18"
        strokeLinecap="round"
        opacity="0.45"
      />
    </Base>
  );
}

/* 4 — MERGE: the feature branch curving into base; approval as convergence. */
function IconMerge() {
  return (
    <Base id="merge">
      <g fill="none" strokeLinecap="round">
        {/* base branch */}
        <line
          x1="346"
          y1="150"
          x2="346"
          y2="376"
          stroke={INK}
          opacity="0.25"
          strokeWidth="30"
        />
        {/* feature branch merging in */}
        <path
          d="M166 150 v60 a106 106 0 0 0 106 106 h28"
          stroke="url(#merge-iris)"
          strokeWidth="30"
        />
      </g>
      <circle cx="166" cy="150" r="36" fill="url(#merge-iris)" />
      <circle cx="346" cy="150" r="36" fill={INK} opacity="0.3" />
      {/* the merge point */}
      <circle
        cx="346"
        cy="316"
        r="36"
        fill="none"
        stroke="url(#merge-iris)"
        strokeWidth="24"
      />
    </Base>
  );
}

/* 5 — FLOW: inbox to zero. Stacked chevrons accelerating through. */
function IconFlow() {
  return (
    <Base id="flow">
      <g
        fill="none"
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M164 132 L288 256 L164 380" stroke={INK} opacity="0.18" />
        <path d="M224 132 L348 256 L224 380" stroke={IRIS} opacity="0.45" />
        <path d="M284 132 L408 256 L284 380" stroke="url(#flow-iris)" />
      </g>
    </Base>
  );
}

const ICONS: { id: string; name: string; note: string; render: () => React.ReactNode }[] = [
  {
    id: "diff",
    name: "Diff",
    note: "The work itself: +/− gutter, code bars, the iris line cursor. Most literal.",
    render: () => <IconDiff />,
  },
  {
    id: "keycap",
    name: "Keycap",
    note: "Keyboard-first identity — one key with the return glyph. Reads at 16px.",
    render: () => <IconKeycap />,
  },
  {
    id: "keycap-nod",
    name: "Keycap — pressed (Nod)",
    note: "The key mid-press: the nod itself. Return = approve, caught in the act.",
    render: () => <IconKeycapNod />,
  },
  {
    id: "iris",
    name: "Iris",
    note: "The reviewer's eye; the accent color becomes the brand. Pairs with a rename.",
    render: () => <IconIris />,
  },
  {
    id: "merge",
    name: "Merge",
    note: "Branch converging into base — approval as convergence. Most git-native.",
    render: () => <IconMerge />,
  },
  {
    id: "flow",
    name: "Flow",
    note: "Inbox → zero. Chevrons accelerating through the queue. Most abstract.",
    render: () => <IconFlow />,
  },
];

/** Rasterize an SVG element to a PNG download at the given square size. */
function downloadPng(svg: SVGSVGElement, name: string, size = 1024) {
  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${name}-1024.png`;
    a.click();
  };
  img.src = url;
}

function IconCard({
  icon,
}: {
  icon: (typeof ICONS)[number];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--fg)" }}>
          {icon.name}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{icon.note}</span>
      </div>

      {/* hero + dock sizes on dark, plus a light-desktop check */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
        <svg ref={svgRef} viewBox="0 0 512 512" width={128} height={128}>
          {icon.render()}
        </svg>
        {[64, 32, 16].map((s) => (
          <svg key={s} viewBox="0 0 512 512" width={s} height={s}>
            {icon.render()}
          </svg>
        ))}
        <div
          style={{
            marginLeft: "auto",
            background: "#e9e9ef",
            borderRadius: 12,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {[48, 24].map((s) => (
            <svg key={s} viewBox="0 0 512 512" width={s} height={s}>
              {icon.render()}
            </svg>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="q-btn q-btn-quiet"
        style={{ alignSelf: "flex-start", padding: "5px 10px", fontSize: 12 }}
        onClick={() => svgRef.current && downloadPng(svgRef.current, `icon-${icon.id}`)}
      >
        Download 1024px PNG
      </button>
    </div>
  );
}

export default function IconGallery() {
  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--bg)",
        padding: "28px 32px",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--fg)", margin: 0 }}>
          App icon candidates
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 22px" }}>
          Five directions in the Quiet palette. Judge them at 16–32px (the dock
          and title bar are where icons live). Export the winner as PNG, then
          run <code style={{ color: "var(--accent)" }}>pnpm tauri icon icon-*.png</code>{" "}
          to regenerate every platform size.
        </p>
        <div style={{ display: "grid", gap: 16 }}>
          {ICONS.map((icon) => (
            <IconCard key={icon.id} icon={icon} />
          ))}
        </div>
      </div>
    </div>
  );
}
