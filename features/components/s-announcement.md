---
schemaVersion: 1

id: s-announcement
title: Announcement Section
status: done

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - sections/s-announcement.liquid

invariants:
  - Component ID is s-announcement
  - Installs through nazare add s-announcement
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for styling
  - Does not require JavaScript
  - Does not mutate theme scaffold source

nonGoals:
  - Dismissible announcement state
  - Countdown timers
  - Multi-message rotation
  - Header integration
  - Theme scaffold template placement

codebaseOwnership:
  owns:
    repo:
      - components/s-announcement/**
      - nazare.registry.yml s-announcement metadata
      - test/ registry component validation for s-announcement
      - README.md default component notes if needed

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Announcement Section

## Goal

Add first real registry component: a Shopify announcement bar section that merchants can install with `nazare add s-announcement`.

The section gives the registry a concrete component for `nazare list` and `nazare add` smoke usage.

---

## Scope

Included:

- `components/s-announcement/sections/s-announcement.liquid`
- `nazare.registry.yml` component metadata for `s-announcement`
- checksum validation coverage for committed component source files
- simple configurable section settings:
  - announcement text
  - optional link URL
  - optional link label

Component metadata:

```yaml
components:
  s-announcement:
    version: 1.0.0
    type: section
    dependencies: []
    files:
      - from: components/s-announcement/sections/s-announcement.liquid
        to: sections/s-announcement.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

---

## Success behavior

- `nazare list` shows `s-announcement` as available after registry update.
- `nazare add s-announcement` installs `sections/s-announcement.liquid`.
- Installed section renders announcement text from Shopify settings.
- Optional link renders only when both URL and label exist.
- Section uses Tailwind utility classes only.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Section must not depend on JavaScript, snippets, or scaffold changes beyond existing `section-css` render pattern.

---

## Verification

Result: done.

- [x] component source exists at registry path
- [x] registry contains `s-announcement` metadata
- [x] registry checksum matches component source bytes
- [x] component metadata validates with component registry parser
- [x] section schema contains text, link URL, and link label settings
- [x] section uses Tailwind utilities
- [x] `nazare add s-announcement` smoke installs section from local registry

---

## Architecture notes

Keep this component self-contained. No JavaScript asset, no snippets, no template changes.

Use the existing section CSS render convention from scaffold sections:

```liquid
{% render 'section-css', section_name: 's-announcement' %}
```

---

## Open questions

None.
