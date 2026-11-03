// trope.js — cantillation (ta'amei ha-mikra) classification for color
// highlighting. Pure functions, no DOM: loaded by index.html via
// <script src="trope.js"></script> and require()-able from node tests
// (tests/validate-trope.js runs it over the whole Torah).
//
// What it does: given the token array from buildTokens() (tokenizer.js),
// work out for every word which trope it carries, and attach two
// classifications to it:
//
//   1. FAMILY — the musical phrase group a word belongs to, the way trope
//      is usually taught (Sof Pasuk, Etnachta, Katon, Revi'i, Segol,
//      Tevir, Geresh, Pazer). A conjunctive ("servant") takes the family
//      of the next disjunctive it leads into, so a whole phrase like
//      mercha-tipcha-mercha-sof pasuk comes out in one color.
//   2. LEVEL — the classical disjunctive hierarchy (Emperors, Kings,
//      Dukes, Counts) plus Servants for every conjunctive. Follows
//      Jacobson, "Chanting the Hebrew Bible": revi'i is a Duke, not a
//      King (some tables differ; this is a documented choice).
//
// How it's attached: the token's `vowel` HTML is wrapped in
//   <span class="tw tf-<family> tl-<level>" title="<Trope name>">…</span>
// Coloring itself is pure CSS, keyed off html[data-trope] (see index.html),
// so switching modes never re-renders or re-measures anything. The wrapper
// does not change glyph widths, so line-sync breaks are unaffected.
//
// Deliberately NOT touched:
//   - the scroll column (no trope marks in a real sefer Torah; coloring it
//     would give away the answer the reader is practicing),
//   - petucha/setuma/paseq tokens (no letters, nothing to classify) — and
//     PETUCHA_HTML/SETUMA_HTML equality checks in index.html depend on
//     those token strings staying byte-identical.

(function (root) {
  'use strict';

  // Unicode accent → trope id. Zarqa appears both as U+0598 and as
  // U+05AE (zinor) in the MAM text Sefaria serves (59 vs. 375 occurrences
  // in the Torah) — both are the same accent.
  const DISJ = {
    '֑': 'etnachta',
    '֒': 'segol',
    '֓': 'shalshelet',
    '֔': 'zakef-katon',
    '֕': 'zakef-gadol',
    '֖': 'tipcha',
    '֗': 'revii',
    '֘': 'zarka',
    '֮': 'zarka',
    '֙': 'pashta',
    '֚': 'yetiv',
    '֛': 'tevir',
    '֜': 'geresh',
    '֝': 'geresh',          // geresh muqdam
    '֞': 'gershayim',
    '֟': 'karnei-para',
    '֠': 'telisha-gedola',
    '֡': 'pazer',
  };
  const CONJ = {
    '֣': 'munach',
    '֤': 'mahpach',
    '֥': 'mercha',
    '֦': 'mercha-kefula',
    '֧': 'darga',
    '֨': 'kadma',
    '֩': 'telisha-ketana',
    '֪': 'yerach-ben-yomo',
  };
  const SOF_PASUK = '׃';
  const PASEQ = '׀';

  // Level: 1 Emperor, 2 King, 3 Duke, 4 Count, 's' Servant.
  const LEVEL = {
    'sof-pasuk': 1, 'etnachta': 1,
    'segol': 2, 'shalshelet': 2, 'zakef-katon': 2, 'zakef-gadol': 2, 'tipcha': 2,
    'revii': 3, 'zarka': 3, 'pashta': 3, 'yetiv': 3, 'tevir': 3,
    'geresh': 4, 'gershayim': 4, 'legarmeh': 4, 'pazer': 4, 'karnei-para': 4, 'telisha-gedola': 4,
  };

  // Fixed family for disjunctives. tipcha and legarmeh are resolved from
  // context instead (see classifyTropeTokens).
  const FAMILY = {
    'sof-pasuk': 'sof', 'etnachta': 'etnachta',
    'segol': 'segol', 'shalshelet': 'segol', 'zarka': 'segol',
    'zakef-katon': 'katon', 'zakef-gadol': 'katon', 'pashta': 'katon', 'yetiv': 'katon',
    'revii': 'revii',
    'tevir': 'tevir',
    'geresh': 'geresh', 'gershayim': 'geresh', 'telisha-gedola': 'geresh',
    'pazer': 'pazer', 'karnei-para': 'pazer',
  };

  const NAMES = {
    'sof-pasuk': 'Sof Pasuk', 'etnachta': 'Etnachta', 'segol': 'Segol', 'shalshelet': 'Shalshelet',
    'zakef-katon': 'Zakef Katon', 'zakef-gadol': 'Zakef Gadol', 'tipcha': 'Tipcha', 'revii': "Revi'i",
    'zarka': 'Zarka', 'pashta': 'Pashta', 'yetiv': 'Yetiv', 'tevir': 'Tevir', 'geresh': 'Geresh',
    'gershayim': 'Gershayim', 'karnei-para': 'Karnei Para', 'telisha-gedola': 'Telisha Gedola',
    'pazer': 'Pazer', 'legarmeh': 'Munach Legarmeh', 'munach': 'Munach', 'mahpach': 'Mahpach',
    'mercha': 'Mercha', 'mercha-kefula': 'Mercha Kefula', 'darga': 'Darga', 'kadma': 'Kadma',
    'telisha-ketana': 'Telisha Ketana', 'yerach-ben-yomo': 'Yerach Ben Yomo',
  };

  // Legend data for the UI (order = display order).
  const FAMILIES = [
    { id: 'sof',      en: 'Sof Pasuk', he: 'סוף פסוק' },
    { id: 'etnachta', en: 'Etnachta',  he: 'אתנחתא' },
    { id: 'katon',    en: 'Katon',     he: 'קטן' },
    { id: 'revii',    en: "Revi'i",    he: 'רביע' },
    { id: 'segol',    en: 'Segol',     he: 'סגול' },
    { id: 'tevir',    en: 'Tevir',     he: 'תביר' },
    { id: 'geresh',   en: 'Geresh',    he: 'גרש' },
    { id: 'pazer',    en: 'Pazer',     he: 'פזר' },
  ];
  const LEVELS = [
    { id: '1', en: 'Emperors', he: 'קיסרים' },
    { id: '2', en: 'Kings',    he: 'מלכים' },
    { id: '3', en: 'Dukes',    he: 'משנים' },
    { id: '4', en: 'Counts',   he: 'שלישים' },
    { id: 's', en: 'Servants', he: 'משרתים' },
  ];

  const stripTags = (html) => String(html).replace(/<[^>]+>/g, '');
  const hasLetters = (s) => /[א-ת]/.test(s);

  // The strongest trope on a single word (a word can carry a disjunctive
  // plus a conjunctive or a doubled pashta/telisha — the disjunctive wins).
  // Returns null for tokens with no letters (petucha/setuma/paseq) and
  // {kind:'none'} for a word with letters but no accent.
  function readWord(html) {
    // Petucha/setuma markers are tokens of their own whose glyph IS a
    // Hebrew letter (פ / ס) — they must not count as words.
    if (/class="pm[ "]/.test(html)) return null;
    const text = stripTags(html);
    if (!hasLetters(text)) return null;
    if (text.includes(SOF_PASUK)) return { kind: 'disj', id: 'sof-pasuk' };
    let best = null;
    for (const ch of text) {
      const d = DISJ[ch];
      if (d && (!best || best.kind !== 'disj' || LEVEL[d] < LEVEL[best.id])) best = { kind: 'disj', id: d };
      const c = CONJ[ch];
      if (c && !best) best = { kind: 'conj', id: c };
    }
    return best || { kind: 'none' };
  }

  // Classifies every token of one rendered reading. Mutates and returns
  // the array: each word token gets t.trope = {id, family, level} and its
  // `vowel` HTML wrapped (see header). Works on any span of whole verses
  // (one verse, one aliyah, a whole chapter) with identical results.
  function classifyTropeTokens(tokens) {
    const info = tokens.map((t) => readWord(t.vowel));

    // Munach followed directly by a paseq token is munach legarmeh, a
    // disjunctive (Count). The paseq is its own token (see tokenizer.js).
    for (let i = 0; i < info.length; i++) {
      const w = info[i];
      if (w && w.kind === 'conj' && w.id === 'munach') {
        const next = tokens[i + 1];
        if (next && stripTags(next.vowel).trim() === PASEQ) info[i] = { kind: 'disj', id: 'legarmeh' };
      }
    }

    // Resolve families right-to-left so each conjunctive can take the
    // family of the nearest following disjunctive, and each tipcha the
    // family of the next etnachta/sof pasuk. No explicit verse-boundary
    // reset is needed: scanning leftward, the previous verse always
    // begins with its own sof pasuk, which overwrites both trackers.
    // (Deliberately NOT keyed off t.verseNum: congregation-repeat
    // passages split one verse into pseudo-verses with their own
    // verseNum, and a reset there would orphan the first half's words.)
    const family = new Array(tokens.length).fill(null);
    let nextFam = null;      // family of nearest following disjunctive word
    let nextMajor = null;    // 'etnachta' | 'sof' — next main dividing accent
    for (let i = tokens.length - 1; i >= 0; i--) {
      const w = info[i];
      if (!w) continue;
      if (w.kind === 'disj') {
        let f;
        if (w.id === 'tipcha') f = nextMajor || 'sof';
        else if (w.id === 'legarmeh') f = nextFam || 'revii';
        else f = FAMILY[w.id];
        family[i] = f;
        nextFam = f;
        if (w.id === 'etnachta') nextMajor = 'etnachta';
        if (w.id === 'sof-pasuk') nextMajor = 'sof';
      } else {
        family[i] = nextFam; // conjunctive or unaccented word: joins the phrase it leads into
      }
    }

    tokens.forEach((t, i) => {
      const w = info[i];
      if (!w) return;
      const level = w.kind === 'disj' ? LEVEL[w.id] : 's';
      const fam = family[i];
      t.trope = { id: w.kind === 'none' ? null : w.id, family: fam, level: String(level) };
      const cls = ['tw'];
      if (fam) cls.push('tf-' + fam);
      cls.push('tl-' + level);
      const title = w.kind === 'none' ? '' : ` title="${NAMES[w.id]}"`;
      t.vowel = `<span class="${cls.join(' ')}"${title}>${t.vowel}</span>`;
    });
    return tokens;
  }

  const api = { classifyTropeTokens, readWord, FAMILIES, LEVELS, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trope = api;
})(typeof window !== 'undefined' ? window : this);
