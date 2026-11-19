// Custom reading test (Nov 2026) — real browser, real Sefaria.
//
//   1. "✏️ Custom" opens a dialog prefilled with the reading on screen
//      (its name as title, its aliyot as rows).
//   2. A title plus three aliyot (Sheni 28:13-15, Shlishi 28:16-19,
//      Revi'i 28:20-22 — a real request from a minyan with its own
//      division) render in Tikkun Korim and Bima Tikkun with the right
//      headers, verse counts, title and meta line; Cycle and
//      Diaspora/Israel are dimmed; the URL carries ct/cr.
//   3. Bad input is rejected with a message: unknown chapter, verse past
//      the chapter's end, end before start, the same aliyah twice.
//   4. The share link reproduces the reading in a fresh page; the title
//      is shown as text, never as HTML.
//   5. Reopening the dialog shows the custom reading for editing.
//   6. Shabbat/Weekday, the dropdown and the arrows leave the custom
//      reading (toggles un-dimmed, ct/cr gone from the URL).
//   7. Print: the Bima print header shows the custom title and meta.
//
// Run with: node tests/validate-custom-reading.js

const { chromium } = require('playwright');
const path = require('path');

const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route('**cloudflareinsights.com**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const ready = () => page.waitForFunction(() => document.querySelectorAll('.aliyah').length > 0 &&
    !document.querySelector('#statusArea .spinner'), { timeout: 30000 });
  const view = () => page.evaluate(() => ({
    date: document.getElementById('dateDisplay').textContent.trim(),
    name: document.getElementById('parashaName').textContent.trim(),
    url: location.search,
    practice: [...document.querySelectorAll('.practice-section .aliyah')].map(s => s.dataset.aliyah),
    bima: [...document.querySelectorAll('.bima-section .aliyah')].map(s => s.dataset.aliyah),
    hdrs: [...document.querySelectorAll('.bima-section .aliyah .lbl-range')].map(e => e.textContent.replace(/\s+/g, ' ').replace('▶ Listen', '').trim()),
    meta: document.querySelector('.bima-section .tikkun-meta').textContent.trim(),
    dimmed: ['modeToggle', 'locToggle'].map(id => document.getElementById(id).classList.contains('tg-inactive')),
    activeType: [...document.querySelectorAll('#readingTypeToggle .toggle-btn.active')].map(b => b.dataset.val),
  }));
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#crRows .cr-row')].map(r => ({
    key: r.querySelector('.cr-key').value, book: r.querySelector('.cr-book').value,
    range: r.querySelector('.cr-range').value })));
  const setRows = async (list) => {
    await page.click('#crClear');
    for (let i = 0; i < list.length; i++) {
      if (i > 0) await page.click('#crAddRow');
      const row = page.locator('#crRows .cr-row').nth(i);
      await row.locator('.cr-key').selectOption(list[i][0]);
      await row.locator('.cr-book').selectOption(list[i][1]);
      await row.locator('.cr-range').fill(list[i][2]);
    }
  };

  await page.goto(PAGE_URL);
  await page.evaluate(() => localStorage.clear());

  // 1. Prefill from the reading on screen (Vayetzei, Shabbat 21 Nov 2026, Full Kriyah).
  await page.goto(PAGE_URL + '?d=2026-11-21&mode=full');
  await ready();
  const before = await view();
  await page.click('#customReadingBtn');
  check(await page.isVisible('#customReadingDialog'), 'Custom button opens the dialog');
  const pre = await rows();
  check(await page.inputValue('#crTitle') === before.name, `title prefilled with the reading's name (${before.name})`);
  check(pre.length === before.practice.length && pre[0].key === '1' && pre[0].book === 'Genesis' && pre[0].range === '28:10-22',
    `rows prefilled with the reading's aliyot (${pre.length} rows, first ${pre[0] && pre[0].range})`);

  // 3. Validation (before the real submit, dialog stays open).
  const bad = async (list, re, msg) => {
    await setRows(list);
    await page.click('#crSubmit');
    const txt = await page.textContent('#crResult');
    check(await page.isVisible('#customReadingDialog') && re.test(txt), `${msg} → "${txt}"`);
  };
  await bad([['2', 'Genesis', '51:1-3']], /no chapter 51/, 'unknown chapter rejected');
  await bad([['2', 'Genesis', '28:13-30']], /only 22 verses/, 'verse past the end of the chapter rejected');
  await bad([['2', 'Genesis', '28:15-13']], /ends before it starts/, 'end before start rejected');
  await bad([['2', 'Genesis', '28:13-15'], ['2', 'Genesis', '28:16-19']], /appears twice/, 'same aliyah twice rejected');
  await bad([['2', 'Genesis', 'abc']], /not a range/, 'garbage rejected');

  // 2. The real request.
  await setRows([['2', 'Genesis', '28:13-15'], ['3', 'Genesis', '28.16–19'], ['4', 'Genesis', '28:20-28:22']]);
  check(await page.evaluate(() => !document.querySelector('#crTitle').hasAttribute('list') && !document.querySelector('datalist')),
    'title field has no datalist (no fake dropdown arrow)');
  await page.click('#crSuggest button:has-text("Bat Mitzvah")');
  check(await page.inputValue('#crTitle') === 'Bat Mitzvah', 'suggestion chip fills the title');
  await page.fill('#crTitle', 'Bar Mitzvah <b>X</b>');
  await page.click('#crSubmit');
  await ready();
  const v = await view();
  console.log('   ' + JSON.stringify(v));
  check(!(await page.isVisible('#customReadingDialog')), 'dialog closes on Show');
  check(v.name === 'Bar Mitzvah <b>X</b>' && v.date === 'Custom reading', 'header shows the title (as text) and "Custom reading"');
  check(v.practice.join() === '2,3,4' && v.bima.join() === '2,3,4', 'Sheni, Shlishi, Revi\'i in both tabs');
  check(/Genesis 28:13-28:15 \(3 v\.\)/.test(v.hdrs[0]) && /28:16-28:19 \(4 v\.\)/.test(v.hdrs[1]) && /28:20-28:22 \(3 v\.\)/.test(v.hdrs[2]),
    'aliyah headers carry the ranges and verse counts (3, 4, 3)');
  check(v.meta === 'Custom reading · Genesis 28:13-22', `meta line summarises the reading (${v.meta})`);
  check(v.dimmed.every(Boolean) && v.activeType.length === 0, 'Cycle and Diaspora/Israel dimmed, Shabbat/Weekday neither active');
  const q = new URLSearchParams(v.url);
  check(q.get('ct') === 'Bar Mitzvah <b>X</b>' && q.get('cr') === '2_Genesis.28.13-28.15,3_Genesis.28.16-28.19,4_Genesis.28.20-28.22'
    && [...q.keys()].sort().join() === 'cr,ct', `URL carries ct/cr only (${v.url})`);
  const bimaText = await page.textContent('.bima-section .aliyah[data-aliyah="2"] .bima-body');
  check(/וְהִנֵּ֨ה/.test(bimaText) || /והנה/.test(bimaText.replace(/[֑-ׇ]/g, '')), 'Bima text starts at 28:13 (והנה ה׳ נצב עליו)');
  check(await page.evaluate(() => !document.querySelector('.print-header b')), 'title is never parsed as HTML');

  // 7. Print header.
  await page.click('.tab-btn[data-tab="bima"]');
  await page.emulateMedia({ media: 'print' });
  const ph = await page.evaluate(() => {
    const h = document.querySelector('.bima-section .print-header');
    return h ? [h.querySelector('.ph-en').textContent, h.querySelector('.ph-meta').textContent] : null;
  });
  check(ph && /^Bar Mitzvah <b>X<\/b> · Bima Tikkun$/.test(ph[0]) && /Custom reading · Genesis 28:13-22/.test(ph[1]), `print header: ${ph && ph.join(' | ')}`);
  await page.emulateMedia({ media: 'screen' });
  await page.click('.tab-btn[data-tab="practice"]');

  // 4. Share link in a fresh page.
  const link = await page.evaluate(() => location.href);
  const page2 = await context.newPage();
  page2.on('pageerror', e => errors.push(String(e)));
  await page2.route('**cloudflareinsights.com**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page2.goto(link);
  await page2.waitForFunction(() => document.querySelectorAll('.aliyah').length > 0 && !document.querySelector('#statusArea .spinner'), { timeout: 30000 });
  const v2 = await page2.evaluate(() => ({
    name: document.getElementById('parashaName').textContent.trim(),
    keys: [...document.querySelectorAll('.practice-section .aliyah')].map(s => s.dataset.aliyah).join(),
  }));
  check(v2.name === 'Bar Mitzvah <b>X</b>' && v2.keys === '2,3,4', `share link reopens the custom reading (${v2.name} · ${v2.keys})`);
  // A link with a broken part keeps the good parts; a fully broken one falls back to Shabbat.
  await page2.goto(PAGE_URL + '?ct=T&cr=2_Genesis.28.13-28.15,99_Genesis.1.1-1.2,3_Genesis.99.1-99.2');
  await page2.waitForFunction(() => document.querySelectorAll('.aliyah').length > 0 && !document.querySelector('#statusArea .spinner'), { timeout: 30000 });
  check(await page2.evaluate(() => [...document.querySelectorAll('.practice-section .aliyah')].map(s => s.dataset.aliyah).join()) === '2',
    'hand-edited link: invalid aliyot dropped, valid one kept');
  await page2.close();

  // 5. Edit flow.
  await page.click('#customReadingBtn');
  const again = await rows();
  check(await page.inputValue('#crTitle') === 'Bar Mitzvah <b>X</b>' && again.map(r => r.key + ' ' + r.range).join() === '2 28:13-15,3 28:16-19,4 28:20-22',
    `reopening shows the custom reading for editing (${again.map(r => r.range).join(', ')})`);
  await page.click('#crCancel');

  // 6. Leaving the custom reading.
  await page.click('#readingTypeToggle .toggle-btn[data-val="shabbat"]');
  await page.waitForTimeout(300); await ready();
  const out = await view();
  check(out.name === before.name && !/cr=/.test(out.url) && !out.dimmed.some(Boolean) && out.activeType.join() === 'shabbat',
    `Shabbat toggle leaves the custom reading (${out.name}, ${out.url})`);
  await page.goto(link); await ready();
  await page.click('#nextBtn'); await page.waitForTimeout(300); await ready();
  const nx = await view();
  check(nx.date !== 'Custom reading' && !/cr=/.test(nx.url), `› leaves the custom reading (${nx.date} · ${nx.name})`);
  await page.goto(link); await ready();
  const firstOpt = await page.evaluate(() => [...document.querySelectorAll('#parashaSelect option')].find(o => o.value && !o.value.startsWith('holiday|')).value);
  await page.selectOption('#parashaSelect', firstOpt);
  await page.waitForTimeout(300); await ready();
  const dd = await view();
  check(dd.date !== 'Custom reading' && !/cr=/.test(dd.url) && !dd.dimmed.some(Boolean), `dropdown leaves the custom reading (${dd.name})`);

  // 8. More than Shvi'i: two added aliyot (Hosafah 1, 2) before Maftir.
  await page.click('#customReadingBtn');
  await page.click('#crClear');
  const ranges = ['28:10-11', '28:12', '28:13', '28:14', '28:15', '28:16', '28:17', '28:18', '28:19', '28:20-22'];
  for (let i = 1; i < ranges.length; i++) await page.click('#crAddRow');
  const autoKeys = (await rows()).map(r => r.key);
  check(autoKeys.join() === '1,2,3,4,5,6,7,8,9,10', `"+ Add aliyah" continues past Shvi'i (${autoKeys.join()})`);
  await page.locator('#crRows .cr-row').nth(9).locator('.cr-key').selectOption('maftir');
  for (let i = 0; i < ranges.length; i++) await page.locator('#crRows .cr-row').nth(i).locator('.cr-range').fill(ranges[i]);
  await page.fill('#crTitle', 'Hosafot');
  await page.click('#crSubmit');
  await ready();
  const h = await page.evaluate(() => ({
    keys: [...document.querySelectorAll('.practice-section .aliyah')].map(s => s.dataset.aliyah).join(),
    labels: [...document.querySelectorAll('.practice-section .aliyah .lbl-en')].map(e => e.textContent.trim()),
    colors: Object.fromEntries([...document.querySelectorAll('.practice-section .aliyah')].map(s => [s.dataset.aliyah, getComputedStyle(s.querySelector('.aliyah-hdr')).backgroundColor])),
    jump: [...document.querySelectorAll('#aliyahJumpSelect option')].map(o => o.value).join(),
    filter: [...document.querySelectorAll('#aliyahMsPanel .aliyah-cb')].map(c => c.dataset.aliyah).join(),
    cr: new URLSearchParams(location.search).get('cr'),
  }));
  check(h.keys === '1,2,3,4,5,6,7,8,9,maftir', `aliyot render in order through Hosafah 2 and Maftir (${h.keys})`);
  check(h.labels[7] === 'Hosafah 1' && h.labels[8] === 'Hosafah 2' && h.labels[9] === 'Maftir', `labels: ${h.labels.slice(6).join(', ')}`);
  check(h.colors['8'] !== h.colors['7'] && h.colors['9'] !== h.colors['8'] && h.colors['9'] !== h.colors.maftir, 'added aliyot get colors distinct from their neighbours');
  check(h.jump === ',1,2,3,4,5,6,7,8,9,maftir' && h.filter === '1,2,3,4,5,6,7,8,9,maftir', 'jump dropdown and aliyah filter list the added aliyot');
  check(/(^|,)8_Genesis\.28\.18-28\.18,9_Genesis\.28\.19-28\.19,/.test(h.cr) && /maftir_Genesis\.28\.20-28\.22$/.test(h.cr), `link carries the added aliyot (${h.cr})`);

  // 9. Hebcal's own 8th aliyah (Simchat Torah on Shabbat, Israel) is no longer dropped.
  await page.goto(PAGE_URL + '?h=' + encodeURIComponent('2026-10-03|Simchat Torah (on Shabbat)') + '&il=1');
  await ready();
  const st = await page.evaluate(() => [...document.querySelectorAll('.practice-section .aliyah')].map(s =>
    s.dataset.aliyah + ' ' + s.querySelector('.lbl-range').textContent.replace(/\s+/g, ' ').replace('▶ Listen', '').trim()));
  check(st.length === 9 && /^8 Genesis 1:1-2:3/.test(st[7]), `Israel Simchat Torah on Shabbat shows its 8th aliyah (${st[7]})`);

  // Mobile: the three header buttons share a row without overflowing.
  await page.setViewportSize({ width: 360, height: 800 });
  const fit = await page.evaluate(() => ['verseLookupBtn', 'yearTikkunBtn', 'customReadingBtn'].map(id => {
    const b = document.getElementById(id); const r = b.getBoundingClientRect();
    return { top: Math.round(r.top), right: r.right, over: b.scrollWidth > b.clientWidth + 1 };
  }));
  check(new Set(fit.map(f => f.top)).size === 1 && fit.every(f => f.right <= 360 && !f.over), `mobile: Verse / Full year / Custom on one row, no overflow (${JSON.stringify(fit)})`);
  await page.click('#customReadingBtn');
  const dlgFit = await page.evaluate(() => {
    const d = document.getElementById('customReadingDialog').getBoundingClientRect();
    const r = [...document.querySelectorAll('#crRows .cr-row')].map(x => x.scrollWidth <= x.clientWidth + 1);
    return { left: d.left, right: d.right, rowsFit: r.every(Boolean) };
  });
  check(dlgFit.left >= 0 && dlgFit.right <= 360 && dlgFit.rowsFit, `mobile: dialog and its rows fit 360px (${JSON.stringify(dlgFit)})`);
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'custom-reading-dialog-mobile.png') });

  check(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
