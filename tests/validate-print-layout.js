// Validates Step 4 of line-sync: print-time line breaks must be computed
// against a fixed reference width (PRINT_REF_WIDTH, ~680px), independent
// of whatever viewport/device triggered the print — NOT just whatever
// breaks happened to be on screen already.
//
// Loads the real index.html in a headless browser, injects a synthetic
// practice-body with a long token array (so it reliably wraps to multiple
// lines at any plausible width), then:
//   1. Confirms print-layout output is IDENTICAL across two very different
//      viewport widths (mobile-narrow vs. desktop-wide) — proving it does
//      not depend on the viewport.
//   2. Confirms print-layout output DIFFERS from the on-screen layout when
//      the viewport width differs meaningfully from PRINT_REF_WIDTH —
//      proving it isn't just reusing whatever was last rendered.
//   3. Confirms scroll/vowel columns stay token-count-aligned (same number
//      of <br> breaks in both columns) after print-layout is applied.
//
// Run with: node tests/validate-print-layout.js

const { chromium } = require('playwright');
const path = require('path');

const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Build a synthetic but realistic-shaped token array: alternating
// short/long "words" so it wraps unpredictably and reliably spans many
// lines, independent of any real Sefaria data (keeps this test offline
// and fast).
function makeFakeTokens(n) {
  const words = ['אֱלֹהִים','בָּרָא','אֶת','הַשָּׁמַיִם','וְאֵת','הָאָרֶץ','וְהָאָרֶץ','הָיְתָה','תֹהוּ','וָבֹהוּ'];
  const scrollWords = ['אלהים','ברא','את','השמים','ואת','הארץ','והארץ','היתה','תהו','ובהו'];
  const tokens = [];
  for (let i = 0; i < n; i++) {
    tokens.push({
      vowel: words[i % words.length],
      scroll: scrollWords[i % scrollWords.length],
      verseNum: (i % 7 === 0) ? Math.floor(i / 7) + 1 : null,
    });
  }
  return tokens;
}

async function injectFakeAliyah(page, tokens) {
  await page.evaluate((tokens) => {
    // Ensure the practice section is "visible" per syncAllPracticeColumns'
    // own gating check.
    let section = document.querySelector('.practice-section');
    if (!section) {
      section = document.createElement('div');
      section.className = 'practice-section visible';
      document.body.appendChild(section);
    } else {
      section.classList.add('visible');
    }

    const id = 'test-token-id';
    window.__aliyahTokenRegistry[id] = tokens;

    let body = document.querySelector(`.practice-body[data-token-id="${id}"]`);
    if (!body) {
      body = document.createElement('div');
      body.className = 'practice-body';
      body.dataset.tokenId = id;
      body.innerHTML = '<div class="col-scroll" dir="rtl"></div><div class="col-vowel" dir="rtl"></div>';
      section.appendChild(body);
    }
  }, tokens);
}

async function getColumnsBrCounts(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.practice-body[data-token-id="test-token-id"]');
    const vowelHtml = body.querySelector('.col-vowel').innerHTML;
    const scrollHtml = body.querySelector('.col-scroll').innerHTML;
    const count = (html) => (html.match(/<br>/g) || []).length;
    return { vowelBr: count(vowelHtml), scrollBr: count(scrollHtml), vowelHtml, scrollHtml };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let failures = 0;

  const tokens = makeFakeTokens(120);

  // --- Test 1: print layout is viewport-independent ---
  await page.setViewportSize({ width: 360, height: 800 }); // mobile-narrow
  await page.goto(FILE_URL);
  await injectFakeAliyah(page, tokens);
  await page.evaluate(() => window.applyPrintLayout());
  const printNarrow = await getColumnsBrCounts(page);

  await page.setViewportSize({ width: 1400, height: 900 }); // desktop-wide
  // applyPrintLayout uses an absolutely-positioned, fixed-width offscreen
  // probe — it should NOT be affected by re-running at a different
  // viewport. Re-inject onto the same loaded page (no reload) to prove
  // the *viewport* change alone doesn't change the result.
  await injectFakeAliyah(page, tokens); // idempotent: re-registers same tokens
  await page.evaluate(() => window.applyPrintLayout());
  const printWide = await getColumnsBrCounts(page);

  if (printNarrow.vowelHtml !== printWide.vowelHtml || printNarrow.scrollHtml !== printWide.scrollHtml) {
    console.log('FAIL: print layout differs between 360px and 1400px viewports — it should be viewport-independent.');
    console.log('  360px breaks:', printNarrow.vowelBr, ' 1400px breaks:', printWide.vowelBr);
    failures++;
  } else {
    console.log('PASS: print layout identical across 360px and 1400px viewports (' + printNarrow.vowelBr + ' breaks each).');
  }

  // --- Test 2: print layout differs from on-screen layout at a viewport
  // far from PRINT_REF_WIDTH (680px) — proves it isn't just reusing
  // whatever was already on screen.
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.reload();
  await injectFakeAliyah(page, tokens);
  // Force the practice-body's column width to roughly match the full
  // 1400px viewport (no max-width cap in this synthetic body), then
  // render on-screen breaks via the normal screen path.
  await page.evaluate(() => {
    const body = document.querySelector('.practice-body[data-token-id="test-token-id"]');
    body.style.display = 'block';
    const vowelEl = body.querySelector('.col-vowel');
    const scrollEl = body.querySelector('.col-scroll');
    vowelEl.style.width = '1300px';
    window.renderSyncedColumns(window.__aliyahTokenRegistry['test-token-id'], vowelEl, scrollEl);
  });
  const onScreenWide = await getColumnsBrCounts(page);

  await page.evaluate(() => window.applyPrintLayout());
  const printAfterWide = await getColumnsBrCounts(page);

  if (onScreenWide.vowelBr === printAfterWide.vowelBr && onScreenWide.vowelHtml === printAfterWide.vowelHtml) {
    console.log('FAIL: print layout is identical to the 1300px-wide on-screen layout — expected it to differ (print targets ~680px).');
    failures++;
  } else {
    console.log('PASS: print layout (' + printAfterWide.vowelBr + ' breaks) differs from 1300px on-screen layout (' + onScreenWide.vowelBr + ' breaks), as expected.');
  }

  // --- Test 3: scroll/vowel stay break-count-aligned after print layout ---
  if (printAfterWide.vowelBr !== printAfterWide.scrollBr) {
    console.log('FAIL: vowel and scroll columns have different break counts after print layout (' +
      printAfterWide.vowelBr + ' vs ' + printAfterWide.scrollBr + ') — token alignment broken.');
    failures++;
  } else {
    console.log('PASS: vowel and scroll columns have identical break counts after print layout (' + printAfterWide.vowelBr + ' each).');
  }

  await browser.close();

  if (failures > 0) {
    console.log(`\n${failures} FAILURE(S)`);
    process.exit(1);
  } else {
    console.log('\nALL PASS');
  }
})();
