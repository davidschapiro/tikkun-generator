// Checks the unverified assumption noted in AGENTS.md §11 item 1: does
// line-sync's vowel-only width measurement ever miss a case where the
// SCROLL column is actually wider for a given LINE (as the app defines a
// line — by vowel's own break points)? Most likely cause: maqaf-joined
// words rendering as a literal space in scroll, inflating its visual
// width relative to vowel for that token.
//
// CORRECT method (a first version of this script compared two
// independently-greedy-wrapped break sets and found thousands of
// "violations" — that was the wrong test: two texts with different
// per-token widths throughout will essentially never choose the same
// greedy break points by chance, even when one is uniformly wider. The
// real question is narrower: for each LINE as vowel actually defines it
// (the token range between two consecutive vowel breaks — exactly what
// the real app would put on one printed/screen row), does the SCROLL
// rendering of that same token range ever need more than one row when
// confined to the same width? That's the only scenario that would
// actually break the real app, since the real app only ever measures
// vowel and trusts scroll to fit in the same break points.
//
// This is a one-off investigative script (not part of the permanent test
// suite) — see /tests/validate-tokenizer.js and
// /tests/validate-print-layout.js for the maintained suite.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { buildTokens } = require('../tokenizer.js');

const WIDTHS = [300, 400, 530, 680]; // print/mobile, tablet, desktop, generous-desktop

async function computeBreaksAtWidth(page, tokens, width, key) {
  return page.evaluate(({ tokens, width, key }) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.left = '-99999px';
    probe.style.top = '0';
    probe.style.width = width + 'px';
    probe.dir = 'rtl';
    probe.style.fontFamily = "'ShlomoSemiStam','Arimo',sans-serif";
    probe.style.fontSize = '1.05rem';
    probe.style.lineHeight = '2.3';
    document.body.appendChild(probe);
    probe.innerHTML = tokens.map((t, i) => `<span class="ttok" data-i="${i}">${t[key]}</span>`).join(' ');
    const spans = probe.querySelectorAll('.ttok');
    const breaks = [];
    let lastTop = null;
    spans.forEach((span, i) => {
      const top = span.offsetTop;
      if (lastTop !== null && top > lastTop + 2) breaks.push(i);
      lastTop = top;
    });
    document.body.removeChild(probe);
    return breaks;
  }, { tokens, width, key });
}

// For every vowel-defined line segment, check if rendering ONLY that
// segment's scroll tokens (same width, natural wrap allowed) produces
// more than one visual row. Batches all segments into one probe pass per
// width for speed.
async function findScrollOverflows(page, tokens, vowelBreaks, width) {
  return page.evaluate(({ tokens, vowelBreaks, width }) => {
    const boundaries = [0, ...vowelBreaks, tokens.length];
    const results = [];
    for (let s = 0; s < boundaries.length - 1; s++) {
      const start = boundaries[s], end = boundaries[s + 1];
      if (end <= start) continue;
      const probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.left = '-99999px';
      probe.style.top = '0';
      probe.style.width = width + 'px';
      probe.dir = 'rtl';
      probe.style.fontFamily = "'ShlomoSemiStam','Arimo',sans-serif";
      probe.style.fontSize = '1.05rem';
      probe.style.lineHeight = '2.3';
      document.body.appendChild(probe);
      let html = '';
      for (let i = start; i < end; i++) html += `<span class="ttok" data-i="${i}">${tokens[i].scroll}</span> `;
      probe.innerHTML = html;
      const spans = probe.querySelectorAll('.ttok');
      let firstTop = null, overflowed = false;
      spans.forEach(span => {
        if (firstTop === null) firstTop = span.offsetTop;
        else if (span.offsetTop > firstTop + 2) overflowed = true;
      });
      document.body.removeChild(probe);
      if (overflowed) results.push({ start, end });
    }
    return results;
  }, { tokens, vowelBreaks, width });
}

(async () => {
  console.log('Loading full-torah-reference.json and building the full token stream...');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'full-torah-reference.json'), 'utf8'));
  const verses = raw.map(([v, he]) => ({ v, he }));
  const { tokens, mismatches } = buildTokens(verses);
  console.log(`Total tokens: ${tokens.length}, mismatches: ${mismatches.length}`);
  if (mismatches.length > 0) {
    console.log('ABORTING: tokenizer mismatches present — fix those first (see validate-tokenizer.js).');
    process.exit(1);
  }

  const plainTokens = tokens.map(t => ({
    vowel: t.vowel.replace(/<sup class="vn">.*?<\/sup>/, ''),
    scroll: t.scroll,
  }));

  const browser = await chromium.launch();
  const page = await browser.newPage();

  let totalOverflows = 0;

  for (const width of WIDTHS) {
    console.log(`\n--- width ${width}px ---`);
    const vowelBreaks = await computeBreaksAtWidth(page, plainTokens, width, 'vowel');
    console.log(`vowel-defined lines: ${vowelBreaks.length + 1}`);
    const overflows = await findScrollOverflows(page, plainTokens, vowelBreaks, width);
    totalOverflows += overflows.length;
    if (overflows.length === 0) {
      console.log(`PASS: every one of those ${vowelBreaks.length + 1} vowel-defined lines fits scroll's text too, with zero internal overflow.`);
    } else {
      console.log(`FAIL: ${overflows.length} line(s) where scroll overflows vowel's line break. First few:`);
      for (const { start, end } of overflows.slice(0, 10)) {
        let v = null;
        for (let j = start; j >= 0; j--) { if (tokens[j].verseNum) { v = tokens[j].verseNum; break; } }
        const scrollText = plainTokens.slice(start, end).map(t => t.scroll).join(' ');
        const vowelText = plainTokens.slice(start, end).map(t => t.vowel).join(' ');
        console.log(`  tokens [${start},${end}) verse ~${v}:`);
        console.log(`    vowel:  ${vowelText}`);
        console.log(`    scroll: ${scrollText}`);
      }
    }
  }

  await browser.close();

  console.log(`\n=== TOTAL OVERFLOWS ACROSS ALL WIDTHS: ${totalOverflows} ===`);
  process.exit(totalOverflows > 0 ? 1 : 0);
})();
