# Bima Tikkun 5787 (Diaspora) — generation tooling

Produces a single print-ready PDF covering every Torah-reading occasion
in Hebrew year 5787 (12 Sep 2026 – 1 Oct 2027): 50 weekly parshiot in the
triennial cycle (Year 2) plus 42 holiday/fast-day readings, all Diaspora
nusach, rendered from the Bima Tikkun view.

It works by driving the live app in headless Chromium via Playwright —
one page load per occasion, using the app's own shareable-link URL
scheme (`?d=` for a Shabbat date, `?h=` for a holiday key) — rather than
reimplementing any tokenization, coloring, or print-layout logic
separately. Each occasion becomes its own correctly-paginated PDF; a
final merge step concatenates them in chronological order.

## Requirements

```
npm install -g playwright
npx playwright install chromium
pip install pypdf
```

## Steps

1. Serve the repo root over HTTP (needed for `fetch()` calls to Sefaria —
   `file://` won't work reliably):
   ```
   python3 -m http.server 8791
   ```
2. Generate the individual PDFs:
   ```
   node tools/bima-5787/generate.js
   ```
   Output lands in `tools/bima-5787/out/pdfs/`, numbered so alphabetical
   sort = chronological order, plus `out/manifest.json` recording success/
   failure per occasion.
3. Render the cover page (`cover.html`) to PDF the same way (any
   HTML-to-PDF tool — Playwright's `page.pdf()` works fine).
4. Merge cover + all files in `out/pdfs/` (in filename order) into one
   PDF, e.g. with `pypdf`:
   ```python
   from pypdf import PdfWriter, PdfReader
   writer = PdfWriter()
   writer.append(PdfReader('cover.pdf'))
   for f in sorted(glob.glob('out/pdfs/*.pdf')):
       writer.append(PdfReader(f))
   writer.write('Bima-Tikkun-5787-Diaspora.pdf')
   ```

## Regenerating for a different year

`occasions.json` is specific to 5787. To build another year: pull
`PARASHA_LISTS.diaspora` and `HOLIDAY_DATA.diaspora` out of `index.html`,
filter parshiot to the target Hebrew year's Gregorian date range, filter
holiday entries by `hdate` ending in that Hebrew year, sort by date, and
write out the same `{kind, date, label, holidayKey?}` shape.

## Known limitation

The three combined weeks in 5787 (none occur this year, since 5787 is a
leap year and weeks split apart — but in a non-leap Diaspora year,
Chukat-Balak/Matot-Masei/Nitzavim-Vayeilech would render as a single
occasion using the app's own combined-week ranges, same as the live
site). No special handling was needed here.
