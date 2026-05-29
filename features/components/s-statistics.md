---
schemaVersion: 1

id: s-statistics
title: Statistics Section
status: implemented

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-stat

surfaces:
  storefront:
    - sections/s-statistics.liquid

invariants:
  - Component ID is s-statistics
  - Installs through nazare add s-statistics
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript
  - Renders nothing when no stat blocks are added
  - Each stat block renders via c-stat
  - Heading renders only when the setting is non-empty
  - Footnote renders only when the setting is non-empty
  - Does not mutate theme scaffold source

nonGoals:
  - Animated count-up on scroll
  - Chart or graph visualizations
  - JavaScript behavior
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/s-statistics/**
      - nazare.registry.yml s-statistics metadata
      - test/ registry component validation for s-statistics

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Statistics Section

## Goal

Add an installable Shopify section that presents a set of statistics — each with a category label, a large numeric value, and a supporting description — beneath a centered heading and above an optional footnote.

The section gives merchants a social proof or outcome data placement for landing and product pages. Each stat is delegated to `c-stat`; the section owns the grid layout, heading, and footnote.

---

## Scope

Included:

- `components/s-statistics/s-statistics.liquid`
- `nazare.registry.yml` component metadata for `s-statistics`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add s-statistics` installs the section from the local registry
- configurable section settings:
  - optional heading text (plain text)
  - heading alignment: `left`, `center`, or `right`, default `center`
  - optional footnote text (plain text; renders centered below the stat grid in small type)
- section blocks (type: `stat`):
  - label (optional) — category label forwarded to `c-stat`
  - value (required) — primary statistic forwarded to `c-stat`
  - description (optional) — supporting text forwarded to `c-stat`

Layout contract:

- Section uses `page-width` container for horizontal padding.
- Heading renders above the stat grid, aligned per the alignment setting.
- Stat grid is a responsive column layout: 4 columns on desktop, 2 on tablet, 1 on mobile.
- Each stat block renders via `{% render 'c-stat', label: ..., value: ..., description: ... %}`.
- Footnote renders centered below the stat grid in small muted type when non-empty.
- Section renders nothing when zero stat blocks are present.

Component metadata:

```yaml
components:
  s-statistics:
    version: 1.0.0
    type: section
    dependencies:
      - c-stat
    files:
      - from: components/s-statistics/s-statistics.liquid
        to: sections/s-statistics.liquid
        checksum:
          algorithm: sha256
          value: ""
```

---

## Success behavior

- `nazare list` shows `s-statistics` as available after registry update.
- `nazare add s-statistics` installs `sections/s-statistics.liquid` and transitively installs `c-stat`.
- Zero stat blocks renders nothing.
- Heading renders above the grid when non-empty; absent otherwise.
- Each stat block renders label, value, and description via `c-stat`.
- Stats are arranged in a responsive column grid.
- Footnote renders in small centered type below the grid when non-empty; absent otherwise.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Stat block with blank value renders nothing for that item via `c-stat` invariant.
- Missing `c-stat` dependency does not crash section render — registry resolves transitively.

---

## Verification

- [x] component source exists at registry path
- [x] registry contains `s-statistics` metadata with c-stat dependency
- [x] registry checksum matches component source bytes
- [x] component metadata validates with component registry parser
- [x] zero blocks renders nothing
- [x] heading renders when non-empty, absent otherwise
- [x] each stat block renders via c-stat with correct label, value, description
- [x] stat grid is 4 columns on desktop, 2 on tablet, 1 on mobile
- [x] footnote renders in small centered type when non-empty, absent otherwise
- [x] section uses Tailwind utilities only
- [x] `nazare add s-statistics` smoke installs section and c-stat

---

## Architecture notes

The section is a thin grid wrapper. All typographic hierarchy within each stat lives in `c-stat`; the section only controls column count and spacing. This means `c-stat` can be reused in other layouts (e.g. a two-column proof section, a sidebar stat block) without inheriting the grid.

Stat block count drives the visual density. The 4-column desktop layout matches the design; merchants adding fewer blocks get a less dense grid, which is acceptable — column count is fixed at 4 regardless of block count.

---

## Open questions

- Should the grid column count adapt to the number of blocks (e.g. 3 blocks → 3-column grid) or always stay at 4 columns with empty cells when fewer blocks are added?
- Should the footnote support rich text for links or italic legal text?
