# Blog Landing Specification — Alkamind

Reference designs: `Blog-Landing_D.png` (desktop) · `Blog-Landing_M.png` (mobile)

---

## Sections

### 1. Announcement Bar
Thin full-width green bar. "Kick acid. Find relief." No close button.

**Mobile:** Same, single line.

---

### 2. Site Header
Standard. Logo centered, nav left, icons right.

**Mobile:** Hamburger left, logo center, search + cart right.

---

### 3. Featured Article Hero
Full-width split section. Left: large hero image with "X MIN READ" label overlay. Right: "Featured" badge + category tag, article title (H1), short placeholder descriptor, "READ THE ARTICLE" CTA button.

**Mobile:** Single column. Hero image full width on top. Badges, title, copy, and CTA stacked below.

#### Components
- **Featured Badge** — Small pill label ("Featured").
- **Category Tag** — Secondary pill label (e.g., "Acid Reflux & Heartburn").
- **Article Title** — H1.
- **Descriptor Copy** — 1–2 line excerpt.
- **Read CTA** — Outlined button "READ THE ARTICLE".
- **Min Read Label** — Overlay on image (e.g., "5 MIN READ").

---

### 4. Filter + Sort Bar
Horizontal row of category filter pills + sort dropdown. Pills: All, Acid Reflux & Heartburn, Bloating, Constipation, Gas & Indigestion, Brain Fog, Fatigue, Weight Loss, Recipes, Lifestyle + more. Sort dropdown right-aligned: "SORT: ALL".

**Mobile:** Filter pills horizontally scrollable. Sort dropdown stacks below pills on its own row.

#### Components
- **Filter Pill** — Label, active/inactive state. Filters grid on click.
- **Sort Dropdown** — Label + value. Opens option list.

---

### 5. Article Grid
3-column grid of article cards. Inline featured article card inserted at a fixed position within the grid.

**Mobile:** 2-column grid. Inline featured card spans full width.

#### Components

- **Article Card**
  - **Cover Image** — Square/portrait image, full bleed.
  - **Category Tag** — Small overlay label top-left.
  - **Min Read Label** — Overlay label bottom or top of image.
  - **Article Title** — Below image.

- **Featured Inline Card** (breaks grid layout)
  - Full-width card with editorial background image. "Featured" + category badges. Article title. Body excerpt. "READ THE ARTICLE" button.
  _Mobile: Full width, stacked — image top, content below._

---

### 6. Show More Button
Centered text/outlined button below last grid row. Loads next page of articles.

**Mobile:** Full width.

---

### 7. Gut Check CTA Banner
Full-width editorial banner. "THE GUT CHECK" display headline. "FIND YOUR REFLUX TYPE" CTA button. Abstract liquid background image.

**Mobile:** Same full width. Text stacks. CTA full width.

---

### 8. UGC / Social Gallery
"@GETOFFYOURACID" heading + social icons right (Instagram, Facebook, YouTube). Horizontal photo tile row.

**Mobile:** Social icons below heading, left-aligned. 2-column photo grid.

---

### 9. Footer
Standard footer. Nav columns, newsletter signup, "GET OFF YOUR ACID®" headline, legal bar.

**Mobile:** Newsletter full width. Nav as accordions. Legal stacked.
