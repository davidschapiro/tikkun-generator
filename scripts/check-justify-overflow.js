// Verifies the new block-justify feature (justifyColumnHTML in index.html)
// never causes a line to overflow/re-wrap internally, across the ENTIRE
// Torah, at several representative widths. This is the exact failure
// mode that caused the print-jumbling bug fixed earlier in this project
// (see AGENTS.md §5) — a line that's stretched a hair too far overflows
// its container and silently wraps a second time, breaking row alignment.
//
// Method: for each width, compute real breaks (vowel-measured, as the
// real app does), build the justified HTML for both columns using the
// app's actual buildJustifiedColumnHTML function (loaded live in a real
// browser page, not reimplemented here), then check every resulting line
// in both columns for internal overflow (more than one visual row).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { buildTokens } = require('../tokenizer.js');

const WIDTHS = [300, 400, 530]; // print/narrow-mobile, tablet, real maximum
// (confirmed empirically: even on a 2400px-wide screen, .content's
// max-width:1100px caps the real column width at ~530px — there is no
// realistic scenario where a column exceeds that)

(async () => {
  console.log('Loading full-torah-reference.json and building the full token stream...');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'full-torah-reference.json'), 'utf8'));
  // IMPORTANT: v must be a bare integer (i+1), matching production
  // exactly (index.html: verses.push({ch, v:i+1, he})) — NOT raw[i][0],
  // the full reference string like "Exodus 26:2". Using the full string
  // here previously produced a confirmed false impression of overflow
  // (see AGENTS.md §5): the embedded space within "Exodus 26:2" gets
  // counted as an extra stretchable gap that doesn't exist in real data.
  const verses = raw.map(([v, he], i) => ({ v: i + 1, he }));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Load the real app so we use the REAL buildJustifiedColumnHTML,
  // measureNaturalWidth, etc. — not a reimplementation that could drift
  // from what actually ships.
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(1500);
  // Same documented first-measurement timing issue as ensurePrintProbeWarm
  // in index.html (AGENTS.md §5/§9): the very first real layout
  // measurement after load can be unreliable. Warm up before trusting any
  // measurement in this script too.
  await page.evaluate(() => window.ensurePrintProbeWarm ? window.ensurePrintProbeWarm() : Promise.resolve());
  await page.waitForTimeout(50);

  const { tokens, mismatches } = await page.evaluate((verses) => {
    return window.buildTokens ? window.buildTokens(verses) : (() => { throw new Error('buildTokens not on window'); })();
  }, verses).catch(async () => {
    // buildTokens isn't attached to window directly; use the Node copy
    // for token construction (pure data transform, no DOM needed) and
    // only use the page for the DOM-dependent justify/measurement step.
    return buildTokens(verses);
  });
  console.log(`Total tokens: ${tokens.length}, mismatches: ${mismatches.length}`);
  if (mismatches.length > 0) {
    console.log('ABORTING: tokenizer mismatches present.');
    process.exit(1);
  }

  let totalOverflows = 0;
  const fontSpec = { fontFamily: "'ShlomoSemiStam','Arimo',sans-serif", fontSize: '1.05rem', lineHeight: '2.3', wordSpacing: '0.05em' };

  for (const width of WIDTHS) {
    console.log(`\n--- width ${width}px ---`);
    const result = await page.evaluate(({ tokens, width, fontSpec }) => {
      // Real, shipped break computation: vowel's own natural breaks
      // only — the vowel-vs-scroll overflow (AGENTS.md TODO item) is now
      // handled by per-line compression INSIDE buildJustifiedColumnHTML,
      // not by patching the break list.
      const breaks = window.computeBreaksAtWidth(tokens, width);

      // Real justified HTML via the actual shipped function.
      const vowelHtml = window.buildJustifiedColumnHTML(tokens, breaks, 'vowel', width, fontSpec);
      const scrollHtml = window.buildJustifiedColumnHTML(tokens, breaks, 'scroll', width, fontSpec);
      const wasStretched = (html) => html.split('<br>').map(l => l.includes('word-spacing'));

      // Render each justified column in a REAL fixed-width container and
      // check every line for internal overflow (more than 1 row).
      function checkOverflow(html, key) {
        const container = document.createElement('div');
        container.style.position = 'absolute'; container.style.visibility = 'hidden';
        container.style.left = '-99999px'; container.style.top = '0'; container.style.width = width + 'px';
        container.dir = 'rtl';
        container.style.fontFamily = fontSpec.fontFamily; container.style.fontSize = fontSpec.fontSize; container.style.lineHeight = fontSpec.lineHeight;
        container.style.wordSpacing = fontSpec.wordSpacing;
        document.body.appendChild(container);
        const lines = html.split('<br>');
        const overflowed = [];
        lines.forEach((lineHtml, idx) => {
          container.innerHTML = lineHtml;
          const range = document.createRange();
          range.selectNodeContents(container);
          const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
          const tops = rects.map(r => r.top).sort((a, b) => a - b);
          // Cluster tops within half a line-height as the same visual row
          // — a <sup class="vn"> verse number's vertical-align:super
          // naturally sits a few px above baseline text on the SAME row;
          // that is not an overflow. Only a gap close to a full
          // line-height apart indicates a genuine second row.
          const lineHeightPx = parseFloat(window.getComputedStyle(container).lineHeight) || 30;
          let rowCount = 1;
          for (let i = 1; i < tops.length; i++) {
            if (tops[i] - tops[i - 1] > lineHeightPx / 2) rowCount++;
          }
          if (rowCount > 1) overflowed.push(idx);
        });
        document.body.removeChild(container);
        return overflowed;
      }

      const vowelOverflows = checkOverflow(vowelHtml, 'vowel');
      const scrollOverflows = checkOverflow(scrollHtml, 'scroll');
      const vowelStretched = wasStretched(vowelHtml);
      const scrollStretched = wasStretched(scrollHtml);
      return {
        lineCount: breaks.length + 1, vowelOverflows, scrollOverflows,
        vowelOverflowsStretched: vowelOverflows.map(i => vowelStretched[i]),
        scrollOverflowsStretched: scrollOverflows.map(i => scrollStretched[i]),
      };
    }, { tokens, width, fontSpec });

    console.log(`lines: ${result.lineCount}`);
    const total = result.vowelOverflows.length + result.scrollOverflows.length;
    totalOverflows += total;
    if (total === 0) {
      console.log(`PASS: zero internal overflow in either column across all ${result.lineCount} lines.`);
    } else {
      console.log(`FAIL: vowel overflows at line indices ${JSON.stringify(result.vowelOverflows.slice(0,10))}, stretched: ${JSON.stringify(result.vowelOverflowsStretched.slice(0,10))}`);
      console.log(`FAIL: scroll overflows at line indices ${JSON.stringify(result.scrollOverflows.slice(0,10))}, stretched: ${JSON.stringify(result.scrollOverflowsStretched.slice(0,10))}`);
      const anyStretchedOverflow = result.vowelOverflowsStretched.includes(true) || result.scrollOverflowsStretched.includes(true);
      console.log(anyStretchedOverflow ? '  >>> AT LEAST ONE OVERFLOW WAS ACTUALLY STRETCHED BY JUSTIFY <<<' : '  (all overflows here are pure pass-through, zero stretch applied — pre-existing, not justify-caused)');
    }
  }

  await browser.close();
  console.log(`\n=== TOTAL OVERFLOWS ACROSS ALL WIDTHS: ${totalOverflows} ===`);
  process.exit(totalOverflows > 0 ? 1 : 0);
})();
