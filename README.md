# Tikkun Generator

A self-contained web tool for generating Torah and holiday reading practice sheets (tikkunim).

**Live:** https://tikkun.kahal-masorti.org

## What it does

Generates two printable tikkunim for any Shabbat parasha or Jewish holiday reading:

- **Tikkun Korim** — vowelized text with cantillation alongside consonantal scroll text (no nikud, no sof pasuk, no shin/sin dots)
- **Bima Tikkun** — single large-font vowelized column for use at the reading desk

## Features

### Core
- Auto-generates on load and on every control change
- **Parasha selector** grouped by year and book, current week onward (~1.5 years of upcoming Shabbatot); holidays grouped per year alongside parshiot
- **Holiday readings** — all major Yamim Tovim, Chol HaMoed, Chanukka weekdays (correctly labeled "Day 1–8"), Purim, Rosh Chodesh, Yom Kippur Mincha; pre-baked, no extra API calls
- **Monday/Thursday weekday Torah reading** — a "Shabbat / Weekday" toggle shows the open parasha's own weekday instance (Monday or Thursday, whichever resolves), fetched live on demand
- **All public fast days** — Tzom Gedaliah, Asara B'Tevet, Ta'anit Esther, Tzom Tammuz, and Tisha B'Av, each with its own correctly-sourced Mincha reading. All Mincha leyning comes directly from Hebcal's `/leyning` endpoint, not hardcoded
- **Congregation-repeat coloring for fast-day Shacharit** — in the Vayechal Moshe reading (Exodus 32:11–14 + 34:1–10), the three word spans customarily chanted first by the congregation and then repeated by the Ba'al Kriyah are rendered in dark blue, inline in the text flow with no paragraph breaks. Word-level precision: only the actual congregation phrases are colored (e.g. "שׁוּב" mid-verse 32:12, not the whole verse). An explanatory note appears at the top of each affected aliyah.
- **Rosh Chodesh** — single generic entry in the dropdown (the reading is always identical — Numbers 28:1-15 — so there is no point listing every month); no date shown in the meta line for the same reason
- **Yom Tov on Shabbat** — automatically displays the holiday reading when no parasha falls on that date
- **Triennial / Full Kriyah** toggle (remembered across sessions); auto-switches to full reading for holidays
- **Regular Maftir override for Triennial mode** — toggleable, only shown when Triennial is active and no holiday is selected
- **Diaspora / Israel** toggle — separate parasha and holiday schedules for each
- Honors special maftirs: Arba Parashiot, Shabbat Rosh Chodesh, Shabbat Chanukka
- **Hebrew date in the meta line** for all readings — parashiot, holidays, and fast days all show their Hebrew date (e.g. `17 Tamuz 5786 · 2026-07-02`), sourced from Hebcal and stored at build time

### Text accuracy
- **Ketiv-Qere resolved correctly** — scroll column shows the ketiv; vowelized column shows the qere with a small ketiv annotation
- Manuscript-variant footnotes stripped entirely
- Maqaf-joined words rendered as a real space in the scroll column

### Reading & practice tools
- **Line-synced columns** — scroll and vowelized columns wrap at identical points; recomputed live on resize; print uses its own fixed-width computation so output is identical regardless of device
- **Justified block format** — every line stretches to fill the full column width; last line of each reading is unstretched
- **Open-parasha (פ) paragraph breaks** render as an actual line break; marker never stranded alone on its line
- **Closed-parasha (ס) gets a visual mid-line gap**, scaled to the glyph's rendered width; word-pulling from adjacent lines in most cases to avoid landing at a line edge
- **Bima Tikkun is fully justified** with the same petucha/setuma paragraph handling as Tikkun Korim
- **Chapter:verse indicator** — full `chapter:verse` at the start of every chapter, every 15th verse, and at any reading beginning mid-chapter; bare verse number elsewhere
- **Verse lookup** — a "🔍 Verse" button next to the dropdown (mobile: "Look up a verse", full-width) opens a modal where you can enter any Torah book, chapter, and verse. The tool validates the reference against a hardcoded verse-count table (so "Deuteronomy 10:50" is rejected immediately), then finds the correct parasha and aliyah from the pre-baked fullkriyah range index — no runtime API call. Always navigates in Full Kriyah mode; scrolls to and briefly highlights the specific verse in gold
- **Aliyah jump chips** — a row of colored buttons (matching each aliyah header's color) sits in the controls bar alongside the aliyah selector. Clicking scrolls directly to that aliyah; chips for deselected aliyot are hidden automatically so the bar always reflects only what's visible
- **Aliyah multi-select** — "All Aliyot" button opens a popover; unchecking it deselects everything so you can quickly pick one or two; the "at least one" guard on individual checkboxes prevents an accidental blank screen
- **Side-by-Side / Either-Or layout toggle** for Tikkun Korim — Either-Or collapses to single column with a Scroll/Tikkun sub-toggle for cover-and-check practice
- Both toggles in a **floating widget** (bottom-right, always visible while scrolling)
- Tab switcher between Tikkun Korim and Bima Tikkun (last tab remembered); tab switcher lives just above the tikkun content, not buried in the header
- Print button per tikkun — printer-friendly (white headers, no color fills); always forces Side-by-Side; columns centered and precisely pin-sized to `PRINT_REF_WIDTH` regardless of paper size (A4 or Letter)

### UI / controls layout
- All reading controls live in a **sticky header** centered on both desktop and mobile:
  - Row 1: nav arrows · date · parasha name · jump-to-parasha dropdown (one line on desktop; dropdown wraps below on mobile)
  - Row 2: Triennial/Full Kriyah · Shabbat/Weekday · Diaspora/Israel toggles
  - Row 3 (after content loads): aliyah selector · aliyah jump chips
  - Row 4 (conditional): Regular Maftir checkbox
- Controls bar slides away on scroll-down, reappears on scroll-up

### Mobile
- **Defaults to Either-Or / Tikkun view** below 680px
- Aliyah chips centered on all line-wrap configurations
- Parasha name centered between the nav buttons and screen edge

### Technical
- Hebrew text set in **Shlomo SemiStam** (SIL Open Font License), embedded
- Favicon: a tav (ת) rendered in the same embedded font, gold-on-dark
- Dark mode support
- No backend, no build step — `index.html` + `tokenizer.js`, both static

## Sources

- Leyning data: [Hebcal.com](https://hebcal.com)'s `/leyning` endpoint (Eisenberg/CJLS triennial system) — single unified source for Shabbat, holiday, and weekday readings
- Torah text: [Sefaria.org](https://sefaria.org)
- Hebrew font: Shlomo SemiStam by Shlomo Orbach, based on Ezra SIL SR — [SIL Open Font License 1.1](https://scripts.sil.org/OFL)

## Known gaps

- A setuma can occasionally still land at a line edge on a tight column — accepted as permanent, glyph stays in both columns
- Simchat Torah Chatanim structure not included
- **No audio** — planned idea, not yet investigated

## Deploy & maintenance

Hosted on GitHub Pages. Any push to `main` auto-deploys. Static files — no build process.

Schedule data is embedded in `index.html` and refreshed automatically via **GitHub Actions** (`refresh_data.py`) on **Jan 1 and Jul 1**, fetching ~1.5 years ahead. Can be triggered manually from the Actions tab.

## Impressum

Kahal Masorti e.V.i.G. · Baumeisterstr. 11 · 26122 Oldenburg
Verantwortlicher gemäß §18 Abs. 2 MStV: David Schapiro · david@schapiro.org


A self-contained web tool for generating Torah and holiday reading practice sheets (tikkunim).

**Live:** https://tikkun.kahal-masorti.org

## What it does

Generates two printable tikkunim for any Shabbat parasha or Jewish holiday reading:

- **Tikkun Korim** — vowelized text with cantillation alongside consonantal scroll text (no nikud, no sof pasuk, no shin/sin dots)
- **Bima Tikkun** — single large-font vowelized column for use at the reading desk

## Features

### Core
- Auto-generates on load and on every control change
- **Parasha selector** grouped by year and book, current week onward (~1.5 years of upcoming Shabbatot — past weeks aren't shown, so the list is always relevant); holidays grouped right alongside each year's parshiot, not dumped at the very end of the whole multi-year list
- **Holiday readings** — all major Yamim Tovim, Chol HaMoed, Chanukka weekdays (correctly labeled "Day 1–8", not raw candle counts), Purim, Rosh Chodesh, Yom Kippur Mincha; pre-baked, no extra API calls
- **Monday/Thursday weekday Torah reading** — a "Shabbat / Weekday" toggle shows the open parasha's own weekday instance (Monday or Thursday, whichever resolves), fetched live on demand rather than embedded, since it's always the reading for whichever parasha is currently open
- **All public fast days** — Tzom Gedaliah, Asara B'Tevet, Ta'anit Esther, Tzom Tammuz, and Tisha B'Av, each with its own correctly-sourced Mincha reading (Vayechal Moshe + the haftarah Dirshu Hashem for the four minor fasts and Tisha B'Av's Mincha; Tisha B'Av's own Shacharit reading differs from the others; Yom Kippur Mincha gets its own correct Jonah/Micah haftarah). All Mincha leyning now comes directly from Hebcal's `/leyning` endpoint, not hardcoded
- **Yom Tov on Shabbat** — automatically displays the holiday reading when no parasha falls on that date
- **Triennial / Full Kriyah** toggle (remembered across sessions); auto-switches to full reading for holidays
- **Regular Maftir override for Triennial mode** — some communities read the regular (full-kriyah) maftir even on a triennial week rather than the triennial cycle's own maftir; toggleable, only shown when Triennial is active and no holiday is selected
- **Diaspora / Israel** toggle — separate parasha and holiday schedules for each
- Honors special maftirs: Arba Parashiot (Shekalim, Zachor, Para, HaChodesh), Shabbat Rosh Chodesh, Shabbat Chanukka

### Text accuracy
- **Ketiv-Qere resolved correctly** — scroll column shows the ketiv (as written in the scroll); vowelized column shows the qere (as read aloud) with a small ketiv annotation alongside
- Manuscript-variant footnotes (e.g. Sephardi/Ashkenazi spelling notes) stripped entirely — they're editorial notes, not text to be read
- Maqaf-joined words rendered as a real space in the scroll column (not merged into one unbroken word)

### Reading & practice tools
- **Line-synced columns** — scroll and vowelized columns wrap at identical points, so they align row-for-row in Side-by-Side mode and there's no visual jump switching between views in Either-Or mode. Recomputed live on resize; print uses its own fixed-width computation (deterministic `@page` margins) so printed output is identical regardless of the device or window size used to print.
- **Justified block format** — every line stretches to fill the full column width, like a real tikkun korim, instead of ragged-edge text. The last line of each reading is left unstretched, per standard typesetting convention.
- **Open-parasha (פ) paragraph breaks render as an actual line break**, not just an inline glyph — the marker always starts a fresh line and is never left stranded alone on its own line with nothing else on it.
- **Closed-parasha (ס) gets a visual mid-line gap**, sized to the glyph's own rendered width so it scales naturally with column width, screen vs print, and font — not a flat px/em guess. The gap deliberately doesn't stretch with line justification (a real scribal gap is a fixed shape, not something that grows on a loose line). A setuma sitting as the very first or last word of a line gets a word pulled in from the adjacent line where there's room, so it isn't mistaken for a petucha at a glance — this succeeds in most cases but not always; on a tight column it can occasionally still land at a line edge, distinguishable only by the glyph itself (see Known gaps).
- **Chapter:verse indicator** — verse numbers show the full `chapter:verse` form (e.g. `19:15`) at the start of every chapter, every 15th verse, and at the start of any reading that begins mid-chapter; a bare verse number everywhere else, so readers always know what chapter they're in without losing the lightweight numbering most of the time.
- **Aliyah multi-select popover** — closed-by-default trigger button (verse range shown per row when opened), with a bold "All Aliyot" checkbox that selects/reflects everything at once. Any combination can be shown at once — e.g. just aliyot 1, 3, and 6 — not just one-or-all, and it's reflected in print too. Print buttons show a count (e.g. "Print (3/6)") whenever the selection is narrowed, as a reminder right at the moment it matters
- **Side-by-Side / Either-Or layout toggle** for Tikkun Korim — Either-Or collapses to a single full-width column with its own **Scroll view / Tikkun view** sub-toggle, for cover-and-check practice
- Both toggles live in a **floating widget** (bottom-right, always visible while scrolling, on both mobile and desktop) — no need to scroll back up mid-practice
- Tab switcher between Tikkun Korim and Bima Tikkun (last tab remembered)
- Print button for each tikkun — printer-friendly (white headers, no color fills); print output always forces Side-by-Side layout for completeness, regardless of on-screen toggle state

### Mobile
- **Defaults to Either-Or / Tikkun view** below 680px width — Side-by-Side squeezes both columns to half-width each, too cramped on a phone. Desktop still defaults to Side-by-Side.
- Controls bar slides away on scroll-down, reappears on any scroll-up (not pinned, not buried — a small upward scroll is enough)
- Date/parasha-name share a row efficiently on narrow screens

### Technical
- Hebrew text set in **Shlomo SemiStam** (SIL Open Font License), embedded — no external dependencies
- Favicon rendered from that same embedded font (a tav, ת)
- Dark mode support
- No backend, no build step — `index.html` + a small `tokenizer.js` module, both static

## Sources

- Leyning data: [Hebcal.com](https://hebcal.com)'s `/leyning` endpoint (Eisenberg/CJLS triennial system) — a single unified source for Shabbat, holiday, and Monday/Thursday weekday readings
- Torah text: [Sefaria.org](https://sefaria.org)
- Hebrew font: Shlomo SemiStam by Shlomo Orbach, based on Ezra SIL SR — [SIL Open Font License 1.1](https://scripts.sil.org/OFL)

## Known gaps

- A setuma (ס) can occasionally still land as the first or last word of a line on a tight column — a word gets pulled in from the adjacent line where there's room, but a whole extra Hebrew word's width sometimes exceeds what's available, so it isn't guaranteed every time. This is accepted as a permanent characteristic rather than something actively being chased further. The glyph itself stays in both columns permanently for this reason (and others) — removing it entirely was an earlier idea, now abandoned, not planned
- Simchat Torah Chatanim structure not included
- **No audio** — text only right now; linking or embedding actual chanting/trope recordings (e.g. Sefaria has some, coverage inconsistent) is a planned idea, not yet investigated

## Deploy & maintenance

Hosted on GitHub Pages. Any push to `main` auto-deploys. Static files — no build process.

Schedule data (parasha and holiday listings) is embedded in `index.html` and refreshed automatically via **GitHub Actions** (`refresh_data.py`) on **Jan 1 and Jul 1** each year, fetching ~1.5 years ahead each run (always at least a full year of buffer before the next refresh). Can also be triggered manually from the Actions tab. No manual maintenance required.

## Impressum

Kahal Masorti e.V.i.G. · Baumeisterstr. 11 · 26122 Oldenburg
Verantwortlicher gemäß §18 Abs. 2 MStV: David Schapiro · david@schapiro.org
