---
schemaVersion: 1

id: c-icon-list
title: Icon List Snippet
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - snippets/c-icon-list.liquid

invariants:
  - Component ID is c-icon-list
  - Installs through nazare add c-icon-list
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript
  - Each item has an icon image and an optional label
  - Items without an icon are silently skipped
  - Items without a label render the icon only
  - Optional link wraps icon and label in an anchor
  - icon_size controls max-height of the icon image
  - layout controls whether label appears below (vertical) or beside (horizontal) the icon
  - gap controls spacing between items
  - Does not mutate theme scaffold source

nonGoals:
  - Marquee or auto-scroll behavior — caller wraps in c-carousel for that
  - Inline SVG icons — icons are always image_picker uploads
  - Fixed/hardcoded icons (e.g. checkmark) — caller supplies icon images
  - Section schema — this is a snippet consumed by sections
  - JavaScript behavior
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
    - existing component source files
---

# Icon List Snippet

## Goal

Provide a reusable horizontal list of icon items where each item has an uploaded icon image and an optional text label. Covers three surface patterns from one snippet with different param combinations:

- **Symptom / category icons** (Image 4): large icon above label, vertical layout, wide spacing
- **Trust badges** (Image 5): small icon beside label, horizontal layout, even spacing
- **Press logos** (Image 6): medium logo image, no label, horizontal layout

Replaces `s-press-bar` and `s-trust-bar`, which are deleted.

---

## Scope

- `components/c-icon-list/c-icon-list.liquid`
- `nazare.registry.yml` component metadata for `c-icon-list`

### Snippet parameters

| param | type | default | description |
|-------|------|---------|-------------|
| `blocks` | array | — | Section blocks; each exposes `settings.icon`, `settings.label`, `settings.link`, `settings.alt` |
| `icon_size` | string | `md` | Max-height of icon: `sm` (24px) / `md` (40px) / `lg` (64px) |
| `layout` | string | `horizontal` | `horizontal` — icon beside label; `vertical` — icon above label |
| `gap` | string | `md` | Item spacing: `sm` (gap-6) / `md` (gap-10) / `lg` (gap-16) |
| `class` | string | — | Optional extra classes on the root `<ul>` |

### Block settings (owned by consuming section)

Each block must expose:

| id | type | required |
|----|------|----------|
| `icon` | image_picker | yes — item skipped when blank |
| `label` | text | no |
| `link` | url | no |
| `alt` | text | no — falls back to icon image alt metadata |

### Icon size mapping

| value | max-height class |
|-------|-----------------|
| `sm` | `max-h-6` (24px) |
| `md` | `max-h-10` (40px) |
| `lg` | `max-h-16` (64px) |

### Layout behavior

**horizontal** (`layout: horizontal`):
- Each item is `flex items-center gap-2`
- Icon beside label on the same row

**vertical** (`layout: vertical`):
- Each item is `flex flex-col items-center gap-3 text-center`
- Icon above label

### Component metadata

```yaml
components:
  c-icon-list:
    version: 1.0.0
    type: snippet
    dependencies: []
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
  gap: 'lg'
%}
```

- Root element is a `<ul>` with `flex flex-wrap items-center` and gap class from `gap` param.
- Each item is a `<li>` with layout-specific flex classes.
- Items with blank `icon` are skipped entirely.
- Items with blank `label` render icon only; no empty text node.
- When `link` is set, icon and label are wrapped in `<a href="{{ link }}">`.
- Icon renders as `<img>` with `alt` from block setting, falling back to image metadata alt.
- Unknown or blank `icon_size` falls back to `md`.
- Unknown or blank `layout` falls back to `horizontal`.
- Unknown or blank `gap` falls back to `md`.

---

## Success behavior

- `nazare list` shows `c-icon-list` as available.
- `nazare add c-icon-list` installs `snippets/c-icon-list.liquid` with no transitive deps.
- Items without icon are skipped without Liquid errors.
- Items without label render icon only.
- All three icon sizes render correct `max-h-*` class.
- `layout: vertical` renders icon above label.
- `layout: horizontal` renders icon beside label.
- All three gap values render correct `gap-*` class.
- Optional link wraps item content in an anchor.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails component validation tests.
- Missing component source file fails registry component tests.
- Blank `icon` on every block renders nothing without broken markup.
- Unknown params fall back to safe defaults without Liquid errors.

---

## Verification

Result: planned.

- [ ] component source exists at registry path
- [ ] registry contains `c-icon-list` metadata
- [ ] registry checksum matches component source bytes
- [ ] items without icon are skipped
- [ ] items without label render icon only
- [ ] all three icon sizes render correct class
- [ ] layout: vertical renders icon above label
- [ ] layout: horizontal renders icon beside label
- [ ] all three gap values render correct class
- [ ] link wraps item content in anchor
- [ ] unknown params fall back to defaults
- [ ] snippet uses Tailwind utilities only

---

## Architecture notes

Icon image is rendered with `width: auto` and the max-height inline style so aspect ratios are preserved regardless of the icon's natural dimensions. This handles both square icons and wide logos from the same snippet.

For marquee behavior (press logo row scrolling), the consuming section captures the items from `c-icon-list`... actually: since `c-icon-list` renders the full `<ul>`, it cannot be used directly inside `c-carousel`. Sections that need marquee should iterate blocks directly, wrap each in `data-c-carousel-item`, and pass to `c-carousel`. `c-icon-list` is for static layouts only.

---

## Open questions

None.
