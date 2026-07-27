// The tokens both frontends share.
//
// The gallery shell and an isolated story document are separate HTML documents,
// but a component reads the same custom properties in each — so the variables
// live here rather than in either page's stylesheet. A story rendered in an
// iframe must theme identically to the same story rendered inline, or the
// isolation would change what the workbench shows.

/** Custom properties: the page's own chrome, plus the storefront-ish tokens a
 * previewed component themes off. Light by default, dark by preference or by an
 * explicit `data-theme` on the root. */
export const TOKEN_STYLES = `
  :root {
    color-scheme: light;
    --background: #ffffff;
    --foreground: #09090b;
    --card: #ffffff;
    --muted: #f4f4f5;
    --muted-foreground: #71717a;
    --border: #e4e4e7;
    --accent: #f4f4f5;
    --code-bg: #fafafa;
    --radius: 0.65rem;
    /* Consumed by previewed components that theme off storefront tokens. */
    --color-foreground: var(--foreground);
    --color-background: var(--background);
    --color-accent: #2563eb;
    --color-accent-foreground: #ffffff;
    --color-ring: #2563eb;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --background: #09090b;
      --foreground: #fafafa;
      --card: #0c0c0f;
      --muted: #18181b;
      --muted-foreground: #a1a1aa;
      --border: #27272a;
      --accent: #18181b;
      --code-bg: #0c0c0f;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --background: #09090b;
    --foreground: #fafafa;
    --card: #0c0c0f;
    --muted: #18181b;
    --muted-foreground: #a1a1aa;
    --border: #27272a;
    --accent: #18181b;
    --code-bg: #0c0c0f;
  }
`;

/** The message channel between the shell and its story frames. A frame is a
 * separate document, so height and theme cross by postMessage or not at all. */
export const FRAME_MESSAGE = {
	height: "nazare-preview:height",
	theme: "nazare-preview:theme",
	/** Background, outline, zoom: how the story is shown, not what it is. */
	canvas: "nazare-preview:canvas",
} as const;

/**
 * Grounds a story can be judged against.
 *
 * A component looks right on the ground it was designed for and wrong on the
 * one the merchant actually uses, and a workbench that only ever shows the
 * page's own background hides exactly that. `page` is the theme's background —
 * the default, and the honest one.
 */
export const BACKGROUNDS: { id: string; label: string; css: string }[] = [
	{ id: "page", label: "Page", css: "" },
	{ id: "white", label: "White", css: "#ffffff" },
	{ id: "dark", label: "Dark", css: "#09090b" },
	{ id: "grey", label: "Grey", css: "#f4f4f5" },
	// Alpha in a component's own background reads as opaque against anything
	// flat, so the checkerboard is the one ground that shows transparency.
	{
		id: "checker",
		label: "Transparent",
		css: "repeating-conic-gradient(#e4e4e7 0% 25%, #ffffff 0% 50%) 50% / 16px 16px",
	},
];

/** What a frame applies when the shell tells it how to present the story. */
export const CANVAS_STYLES = `
  body[data-canvas-background] { background: var(--canvas-background); }
  /* Every box, one hairline: the fastest way to see a spacing bug that a
   * screenshot would hide. Outlines do not affect layout, so nothing shifts. */
  body[data-canvas-outline] * { outline: 1px solid rgba(139, 92, 246, .45); }
`;
