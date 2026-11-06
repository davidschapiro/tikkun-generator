// Builds audio-data.js from the vayavinu.com scrape (vayavinu-audio.json)
// plus the full-kriyah aliyah verse ranges for every recording, taken from
// @hebcal/leyning — the same library behind Hebcal's /leyning endpoint
// that refresh_data.py already relies on.
//
// Why ranges are needed at all: vayavinu recorded each parasha (and some
// holidays) once, aliyah by aliyah, in the FULL KRIYAH division. This app
// defaults to the triennial cycle, has weekday readings, combined weeks
// (Chukat-Balak etc.) and holiday readings drawn from parasha text — none
// of which line up 1:1 with those recordings. So index.html matches by
// verse range: for whatever aliyah is on screen, it offers the recording(s)
// whose verses overlap it, and says when a recording contains more than
// the aliyah. That needs each recording's exact range, which is what this
// script adds.
//
// Usage (one-off; re-run only if the scrape is refreshed):
//   cd <scratch dir> && npm install @hebcal/leyning
//   NODE_PATH=<scratch dir>/node_modules node scripts/build-audio-data.js
//
// Output: audio-data.js, defining window.AUDIO_DATA (a <script src> file,
// not JSON, so it also loads under file:// in the Playwright tests).

const fs = require('fs');
const path = require('path');
const L = require('@hebcal/leyning');

const root = path.join(__dirname, '..');
const scrape = JSON.parse(fs.readFileSync(path.join(root, 'vayavinu-audio.json'), 'utf8'));
const nameMap = JSON.parse(fs.readFileSync(path.join(root, 'vayavinu-parasha-map.json'), 'utf8'));

// The scrape stored each page's video ids in PAGE-LAYOUT order (two
// columns: 1,3,5,7,2,4,6) — not aliyah order — and a few pages link a
// video under the wrong label. So the order is NOT trusted: every video's
// YouTube title (vayavinu-titles.json, captured via YouTube's oEmbed
// endpoint) is parsed for its aliyah number, and recordings are rebuilt
// from that. Title formats vary by page ("bereishit ashk 1",
// "lekhlekha 1 ashk", "YT Pesach Ashk 1,3", "Leining Yom Kippur #2 -
// Ashkenazit", "05 Devarim Ashk 11 VeZot HaBerakhah 03").
const titles = JSON.parse(fs.readFileSync(path.join(root, 'vayavinu-titles.json'), 'utf8'));
function labelOf(title) {
  const t = String(title).toLowerCase().trim();
  if (/akdamut|yatziv|tachton|elyon|e`lyon/.test(t)) return null; // not an aliyah of the reading (or a duplicate Decalogue version)
  if (/maftir/.test(t) || /,\s*m$/.test(t) || /\sm$/.test(t)) return 'M';
  let m = t.match(/,\s*(\d+)$/) || t.match(/#\s*(\d+)/);
  if (!m) { const all = t.match(/\d+[a-z]?/g) || []; const last = all[all.length - 1]; m = last && /^\d+$/.test(last) ? [null, last] : null; }
  return m ? String(+m[1]) : null;
}

// vayavinu slug -> Hebcal holiday leyning key. Only readings that are
// chanted in a DIFFERENT nusach than an ordinary Shabbat need to be told
// apart from parasha recordings of the same verses: Rosh Hashana and Yom
// Kippur (High Holiday trope, flagged hh). The other Yom Tov recordings
// are included because their aliyah splits differ from the parasha's,
// so they give exact matches on those days.
const HOLIDAY_SLUGS = {
  'shavuot-1': { key: 'Shavuot I' },
  'shavuot-2': { key: 'Shavuot II' },
  'taanit-tzibbur': { key: 'Tzom Gedaliah' },
  'rosh-hashanah-1': { key: 'Rosh Hashana I', hh: true },
  'rosh-hashanah-2': { key: 'Rosh Hashana II', hh: true },
  'yom-kippur': { key: 'Yom Kippur', hh: true },
  'sukkot-1-2': { key: 'Sukkot I' },
  'shabbat-chol-hamoed-sukkot': { key: 'Sukkot Shabbat Chol ha-Moed' },
  'shemini-atzeret': { key: 'Shmini Atzeret' },
  'pesach-1': { key: 'Pesach I (on Shabbat)' },
  'pesach-2': { key: 'Pesach II' },
  'pesach-3': { key: "Pesach III (CH''M)" },
  'pesach-4': { key: "Pesach IV (CH''M)" },
  'pesach-5': { key: "Pesach V (CH''M)" },
  'pesach-6': { key: "Pesach VI (CH''M)" },
  'pesach-7': { key: 'Pesach VII' },
  'pesach-8': { key: 'Pesach VIII (on Shabbat)' },
  '05devarim-11-vezot-haberakhah': { key: 'Simchat Torah' },
  // '05devarim-11-vezot-haberakhah-yn-trop' deliberately omitted: a
  // minority custom, and its last video is a partial ("06a").
};
const LABEL_NAMES = { '1': 'Rishon', '2': 'Sheni', '3': 'Shlishi', '4': "Revi'i", '5': 'Chamishi', '6': 'Shishi', '7': "Shvi'i", 'M': 'Maftir' };

function rangeOf(a) {
  const [sc, sv] = a.b.split(':').map(Number);
  const [ec, ev] = a.e.split(':').map(Number);
  return [a.k, sc, sv, ec, ev];
}

const out = { recordings: [], problems: [] };
const slugToParsha = {};
for (const [appName, slug] of Object.entries(nameMap)) {
  if (typeof slug === 'string') slugToParsha[slug] = appName;
  else appName.split('-').forEach((n, i) => { if (slug[i] && !slugToParsha[slug[i]]) slugToParsha[slug[i]] = n; });
}

for (const [slug, rec] of Object.entries(scrape)) {
  let fk, label, kind, hh = false;
  if (slugToParsha[slug]) {
    const appName = slugToParsha[slug];
    fk = L.getLeyningForParsha(appName.replace(/’/g, "'")).fullkriyah;
    kind = 'parasha'; label = 'Parashat ' + appName;
  } else if (HOLIDAY_SLUGS[slug]) {
    const h = HOLIDAY_SLUGS[slug];
    const ley = L.getLeyningForHolidayKey(h.key);
    if (!ley || !ley.fullkriyah) { out.problems.push(`${slug}: no Hebcal leyning for "${h.key}"`); continue; }
    fk = ley.fullkriyah; kind = 'holiday'; label = rec.name; hh = !!h.hh;
  } else { out.problems.push(`${slug}: not mapped (skipped)`); continue; }

  // Which labels the reading has. Parasha recordings have no maftir
  // (it's the end of Shvi'i, which the matcher finds anyway).
  const numeric = Object.keys(fk).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b);
  const byNus = {};
  for (const [nus, ids] of [['ashk', rec.ashkenazit || []], ['seph', rec.sephardit || []]]) {
    const map = {};
    for (const id of ids) {
      const t = titles[id];
      if (!t) { out.problems.push(`${slug} ${nus}: no title for ${id}`); continue; }
      if (!t.toLowerCase().includes(nus)) { out.problems.push(`${slug} ${nus}: title "${t}" is the other nusach (dropped)`); continue; }
      const lab = labelOf(t);
      if (!lab) continue;
      if (map[lab]) { out.problems.push(`${slug} ${nus}: duplicate label ${lab} ("${t}")`); continue; }
      map[lab] = id;
    }
    byNus[nus] = map;
  }
  const labels = [...numeric];
  if (kind === 'holiday') {
    const recordedM = byNus.ashk.M || byNus.seph.M;
    if (recordedM && fk.M) labels.push('M');
    else if (recordedM && !fk.M) {
      // Chol HaMoed Pesach: the 4th aliyah IS the Numbers maftir passage,
      // and vayavinu labels that video "M".
      const lastNum = numeric[numeric.length - 1];
      for (const nus of ['ashk', 'seph']) if (byNus[nus].M && !byNus[nus][lastNum]) { byNus[nus][lastNum] = byNus[nus].M; }
    }
  }
  // Drop labels beyond what was recorded (e.g. Simchat Torah's Chatan Bereishit).
  const kept = labels.filter(l => byNus.ashk[l] || byNus.seph[l]);
  const missing = [];
  for (const l of kept) for (const nus of ['ashk', 'seph']) if (!byNus[nus][l]) missing.push(`${nus} ${l}`);
  if (missing.length) out.problems.push(`${slug}: no video for ${missing.join(', ')} (offered in the other nusach only)`);
  if (kind === 'parasha' && kept.length !== numeric.length) out.problems.push(`${slug}: only ${kept.length}/${numeric.length} aliyot recorded`);
  out.recordings.push({
    slug, label, kind, hh,
    labels: kept.map(l => LABEL_NAMES[l] || l),
    ranges: kept.map(l => rangeOf(fk[l])),
    ashk: kept.map(l => byNus.ashk[l] || null),
    seph: kept.map(l => byNus.seph[l] || null),
  });
}

const js = '// GENERATED by scripts/build-audio-data.js — do not edit by hand.\n' +
  '// Recordings: Rabbi Jeremy Wieder, vayavinu.com. Aliyah ranges: @hebcal/leyning.\n' +
  'window.AUDIO_DATA = ' + JSON.stringify({ recordings: out.recordings }) + ';\n';
fs.writeFileSync(path.join(root, 'audio-data.js'), js);
console.log(`Wrote audio-data.js: ${out.recordings.length} recordings (${out.recordings.filter(r => r.kind === 'parasha').length} parshiot, ${out.recordings.filter(r => r.kind === 'holiday').length} holidays)`);
if (out.problems.length) console.log('Notes:\n  ' + out.problems.join('\n  '));
