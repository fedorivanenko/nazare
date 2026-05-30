---
schemaVersion: 1

id: c-icon
title: Icon Snippet
status: done

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - snippets/c-icon.liquid

invariants:
  - Component ID is c-icon
  - Installs through nazare add c-icon
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript
  - Renders a single icon image with optional label and optional link
  - Renders nothing when icon is blank
  - Label is omitted entirely when blank — no empty element
  - Optional link wraps icon and label in an anchor
  - icon_size controls max-height of the icon image
  - layout controls whether label appears below (vertical) or beside (horizontal) the icon
  - Does not mutate theme scaffold source

nonGoals:
  - Inline SVG icons — icon is always an image
  - Fixed hardcoded icons
  - List layout — caller iterates and positions items
  - JavaScript behavior
  - Custom CSS files
  - Theme scaffold template placement

codebaseOwnership:
  owns:
    repo:
      - components/c-icon/**
      - nazare.registry.yml c-icon metadata

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Icon Snippet

## Goal

Atomic icon+label primitive. Renders one icon image with an optional text label and an optional wrapping link. `c-icon-list` iterates blocks and calls this snippet for each item.

---

## Scope

- `components/c-icon/c-icon.liquid`
- `nazare.registry.yml` component metadata for `c-icon`

### Snippet parameters

| param | type | default | description |
|-------|------|---------|-------------|
| `icon` | image object | — | Shopify image; renders nothing when blank |
| `label` | string | — | Optional text label |
| `link` | string | — | Optional URL; wraps icon+label in `<a>` |
| `alt` | string | — | Alt text; falls back to `icon.alt` |
| `icon_size` | string | `md` | `sm` (24px) / `md` (40px) / `lg` (64px) |
| `layout` | string | `horizontal` | `horizontal` — icon beside label; `vertical` — icon above label |
| `class` | string | — | Extra classes on the root element |

### Icon size mapping

| value | style |
|-------|-------|
| `sm` | `max-height: 24px` |
| `md` | `max-height: 40px` |
| `lg` | `max-height: 64px` |

Height is applied via inline style so aspect ratio is preserved across square icons and wide logos.

### Layout behavior

**horizontal**: root is `flex items-center gap-2` — icon beside label.

**vertical**: root is `flex flex-col items-center gap-3 text-center` — icon above label.

### Component metadata

```yaml
components:
  c-icon:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-icon/c-icon.liquid
        to: snippets/c-icon.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

### Render contract

```liquid
{% render 'c-icon',
  icon: block.settings.icon,
  label: block.settings.label,
  link: block.settings.link,
  alt: block.settings.alt,
  icon_size: 'lg',
  layout: 'vertical'
%}
```

- Renders nothing when `icon` is blank.
- Label element omitted when `label` is blank.
- `link` wraps the entire rendered content in `<a href="{{ link }}">`.
- Unknown or blank `icon_size` falls back to `md`.
- Unknown or blank `layout` falls back to `horizontal`.
- Optional `class` appended to the root element.

---

## Success behavior

- `nazare add c-icon` installs `snippets/c-icon.liquid` with no transitive deps.
- Blank `icon` renders nothing.
- Blank `label` renders icon only with no empty element.
- All three sizes apply correct max-height.
- `layout: vertical` stacks icon above label.
- `layout: horizontal` places icon beside label.
- Link wraps icon and label in an anchor.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails component validation tests.
- Missing component source file fails registry component tests.
- All blank inputs render nothing without broken markup.

---

## Verification

Result: planned.

- [x] component source exists at registry path
- [x] registry contains `c-icon` metadata
- [x] registry checksum matches component source bytes
- [x] blank icon renders nothing
- [x] blank label renders no empty element
- [x] all three sizes apply correct max-height
- [x] layout: vertical stacks icon above label
- [x] layout: horizontal places icon beside label
- [x] link wraps content in anchor
- [x] snippet uses Tailwind utilities only

---

## Open questions

None.
