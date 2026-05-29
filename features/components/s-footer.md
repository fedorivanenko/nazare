---
schemaVersion: 1

id: s-footer
title: Footer Section
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-email-signup-klaviyo

surfaces:
  storefront:
    - sections/s-footer.liquid

invariants:
  - Component ID is s-footer
  - Installs through nazare add s-footer
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript beyond what the email signup provider provides
  - Brand tagline is always rendered
  - Nav columns and email signup zone are each optional
  - Nav column renders only when its linked menu has at least one link
  - Email signup zone renders only when the email provider setting is configured
  - Does not mutate theme scaffold source
  - Section source includes nazare:layout footer directive so the Vite plugin injects it into layout/theme.liquid automatically

nonGoals:
  - Image gallery (use s-image-gallery above the footer)
  - Cookie consent bar
  - Back-to-top button
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/s-footer/**
      - nazare.registry.yml s-footer metadata
      - test/ registry component validation for s-footer

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Footer Section

## Goal

Add an installable Shopify section for the site footer — navigation link columns, email newsletter signup, and a full-width brand tagline.

The section covers everything below the image gallery: nav menus, email capture (provider-configurable via the `c-email-signup-*` pattern), and the oversized brand tagline at the bottom. The image gallery and social bar above are separate sections.

---

## Scope

Included:

- `components/s-footer/s-footer.liquid`
- `nazare.registry.yml` component metadata for `s-footer`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add s-footer` installs the section from the local registry
- configurable section settings:
  - brand tagline image (image_picker; optional)
  - email provider: `klaviyo` or `none`, default `none`
  - Klaviyo list ID (active when provider is `klaviyo`)
  - email zone heading (optional)
  - email zone description (optional)
  - email input placeholder, default `Email Address`
  - email button label, default `Sign Up`
- navigation menu: single `link_list` setting (`nav_menu`); top-level links become column headings, their child links become the column items

Layout contract:

- Section is divided into two horizontal zones stacked vertically.
- **Main zone**: left side holds nav columns derived from the `nav_menu` linklist; right side holds email signup zone (heading, description, `c-email-signup-*` form) when email provider is configured.
- **Tagline zone**: full-width, oversized display text spanning the section width at the bottom. Font size scales to fill the full width.
- Nav columns are parsed from `linklists[nav_menu].links`: each top-level link title is a column heading; its `link.links` are the items listed below it.
- A column is absent when its top-level link has no children.
- Email signup renders via the appropriate provider snippet (`c-email-signup-klaviyo` when provider is `klaviyo`).
- Email zone is absent when provider is `none`.
- `c-social-links` is not rendered in the footer itself — social links belong to the `s-social-gallery` section above. Social link settings are present for themes that use the footer without `s-social-gallery`.

Layout injection:

`s-footer.liquid` includes `{% comment %}nazare:layout footer{% endcomment %}` before its first rendered output. The Nazare Vite plugin reads this directive and injects `{% section 's-footer' %}` into the generated `layout/theme.liquid` at the footer position. No manual edits to `layout/theme.liquid` are needed after `nazare add s-footer`.

Component metadata:

```yaml
components:
  s-footer:
    version: 1.0.0
    type: section
    dependencies:
      - c-email-signup-klaviyo
      - c-social-links
    files:
      - from: components/s-footer/s-footer.liquid
        to: sections/s-footer.liquid
        checksum:
          algorithm: sha256
          value: ""
```

---

## Success behavior

- `nazare list` shows `s-footer` as available after registry update.
- `nazare add s-footer` installs `sections/s-footer.liquid` and transitively installs `c-email-signup-klaviyo`, `c-email-signup`, and `c-social-links`.
- Brand tagline always renders full-width at the bottom.
- Nav columns render from `nav_menu`: each top-level link becomes a column heading, its children become the link list.
- Nav zone is absent when `nav_menu` is blank or the menu has no top-level links with children.
- Email zone renders with Klaviyo form when provider is `klaviyo` and list ID is set.
- Email zone is absent when provider is `none`.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Blank `nav_menu` handle renders no nav columns without Liquid errors.
- Provider `none` renders no email zone without broken markup.
- Missing dependency snippets do not crash section render — registry resolves transitively.

---

## Verification

- [ ] component source exists at registry path
- [ ] registry contains `s-footer` metadata with c-email-signup-klaviyo and c-social-links dependencies
- [ ] registry checksum matches component source bytes
- [ ] component metadata validates with component registry parser
- [ ] brand tagline always renders
- [ ] nav columns render from `nav_menu`: top-level links → headings, children → items
- [ ] nav zone absent when `nav_menu` blank or top-level links have no children
- [ ] email zone renders Klaviyo form when provider is klaviyo
- [ ] email zone absent when provider is none
- [ ] section uses Tailwind utilities only
- [ ] `nazare add s-footer` smoke installs section and all transitive dependencies

---

## Architecture notes

The brand tagline uses fluid typography to fill the full section width — `clamp()` or a viewport-unit font-size so the text scales from small screens to wide desktops without a fixed breakpoint. This matches the design where the tagline spans edge to edge.

Nav columns are derived from a single `link_list` setting (`nav_menu`) rather than per-column blocks. The linklist hierarchy drives the layout: top-level links are column headings, their children are the listed links. Merchants manage the entire footer nav structure in the Shopify admin navigation editor; no theme customizer blocks needed.

The email provider setting is a select with `klaviyo` and `none`. Additional providers (Mailchimp, Omnisend, etc.) are added by installing their `c-email-signup-*` snippet and extending this setting — the section conditionally renders the matching provider snippet based on the setting value.

---

## Open questions

- Should social links render in the footer main zone (below nav columns) in addition to `s-social-gallery`, or only when `s-social-gallery` is not present?
- Should the tagline font size use a fixed `clamp()` or be a configurable setting?
