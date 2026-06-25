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
- **Parasha selector** grouped by year and book, ~2.5 years of upcoming Shabbatot
- **Holiday readings** — all major Yamim Tovim, Chol HaMoed, Chanukka weekdays (correctly labeled "Day 1–8", not raw candle counts), Purim, Tisha B'Av, Yom Kippur Mincha; pre-baked, no extra API calls
- **Yom Tov on Shabbat** — automatically displays the holiday reading when no parasha falls on that date
- **Triennial / Full Kriyah** toggle (remembered across sessions); auto-switches to full reading for holidays
- **Diaspora / Israel** toggle — separate parasha and holiday schedules for each
- Honors special maftirs: Arba Parashiot (Shekalim, Zachor, Para, HaChodesh), Shabbat Rosh Chodesh, Shabbat Chanukka

### Text accuracy
- **Ketiv-Qere resolved correctly** — scroll column shows the ketiv (as written in the scroll); vowelized column shows the qere (as read aloud) with a small ketiv annotation alongside
- Manuscript-variant footnotes (e.g. Sephardi/Ashkenazi spelling notes) stripped entirely — they're editorial notes, not text to be read
- Maqaf-joined words rendered as a real space in the scroll column (not merged into one unbroken word)

### Reading & practice tools
- **Line-synced columns** — scroll and vowelized columns wrap at identical points, so they align row-for-row in Side-by-Side mode and there's no visual jump switching between views in Either-Or mode. Recomputed live on resize; print uses its own fixed-width computation (deterministic `@page` margins) so printed output is identical regardless of the device or window size used to print.
- **Aliyah jump dropdown** — verse range shown inline, jump straight to any aliyah
- **Side-by-Side / Either-Or layout toggle** for Tikkun Korim — Either-Or collapses to a single full-width column with its own **Scroll view / Tikkun view** sub-toggle, for cover-and-check practice
- Both toggles live in a **floating widget** (bottom-right, always visible while scrolling, on both mobile and desktop) — no need to scroll back up mid-practice
- Tab switcher between Tikkun Korim and Bima Tikkun (last tab remembered)
- Print button for each tikkun — printer-friendly (white headers, no color fills); print output always forces Side-by-Side layout for completeness, regardless of on-screen toggle state

### Mobile
- Controls bar slides away on scroll-down, reappears on any scroll-up (not pinned, not buried — a small upward scroll is enough)
- Date/parasha-name share a row efficiently on narrow screens

### Technical
- Hebrew text set in **Shlomo SemiStam** (SIL Open Font License), embedded — no external dependencies
- Dark mode support
- No backend, no build step — `index.html` + a small `tokenizer.js` module, both static

## Sources

- Leyning data: [Hebcal.com](https://hebcal.com) (Eisenberg/CJLS triennial system)
- Torah text: [Sefaria.org](https://sefaria.org)
- Hebrew font: Shlomo SemiStam by Shlomo Orbach, based on Ezra SIL SR — [SIL Open Font License 1.1](https://scripts.sil.org/OFL)

## Known gaps

- Yom Kippur Mincha is hardcoded (Leviticus 18:1–30); not in Hebcal
- Simchat Torah Chatanim structure not included
- Weekday fast day readings (Shacharit/Mincha) not included

## Deploy & maintenance

Hosted on GitHub Pages. Any push to `main` auto-deploys. Static files — no build process.

Schedule data (parasha and holiday listings) is embedded in `index.html` and refreshed automatically via **GitHub Actions** (`refresh_data.py`) on **Jan 1 and Jul 1** each year. Can also be triggered manually from the Actions tab. No manual maintenance required.

## Impressum

Kahal Masorti e.V.i.G. · Baumeisterstr. 11 · 26122 Oldenburg
Verantwortlicher gemäß §18 Abs. 2 MStV: David Schapiro · david@schapiro.org
