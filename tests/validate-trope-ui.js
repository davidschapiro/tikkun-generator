// Trope-color UI test (real browser, real Hebcal/Sefaria data).
//
// Verifies the properties trope coloring must have to be safe in this
// codebase (see AGENTS.md §3/§4 — line-sync is the fragile part) and that
// the color editor actually works:
//
//   1. Turning colors on/off and every editor action (recolor, regroup,
//      servants on/off, new group, reset) changes ONLY CSS: every rendered
//      column's HTML (vowel, scroll, print twins, Bima) stays
//      byte-identical, so no line break can move.
//   2. Colors really apply: sof pasuk words in the Sof Pasuk group color;
//      a servant leading into sof pasuk shares it while "servants follow"
//      is on, is uncolored when it's off and its own trope has no group,
//      and colored again once assigned; a trope removed from all groups
//      goes back to ink; dark mode uses a lighter shade.
//   3. The scheme persists in localStorage; ?tc=1 and the old ?tc=fam
//      links turn colors on; the legend shows the group names.
//   4. The scroll column never contains trope wrappers.
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
  return { vowel: html('.col-vowel'), scroll: html('.col-scroll'), vowelPrint: html('.col-vowel-print'),
    scrollPrint: html('.col-scroll-print'), bima: html('.bima-body') };
});
const colorOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s); return el ? getComputedStyle(el).color : null;
}, sel);
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

async function sameHtml(page, before, label) {
  const now = await snapshot(page);
  const bad = Object.keys(before).filter(k => before[k] !== now[k]);
  check(bad.length === 0, `column HTML unchanged after ${label}${bad.length ? ' (changed: ' + bad.join(',') + ')' : ''}`);
}
async function newPage(context) {
  const p = await context.newPage();
  await p.route('**cloudflareinsights.com**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  return p;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await newPage(context);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE_URL);
  await page.evaluate(() => { ['tropeColors', 'tropeScheme', 'tikkunTab'].forEach(k => localStorage.removeItem(k)); });
  await page.goto(PAGE_URL);
  await ready(page);

  check(await page.evaluate(() => !document.documentElement.dataset.trope), 'default is Plain');
  check((await page.locator('.col-vowel .tw').count()) > 50, 'vowel words carry trope classes');
  check((await page.locator('.col-scroll .tw, .col-scroll-print .tw').count()) === 0, 'scroll columns have no trope wrappers');
  const before = await snapshot(page);
  const ink = await colorOf(page, '.col-vowel');
  const SOF = '.col-vowel .tw.tk-sof-pasuk';
  const SERVANT_TO_SOF = '.col-vowel .tw.tc.tm-sof-pasuk';
  check(await colorOf(page, SOF) === ink, 'Plain: sof pasuk word in ink color');

  await page.click('#tropeToggle .toggle-btn[data-val="on"]');
  await page.waitForTimeout(200);
  const def = await page.evaluate(() => Trope.DEFAULT_SCHEME());
  const sofColor = def.groups.find(g => g.keys.includes('sof-pasuk')).color;
  check(await colorOf(page, SOF) === rgb(sofColor), `on: sof pasuk in its group color ${sofColor}`);
  check(await colorOf(page, SERVANT_TO_SOF) === rgb(sofColor), 'on: servant leading into sof pasuk shares that color');
  check(new URL(page.url()).searchParams.get('tc') === '1', 'share link carries tc=1');
  check(await page.locator('#tropeLegend .tg-g-sof').isVisible(), 'legend shows the Sof Pasuk group');
  await sameHtml(page, before, 'turning colors on');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trope-default-light.png') });

  // Editor: recolor the Sof Pasuk group via its palette.
  await page.click('#tropeEditBtn');
  check(await page.locator('#tropeEditor').isVisible(), 'editor opens');
  const newColor = await page.evaluate(() => Trope.PALETTE[9]);
  await page.click('.te-group[data-gid="g-sof"] .te-swatch');
  await page.click(`.te-group[data-gid="g-sof"] .te-palette button[data-color="${newColor}"]`);
  await page.waitForTimeout(150);
  check(await colorOf(page, SOF) === rgb(newColor), 'recoloring a group recolors its words live');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trope-editor.png') });

  // Remove tevir from every group → tevir words back to ink.
  const tevirSel = '.col-vowel .tw.tk-tevir';
  await page.selectOption('#teTropes select[data-key="tevir"]', '');
  await page.waitForTimeout(150);
  if (await page.locator(tevirSel).count()) check(await colorOf(page, tevirSel) === ink, 'tevir with no group is uncolored');

  // Servants are listed even while following: darga and telisha ketana
  // can get their own group, which then beats the follow color.
  for (const k of ['darga', 'telisha-ketana']) check(await page.locator(`#teTropes select[data-key="${k}"]`).count() === 1, `${k} is assignable while servants follow`);
  if (await page.locator('.col-vowel .tw.tk-darga').count()) {
    // Default puts darga with tevir; move it to Segol and check it follows.
    const tevirColor = await page.evaluate(() => tropeScheme.groups.find(g => g.id === 'g-tevir').color);
    check(await colorOf(page, '.col-vowel .tw.tk-darga') === rgb(tevirColor), 'darga has the Tevir color by default');
    await page.selectOption('#teTropes select[data-key="darga"]', 'g-segol');
    await page.waitForTimeout(150);
    const segolColor = await page.evaluate(() => tropeScheme.groups.find(g => g.id === 'g-segol').color);
    check(await colorOf(page, '.col-vowel .tw.tk-darga') === rgb(segolColor), 'darga moved to Segol takes the Segol color');
  }

  // Servants off → mercha uncolored; then give mercha its own new group.
  await page.uncheck('#teFollow');
  await page.waitForTimeout(150);
  const mercha = '.col-vowel .tw.tk-mercha';
  check(await colorOf(page, mercha) === ink, 'servants off: mercha uncolored until assigned');
  await page.click('#teAddGroup');
  const last = page.locator('.te-group').last();
  const gid = await last.getAttribute('data-gid');
  await last.locator('input[type=text]').fill('Servants');
  await page.selectOption('#teTropes select[data-key="mercha"]', gid);
  await page.waitForTimeout(150);
  const servColor = await page.evaluate(id => tropeScheme.groups.find(g => g.id === id).color, gid);
  check(await colorOf(page, mercha) === rgb(servColor), 'mercha takes its own new group color');
  check((await page.locator('#tropeLegend').innerText()).includes('Servants'), 'legend shows the renamed new group');
  await page.click('#teDone');
  await sameHtml(page, before, 'all editor actions');

  // Persistence across reload.
  await page.reload();
  await ready(page);
  check(await page.evaluate(() => document.documentElement.dataset.trope) === 'on', 'colors stay on after reload');
  check(await colorOf(page, SOF) === rgb(newColor), 'custom group color survives reload');
  check(await colorOf(page, mercha) === rgb(servColor), 'custom servant group survives reload');

  // Dark mode lightens.
  await page.click('#themeToggle .toggle-btn[data-val="dark"]');
  await page.waitForTimeout(150);
  const dark = await colorOf(page, SOF);
  check(dark && dark !== rgb(newColor), `dark mode uses a lighter shade (${dark})`);
  await page.click('#themeToggle .toggle-btn[data-val="light"]');

  // Reset.
  await page.click('#tropeEditBtn');
  await page.click('#teReset');
  await page.click('#teDone');
  await page.waitForTimeout(150);
  check(await colorOf(page, SOF) === rgb(sofColor), 'reset restores the default colors');
  check(await colorOf(page, SERVANT_TO_SOF) === rgb(sofColor), 'reset restores servants-follow');

  // Bima.
  await page.click('.tab-btn[data-tab="bima"]');
  await page.waitForTimeout(300);
  check(await colorOf(page, '.bima-body .tw.tk-sof-pasuk') === rgb(sofColor), 'Bima text is colored too');
  await page.click('.tab-btn[data-tab="practice"]');
  await page.waitForTimeout(200);

  // Links: tc=1 and the old tc=fam.
  for (const q of ['?tc=1', '?tc=fam']) {
    const p2 = await newPage(context);
    await p2.goto(PAGE_URL);
    await p2.evaluate(() => localStorage.setItem('tropeColors', 'off'));
    await p2.goto(PAGE_URL + q);
    await ready(p2);
    check(await p2.evaluate(() => document.documentElement.dataset.trope) === 'on', `${q} turns colors on`);
    check((await snapshot(p2)).vowel === before.vowel, `${q}: vowel line breaks identical to a Plain load`);
    await p2.close();
  }

  check(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nPASS — trope color UI');
  process.exit(failures ? 1 : 0);
})();
