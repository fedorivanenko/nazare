---
schemaVersion: 1

id: c-icon-list
title: Icon List Snippet
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-icon
  - c-carousel

surfaces:
  storefront:
    - snippets/c-icon-list.liquid

invariants:
  - Component ID is c-icon-list
  - Installs through nazare add c-icon-list
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - JavaScript behavior is delegated entirely to c-carousel
  - Accepts blocks, carousel params, icon_size, layout, gap, and aria_label
  - Iterates blocks internally; skips blocks with no icon set
  - Each valid block is rendered via c-icon wrapped in data-c-carousel-item
  - Delegates carousel and scrolling to c-carousel
  - Default mode is static
  - Empty state placeholder renders only in design mode
  - Does not render heading, description, or CTA — caller owns those
  - Does not mutate theme scaffold source

nonGoals:
  - Heading, description, or CTA settings
  - Section schema — this is a snippet consumed by sections
  - Custom CSS files
  - Theme scaffold template placement

codebaseOwnership:
  owns:
    repo:
      - components/c-icon-list/**
      - nazare.registry.yml c-icon-list metadata

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - components/c-icon/**
    - components/c-carousel/**
---

# Icon List Snippet

## Goal

Render a horizontal list of icon items through `c-carousel`, covering three surface patterns from one snippet:

- **Symptom / category icons**: large icon above label, static layout
- **Trust badges**: small icon beside label, static layout
- **Press logos**: logo image only, marquee layout

Each item is rendered via `c-icon`. The list is always routed through `c-carousel` so static and marquee behavior come from the same code path.

Replaces `s-press-bar` and `s-trust-bar`, which are deleted.

---

## Scope

- `components/c-icon-list/c-icon-list.liquid`
- `nazare.registry.yml` component metadata for `c-icon-list`

### Snippet parameters

| param | type | default | description |
|-------|------|---------|-------------|
| `blocks` | array | — | Section blocks; each exposes `settings.icon`, `settings.label`, `settings.link`, `settings.alt` |
| `icon_size` | string | `md` | Forwarded to `c-icon`: `sm` (24px) / `md` (40px) / `lg` (64px) |
| `layout` | string | `horizontal` | Forwarded to `c-icon`: `horizontal` / `vertical` |
| `gap` | string | `md` | Carousel item gap: `sm` / `md` / `lg` |
| `mode` | string | `static` | `static` (drag to scroll) / `marquee` (auto-scroll) |
| `direction` | string | `left` | Marquee direction: `left` / `right` |
| `speed` | string | `normal` | Marquee speed: `slow` / `normal` / `fast` |
| `pause_on_hover` | boolean | `true` | Pause marquee on hover |
| `aria_label` | string | — | Accessible label forwarded to `c-carousel` |

### Block settings (owned by consuming section)

| id | type | required |
|----|------|----------|
| `icon` | image_picker | yes — item skipped when blank |
| `label` | text | no |
| `link` | url | no |
| `alt` | text | no — falls back to icon image alt metadata |

### Component metadata

```yaml
components:
  c-icon-list:
    version: 1.0.0
    type: snippet
    dependencies:
      - c-icon
      - c-carousel
    files:
      - from: components/c-icon-list/c-icon-list.liquid
        to: snippets/c-icon-list.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

### Render contract

```liquid
{% render 'c-icon-list',
  blocks: section.blocks,
  icon_size: 'lg',
  layout: 'vertical',
  gap: 'lg',
  mode: 'static'
%}
```

- Iterates `blocks`; skips any block with blank `icon`.
- Each valid block captured as `data-c-carousel-item` wrapping `{% render 'c-icon', ... %}`.
- Captured items passed to `{% render 'c-carousel', ... %}`.
- When no valid blocks exist and `request.design_mode` is true, renders a dashed placeholder.
- When no valid blocks exist outside design mode, renders nothing.
- `icon_size` and `layout` forwarded verbatim to each `c-icon` call.
- `gap`, `mode`, `direction`, `speed`, `pause_on_hover`, `aria_label` forwarded to `c-carousel`.

---

## Success behavior

- `nazare add c-icon-list` installs `snippets/c-icon-list.liquid` and transitively installs `c-icon`, `c-carousel`, and `c-drag-scroll`.
- Blocks without icon are skipped without Liquid errors.
- Carousel renders when at least one icon block is present.
- Empty state placeholder renders in design mode only.
- `icon_size` and `layout` pass correctly to each `c-icon`.
- `mode: marquee` auto-scrolls; `mode: static` allows drag scroll.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails component validation tests.
- Missing component source file fails registry component tests.
- All blocks having no icon renders nothing outside design mode.
- Unknown `mode` falls back to `static` (delegated to c-carousel).
- Unknown `icon_size` or `layout` fall back to defaults (delegated to c-icon).

---

## Verification

Result: planned.

- [ ] component source exists at registry path
- [ ] registry contains `c-icon-list` metadata with c-icon and c-carousel deps
- [ ] registry checksum matches component source bytes
- [ ] blocks without icon are skipped
- [ ] each valid block rendered via c-icon inside data-c-carousel-item
- [ ] carousel renders when icon blocks are present
- [ ] empty state renders in design mode only
- [ ] icon_size forwarded to c-icon
- [ ] layout forwarded to c-icon
- [ ] mode: marquee auto-scrolls
- [ ] snippet uses Tailwind utilities only

---

## Architecture notes

Same pattern as `c-video` / `c-video-gallery`. `c-icon` is the atomic item primitive; `c-icon-list` is the block iterator that routes through `c-carousel`.

Routing everything through `c-carousel` — even static mode — keeps one code path for both static drag-scroll and marquee. Static mode of `c-carousel` is a horizontally scrollable ribbon with pointer drag; this handles the press logo row without a separate marquee toggle.

---

## Open questions

None.
