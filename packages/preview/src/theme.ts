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
} as const;
