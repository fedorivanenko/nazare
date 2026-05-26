---
schemaVersion: 1

id: theme-design-tokens
title: Theme Design Tokens
status: done

dependencies:
  - theme-build-pipeline
  - theme-scaffold

surfaces:
  storefront:
    - Theme CSS custom properties
    - Tailwind semantic utility names

invariants:
  - Tokens are semantic, not component-specific
  - Tokens live in theme/default/styles/base.css
  - Tailwind utilities consume tokens through Tailwind v4 @theme mappings
  - Default token values are neutral and storefront-safe
  - Components use semantic utilities instead of hard-coded palette values when practical
  - Token additions do not require JavaScript
  - Token additions do not change CLI command behavior

nonGoals:
  - Full design system implementation
  - Merchant theme editor controls for tokens
  - Dark mode switching behavior
  - Per-component custom CSS files
  - Typography scale beyond minimal font/color/radius primitives
  - Figma import or token sync automation
  - Breaking existing component markup

codebaseOwnership:
  owns:
    repo:
      - theme/default/styles/base.css
      - nazare.registry.yml theme/default/styles/base.css checksum
      - test/theme-build-pipeline.test.js token coverage
      - biome.json Tailwind CSS parser support
      - docs/backlog.md follow-up token notes if needed

  mustNotModify:
    - bin/nazare.js command behavior
    - install metadata
    - theme/default/sections/** markup unless required by token verification
    - existing component source files
    - generated build outputs
---

# Theme Design Tokens

## Goal

Add a small semantic token layer to the default theme scaffold so registry components can share one visual language.

The token model should feel like shadcn-style CSS variables: CSS custom properties define semantic values, Tailwind v4 `@theme` exposes matching utility names, and Liquid components use those semantic utilities instead of raw palette classes.

---

## Scope

Included:

- CSS custom properties in `theme/default/styles/base.css`
- Tailwind v4 `@theme` mappings for semantic utilities
- registry checksum update for `theme/default/styles/base.css`
- Biome CSS parser support for Tailwind directives
- tests that verify token mappings exist in scaffold CSS
- guidance for future components to prefer semantic utilities

Initial v1 token set:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
}
```

Tailwind v4 mapping:

```css
@theme {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
```

Example component usage:

```liquid
<section class="bg-background text-foreground">
  <a class="rounded-md bg-primary text-primary-foreground ring-ring">
    {{ section.settings.cta_label }}
  </a>
</section>
```

---

## Success behavior

- Pulled default theme includes semantic CSS variables in `styles/base.css`.
- Tailwind can generate utilities such as `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`, `ring-ring`, `rounded-md`, and `rounded-lg`.
- Existing scaffold still builds with the Tailwind/Vite pipeline.
- Registry manifest checksum for `theme/default/styles/base.css` matches source bytes.
- Future component feature docs can reference semantic token utilities as default styling vocabulary.

---

## Failure behavior

- Missing or invalid `@theme` mappings fail scaffold tests.
- Registry checksum mismatch fails existing theme pull/update validation.
- Token feature must not require CLI changes or JavaScript runtime behavior.
- Token feature must not remove existing Tailwind `@source` directives.

---

## Verification

Result: done.

- [x] `theme/default/styles/base.css` contains v1 `:root` token values
- [x] `theme/default/styles/base.css` contains Tailwind v4 `@theme` semantic mappings
- [x] existing Tailwind `@source` directives remain present
- [x] registry checksum for `theme/default/styles/base.css` matches source bytes
- [x] tests assert key semantic utilities are exposed through `@theme`
- [x] Biome config allows Tailwind-specific CSS directives
- [x] `npm test` passes
- [x] `biome check theme/default/styles/base.css nazare.registry.yml test/theme-build-pipeline.test.js biome.json` passes

---

## Architecture notes

Place tokens after `@import "tailwindcss";` and before or after `@source` directives only if Tailwind v4 accepts the ordering. Keep existing source scanning intact.

Use semantic names from shadcn as inspiration, but keep the set smaller and storefront-neutral. Prefer OKLCH values for modern color control and better future theming.

Do not add `.dark` or data-theme overrides in v1. Dark/light component variants should use local Liquid class branches until a real theme-mode feature exists.

Component implementation should prefer semantic utilities for base surfaces and actions. Raw Tailwind palette values remain allowed for rare decorative details where no semantic token exists.

---

## Open questions

None.
