// Trope-color UI test (real browser, real Hebcal/Sefaria data).
//
// Verifies the properties trope coloring must have to be safe in this
// codebase (see AGENTS.md §3/§4 — line-sync is the fragile part):
//
//   1. Switching Plain → Trope groups → Trope hierarchy changes ONLY the
//      html[data-trope] attribute: every rendered column's HTML (vowel,
//      scroll, print twins, Bima) is byte-identical before and after.
//      Nothing re-renders, so no line break can move.
//   2. Colors actually apply: a sof-pasuk word is computed in the
//      sof color in "groups" mode and the Emperor color in "hierarchy"
//      mode, and in the plain ink color in "Plain" mode.
//   3. The scroll column never contains trope wrappers (.tw) — coloring
//      it would give the answer away.
//   4. The mode survives a reload via ?tc=… and via localStorage, and
//      the legend shows the matching set.
//   5. Zero console/page errors.
//
// Run with: node tests/validate-trope-ui.js  [--shots DIR]

const { chromium } = require('playwright');
const path = require('path');

const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

async function ready(page) {
  await page.waitForFunction(() => {
    const els = document.querySelectorAll('.col-vowel');
    return els.length > 0 && [...els].every(el => el.innerHTML.trim().length > 0);
  }, { timeout: 20000 });
  await page.waitForTimeout(400);
}

const snapshot = (page) => page.evaluate(() => {
  const html = (sel) => [...document.querySelectorAll(sel)].map(e => e.innerHTML).join('\u0001');
  return {
    vowel: html('.col-vowel'), scroll: html('.col-scroll'),
    vowelPrint: html('.col-vowel-print'), scrollPrint: html('.col-scroll-print'),
    bima: html('.bima-body'),
  };
});

const colorOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el).color : null;
}, sel);

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await context.newPage();
  await page.route('**cloudflareinsights.com**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE_URL);
  await page.evaluate(() => { localStorage.removeItem('tropeColors'); localStorage.removeItem('tikkunTab'); });
  await page.goto(PAGE_URL);
  await ready(page);

  check(await page.evaluate(() => !document.documentElement.dataset.trope), 'default mode is Plain (no data-trope)');
  check((await page.locator('.col-vowel .tw').count()) > 50, 'vowel column words carry trope classes');
  check((await page.locator('.col-scroll .tw').count()) === 0, 'scroll column has no trope wrappers');
  check((await page.locator('.col-scroll-print .tw').count()) === 0, 'scroll print column has no trope wrappers');

  const before = await snapshot(page);
  const ink = await colorOf(page, '.col-vowel .tw.tl-1');

  await page.click('#tropeToggle .toggle-btn[data-val="fam"]');
  await page.waitForTimeout(300);
  const famSof = await colorOf(page, '.col-vowel .tw.tl-1.tf-sof');
  const famVar = await page.evaluate(() => {
    const p = document.createElement('span'); p.style.color = 'var(--tr-sof)';
    document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c;
  });
  check(famSof === famVar && famSof !== ink, `groups mode colors sof-pasuk words (${famSof})`);
  check(await page.locator('#tropeLegend .tlg-fam').isVisible(), 'groups legend visible');
  check(!(await page.locator('#tropeLegend .tlg-lvl').isVisible()), 'hierarchy legend hidden in groups mode');
  check(new URL(page.url()).searchParams.get('tc') === 'fam', 'share link carries tc=fam');
  const afterFam = await snapshot(page);
  for (const k of Object.keys(before)) check(before[k] === afterFam[k], `${k} HTML unchanged by switching to groups`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trope-groups-light.png'), fullPage: false });

  await page.click('#tropeToggle .toggle-btn[data-val="lvl"]');
  await page.waitForTimeout(300);
  const lvl1 = await colorOf(page, '.col-vowel .tw.tl-1');
  const lvlS = await colorOf(page, '.col-vowel .tw.tl-s');
  check(lvl1 !== ink && lvlS !== ink && lvl1 !== lvlS, `hierarchy mode colors emperors (${lvl1}) and servants (${lvlS}) differently`);
  const afterLvl = await snapshot(page);
  for (const k of Object.keys(before)) check(before[k] === afterLvl[k], `${k} HTML unchanged by switching to hierarchy`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trope-hierarchy-light.png'), fullPage: false });

  // Dark theme still distinguishes the colors.
  await page.click('#themeToggle .toggle-btn[data-val="dark"]');
  await page.click('#tropeToggle .toggle-btn[data-val="fam"]');
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trope-groups-dark.png'), fullPage: false });

  // Bima tab.
  await page.click('.tab-btn[data-tab="bima"]');
  await page.waitForTimeout(400);
  check((await page.locator('.bima-body .tw').count()) > 50, 'Bima text carries trope classes');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trope-groups-bima-dark.png'), fullPage: false });

  await page.click('#tropeToggle .toggle-btn[data-val="off"]');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => !document.documentElement.dataset.trope), 'Plain removes data-trope');
  check(new URL(page.url()).searchParams.get('tc') === null, 'share link drops tc in Plain mode');
  check((await colorOf(page, '.bima-body .tw.tl-1')) === (await colorOf(page, '.bima-body')),
    'Plain mode leaves text in the normal ink color');

  // The active tab is persisted (localStorage 'tikkunTab'); switch back to
  // the practice tab so the reload below renders the same view as before.
  await page.click('.tab-btn[data-tab="practice"]');
  await page.waitForTimeout(300);

  // Reload via share link and via localStorage.
  const p2 = await context.newPage();
  await p2.route('**cloudflareinsights.com**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await p2.goto(PAGE_URL + '?tc=lvl');
  await ready(p2);
  check((await p2.evaluate(() => document.documentElement.dataset.trope)) === 'lvl', '?tc=lvl restores hierarchy mode');
  check(await p2.locator('#tropeToggle .toggle-btn[data-val="lvl"].active').count() === 1, 'toggle shows hierarchy active');
  const p2snap = await snapshot(p2);
  check(p2snap.vowel === before.vowel, 'vowel line breaks identical when loading directly in a color mode');
  await p2.close();

  const p3 = await context.newPage();
  await p3.route('**cloudflareinsights.com**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await p3.goto(PAGE_URL);
  await p3.evaluate(() => localStorage.setItem('tropeColors', 'fam'));
  await p3.goto(PAGE_URL);
  await ready(p3);
  check((await p3.evaluate(() => document.documentElement.dataset.trope)) === 'fam', 'localStorage restores groups mode');
  await p3.close();

  check(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nPASS — trope color UI');
  process.exit(failures ? 1 : 0);
})();
