# FAQ Page Specification — Alkamind

Reference designs: `FAQ_D.png` (desktop) · `FAQ_M.png` (mobile)

---

## Sections

### 1. Announcement Bar
Thin full-width green bar. No close button.

**Mobile:** Same.

---

### 2. Site Header
Standard. Logo centered, nav left, icons right.

**Mobile:** Hamburger left, logo center, search + cart right.

---

### 3. Page Header
Large display heading: "FREQUENTLY ASKED QUESTIONS". Subtext below: "Have other questions? Contact us." — "Contact us" is a hyperlink.

**Mobile:** Same, full width. Heading wraps to 2–3 lines.

#### Components
- **Page Title** — Large H1.
- **Contact Link** — Inline text link within subtext.

---

### 4. FAQ Content Area
Two-column layout. Left: sticky category sidebar nav. Right: accordion FAQ list on dark background.

**Mobile:** No sidebar. Category nav becomes a horizontally scrollable tab strip below the page header. FAQ accordion below, full width.

#### Components

- **Category Sidebar** (desktop only)
  - Vertical list of category links: General, Products, Alkalinity & pH, Shipping & Returns, Detox Programs.
  - Active category highlighted (blue underline/color).
  - Clicking category jumps to or filters the FAQ list.

- **Category Tab Strip** (mobile only)
  - Same category labels as horizontal scrollable pills/tabs.
  - Active tab highlighted.

- **FAQ Accordion List**
  - Dark background container.
  - Each question row: rounded pill/card with question text left, +/– icon right.
  - Expanded state: answer appears as white rounded card below the question row.
  - Only one item expanded at a time (or multiple — TBD).
  _Mobile: Full width, same pill/card style. Larger tap targets._

---

### 5. Gut Check CTA Banner
Full-width editorial banner. "THE GUT CHECK" headline. "FIND YOUR REFLUX TYPE" CTA button. Liquid background image.

**Mobile:** Full width, stacked text. CTA button full width.

---

### 6. UGC / Social Gallery
"@GETOFFYOURACID" heading + social icons right. Horizontal photo tile row.

**Mobile:** Social icons left below heading. 2-column photo grid.

---

### 7. Footer
Standard footer. Nav columns, newsletter signup, "GET OFF YOUR ACID®" headline, legal bar.

**Mobile:** Newsletter full width. Nav as accordions. Legal stacked.
