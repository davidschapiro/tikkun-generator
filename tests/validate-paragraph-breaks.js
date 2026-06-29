// Combined petucha + setuma validation, across the entire Torah, at every
// realistic column width. Written after both features were finalized
// (petucha: line-break + never-alone, shipped; setuma: edge-pull gap,
// shipped) — per the project's explicit decision to build one test
// covering both together rather than two separate passes (AGENTS.md §11).
//
// What this checks, per width in WIDTHS:
//   1. Every petucha marker is immediately followed by a forced break
//      (the existing invariant baked into measurableTokenHtml).
//   2. No petucha is left alone as the sole token on its line
//      (pullPetuchaCompanion's job).
//   3. No setuma sits as the very first or last token of a line UNLESS
//      pullSetumaCompanion genuinely could not avoid it (a known,
//      accepted residual edge case — see AGENTS.md §11 "Gap-size
//      decision"). Those are counted and reported, not treated as
//      failures, but a regression (a large jump in count) would be
//      visible immediately in the printed totals.
//   4. Zero internal line overflow in either column, at any width —
//      same overflow-detection method as scripts/check-justify-overflow.js,
//      reused here so a regression in either paragraph-break feature
//      can't silently re-wrap a line a second time.
//
// IMPORTANT, per AGENTS.md's repeated lesson in this exact area of the
// codebase: passing this test is necessary but NOT sufficient. Always
// also look at a real screenshot at a real device width before
// considering a change to petucha/setuma handling done.
//
// Run with: node tests/validate-paragraph-breaks.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { buildTokens } = require('../tokenizer.js');

const WIDTHS = [300, 400, 530]; // print/narrow-mobile, tablet, real max (.content max-width:1100px caps real column width at ~530px)
const fontSpec = { fontFamily: "'ShlomoSemiStam','Arimo',sans-serif", fontSize: '1.05rem', lineHeight: '2.3', wordSpacing: '0.05em' };

(async () => {
  console.log('Loading full-torah-reference.json and building the full token stream...');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'full-torah-reference.json'), 'utf8'));
  // v must be a bare integer (i+1), matching production exactly — see
  // AGENTS.md §5 for why using the raw reference string here is wrong.
  const verses = raw.map(([, he], i) => ({ v: i + 1, he }));

  const { tokens, mismatches } = buildTokens(verses);
  console.log(`Total tokens: ${tokens.length}, mismatches: ${mismatches.length}`);
  if (mismatches.length > 0) {
    console.log('ABORTING: tokenizer mismatches present.');
    process.exit(1);
  }

  const petuchaCount = tokens.filter(t => t.vowel === '<span class="pm">פ</span>').length;
  const setumaCount = tokens.filter(t => t.vowel === '<span class="pm pm-samekh">ס</span>').length;
  console.log(`Petucha markers in full Torah: ${petuchaCount}`);
  console.log(`Setuma markers in full Torah: ${setumaCount}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.ensurePrintProbeWarm ? window.ensurePrintProbeWarm() : Promise.resolve());
  await page.waitForTimeout(50);

  let anyFailure = false;

  for (const width of WIDTHS) {
    console.log(`\n--- width ${width}px ---`);
    const result = await page.evaluate(({ tokens, width, fontSpec }) => {
      const naturalBreaks = window.computeBreaksAtWidth(tokens, width);
      const afterPetucha = window.pullPetuchaCompanion(tokens, naturalBreaks, width, fontSpec);
      const finalBreaks = window.pullSetumaCompanion(tokens, afterPetucha, width, fontSpec);

      // Reconstruct line boundaries (token index ranges) from the break list.
      const lineRanges = [];
      let start = 0;
      for (const b of finalBreaks) { lineRanges.push([start, b]); start = b; }
      lineRanges.push([start, tokens.length]);

      const PETUCHA = '<span class="pm">פ</span>';
      const SETUMA = '<span class="pm pm-samekh">ס</span>';

      // Check 1 + 2: every petucha followed by a break, and never alone.
      let petuchaMissingBreak = 0, petuchaAlone = 0;
      tokens.forEach((t, i) => {
        if (t.vowel !== PETUCHA) return;
        const isLastToken = i === tokens.length - 1;
        if (!isLastToken && !finalBreaks.includes(i + 1)) petuchaMissingBreak++;
        const line = lineRanges.find(([s, e]) => i >= s && i < e);
        if (line && (line[1] - line[0]) === 1) petuchaAlone++;
      });

      // Check 3: setuma at a line edge (informational — known residual cases exist).
      let setumaAtEdge = 0;
      lineRanges.forEach(([s, e]) => {
        if (tokens[s] && tokens[s].vowel === SETUMA) setumaAtEdge++;
        if (e > s && tokens[e - 1] && tokens[e - 1].vowel === SETUMA && e - 1 !== s) setumaAtEdge++;
      });

      // Check 4: zero internal overflow, both columns, real justified HTML.
      const vowelHtml = window.buildJustifiedColumnHTML(tokens, finalBreaks, 'vowel', width, fontSpec);
      const scrollHtml = window.buildJustifiedColumnHTML(tokens, finalBreaks, 'scroll', width, fontSpec);

      function checkOverflow(html) {
        const container = document.createElement('div');
        container.style.position = 'absolute'; container.style.visibility = 'hidden';
        container.style.left = '-99999px'; container.style.top = '0'; container.style.width = width + 'px';
        container.dir = 'rtl';
        container.style.fontFamily = fontSpec.fontFamily; container.style.fontSize = fontSpec.fontSize;
        container.style.lineHeight = fontSpec.lineHeight; container.style.wordSpacing = fontSpec.wordSpacing;
        document.body.appendChild(container);
        const lines = html.split('<br>');
        const overflowed = [];
        lines.forEach((lineHtml, idx) => {
          container.innerHTML = lineHtml;
          const range = document.createRange();
          range.selectNodeContents(container);
          const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
          const tops = rects.map(r => r.top).sort((a, b) => a - b);
          const lineHeightPx = parseFloat(window.getComputedStyle(container).lineHeight) || 30;
          let rowCount = 1;
          for (let i = 1; i < tops.length; i++) {
            if (tops[i] - tops[i - 1] > lineHeightPx / 2) rowCount++;
          }
          if (rowCount > 1) overflowed.push(idx);
        });
        document.body.removeChild(container);
        return overflowed.length;
      }

      return {
        lineCount: finalBreaks.length + 1,
        petuchaMissingBreak,
        petuchaAlone,
        setumaAtEdge,
        vowelOverflows: checkOverflow(vowelHtml),
        scrollOverflows: checkOverflow(scrollHtml),
      };
    }, { tokens, width, fontSpec });

    console.log(`lines: ${result.lineCount}`);
    console.log(`petucha missing forced break: ${result.petuchaMissingBreak} (must be 0)`);
    console.log(`petucha alone on its line: ${result.petuchaAlone} (must be 0)`);
    console.log(`setuma at a line edge (start or end): ${result.setumaAtEdge} (informational — known residual edge cases, see AGENTS.md §11)`);
    console.log(`vowel internal overflows: ${result.vowelOverflows} (must be 0)`);
    console.log(`scroll internal overflows: ${result.scrollOverflows} (must be 0)`);

    if (result.petuchaMissingBreak > 0 || result.petuchaAlone > 0 || result.vowelOverflows > 0 || result.scrollOverflows > 0) {
      anyFailure = true;
      console.log('FAIL at this width.');
    } else {
      console.log('PASS at this width.');
    }
  }

  await browser.close();
  console.log(anyFailure ? '\n=== OVERALL: FAIL ===' : '\n=== OVERALL: PASS ===');
  process.exit(anyFailure ? 1 : 0);
})();
