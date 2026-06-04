# Tikkun Generator

A client-side web tool for generating Torah reading practice sheets (tikkunim).

**Live:** https://davidschapiro.github.io/tikkun-generator

## What it does

Auto-detects the current week's parasha and generates two printable tikkunim:

- **Practice Tikkun (Tikkun Korim)** — two side-by-side columns: vowelized text with cantillation on one side, consonantal scroll text on the other
- **Bima Tikkun** — single large-font vowelized column for use at the reading desk

## Features

- Triennial / Full Kriyah toggle (choice remembered across sessions)
- Diaspora / Israel toggle
- Prev / Next Shabbat navigation
- Print button for each tikkun
- Dark mode support
- No backend — runs entirely in the browser

## Sources

- Leyning data: [Hebcal.com](https://hebcal.com) (Eisenberg/CJLS triennial system)
- Torah text: [Sefaria.org](https://sefaria.org)

## Deploy

Hosted on GitHub Pages. Any push to `main` auto-deploys.
