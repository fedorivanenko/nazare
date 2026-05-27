---
schemaVersion: 1

id: c-video
title: Video Snippet
status: done

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - snippets/c-video.liquid
    - scripts/snippets/c-video.js

invariants:
  - Component ID is c-video
  - Installs through nazare add c-video
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - JavaScript is limited to video playback controls, thumbnail state, and global mute coordination
  - Renders Shopify-hosted video objects only
  - Registers each initialized instance in a global video store
  - Unmuting one registered video mutes every other registered video
  - Does not mutate theme scaffold source

nonGoals:
  - YouTube, Vimeo, or external iframe video embeds
  - Product media gallery integration
  - Autoplay or scroll-triggered playback
  - Captions, transcripts, or chapter controls
  - Full custom video timeline controls
  - Public JavaScript API beyond the internal global store needed for instance coordination
  - Theme scaffold template placement
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/c-video/**
      - nazare.registry.yml c-video metadata
      - test/ registry component validation for c-video
      - README.md default component notes if needed

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Video Snippet

## Goal

Add an installable Shopify video snippet for theme sections that need hosted video with lightweight custom controls.

The snippet gives sections a reusable video primitive with thumbnail, play/pause, mute/unmute, and cross-instance mute coordination so only one video can be audible at a time.

---

## Scope

Included:

- `components/c-video/c-video.liquid`
- `components/c-video/c-video.js`
- `nazare.registry.yml` component metadata for `c-video`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-video` installs the snippet and script from the local registry
- snippet parameters:
  - `video`: required Shopify-hosted video object
  - `thumbnail`: optional Shopify image object used as poster/overlay thumbnail
  - `thumbnail_alt`: optional thumbnail alt text
  - `class`: optional wrapper classes
  - `id`: optional stable DOM id suffix for analytics/testing hooks

Component metadata:

```yaml
components:
  c-video:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-video/c-video.liquid
        to: snippets/c-video.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
      - from: components/c-video/c-video.js
        to: scripts/snippets/c-video.js
        checksum:
          algorithm: sha256
          value: <sha256>
```

Snippet render contract:

- Root element uses `data-nazare-use="snippets/c-video"` so the existing Nazare runtime loads `scripts/snippets/c-video.js`.
- Root element uses Tailwind utility classes only.
- Video renders with native `<video>` output for Shopify-hosted video media.
- Native browser controls are hidden; snippet renders its own play/pause and mute/unmute buttons.
- Video starts paused and muted by default.
- Thumbnail is visible before first play when `thumbnail` exists; otherwise fallback uses `video.preview_image` when available.
- Thumbnail hides after play starts and returns when playback is paused before meaningful progress only if that behavior does not hide the video frame unexpectedly.
- Button labels and accessible names update with current playback and mute state.
- Missing optional thumbnail values do not render broken image markup.

JavaScript behavior contract:

- `init(root)` registers the instance with `window.NazareVideoStore`.
- `destroy(root)` unregisters the instance and removes event listeners.
- The global store is created once if absent and reused by all snippet instances.
- When an instance becomes unmuted, it calls the store to mute all other registered instances.
- Store operations tolerate removed or disconnected DOM nodes.
- Shopify theme editor section load/unload works through the existing Nazare runtime.

---

## Success behavior

- `nazare list` shows `c-video` as available after registry update.
- `nazare add c-video` installs `snippets/c-video.liquid` and `scripts/snippets/c-video.js`.
- A section can render `{% render 'c-video', video: section.settings.video, thumbnail: section.settings.thumbnail %}`.
- Rendered snippet shows a Shopify-hosted video with thumbnail when available.
- Play/pause button toggles video playback and reflects current state.
- Mute/unmute button toggles video audio and reflects current state.
- Unmuting one `c-video` instance mutes all other registered `c-video` instances on the page.
- Dynamically loaded theme editor sections register new instances and unregister removed instances.
- Component source checksums match registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source files fail registry component tests.
- Missing `video` parameter renders no video markup and does not throw Liquid errors.
- Missing thumbnail falls back to `video.preview_image` when available; otherwise no thumbnail image renders.
- JavaScript initialization failure leaves native video markup visible and logs through the existing Nazare runtime warning path.
- Store registration failure must not prevent basic video playback through direct `<video>` interaction.
- Failure cases must not mutate unrelated user files.

---

## Verification

Result: done.

- [x] component source exists at registry paths
- [x] registry contains `c-video` metadata with Liquid and JavaScript files
- [x] registry checksums match component source bytes
- [x] component metadata validates with component registry parser
- [x] snippet root declares `data-nazare-use="snippets/c-video"`
- [x] snippet uses Tailwind utilities only
- [x] snippet renders no broken media when `video` is missing
- [x] play/pause control toggles playback state
- [x] mute/unmute control toggles muted state
- [x] unmuting one initialized instance mutes other initialized instances
- [x] `destroy(root)` unregisters instances and removes listeners
- [x] `nazare add c-video` smoke installs snippet and script from local registry

---

## Architecture notes

Use the existing Nazare runtime module system instead of inline scripts. The Liquid root should declare `data-nazare-use="snippets/c-video"`, and the registry should install the JavaScript module to `scripts/snippets/c-video.js`.

Keep the global store small and internal:

```js
window.NazareVideoStore = window.NazareVideoStore || {
  instances: new Set(),
  register(instance) {},
  unregister(instance) {},
  muteOthers(activeInstance) {},
};
```

The store coordinates only mute state. Playback state stays local to each instance.

Prefer `WeakMap` or module-local maps for DOM listener cleanup. Do not attach repeated listeners when `init(root)` is called more than once for the same root.

Use Shopify video media output and normal Liquid guards. Do not support external iframe providers in v1.

---

## Open questions

None.
