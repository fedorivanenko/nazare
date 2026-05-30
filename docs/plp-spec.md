# PLP Specification — Alkamind Product Listing Page

Reference designs: `PLP_D.png` (desktop) · `PLP_M.png` (mobile)

---

## Sections

### 1. Announcement Bar
Thin full-width green bar at very top. Short promotional text ("Kick acid. Find relief."). No close button.

**Mobile:** Same, single line, smaller font. Full width.

---

### 2. Site Header
Logo centered "Alkamind". Nav left (Shop, Shop By Need, Learn). Icons right (Search, Account, Cart).

**Mobile:** Hamburger icon left. Logo centered. Search + Cart icons right. Nav links hidden.

---

### 3. Promo Banner
Dismissible full-width blue banner below header. Promotional message ("COMING SOON MOLECULAR HYDROGEN TEA · JOIN THE WAITLIST"). Close (×) button on right.

**Mobile:** Same, full width. Text wraps to two lines. × button top-right.

---

### 4. Hero Banner
Full-width editorial image. "SHOP ALL" H1 heading bottom-left over image. Short descriptor copy top-right.

**Mobile:** Same full-width image. Heading bottom-left, descriptor hidden or overlaid. Reduced heading size.

---

### 5. Filter + Sort Bar
Horizontal row of category filter pills + sort dropdown. Pills: All, Acid Reflux & Heartburn, Bloating, Constipation, Gas & Indigestion, Brain Fog, Fatigue. "All" pill active by default. Sort dropdown right-aligned: "SORT: BESTSELLING".

**Mobile:** Filter pills horizontally scrollable (overflow hidden, swipe to reveal). Sort dropdown stacks below pills or remains inline right. Pills show partial overflow to hint at scroll.

#### Components
- **Filter Pill** — Label text, active/inactive state. Clicking filters the product grid.
- **Sort Dropdown** — Label + selected value. Opens options list on click.

---

### 6. Product Grid
3-column grid of product cards. Renders all products for the active filter. An editorial card is inserted at a fixed grid position.

**Mobile:** 2-column grid. Product cards include a visible "ADD TO CART" button (not shown on desktop). Editorial card spans full width (breaks out of 2-column layout).

#### Components

- **Product Card**
  - **Badge** — "Bestseller" label (green) or "% Off" discount badge (top-left corner). Optional.
  - **Category Tag** — Small pill label (e.g., "Acid Reflux & Heartburn") below badge.
  - **Product Image** — Square, white background.
  - **Star Rating + Review Count** — Stars + "(729)" count.
  - **Product Name** — Short product title.
  - **Price** — Regular price. If on sale: strikethrough original + highlighted sale price.
  - **Variant Swatches** — Color dot row for flavor/variant selection.
  - **Flavor Name Label** — Text label of selected variant below swatches.
  - _Mobile: adds_ **Add to Cart Button** — Full-width CTA below price/swatches.

- **Editorial Card** (inline grid position)
  - Full-bleed lifestyle image with overlay headline and "SHOP NOW" CTA button.
  - _Mobile: spans full width across both columns._

---

### 7. Category Navigation Strip
Full-width horizontal strip of lifestyle photos, one per category. Each tile has a category label below (Acid Reflux & Heartburn, Bloating, Constipation, Gas & Indigestion, Brain Fog, Fatigue). Clicking filters the grid.

**Mobile:** Horizontally scrollable. Tiles narrower, labels below each image. Partial tile visible to hint scroll.

#### Components
- **Category Tile** — Square photo, label below, tap/click to filter.

---

### 8. Extended Product Grid
Continuation of the product grid below the category strip. Same card structure. Ends with "SHOW MORE +" text button centered below last row.

**Mobile:** Same 2-column layout. "SHOW MORE +" button full width.

#### Components
- **Show More Button** — Text link / outlined button. Loads next page of products or expands grid.

---

### 9. Gut Check CTA Banner
Full-width editorial banner. Large display headline: "THE GUT CHECK". Subtext below. Dark pill CTA button: "FIND YOUR REFLUX TYPE". Background: full-bleed abstract/liquid imagery.

**Mobile:** Same full width. Headline stacks, slightly smaller. CTA button full width.

---

### 10. UGC / Social Gallery
"@GETOFFYOURACID" heading with social icons (Instagram, Facebook, YouTube) right-aligned. Horizontal row of UGC lifestyle photo tiles below.

**Mobile:** Social icons left-aligned below heading. Photos in 2-column grid (not horizontal row).

---

### 11. Footer
Multi-column layout. 4 nav columns (Support, Company, Explore, Reflux News You Can Use). Newsletter column has email input + "SIGN UP" button. "GET OFF YOUR ACID®" large display headline at bottom. Copyright + Privacy Policy + Terms of Use bar below.

**Mobile:** Newsletter signup full width at top of footer. Nav columns collapse to accordions (tap label to expand links). "GET OFF YOUR ACID®" headline remains large. Legal bar below, stacked.

#### Components
- **Nav Columns** — 4 grouped link lists: Support, Company, Explore, Reflux News You Can Use.
  _Mobile: Each column is an accordion — tap to expand._
- **Newsletter Signup** — Email input + "SIGN UP" button inline.
  _Mobile: Full-width stacked input + button._
- **Legal Bar** — "Copyright 2026, Alkamind." + Privacy Policy + Terms of Use links.
  _Mobile: Stacked, centered._
