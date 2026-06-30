// Print-geometry regression test. Written after a real bug shipped to
// main and was only caught by a human looking at an actual printed PDF
// (see git history, June 2026): refreshPrintColumns() read padding via
// getComputedStyle() at a point where @media print wasn't active, so it
// silently read 0 instead of the real print-time padding, undercounting
// the content-box compensation and making every printed line wrap far
// too early. Nothing in the existing suite would have caught this,
// because validate-paragraph-breaks.js measures against a synthetic
// width (300px) directly -- it never goes through the ACTUAL CSS cascade
// a real print job uses (.col-vowel-print/.col-scroll-print's real
// padding/border only exist inside @media print), so a bug specifically
// IN that cascade-dependent code path was invisible to it.
//
// This test closes that gap by using Playwright's real emulateMedia
// to put the page in actual print mode, then measuring the REAL
// rendered DOM -- not a synthetic probe -- to verify:
//
//   1. Each print column's CONTENT width (not outer box width) is
//      pinned to exactly PRINT_REF_WIDTH, regardless of box-sizing mode
//      or which CSS rules happen to be cascading at the moment the JS
//      ran. This is the exact thing that broke.
//   2. The two columns are horizontally centered on the page as a unit
//      (left/right margins equal) -- the original "off-center" bug this
//      whole area of code was created to fix.
//   3. No line of real, real Torah-text content overflows its column at
//      actual print time (multiple aliyot, not just one).
//
// IMPORTANT: this test exercises the SAME refreshPrintColumns() code
// path failing here would actually run in a real Print button click or
// Ctrl+P -- it does not re-implement or assume the geometry, it measures
// whatever the real DOM produces after a real emulateMedia('print').
//
// Run with: node tests/validate-print-geometry.js

const { chromium } = require('playwright');
const path = require('path');

const TOLERANCE_PX = 1; // sub-pixel rounding only

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));

  // Don't rely on a fixed sleep -- generate() is async (fetches from
  // Sefaria, then runs refreshAllPrintColumns fire-and-forget per
  // AGENTS.md), so a flat waitForTimeout here is a real, observed race:
  // this test intermittently saw 0 aliyot on a cold run before the first
  // generate() had finished. Poll until the print columns actually have
  // content instead.
  await page.waitForFunction(() => {
    const els = document.querySelectorAll('.col-vowel-print');
    return els.length > 0 && [...els].every(el => el.innerHTML.trim().length > 0);
  }, { timeout: 15000 });
  await page.waitForTimeout(300); // settle after population, same caution as ensurePrintProbeWarm

  // Read PRINT_REF_WIDTH straight from the page's own JS rather than
  // duplicating the number here -- if that constant is ever retuned,
  // this test should track it automatically, not silently test against
  // a stale copy.
  const PRINT_REF_WIDTH = await page.evaluate(() => {
    // Top-level `const` in a classic <script> does NOT attach to
    // `window` (unlike `var`) -- evaluate the bare identifier directly
    // in page context instead.
    try { return PRINT_REF_WIDTH; } catch (e) { return null; }
  });
  if (!PRINT_REF_WIDTH) {
    console.log('FAIL: could not read PRINT_REF_WIDTH from the page (is it still exposed on window?).');
    process.exit(1);
  }
  console.log(`PRINT_REF_WIDTH = ${PRINT_REF_WIDTH}px`);

  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(200); // let print CSS settle

  const aliyotGeo = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll('.practice-body[data-token-id]')];
    return bodies.map(body => {
      const vowelEl = body.querySelector('.col-vowel-print');
      const scrollEl = body.querySelector('.col-scroll-print');
      const bodyRect = body.getBoundingClientRect();
      const vowelRect = vowelEl.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const vowelCS = window.getComputedStyle(vowelEl);
      const scrollCS = window.getComputedStyle(scrollEl);

      function contentWidth(rect, cs) {
        const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
        const borL = parseFloat(cs.borderLeftWidth), borR = parseFloat(cs.borderRightWidth);
        return rect.width - padL - padR - borL - borR;
      }

      // Real overflow check: does any line's actual rendered content
      // exceed its column's content box? Re-walk each <br>-delimited
      // line and compare its Range width against the content width.
      function checkOverflow(el, contentW) {
        const lines = el.innerHTML.split('<br>');
        const probe = document.createElement('div');
        probe.style.position = 'absolute'; probe.style.visibility = 'hidden';
        probe.style.left = '-99999px'; probe.style.width = el.clientWidth + 'px';
        probe.dir = 'rtl';
        const cs = window.getComputedStyle(el);
        probe.style.fontFamily = cs.fontFamily; probe.style.fontSize = cs.fontSize;
        probe.style.lineHeight = cs.lineHeight; probe.style.wordSpacing = cs.wordSpacing;
        document.body.appendChild(probe);
        let overflowCount = 0;
        lines.forEach(lineHtml => {
          probe.innerHTML = lineHtml;
          const range = document.createRange();
          range.selectNodeContents(probe);
          const rects = [...range.getClientRects()].filter(r => r.width > 0);
          if (rects.length === 0) return; // empty line (e.g. trailing fragment after a <br>)
          // Off-screen probe (left:-99999px) means real coordinates are
          // deeply negative -- a 0/Infinity sentinel fallback here would
          // silently corrupt the result (0 is "bigger" than any real
          // negative right-edge value, so Math.max would always pick
          // the sentinel instead of the real measurement). No fallback
          // needed since the empty case is already handled above.
          const maxRight = Math.max(...rects.map(r => r.right));
          const minLeft = Math.min(...rects.map(r => r.left));
          const lineWidth = maxRight - minLeft;
          if (lineWidth > contentW + 2) overflowCount++; // +2px float/AA slack
        });
        document.body.removeChild(probe);
        return overflowCount;
      }

      return {
        bodyLeft: bodyRect.left, bodyRight: bodyRect.right,
        vowelLeft: vowelRect.left, vowelRight: vowelRect.right,
        scrollLeft: scrollRect.left, scrollRight: scrollRect.right,
        vowelContentWidth: contentWidth(vowelRect, vowelCS),
        scrollContentWidth: contentWidth(scrollRect, scrollCS),
        vowelOverflows: checkOverflow(vowelEl, contentWidth(vowelRect, vowelCS)),
        scrollOverflows: checkOverflow(scrollEl, contentWidth(scrollRect, scrollCS)),
      };
    });
  });

  await browser.close();

  if (aliyotGeo.length === 0) {
    console.log('FAIL: no .practice-body[data-token-id] elements found -- did the page actually load a parasha?');
    process.exit(1);
  }

  console.log(`Checking ${aliyotGeo.length} aliyot...`);
  let anyFailure = false;

  aliyotGeo.forEach((g, i) => {
    const vowelDelta = Math.abs(g.vowelContentWidth - PRINT_REF_WIDTH);
    const scrollDelta = Math.abs(g.scrollContentWidth - PRINT_REF_WIDTH);
    const leftMargin = g.scrollLeft - g.bodyLeft;
    const rightMargin = g.bodyRight - g.vowelRight;
    const marginDelta = Math.abs(leftMargin - rightMargin);

    const pass = vowelDelta <= TOLERANCE_PX && scrollDelta <= TOLERANCE_PX
      && marginDelta <= TOLERANCE_PX && g.vowelOverflows === 0 && g.scrollOverflows === 0;

    if (!pass) anyFailure = true;
    console.log(`Aliyah ${i + 1}: vowel content width ${g.vowelContentWidth.toFixed(1)}px `
      + `(target ${PRINT_REF_WIDTH}, delta ${vowelDelta.toFixed(1)}), `
      + `scroll ${g.scrollContentWidth.toFixed(1)}px (delta ${scrollDelta.toFixed(1)}), `
      + `margins L${leftMargin.toFixed(1)}/R${rightMargin.toFixed(1)} (delta ${marginDelta.toFixed(1)}), `
      + `overflows V${g.vowelOverflows}/S${g.scrollOverflows} -- ${pass ? 'PASS' : 'FAIL'}`);
  });

  if (consoleErrors.length) {
    console.log('Console/page errors during load:', consoleErrors);
    anyFailure = true;
  }

  console.log(anyFailure ? '\n=== OVERALL: FAIL ===' : '\n=== OVERALL: PASS ===');
  process.exit(anyFailure ? 1 : 0);
})();
