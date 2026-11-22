// Congregation-repeat ("blue") test (Nov 2026) — real browser, real Sefaria.
//
// Blue marks what the congregation says aloud first on a FAST DAY
// (Vayechal: Exodus 32:12 from שוב, 34:6 from ה' ה' to 34:7 ונקה, 34:9 from
// וסלחת). Before this test the rule only compared chapter:verse numbers, so
// Genesis/Numbers/Deuteronomy 32:12 and 34:6-9 were blue (Vayishlach,
// Ha'azinu, Matot-Masei, Simchat Torah), Ki Tisa and Chol HaMoed were
// partly blue, and the Bima Tikkun showed the note without any blue.
//
//   1. Every reading in the embedded data (parashiot full + triennial,
//      holidays, both locales): isVayechalReading() is true exactly for the
//      fast-day readings (aliyah 1 = Exodus 32:11-32:14).
//   2. Fast days (Shacharit, Mincha, Tisha B'Av Mincha): blue words are
//      exactly the three spans, in Tikkun Korim and Bima, blue in color,
//      no repeated verse numbers.
//   3. Readings that contain the same chapter:verse numbers or the same
//      verses outside a fast: no blue, no note, in both tabs.
//   4. Custom readings: a custom division of Vayechal is blue, a custom
//      Ki Tisa piece is not.
//
// Run with: node tests/validate-congregation.js

const { chromium } = require('playwright');
const path = require('path');

const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

// Consonants only (no vowels, trope, paseq, maqaf, verse numbers).
const cons = s => (s || '').replace(/־/g, ' ').replace(/[^א-ת\s]/g, '').replace(/\s+/g, ' ').trim();
const EXPECTED = [
  'שוב מחרון אפך והנחם על הרעה לעמך',
  'יהוה יהוה אל רחום וחנון ארך אפים ורב חסד ואמת נצר חסד לאלפים נשא עון ופשע וחטאה ונקה',
  'וסלחת לעוננו ולחטאתנו ונחלתנו',
].join(' | ');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route('**cloudflareinsights.com**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const ready = () => page.waitForFunction(() => document.querySelectorAll('.aliyah').length > 0 &&
    !document.querySelector('#statusArea .spinner'), { timeout: 40000 });

  await page.goto(PAGE_URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(PAGE_URL);
  await ready();

  // 1. Whole data set.
  const scan = await page.evaluate(() => {
    const out = { vayechal: [], wrong: [], total: 0 };
    const isFastData = (rs) => rs['1'] === 'Exodus 32:11-32:14';
    for (const [loc, d] of Object.entries(HOLIDAY_DATA)) {
      for (const [k, v] of Object.entries(d)) {
        // aliyah keys only — entries also carry 'torah', 'haftarah', 'hdate' strings
        const rs = Object.fromEntries(Object.entries(v).filter(([a, r]) => ALIYAH_ORDER.includes(a) && typeof r === 'string'));
        const got = isVayechalReading(Object.values(rs));
        out.total++;
        if (got) out.vayechal.push(loc + ' ' + k);
        if (got !== isFastData(rs)) out.wrong.push(`${loc} ${k}: got ${got}`);
      }
    }
    for (const [loc, list] of Object.entries(PARASHA_LISTS)) {
      for (const e of list) {
        for (const kind of ['ranges', 'triennial']) {
          if (!e[kind]) continue;
          out.total++;
          if (isVayechalReading(Object.entries(e[kind]).filter(([a]) => ALIYAH_ORDER.includes(a)).map(([, r]) => r))) out.wrong.push(`${loc} ${e.date} ${kind}: parasha counted as fast day`);
        }
      }
    }
    return out;
  });
  check(scan.wrong.length === 0 && scan.vayechal.length > 0,
    `data scan: ${scan.total} readings, ${scan.vayechal.length} fast-day readings get blue, none else${scan.wrong.length ? ' — ' + scan.wrong.slice(0, 5).join('; ') : ''}`);
  console.log('   fast-day readings: ' + [...new Set(scan.vayechal.map(x => x.replace(/^\w+ \d{4}-\d\d-\d\d\|/, '')))].join(', '));

  const blueOf = () => page.evaluate(() => {
    const pick = (sel) => [...document.querySelectorAll(sel)];
    const vowel = pick('.practice-section .col-vowel .cong-token').map(e => e.textContent).join(' ');
    const bimaSpans = pick('.bima-section .cong-verse-bima').map(e => e.textContent);
    const bimaColor = pick('.bima-section .cong-verse-bima').map(e => getComputedStyle(e).color);
    const vnsDup = pick('.bima-section .aliyah').some(s => {
      const v = [...s.querySelectorAll('.vn')].map(e => e.textContent);
      return v.some((x, i) => i && x === v[i - 1]);
    });
    return { vowel, bimaSpans, bimaColor, vnsDup,
      notes: pick('.cong-note').length,
      any: pick('.cong-token, .cong-verse-bima').length };
  });
  const open = async (qs) => {
    await page.goto(PAGE_URL + '?' + qs);
    await ready();
    await page.waitForTimeout(800); // practice columns render after insertion
  };

  // 2. Fast days.
  const fasts = [
    ['Tzom Gedaliah (Shacharit)', 'h=' + encodeURIComponent('2026-09-14|Tzom Gedaliah')],
    ['Tzom Gedaliah (Mincha)', 'h=' + encodeURIComponent('2026-09-14|Tzom Gedaliah (Mincha)')],
    ["Tish'a B'Av (Mincha)", 'h=' + encodeURIComponent('2027-08-12|Tish’a B’Av (Mincha)')],
  ];
  for (const [name, qs] of fasts) {
    await open(qs);
    const r = await blueOf();
    const bimaCons = r.bimaSpans.map(cons).join(' | ');
    check(bimaCons === EXPECTED, `${name}: Bima blue = the three spans${bimaCons === EXPECTED ? '' : ' — got ' + bimaCons}`);
    check(r.bimaColor.every(c => c === 'rgb(42, 82, 152)'), `${name}: Bima spans are blue (${[...new Set(r.bimaColor)].join()})`);
    check(!r.vnsDup, `${name}: no repeated verse numbers in Bima`);
    const vowelCons = cons(r.vowel);
    check(vowelCons === EXPECTED.replace(/ \| /g, ' '), `${name}: Tikkun Korim blue = the three spans${vowelCons === EXPECTED.replace(/ \| /g, ' ') ? '' : ' — got ' + vowelCons}`);
  }

  // 3. Same numbers / same verses, not a fast: no blue anywhere.
  const notFast = [
    ['Vayishlach (full)', 'd=2026-11-28&mode=full'],
    ['Vayishlach (triennial)', 'd=2026-11-28'],
    ["Ha'azinu (full)", 'd=2026-09-19&mode=full'],
    ['Matot-Masei (full)', 'd=2027-07-31&mode=full'],
    ['Matot-Masei (triennial)', 'd=2027-07-31'],
    ['Ki Tisa (full)', 'd=2027-02-27&mode=full'],
    ['Ki Tisa (triennial)', 'd=2027-02-27'],
    ['Simchat Torah (Israel, on Shabbat)', 'h=' + encodeURIComponent('2026-10-03|Simchat Torah (on Shabbat)') + '&il=1'],
    ['Pesach Chol HaMoed (Israel, Exodus 34)', 'h=' + encodeURIComponent('2027-04-26|Pesach V (CH’’M)') + '&il=1'],
  ];
  for (const [name, qs] of notFast) {
    await open(qs);
    const r = await blueOf();
    check(r.any === 0 && r.notes === 0, `${name}: no blue, no note${r.any ? ` — ${r.any} blue elements` : ''}`);
  }

  // 4. Custom readings.
  await open('ct=Fast&cr=' + encodeURIComponent('1_Exodus.32.11-32.14,2_Exodus.34.1-34.5,3_Exodus.34.6-34.10'));
  const c1 = await blueOf();
  check(cons(c1.vowel) === EXPECTED.replace(/ \| /g, ' '), 'custom division of Vayechal: blue as on a fast day');
  await open('ct=Ki+Tisa&cr=' + encodeURIComponent('5_Exodus.34.1-34.9'));
  const c2 = await blueOf();
  check(c2.any === 0 && c2.notes === 0, 'custom Ki Tisa piece (Exodus 34:1-9): no blue');

  check(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
