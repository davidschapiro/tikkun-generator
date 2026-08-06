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
