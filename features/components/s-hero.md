---
schemaVersion: 1

id: s-hero
title: Hero Section
status: done

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-bg-video
  - c-button
  - s-announcement

surfaces:
  storefront:
    - sections/s-hero.liquid

invariants:
  - Component ID is s-hero
  - Installs through nazare add s-hero
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - JavaScript is provided through the c-bg-video dependency, not the section itself
  - Optional CTA renders only when both URL and label exist
  - Background video uses c-bg-video snippet
  - Background image is used as video poster when a video is set, and as a static background when no video is set
  - Does not mutate theme scaffold source

nonGoals:
  - Slideshow or carousel behavior
  - Multiple image art direction sources
  - Header integration
  - Theme scaffold template placement
  - JavaScript animations
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/s-hero/**
      - nazare.registry.yml s-hero metadata
      - test/ registry component validation for s-hero

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Hero Section

## Goal

Add an installable Shopify hero section for first-screen storefront messaging.

The section gives merchants a flexible landing-page hero with heading, text, optional background video or image, and optional CTA. Video backgrounds are delegated to `c-bg-video`, keeping the section Liquid-only while still supporting ambient autoplay and reduced-motion behavior.

---

## Scope

Included:

- `components/s-hero/s-hero.liquid`
- `nazare.registry.yml` component metadata for `s-hero`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add s-hero` installs the section from the local registry
- configurable section settings:
  - optional background video (Shopify-hosted)
  - optional background image (used as video poster when video is set; static background otherwise)
  - optional image alt text
  - overlay intensity: none, light, medium, dark
  - eyebrow text
  - heading
  - body text (rich text)
  - optional CTA URL
  - optional CTA label
  - optional CTA button style: solid, outline, ghost
  - content alignment: left, center
  - text color: light text (for dark backgrounds), dark text (for light backgrounds)

Component metadata:

```yaml
components:
  s-hero:
    version: 1.1.0
    type: section
    dependencies:
      - c-bg-video
      - c-button
    files:
      - from: components/s-hero/s-hero.liquid
        to: sections/s-hero.liquid
        checksum:
          algorithm: sha256
          value: 18e178c3bfeb70ae28b855014ebf15808b718f14ce9de5616b5c3d45d1ccdafa
```

Section render contract:

- Root is a plain `<section>` element.
- When a video is set, the section renders `{% render 'c-bg-video', video: ..., poster: ..., overlay: ..., content: hero_inner %}` with `min-h-[70dvh]` on the c-bg-video root.
- When no video is set but an image is set, the section renders the image absolutely positioned behind the content, with the overlay applied manually.
- Hero content (eyebrow, heading, body, CTA) is captured once via `{% capture hero_inner %}` and reused in both the video and non-video branches.
- Content is vertically centered within a `min-h-[70dvh]` flex container.
- Text width is constrained by `page-width`.
- CTA renders using `{% render 'c-button', ... %}` and only when both `cta_url` and `cta_label` are present.
- Empty eyebrow/body values render nothing.
- Image alt text uses explicit setting when present and falls back to image alt metadata.

---

## Success behavior

- `nazare list` shows `s-hero` as available after registry update.
- `nazare add s-hero` installs `sections/s-hero.liquid` and transitively installs `c-bg-video` and `c-button`.
- Section renders default hero content without merchant setup.
- Section schema exposes video, image, image alt, overlay, eyebrow, heading, body, CTA URL, CTA label, CTA style, alignment, and text color settings.
- When a video is set, c-bg-video renders as the background with reduced-motion and intersection pause/resume behavior.
- Background image is passed as poster to c-bg-video when video is also set.
- When no video is set but an image is set, the image renders as a static full-bleed background.
- Overlay applies in both video and image cases when set.
- CTA renders only when both URL and label exist.
- Content alignment and text color settings affect rendered output.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Empty video setting falls back to image-or-plain rendering without Liquid errors.
- Empty image setting renders no background without broken `<img>` markup.
- Empty optional settings render nothing without broken links or placeholder content.
- Missing c-bg-video or c-button dependency does not crash install — registry resolves dependencies first.

---

## Verification

Result: done.

- [x] component source exists at registry path
- [x] registry contains `s-hero` metadata with c-bg-video and c-button dependencies
- [x] registry checksum matches component source bytes
- [x] component metadata validates with component registry parser
- [x] section schema contains video, image, image alt, overlay, eyebrow, heading, body, CTA URL, CTA label, CTA style, alignment, and text color settings
- [x] section uses Tailwind utilities only
- [x] CTA render is gated by URL and label
- [x] video case renders c-bg-video with image as poster and overlay forwarded
- [x] non-video image case renders absolute background image with overlay
- [x] hero_inner content captured once and shared across both branches
- [x] `nazare add s-hero` smoke installs section from local registry

---

## Architecture notes

Hero content (eyebrow, heading, body, CTA) is captured once with `{% capture hero_inner %}` and passed into `c-bg-video`'s `content` parameter for the video case, or rendered directly in the non-video branch. This avoids duplicating the content markup for two code paths.

The section is Liquid-only — no JavaScript file. Ambient video behavior (autoplay, reduced-motion pause, off-screen pause) lives entirely in `c-bg-video.js`, which the Nazare runtime loads automatically via `data-nazare-use`.

Overlay is resolved in the Liquid layer so both c-bg-video (video case) and the manual image case share the same named values (`none` / `light` / `medium` / `dark`).

---

## Open questions

None.
