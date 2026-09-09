// Renders every occasion in occasions.json to an individual PDF by driving
// the live app in headless Chromium — reuses all existing tokenization,
// coloring, and print-layout logic rather than reimplementing any of it.
//
// Usage:
//   1. Serve the repo root over HTTP (fetch() to Sefaria needs a real
//      origin, not file://) — e.g. from the repo root:
//        python3 -m http.server 8791
//   2. node tools/bima-5787/generate.js
//   3. Merge tools/bima-5787/out/pdfs/*.pdf (in numeric filename order,
//      which is chronological) plus tools/bima-5787/out/cover.pdf into one
//      PDF — e.g. with pypdf's PdfWriter.append() per file, in order.
//
// Override the app's URL with BIMA_BASE_URL if you're not using port 8791.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BASE = process.env.BIMA_BASE_URL || 'http://localhost:8791/index.html';
const OUT_DIR = path.join(HERE, 'out', 'pdfs');
const occasions = JSON.parse(fs.readFileSync(path.join(HERE, 'occasions.json'), 'utf-8'));

function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    // Needed in networks that intercept TLS (e.g. some sandboxed/proxied
    // dev environments) — harmless for a personal batch-generation tool
    // like this one, but remove if running somewhere with a normal
    // trusted certificate chain and you'd rather keep validation on.
    ignoreHTTPSErrors: true,
  });
  // Force the Bima tab on every navigation, before the page's own init()
  // runs — the app otherwise defaults to whatever's in localStorage, which
  // starts empty (Practice tab) on a fresh context.
  await context.addInitScript(() => {
    window.localStorage.setItem('tikkunTab', 'bima');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const manifest = [];

  for (let i = 0; i < occasions.length; i++) {
    const o = occasions[i];
    const url = o.kind === 'holiday'
      ? `${BASE}?h=${encodeURIComponent(o.holidayKey)}`
      : `${BASE}?d=${o.date}`;
    const idx = String(i + 1).padStart(3, '0');
    const outFile = path.join(OUT_DIR, `${idx}_${slug(o.label)}.pdf`);

    if (fs.existsSync(outFile)) {
      manifest.push({ ...o, file: outFile, ok: true, skipped: true });
      console.log(`[${idx}/${occasions.length}] ${o.date} ${o.label} ... already done, skipping`);
      continue;
    }

    process.stdout.write(`[${idx}/${occasions.length}] ${o.date} ${o.label} ... `);
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      // Wait for actual Torah text to have rendered in the Bima section —
      // networkidle alone can fire between the chapter fetch and the
      // synchronous render/tokenize pass that follows it.
      await page.waitForSelector('.bima-section .aliyah .bima-body', { timeout: 40000 });
      // Give layout (font loading, column sync) a moment to settle — same
      // margin of caution the app's own print button gives itself via
      // setTimeout(...,0) for practice columns.
      await page.waitForTimeout(300);

      if (o.titleSuffix) {
        // Fast days whose Mincha reading is byte-identical to Shacharit
        // (see occasions.json build script) — this occasion's single
        // entry stands in for both, so the printed title says so.
        await page.evaluate((suffix) => {
          document.querySelectorAll('.print-header .ph-he, .print-header .ph-en')
            .forEach(el => { el.textContent += suffix; });
        }, o.titleSuffix);
      }

      await page.evaluate(() => document.body.classList.add('print-bima'));
      await page.pdf({
        path: outFile,
        format: 'Letter',
        preferCSSPageSize: true, // respect the app's own @page margin rule
        printBackground: true,
      });
      await page.evaluate(() => document.body.classList.remove('print-bima'));

      manifest.push({ ...o, file: outFile, ok: true });
      console.log('ok');
    } catch (err) {
      manifest.push({ ...o, ok: false, error: String(err) });
      console.log('FAILED:', err.message.split('\n')[0]);
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(HERE, 'out', 'manifest.json'), JSON.stringify(manifest, null, 2));
  const failed = manifest.filter(m => !m.ok);
  console.log(`\nDone. ${manifest.length - failed.length}/${manifest.length} succeeded.`);
  if (failed.length) {
    console.log('Failed:', failed.map(f => `${f.date} ${f.label}`).join('; '));
  }
})();

