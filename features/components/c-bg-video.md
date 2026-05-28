---
schemaVersion: 1

id: c-bg-video
title: Background Video Snippet
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - snippets/c-bg-video.liquid
    - scripts/snippets/c-bg-video.js

invariants:
  - Component ID is c-bg-video
  - Installs through nazare add c-bg-video
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Video always plays muted with no user-facing audio controls
  - Video always loops
  - Video never autoplays when prefers-reduced-motion is reduce; poster shows instead
  - Video pauses when the root element is not intersecting the viewport
  - Video resumes when the root element re-enters the viewport unless reduced-motion is active
  - Renders Shopify-hosted video objects only
  - Does not render user-facing play, pause, or mute controls
  - Does not mutate theme scaffold source

nonGoals:
  - User-facing playback or mute controls
  - Cross-instance mute coordination (no global store)
  - YouTube, Vimeo, or external iframe video embeds
  - Sound or unmuted playback
  - Captions or transcripts
  - Scroll-triggered playback beyond basic intersection pause/resume
  - Public JavaScript API beyond init and destroy
  - Theme scaffold template placement
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/c-bg-video/**
      - nazare.registry.yml c-bg-video metadata
      - test/ registry component validation for c-bg-video
  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Background Video Snippet

## Goal

Add an installable Shopify snippet for sections that need a decorative, full-bleed background video.

The snippet handles the ambient video contract — always muted, always looping, paused when the user prefers reduced motion, and paused when the element is off-screen. It frees the section author from writing inline motion-preference and intersection logic for every background.

---

## Scope

Included:

- `components/c-bg-video/c-bg-video.liquid`
- `components/c-bg-video/c-bg-video.js`
- `nazare.registry.yml` component metadata for `c-bg-video`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-bg-video` installs the snippet and script from the local registry
- snippet parameters:
  - `video`: required Shopify-hosted video object
  - `poster`: optional Shopify image shown when reduced-motion is active or video fails; falls back to `video.preview_image`
  - `poster_alt`: optional alt text for the poster image; defaults to empty string (decorative)
  - `overlay`: optional named overlay intensity — `'light'`, `'medium'`, or `'dark'`; omit for no overlay
  - `content`: optional captured Liquid markup rendered in a stacking layer above the video and overlay
  - `class`: optional additional classes on the root element
  - `id`: optional stable DOM id suffix for analytics or testing hooks

Component metadata:

```yaml
components:
  c-bg-video:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-bg-video/c-bg-video.liquid
        to: snippets/c-bg-video.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
      - from: components/c-bg-video/c-bg-video.js
        to: scripts/snippets/c-bg-video.js
        checksum:
          algorithm: sha256
          value: <sha256>
```

Snippet render contract:

- Root element is `relative overflow-hidden` and fills its containing block; caller controls height.
- Root element uses `data-nazare-use="snippets/c-bg-video"` so the Nazare runtime loads `scripts/snippets/c-bg-video.js`.
- `<video>` is rendered absolute, covers the root (`inset-0 w-full h-full object-cover`), muted, looped, with native controls hidden.
- When `overlay` is set, an absolute `<div>` sits between the video and content: `light` → `bg-black/20`, `medium` → `bg-black/40`, `dark` → `bg-black/60`.
- When `content` is provided, it renders in an absolute layer above both the video and overlay (`inset-0 relative z-10`).
- When no `video` is provided the snippet renders nothing.
- Poster image renders as a sibling `<img>` hidden by default (`hidden`); JavaScript shows it when reduced-motion is active.

Render contract example:

```liquid
{% capture hero_content %}
  <div class="flex h-full items-center justify-center px-6">
    <h2 class="text-4xl font-bold text-white">{{ section.settings.heading }}</h2>
  </div>
{% endcapture %}

{% render 'c-bg-video',
  video: section.settings.video,
  poster: section.settings.poster,
  overlay: 'medium',
  content: hero_content
%}
```

JavaScript behavior contract:

- `init(root)` is idempotent; re-calling it on the same root is a no-op.
- On init: reads `prefers-reduced-motion: reduce` via `window.matchMedia`.
  - If reduced-motion is active: pauses the video, shows the poster element.
  - If not: attempts `video.play()` and hides the poster element.
- Registers a `matchMedia` change listener to respond when the user changes their motion preference at runtime without a page reload.
- Creates an `IntersectionObserver` with a `0.1` threshold.
  - When the root enters the viewport and reduced-motion is not active: calls `video.play()`.
  - When the root leaves the viewport: calls `video.pause()`.
- `destroy(root)` disconnects the `IntersectionObserver`, removes the `matchMedia` listener, and clears the instance from the module-level mount map.

---

## Success behavior

- `nazare list` shows `c-bg-video` as available after registry update.
- `nazare add c-bg-video` installs `snippets/c-bg-video.liquid` and `scripts/snippets/c-bg-video.js`.
- A section renders `{% render 'c-bg-video', video: section.settings.video %}` without Liquid errors.
- Rendered snippet shows a muted, looping background video that covers its container.
- Video pauses automatically when scrolled out of view and resumes when scrolled back in.
- When `prefers-reduced-motion: reduce` is set, the video does not play and the poster image is visible.
- When `overlay` is set, the chosen overlay renders between the video and content.
- When `content` is provided, the caller markup renders in front of the video and overlay.
- Missing optional parameters do not render broken markup.
- Dynamically loaded theme editor sections initialize and destroy correctly.
- Component source checksums match registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation tests.
- Missing component source files fail registry component tests.
- Missing `video` parameter renders no video markup and does not throw Liquid errors.
- Missing `poster` falls back to `video.preview_image`; if both are absent no broken `<img>` renders.
- `video.play()` rejection (e.g. autoplay policy) is caught silently; the video element remains visible and the poster is not shown as an error state.
- JavaScript initialization failure leaves the video markup visible with native browser fallback behavior.
- Failure cases must not mutate unrelated user files.

---

## Verification

- [ ] component source exists at registry paths
- [ ] registry contains `c-bg-video` metadata with Liquid and JavaScript files
- [ ] registry checksums match component source bytes
- [ ] component metadata validates with component registry parser
- [ ] snippet root declares `data-nazare-use="snippets/c-bg-video"`
- [ ] snippet uses Tailwind utilities only
- [ ] snippet renders nothing when `video` is missing
- [ ] video element renders muted, looped, without native controls
- [ ] poster element renders and is hidden by default when a poster source exists
- [ ] overlay `light`, `medium`, `dark` each render the correct Tailwind class
- [ ] content renders in a layer above video and overlay when provided
- [ ] JavaScript pauses video and shows poster when `prefers-reduced-motion: reduce`
- [ ] JavaScript plays/pauses via IntersectionObserver on scroll in/out
- [ ] `matchMedia` change listener updates playback state without a page reload
- [ ] `destroy(root)` disconnects observer and removes listeners
- [ ] `nazare add c-bg-video` smoke installs snippet and script from local registry

---

## Architecture notes

Use the existing Nazare runtime module system. Root declares `data-nazare-use="snippets/c-bg-video"` and the registry installs the JavaScript module to `scripts/snippets/c-bg-video.js`.

No global store: each instance is fully self-contained. All state lives in the module-level `WeakMap<root, instance>`.

Handle `play()` rejection defensively — browsers may block autoplay even when muted in some contexts:

```js
video.play().catch(() => {});
```

Keep the IntersectionObserver threshold low (`0.1`) so the video resumes as soon as any part of the root enters the viewport, avoiding a noticeable black frame on scroll.

The poster element must be a real `<img>` in the DOM, not a CSS background, so the browser can decode and cache it before the video loads. Toggle visibility via Tailwind `hidden` rather than `display` style manipulation.

`c-bg-video` is intentionally not coupled to `c-video`. The two components share no runtime state and serve different interaction models: `c-video` is interactive and coordinated; `c-bg-video` is ambient and self-contained.

---

## Open questions

None.
