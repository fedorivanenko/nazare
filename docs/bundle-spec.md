# Bundle Page Specification — Alkamind

Reference designs: `BUNDLE_D.png` (desktop) · `BUNDLE_M.png` (mobile)

---

## Sections

### 1. Announcement Bar
Thin full-width green bar. No close button.

**Mobile:** Same.

---

### 2. Site Header + Breadcrumbs
Standard header. Breadcrumb path below (e.g., Home / Shop / Bundle Name).

**Mobile:** Hamburger left, logo center, search + cart right. Breadcrumbs visible below, smaller font.

---

### 3. Bundle Hero
Split layout. Left: media gallery. Right: bundle info + buy box.

**Mobile:** Single column stacked. Gallery on top, bundle info below.

#### Components

- **Image Gallery** — Multiple product + lifestyle images. Primary large image with thumbnails.
  _Mobile: Horizontal swipeable carousel, dots indicator._

- **Bundle Title** — H1 (e.g., "KICK ACID REFLUX BUNDLE").

- **Bundle Description** — Short paragraph describing the bundle purpose and contents.

- **Product Variant Selectors** — One row per product in the bundle. Each row: product name, color/flavor swatches, selected flavor label.
  _Mobile: Full width, stacked rows._

- **Buy Box** — Price display, Subscribe & Save toggle, "Add to Cart" CTA button.
  _Mobile: Full width, CTA button full width._

- **Trust Badges (inline)** — Row of icon+text badges below buy box.
  _Mobile: Wraps to 2-column grid._

---

### 4. Doctor / Social Proof Strip
Horizontal photo strip of doctors or experts with names and credentials below each photo.

**Mobile:** Horizontally scrollable strip.

---

### 5. Quality & Certifications Accordion
Collapsible panel. Same as PDP accordion component.

**Mobile:** Full width, same expand/collapse behavior.

---

### 6. Bundle Contents / What's Inside
Grid layout showing each product included in the bundle. Each product block contains: product name, key benefits bullet list, "HOW TO USE" label + instructions, "KEY INGREDIENTS" label + ingredient list.

**Mobile:** Each product block becomes a full-width accordion — tap product name to expand details.

#### Components
- **Product Block** — Name, benefits, how-to-use, key ingredients. Desktop: side-by-side grid. Mobile: accordion.

---

### 7. Routine Section
"YOUR ACID-KICKING ROUTINE" heading. Numbered step cards (01, 02, 03 — mobile adds 04) with full-bleed step images and short copy per step.

**Mobile:** Horizontal swipeable strip. Each step full-width card. More steps may be shown (04 visible on mobile).

---

### 8. Trust Bar
Horizontal strip of certification/claim icons with labels (Vegan Free, No Artificial Ingredients, Doctor-Formulated, Organic, Vegan).

**Mobile:** Horizontally scrollable.

---

### 9. Bundle & Save (Other Bundles)
Horizontal scrollable carousel of other available bundles with product images, names, prices.

**Mobile:** Same carousel, 1–1.5 bundles visible at a time.

---

### 10. Reviews
Rating summary (e.g., 4.9) with total count + "WRITE A REVIEW" CTA. Individual review cards with reviewer name, date, rating, body text. Pagination dots.

**Mobile:** Stacked full-width review cards. Pagination dots remain.

#### Components
- **Rating Summary** — Aggregate score + histogram.
- **Review Card** — Name, rating, date, body, verified badge.
- **Pagination** — Dots or arrows.

---

### 11. Related Products — Acid-Kicking Favorites
"ACID-KICKING FAVORITES" heading + "SEE ALL" link. Horizontal scrollable carousel of product cards.

**Mobile:** Same carousel. "ADD TO CART" button visible on cards.

#### Components
- **Product Card** — Image, name, descriptor, price, swatches, CTA.

---

### 12. Blog / Editorial Cards
"READ UP ON THE LATEST" heading. Row of article preview cards.

**Mobile:** Vertical stack, full-width cards.

#### Components
- **Article Card** — Cover image, title, category tag.

---

### 13. UGC / Social Gallery
"@GETOFFYOURACID" heading + social icons. Horizontal photo tile row.

**Mobile:** 2-column photo grid.

---

### 14. Footer
Standard footer. Nav columns, newsletter, "GET OFF YOUR ACID®" headline, legal bar.

**Mobile:** Newsletter full width. Nav as accordions. Legal stacked.
