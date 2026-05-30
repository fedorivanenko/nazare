# PDP Specification — Alkamind Product Detail Page

Reference designs: `PDP_D.png` (desktop) · `PDP_M.png` (mobile)

---

## Sections

### 1. Site Header
Top navigation bar. Logo left, nav links center (Shop, What & Why, Learn), icons right (search, account, cart).

**Mobile:** Nav links hidden. Hamburger menu icon replaces them. Logo centered. Cart + search icons remain visible right.

---

### 2. Breadcrumbs
Single-line path below header. Shows current product location within site hierarchy.

**Mobile:** Visible, single line, smaller font. Truncates if too long.

---

### 3. Product Hero
Main above-the-fold section. Split layout: media gallery left, product info right.

**Mobile:** Single-column stacked layout. Gallery on top, product info below.

#### Components
- **Image Gallery** — Vertical stack of product photos + lifestyle images. Primary large image with thumbnails.
  _Mobile: Horizontal swipeable carousel. Full-width images, dots indicator. Thumbnails hidden._
- **Product Title** — H1 heading in large bold type.
  _Mobile: Full width, reduced font size._
- **Star Rating + Review Count** — Inline rating with link to reviews section.
  _Mobile: Same, full width._
- **Variant Swatches** — Color/flavor selector dots.
  _Mobile: Same, full width._
- **Buy Box** — Quantity selector, price display, "Add to Cart" CTA button.
  _Mobile: Full-width stacked layout. CTA button full width._
- **Subscribe & Save Toggle** — One-time vs. subscription purchase option with discount callout.
  _Mobile: Full width, stacked below buy box._
- **Trust Badges (inline)** — 3–4 small icon+text badges. Horizontal row below buy box.
  _Mobile: Wraps to 2-column grid or vertical stack._
- **Doctor Endorsement Block** — Headshot photo with name/credential and short quote.
  _Mobile: Horizontal photo strip of headshots, scrollable. Quote text below._

---

### 4. Product Accordion
Expandable Q&A-style panels below the buy box area.

**Mobile:** Full width. Same expand/collapse behavior. Tap target larger for touch.

#### Components
- **How To Use** — Collapsible panel with usage instructions.
- **Ingredients** — Collapsible panel listing full ingredient breakdown.
- **Quality & Certifications** — Collapsible panel with certifications info.

---

### 5. Stat Banner
Full-width proof section. Bold headline ("PROVEN TO BALANCE EVERY CUP") on left, large percentage stat ("99%") with supporting copy on right.

**Mobile:** Stacked single column. Headline on top, stat + copy below. Stat number very large, full width.

---

### 6. Routine Section
Editorial section: "YOUR ACID-KICKING A.M. ROUTINE". Three numbered steps with full-bleed photos and short descriptive copy per step.

**Mobile:** Steps rendered as a horizontal swipeable strip. Each step = full-width card. Swipe to advance. Copy appears below each image.

---

### 7. Trust Bar
Thin horizontal strip of 5 certification/claim icons with labels (Vegan Free, No Artificial Ingredients, Doctor-Formulated, Organic, Vegan).

**Mobile:** Horizontally scrollable. Icons overflow off-screen, user swipes to see all.

---

### 8. Bundle & Save
Promotional product bundle section. "BUNDLE & SAVE" label, horizontal scrollable product card carousel with pricing.

**Mobile:** Same horizontal scroll carousel. Cards slightly narrower, 1.5–2 cards visible at a time.

---

### 9. Ingredients Spotlight
Editorial section: "THE MINERALS TRANSFORMING YOUR MORNING CUP". Grid of 4 ingredient cards.

**Mobile:** Vertical list — cards stack full width, one per row. Image left, name + description right (row layout per card).

#### Components
- **Ingredient Card** — Image, name, description. (MCT & Coconut Oil, Himalayan Pink Salt, Acid-Kicking Minerals, Fat-Burning Enzymes)
  _Mobile: Horizontal card layout — icon left, text right._

---

### 10. Comparison Table
"YOUR GUT DESERVES THE BEST". Full-width table comparing product against competitor columns (Selected, Prescription Office, Probiotics). Rows = product attributes. Check/X icons per cell.

**Mobile:** Table scales to full viewport width. Column headers abbreviated. Row labels wrap. Table horizontally scrollable if needed.

---

### 11. Reviews
Star rating summary (4.9) with total count and "Write a Review" CTA. Individual review cards below with reviewer name, date, rating, and body text. Pagination dots.

**Mobile:** All stacked full width. More review cards shown vertically (no carousel). Pagination dots remain.

#### Components
- **Rating Summary Bar** — Aggregate score + histogram breakdown.
- **Review Card** — Avatar/name, star rating, date, review text, verified badge.
  _Mobile: Full-width card, text truncated with "Read more" expand._
- **Pagination** — Dot or arrow navigation through review pages.

---

### 12. Related Products — Acid-Kicking Favorites
"ACID-KICKING FAVORITES" + "See All" link. Horizontal scrollable carousel of product cards.

**Mobile:** Same horizontal scroll. 1–1.5 cards visible at a time. "See All" link present.

#### Components
- **Product Card** — Product image, name, short descriptor, price range, CTA button.

---

### 13. Blog / Editorial Cards
"READ UP ON THE LATEST". Horizontal row of article preview cards.

**Mobile:** Vertical stack — cards full width, one per row. Cover image top, title below.

#### Components
- **Article Card** — Cover image, article title, optional tag/category.
  _Mobile: Full-width stacked card._

---

### 14. UGC / Social Gallery
"@GETOFFYOURACID" heading with Instagram-handle styling. Grid of user-generated photo tiles. Links to social profile.

**Mobile:** 2-column photo grid. Heading and social icons above. "Load More" or scroll to expand.

---

### 15. Footer
Full-width dark footer. "GET OFF YOUR ACID®" large display headline. Navigation columns, newsletter signup, legal links, social icons.

**Mobile:** Nav columns collapse into accordions (tap to expand each category). Newsletter signup full width. "GET OFF YOUR ACID®" headline remains large. Legal bar stacks vertically.

#### Components
- **Nav Columns** — Grouped site links by category.
  _Mobile: Accordion — tapping category header reveals links._
- **Newsletter Signup** — Email input + submit button.
  _Mobile: Full-width input, full-width button stacked below._
- **Legal Bar** — Copyright, privacy policy, terms links.
  _Mobile: Vertically stacked, centered._
