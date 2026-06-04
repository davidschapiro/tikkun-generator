# Tikkun Generator

A self-contained web tool for generating Torah and holiday reading practice sheets (tikkunim).

**Live:** https://davidschapiro.github.io/tikkun-generator

## What it does

Generates two printable tikkunim for any Shabbat parasha or Jewish holiday reading:

- **Tikkun Korim** — two side-by-side columns: vowelized text with cantillation on one side, consonantal scroll text (no nikud, no vowels, no sof pasuk) on the other
- **Bima Tikkun** — single large-font vowelized column for use at the reading desk

## Features

- Auto-generates on load and on every control change
- **Parasha selector** grouped by year and book, ~14 months of upcoming Shabbatot
- **Holiday readings** — all major Yamim Tovim, Chol HaMoed, Chanukka weekdays, Purim, Tisha B'Av, Yom Kippur Mincha; pre-baked, no extra API calls
- **Triennial / Full Kriyah** toggle (remembered across sessions); auto-switches to full reading for holidays
- **Diaspora / Israel** toggle — separate parasha and holiday schedules for each
- Honors special maftirs: Arba Parashiot (Shekalim, Zachor, Para, HaChodesh), Shabbat Rosh Chodesh, Shabbat Chanukka
- Prev / Next Shabbat navigation
- Tab switcher between Tikkun Korim and Bima Tikkun (last tab remembered)
- Print button for each tikkun — printer-friendly (white headers, no color fills)
- Hebrew text set in **Shlomo SemiStam** (SIL Open Font License), embedded — no external dependencies
- Dark mode support
- No backend, no build step — single HTML file

## Sources

- Leyning data: [Hebcal.com](https://hebcal.com) (Eisenberg/CJLS triennial system)
- Torah text: [Sefaria.org](https://sefaria.org)
- Hebrew font: Shlomo SemiStam by Shlomo Orbach, based on Ezra SIL SR — [SIL Open Font License 1.1](https://scripts.sil.org/OFL)

## Known gaps

- Yom Kippur Mincha is hardcoded (Leviticus 18:1–30); not in Hebcal
- Simchat Torah Chatanim structure not included
- Weekday fast day readings (Shacharit/Mincha) not included

## Deploy

Hosted on GitHub Pages. Any push to `main` auto-deploys. Single file — no build process.

## Impressum

Kahal Masorti e.V.i.G. · Baumeisterstr. 11 · 26122 Oldenburg
Verantwortlicher gemäß §18 Abs. 2 MStV: David Schapiro · david@schapiro.org
