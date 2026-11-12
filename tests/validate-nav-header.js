// Navigation + header test (Nov 2026) — real browser, real Hebcal/Sefaria.
//
//   1. The ‹ › arrows walk every reading in true date order, including the
//      Monday/Thursday readings between two Shabbatot (they used to be
//      skipped): Asara b'Tevet Mincha (Sun 20 Dec 2026) → one stop
//      "Mon 21 / Thu 24 Dec" → Shabbat 26 Dec (Vayechi), and back
//      with ‹. The header never flashes the next Shabbat's date meanwhile.
//   2. The weekday stop's share link reopens it; the Weekday toggle on that
//      Shabbat shows the same stop.
//   3. The aliyah row is one compact line: filter, "Jump to aliyah" select,
//      Regular Maftir. The select scrolls to the chosen aliyah.
//   4. Bima tab + Either-Or: the Scroll/Tikkun view widget stays hidden and
//      the layout toggle is dimmed; back on Tikkun Korim the widget shows.
//
// Run with: node tests/validate-nav-header.js

const { chromium } = require('playwright');
const path = require('path');

const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
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
    weekday: document.querySelector('#readingTypeToggle .toggle-btn.active').dataset.val === 'weekday',
    url: location.search,
  }));

  await page.goto(PAGE_URL);
  await page.evaluate(() => localStorage.clear());

  // 1. Linear navigation through the weekday readings.
  const fastKey = await page.evaluate(() => Object.keys(HOLIDAY_DATA.diaspora).find(k => k.startsWith('2026-12-20|') && k.includes('Mincha')));
  check(!!fastKey, `embedded data has the fast on 2026-12-20 (${fastKey})`);
  await page.goto(PAGE_URL + '?h=' + encodeURIComponent(fastKey));
  await ready();
  const seq = [await view()];
  for (let n = 0; n < 2; n++) {
    // Record every value the date header takes during the transition: the
    // next Shabbat's date used to flash before the weekday reading loaded.
    await page.evaluate(() => {
      window.__dates = [];
      const el = document.getElementById('dateDisplay');
      window.__obs && window.__obs.disconnect();
      window.__obs = new MutationObserver(() => window.__dates.push(el.textContent));
      window.__obs.observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.click('#nextBtn');
    await page.waitForTimeout(300);
    await ready();
    const v = await view();
    v.seen = await page.evaluate(() => window.__dates);
    seq.push(v);
  }
  console.log('   ' + seq.map(v => `${v.date} [${v.name}]${v.weekday ? ' (weekday)' : ''}`).join('  →  '));
  check(/^Mon 21 \/ Thu 24 Dec 2026$/.test(seq[1].date) && seq[1].weekday && /Vayechi/.test(seq[1].name), '› from the fast lands on ONE stop "Mon 21 / Thu 24 Dec 2026" (Vayechi weekday reading)');
  check(!seq[1].seen.some(t => /^Shabbat/.test(t)), `no Shabbat date flashes on the way to the weekday stop (${[...new Set(seq[1].seen)].join(' | ')})`);
  check(/26 Dec 2026/.test(seq[2].date) && !seq[2].weekday && /Vayechi/.test(seq[2].name), '› then Shabbat 26 Dec, Vayechi, with the toggle back on Shabbat');
  await page.click('#prevBtn'); await page.waitForTimeout(300); await ready();
  const back = await view();
  check(/^Mon 21 \/ Thu 24 Dec 2026$/.test(back.date) && back.weekday, '‹ from Shabbat goes back to the Monday/Thursday stop');
  await page.click('#prevBtn'); await page.waitForTimeout(300); await ready();
  check(/Asara/.test((await view()).name), '‹ again goes back to the fast');

  // 2. Share link keeps the weekday stop.
  check(/d=2026-12-21/.test(back.url) && /wd=1/.test(back.url), `weekday link carries the stop's date (${back.url})`);
  await page.goto(PAGE_URL + back.url);
  await ready();
  const reopened = await view();
  check(/^Mon 21 \/ Thu 24 Dec 2026$/.test(reopened.date) && reopened.weekday, 'the link reopens the Monday/Thursday stop');
  // Toggle from Shabbat shows the same merged label.
  await page.goto(PAGE_URL + '?d=2026-12-26');
  await ready();
  await page.click('#readingTypeToggle .toggle-btn[data-val="weekday"]');
  await page.waitForTimeout(300); await ready();
  check(/^Mon 21 \/ Thu 24 Dec 2026$/.test((await view()).date), 'Weekday toggle on Shabbat Vayechi shows the same Monday/Thursday stop');

  // 3. Compact aliyah row.
  await page.goto(PAGE_URL + '?d=2026-11-14');
  await ready();
  const row = await page.evaluate(() => {
    const els = ['aliyahMsTrigger', 'aliyahJumpSelect', 'regularMaftirToggle'].map(id => document.getElementById(id));
    const tops = els.map(e => e.getBoundingClientRect().top);
    return { visible: els.map(e => e.offsetParent !== null), spread: Math.max(...tops) - Math.min(...tops),
      opts: [...document.querySelectorAll('#aliyahJumpSelect option')].map(o => o.textContent) };
  });
  check(row.visible.every(Boolean) && row.spread < 12, `filter, jump select and Regular Maftir share one line (spread ${row.spread.toFixed(1)}px)`);
  check(row.opts.length === 9 && /Jump to aliyah/.test(row.opts[0]) && /^Rishon · /.test(row.opts[1]), `jump select lists 8 aliyot (${row.opts.slice(0, 2).join(' | ')} …)`);
  await page.selectOption('#aliyahJumpSelect', '5');
  await page.waitForTimeout(900);
  const top5 = await page.evaluate(() => document.querySelector('.tikkun-section.visible .aliyah[data-aliyah="5"]').getBoundingClientRect().top);
  check(Math.abs(top5) < 300, `selecting Chamishi scrolls to it (top ${Math.round(top5)}px)`);
  check(await page.$eval('#aliyahJumpSelect', s => s.value === ''), 'select resets to its placeholder');

  // 4. Bima + Either-Or.
  // The reported order: Bima tab first, then Either-Or. The toggle is dimmed
  // there now, so trigger its handler directly to prove the widget logic
  // holds even if the layout changes while on the Bima tab.
  await page.click('.tab-btn[data-tab="bima"]');
  await page.$eval('#layoutToggle .toggle-btn[data-val="either"]', b => b.click());
  await page.waitForTimeout(200);
  check(await page.$eval('#floatingViewToggle', w => getComputedStyle(w).display === 'none'), 'Bima tab + Either-Or: Scroll/Tikkun view widget stays hidden');
  check(await page.$eval('#layoutToggle', g => g.classList.contains('tg-inactive')), 'Bima tab: layout toggle dimmed');
  await page.click('.tab-btn[data-tab="practice"]');
  await page.waitForTimeout(200);
  check(await page.$eval('#floatingViewToggle', w => getComputedStyle(w).display !== 'none'), 'back on Tikkun Korim in Either-Or: widget shows');
  check(await page.$eval('#layoutToggle', g => !g.classList.contains('tg-inactive')), 'Tikkun Korim tab: layout toggle active');

  check(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\nFAIL — ${failures} check(s) failed` : '\nPASS — nav/header');
  process.exit(failures ? 1 : 0);
})();
