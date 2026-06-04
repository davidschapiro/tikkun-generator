# Tikkun Generator

A self-contained web tool for generating Torah reading practice sheets (tikkunim).

**Live:** https://davidschapiro.github.io/tikkun-tool

## What it does

Auto-detects the current week's parasha and generates two printable tikkunim:

- **Tikkun Korim** — two side-by-side columns: vowelized text with cantillation on one side, consonantal scroll text on the other
- **Bima Tikkun** — single large-font vowelized column for use at the reading desk

## Features

- Auto-generates on load and on every control change
- Parasha selector grouped by book (Genesis → Deuteronomy), ~14 months of upcoming Shabbatot
- Triennial / Full Kriyah toggle (choice remembered across sessions)
- Diaspora / Israel toggle
- Prev / Next Shabbat navigation
- Tab switcher between Tikkun Korim and Bima Tikkun (last tab remembered)
- Print button for each tikkun
- Hebrew text set in Shlomo SemiStam (Shlomo Orbach, SIL Open Font License), embedded directly — no external dependencies
- Dark mode support
- No backend, no build step — single HTML file

## Sources

- Leyning data: [Hebcal.com](https://hebcal.com) (Eisenberg/CJLS triennial system)
- Torah text: [Sefaria.org](https://sefaria.org)
- Hebrew font: Shlomo SemiStam by Shlomo Orbach, based on Ezra SIL SR — [SIL Open Font License 1.1](https://scripts.sil.org/OFL)

## Deploy

Hosted on GitHub Pages. Any push to `main` auto-deploys. Single file — no build process.

## Impressum

Kahal Masorti e.V.i.G. · Baumeisterstr. 11 · 26122 Oldenburg  
Verantwortlicher gemäß §18 Abs. 2 MStV: David Schapiro · david@schapiro.org
