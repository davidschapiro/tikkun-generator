// Audio (vayavinu.com recordings) test — real browser, real Hebcal/Sefaria
// data for the rendered page, plus an exhaustive in-page coverage check.
//
//   1. Coverage: every aliyah (full kriyah AND triennial, Diaspora AND
//      Israel) of every parasha embedded in PARASHA_LISTS gets at least one
//      matching recording, and every match really overlaps the aliyah —
//      including the combined weeks (Chukat-Balak, Matot-Masei, ...), which
//      have no recording of their own.
//   2. Ordering: recording index i of every parasha is aliyah i+1 — checked
//      against the YouTube titles captured at build time
//      (vayavinu-titles.json), because the original scrape stored the
//      videos in page-layout order (1,3,5,7,2,4,6), not aliyah order.
//   3. The default page shows "▶ Listen" buttons; opening a panel shows the
//      right recording; NOTHING is loaded from YouTube until "Load player"
//      is clicked; the iframe then points at youtube-nocookie.com with the
//      expected video id; switching to Sephardit swaps the id.
//   4. High Holiday guard: a Yom Kippur reading never matches a regular
//      (non-High-Holiday-trope) recording.
//   5. Audio UI is hidden in print; zero console/page errors.
//
// Run with: node tests/validate-audio.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  const page = await context.newPage();
  await page.route('**cloudflareinsights.com**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const ytRequests = [];
  page.on('request', r => { if (/youtube/.test(r.url())) ytRequests.push(r.url()); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(PAGE_URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => document.querySelectorAll('.aliyah').length > 0, { timeout: 20000 });
  await page.waitForTimeout(500);

  // 1. Coverage over all embedded parshiot.
  const cov = await page.evaluate(() => {
    const out = { checked: 0, missing: [], bad: [] };
    for (const loc of Object.keys(PARASHA_LISTS)) {
      for (const p of PARASHA_LISTS[loc]) {
        for (const kind of ['ranges', 'triennial']) {
          for (const [k, r] of Object.entries(p[kind] || {})) {
            out.checked++;
            const m = audioMatchesForRange(r);
            if (!m.length) { out.missing.push(`${loc} ${p.name} ${kind} ${k} ${r}`); continue; }
            const q = parseRange(r), a = q.sc * 1000 + q.sv, b = q.ec * 1000 + q.ev;
            for (const h of m) if (h.rb < a || h.ra > b || h.rec.ranges[h.idx][0] !== q.book) out.bad.push(`${p.name} ${k}`);
          }
        }
      }
    }
    return out;
  });
  check(cov.missing.length === 0, `every embedded parasha aliyah has a recording (${cov.checked} aliyot checked)` +
    (cov.missing.length ? ` — missing: ${cov.missing.slice(0, 8).join('; ')}` : ''));
  check(cov.bad.length === 0, 'every offered recording overlaps its aliyah');

  // 2. Order check against YouTube titles.
  const titles = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vayavinu-titles.json'), 'utf8'));
  const recs = await page.evaluate(() => AUDIO_DATA.recordings);
  let orderBad = [];
  for (const rec of recs) {
    for (const [nus, ids] of [['ashk', rec.ashk], ['seph', rec.seph]]) {
      ids.forEach((id, i) => {
        if (id === null) return; // recorded in the other nusach only
        const t = (titles[id] || '').toLowerCase();
        if (!t.includes(nus)) orderBad.push(`${rec.slug} ${nus} #${i + 1} title "${titles[id]}" (nusach)`);
        // Every video's title must name the aliyah it is filed under.
        const lab = rec.labels[i];
        const n = { Rishon: 1, Sheni: 2, Shlishi: 3, "Revi'i": 4, Chamishi: 5, Shishi: 6, "Shvi'i": 7 }[lab];
        const nums = (t.match(/\d+/g) || []).map(Number);
        const ok = lab === 'Maftir' ? /maftir|,\s*m$|\sm$/.test(t)
          : (nums.includes(n) || (/,\s*m$/.test(t) && i === rec.labels.length - 1));
        if (!ok) orderBad.push(`${rec.slug} ${nus} ${lab}: title "${titles[id]}"`);
      });
    }
  }
  check(orderBad.length === 0, `video order matches YouTube titles for ${recs.length} recordings` +
    (orderBad.length ? ` — ${orderBad.slice(0, 6).join('; ')}` : ''));

  // 3. Default page UI.
  const btnCount = await page.locator('.practice-section .audio-btn').count();
  const aliyahCount = await page.locator('.practice-section .aliyah').count();
  check(btnCount === aliyahCount && btnCount > 0, `every practice aliyah has a Listen button (${btnCount}/${aliyahCount})`);
  check(ytRequests.length === 0, 'nothing loaded from YouTube before any click');

  const first = page.locator('.practice-section .aliyah').first();
  const range = await first.locator('.audio-btn').getAttribute('data-range');
  await first.locator('.audio-btn').click();
  await page.waitForTimeout(200);
  check(await first.locator('.audio-panel').isVisible(), 'panel opens under the aliyah header');
  check((await first.locator('.audio-panel iframe').count()) === 0, 'panel does not create an iframe by itself');
  check(ytRequests.length === 0, 'opening the panel loads nothing from YouTube');
  const expected = await page.evaluate((r) => {
    const h = audioMatchesForRange(r)[0];
    return { ashk: h.rec.ashk[h.idx], seph: h.rec.seph[h.idx], label: h.rec.label };
  }, range);
  await first.locator('.ap-load').first().click();
  await page.waitForTimeout(400);
  const src = await first.locator('.audio-panel iframe').first().getAttribute('src');
  check(src && src.startsWith('https://www.youtube-nocookie.com/embed/' + expected.ashk), `player loads the Ashkenazit video (${expected.label})`);
  await first.locator('.ap-nusach .toggle-btn[data-nus="seph"]').click();
  await page.waitForTimeout(300);
  const src2 = await first.locator('.audio-panel iframe').first().getAttribute('src');
  check(src2 && src2.includes(expected.seph), 'Sephardit swaps the loaded player');
  check(await page.evaluate(() => localStorage.getItem('audioNusach')) === 'seph', 'nusach choice is remembered');
  await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'audio-panel.png') });

  await page.emulateMedia({ media: 'print' });
  check(!(await first.locator('.audio-panel').isVisible()) && !(await first.locator('.audio-btn').isVisible()), 'audio UI hidden in print');
  await page.emulateMedia({ media: 'screen' });
  await first.locator('.audio-btn').click();
  check((await first.locator('.audio-panel').count()) === 0, 'Listen button toggles the panel closed');

  // 4. High Holiday guard.
  const hh = await page.evaluate(() => {
    const saved = state.holidayKey;
    state.holidayKey = '2026-09-21|Yom Kippur';
    const yk = audioMatchesForRange('Leviticus 16:1-16:6');
    state.holidayKey = null;
    const shabbat = audioMatchesForRange('Leviticus 16:1-16:6');
    state.holidayKey = saved;
    return { yk: yk.map(h => h.rec.slug), shabbat: shabbat.map(h => h.rec.slug) };
  });
  check(hh.yk.every(s => /yom-kippur|rosh-hashanah|yn-trop/.test(s)), `Yom Kippur only gets High-Holiday-trope recordings (${hh.yk.join(',') || 'none'})`);
  check(hh.shabbat.length > 0 && hh.shabbat.every(s => !/yom-kippur/.test(s)), `the same verses on Shabbat get the Aharei Mot recording (${hh.shabbat.join(',')})`);

  check(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nPASS — audio');
  process.exit(failures ? 1 : 0);
})();
