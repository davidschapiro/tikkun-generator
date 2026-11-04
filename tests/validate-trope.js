// Full-Torah validation for trope.js (cantillation color classification).
//
// Runs the ACTUAL shipped tokenizer.js + trope.js over all 5,846 verses of
// full-torah-reference.json, one book at a time (tokens per verse via
// buildTokens, the same entry point index.html uses), and checks
// invariants that must hold for real Masoretic text:
//
//   1. Every verse's last word is classified as sof pasuk.
//   2. No verse has more than one etnachta — except the Decalogue, where
//      the text carries both the upper and lower cantillation.
//   3. Every conjunctive has a master (the disjunctive it leads into),
//      and every tipcha is resolved to tipcha-etnachta or tipcha-sof.
//   3b. Azla is named "Azla" exactly when the previous word is a kadma.
//   3c. The default color scheme gives every disjunctive key a color, and
//       schemeToCss / normalizeScheme behave (corrupt input → default).
//   4. Token count is unchanged and petucha/setuma/paseq tokens are
//      byte-identical to the tokenizer's output (index.html compares them
//      with ===).
//   5. Exact counts for rare accents match the known Torah totals
//      (shalshelet = 4, karnei para = 1, yerach ben yomo = 1).
//
// Run with: node tests/validate-trope.js

const fs = require('fs');
const path = require('path');
const { buildTokens } = require('../tokenizer.js');
const { classifyTropeTokens, TROPES, DEFAULT_SCHEME, normalizeScheme, schemeToCss } = require('../trope.js');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'full-torah-reference.json'), 'utf8'));

const DECALOGUE = new Set(['Exodus 20', 'Deuteronomy 5']);
let failures = 0;
const fail = (msg) => { failures++; if (failures <= 25) console.log('FAIL', msg); };

const idCounts = {};
let azla = 0, azlaGeresh = 0;
let words = 0, unaccented = 0;

for (const [refStr, he] of ref) {
  const m = refStr.match(/^(.*) (\d+):(\d+)$/);
  const chap = `${m[1]} ${m[2]}`;
  const { tokens } = buildTokens([{ ch: +m[2], v: +m[3], he }]);
  const before = tokens.map((t) => t.vowel);
  classifyTropeTokens(tokens);

  if (tokens.length !== before.length) fail(`${refStr}: token count changed`);
  tokens.forEach((t, i) => {
    if (!t.trope && t.vowel !== before[i]) fail(`${refStr}: non-word token ${i} was modified`);
  });

  const wordToks = tokens.filter((t) => t.trope);
  words += wordToks.length;
  if (!wordToks.length) { fail(`${refStr}: no word tokens`); continue; }

  const last = wordToks[wordToks.length - 1];
  if (last.trope.key !== 'sof-pasuk') fail(`${refStr}: last word is ${last.trope.key}, not sof-pasuk`);

  const etn = wordToks.filter((t) => t.trope.key === 'etnachta').length;
  if (etn > 1 && !DECALOGUE.has(chap)) fail(`${refStr}: ${etn} etnachtas`);

  wordToks.forEach((t, i) => {
    const conj = TROPES.find((x) => x.key === t.trope.key).conj;
    if (conj && !t.trope.master) fail(`${refStr}: word ${i} (${t.trope.key}) has no master`);
    if (t.trope.key === 'tipcha') fail(`${refStr}: unresolved tipcha`);
    if (t.trope.key === 'none') unaccented++;
    if (t.trope.key === 'geresh') {
      const prev = wordToks[i - 1];
      const afterKadma = prev && prev.trope.key === 'kadma';
      if ((t.trope.name === 'Azla') !== !!afterKadma) fail(`${refStr}: azla naming wrong at word ${i}`);
      t.trope.name === 'Azla' ? azla++ : azlaGeresh++;
    }
    idCounts[t.trope.key] = (idCounts[t.trope.key] || 0) + 1;
  });
}

// 6. Context independence: classifying a whole chapter at once must give
//    exactly the same result per word as classifying verse by verse, and
//    splitting a verse in two (what congregation-repeat passages do) must
//    not change anything either.
{
  const byChapter = {};
  for (const [refStr, he] of ref) {
    const m = refStr.match(/^(.*) (\d+):(\d+)$/);
    (byChapter[`${m[1]} ${m[2]}`] ||= []).push({ ch: +m[2], v: +m[3], he, refStr });
  }
  let compared = 0;
  for (const [chap, verses] of Object.entries(byChapter)) {
    const whole = classifyTropeTokens(buildTokens(verses).tokens).map((t) => t.vowel);
    const single = verses.flatMap((v) => classifyTropeTokens(buildTokens([v]).tokens).map((t) => t.vowel));
    if (whole.length !== single.length) { fail(`${chap}: chapter/verse token counts differ`); continue; }
    whole.forEach((h, i) => { if (h !== single[i]) fail(`${chap}: token ${i} differs chapter-wise vs verse-wise`); });
    compared += whole.length;
  }
  // Split-verse check on every verse with ≥4 words: cut its tokens in half
  // and mark the second half as a new pseudo-verse (non-null verseNum).
  let splitChecked = 0;
  for (const [refStr, he] of ref) {
    const base = classifyTropeTokens(buildTokens([{ ch: 1, v: 1, he }]).tokens).map((t) => t.vowel);
    const toks = buildTokens([{ ch: 1, v: 1, he }]).tokens;
    if (toks.length < 4) continue;
    const mid = Math.floor(toks.length / 2);
    toks[mid].verseNum = 'x';
    const split = classifyTropeTokens(toks).map((t) => t.vowel);
    split.forEach((h, i) => { if (h !== base[i]) fail(`${refStr}: split-verse changes token ${i}`); });
    splitChecked++;
  }
  console.log(`Context checks: ${compared} tokens chapter-vs-verse, ${splitChecked} split verses`);
}

{
  const def = DEFAULT_SCHEME();
  const colored = new Set(def.groups.flatMap((g) => g.keys));
  TROPES.filter((t) => !t.conj).forEach((t) => { if (!colored.has(t.key)) fail(`default scheme leaves ${t.key} uncolored`); });
  if (!(def.groups.find((g) => g.keys.includes('tevir')) || {}).keys.includes('darga')) fail('default: darga not with tevir');
  { const g = def.groups.find((x) => x.keys.includes('telisha-ketana')); if (!g || g.keys.length !== 1) fail('default: telisha ketana not in its own group'); }
  if (def.groups.length !== 13) fail(`default: ${def.groups.length} groups, expected 13`);
  ['yetiv', 'gershayim', 'telisha-gedola', 'telisha-ketana'].forEach((k) => { const g = def.groups.find((x) => x.keys.includes(k)); if (!g || g.keys.length !== 1) fail(`default: ${k} not in its own group`); });
  if (JSON.stringify(normalizeScheme('garbage')) !== JSON.stringify(def)) fail('normalizeScheme(garbage) is not the default');
  const dup = normalizeScheme({ groups: [{ id: 'a', name: 'A', color: '#ff0000', keys: ['revii', 'nonsense'] }, { id: 'b', name: 'B', color: 'red', keys: ['revii', 'tevir'] }] });
  if (dup.groups[0].keys.join() !== 'revii' || dup.groups[1].keys.join() !== 'tevir' || !/^#[0-9a-f]{6}$/.test(dup.groups[1].color)) fail('normalizeScheme does not dedupe keys / fix colors');
  const css = schemeToCss(def);
  if (!css.includes('.tw.tc.tm-sof-pasuk') || css.includes('tk-munach')) fail('followMaster CSS wrong');
  const css2 = schemeToCss({ ...def, followMaster: false, groups: [...def.groups, { id: 'g-s', name: 'S', color: '#555555', keys: ['munach'] }] });
  if (!css2.includes('.tw.tc.tk-munach') || css2.includes('.tw.tc.tm-')) fail('non-followMaster CSS wrong');
  // A servant in a group while servants follow: its own rule must come after every follow rule.
  const light3 = schemeToCss({ ...def, groups: [...def.groups, { id: 'g-d', name: 'D', color: '#123456', keys: ['darga'] }] }).split('@media')[0];
  if (light3.indexOf('.tw.tc.tk-darga') < light3.lastIndexOf('.tw.tc.tm-')) fail('assigned servant rule does not come after follow rules');
  console.log('Scheme checks done');
}

const expectExact = { 'shalshelet': 4, 'karnei-para': 1, 'yerach-ben-yomo': 1 };
for (const [id, n] of Object.entries(expectExact)) {
  if ((idCounts[id] || 0) !== n) fail(`${id}: expected ${n}, got ${idCounts[id] || 0}`);
}

console.log(`Verses: ${ref.length}, word tokens: ${words}, words with no accent: ${unaccented}`);
console.log('By trope:', JSON.stringify(idCounts));
console.log(`Azla after kadma: ${azla}, Azla-Geresh on its own: ${azlaGeresh}`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nPASS — all invariants hold across the whole Torah');
process.exit(failures ? 1 : 0);
