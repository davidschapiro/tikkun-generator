// trope.js — cantillation (ta'amei ha-mikra) classification for color
// highlighting, plus the user-editable color scheme. Pure functions, no
// DOM: loaded by index.html via <script src="trope.js"></script> and
// require()-able from node tests (tests/validate-trope.js runs it over
// the whole Torah).
//
// 1. CLASSIFICATION (classifyTropeTokens). For every vowelized word, the
//    strongest accent decides its KEY — the unit a user can give a color:
//      - every disjunctive is its own key, except tipcha, which is split
//        by context into "tipcha-etnachta" / "tipcha-sof" (it sounds and is
//        taught differently depending on which of the two follows), and
//        munach directly before a paseq, which is "legarmeh";
//      - every conjunctive is its own key too ("munach", "mercha", ...),
//        and additionally remembers its MASTER: the key of the nearest
//        following disjunctive word. That's what lets a whole phrase
//        (mercha-tipcha-mercha-sof pasuk) come out in one color when
//        "servants follow their master" is on.
//    The word's vowel HTML is wrapped in
//      <span class="tw tk-<key>[ tc tm-<masterKey>]" title="<name>">…</span>
//
// 2. COLOR SCHEME (DEFAULT_SCHEME / normalizeScheme / schemeToCss). A
//    scheme is a list of named groups, each with a color and the keys it
//    contains. schemeToCss turns it into a stylesheet, so applying or
//    editing a scheme never re-renders or re-measures anything (line-sync
//    breaks can't move — color doesn't change glyph width).
//
// Deliberately NOT touched: the scroll column (no trope in a sefer Torah;
// coloring it would give the answer away), and petucha/setuma/paseq tokens
// (index.html compares PETUCHA_HTML/SETUMA_HTML with ===).

(function (root) {
  'use strict';

  // Unicode accent → trope id. Zarqa appears both as U+0598 and as U+05AE
  // (zinor) in the MAM text Sefaria serves — same accent.
  const DISJ = {
    '֑': 'etnachta', '֒': 'segol', '֓': 'shalshelet', '֔': 'zakef-katon',
    '֕': 'zakef-gadol', '֖': 'tipcha', '֗': 'revii', '֘': 'zarka',
    '֮': 'zarka', '֙': 'pashta', '֚': 'yetiv', '֛': 'tevir',
    '֜': 'geresh', '֝': 'geresh', '֞': 'gershayim', '֟': 'karnei-para',
    '֠': 'telisha-gedola', '֡': 'pazer',
  };
  const CONJ = {
    '֣': 'munach', '֤': 'mahpach', '֥': 'mercha', '֦': 'mercha-kefula',
    '֧': 'darga', '֨': 'kadma', '֩': 'telisha-ketana', '֪': 'yerach-ben-yomo',
  };
  const SOF_PASUK = '׃';
  const PASEQ = '׀';

  // Rank only decides which accent wins on a word carrying two
  // (lower = stronger). Classical levels; not shown to users.
  const RANK = {
    'sof-pasuk': 1, 'etnachta': 1,
    'segol': 2, 'shalshelet': 2, 'zakef-katon': 2, 'zakef-gadol': 2, 'tipcha': 2,
    'revii': 3, 'zarka': 3, 'pashta': 3, 'yetiv': 3, 'tevir': 3,
    'geresh': 4, 'gershayim': 4, 'pazer': 4, 'karnei-para': 4, 'telisha-gedola': 4,
  };

  // Every colorable key, in the order the editor lists them. Names follow
  // Ashkenazi usage: the geresh sign is "Azla" right after a kadma
  // (kadma ve-azla) and "Azla-Geresh" on its own — the word's tooltip
  // says which; the key is the same sign either way.
  const TROPES = [
    { key: 'sof-pasuk', en: 'Sof Pasuk', he: 'סוף פסוק', conj: false },
    { key: 'tipcha-sof', en: 'Tipcha (before Sof Pasuk)', he: 'טפחא', conj: false },
    { key: 'etnachta', en: 'Etnachta', he: 'אתנחתא', conj: false },
    { key: 'tipcha-etnachta', en: 'Tipcha (before Etnachta)', he: 'טפחא', conj: false },
    { key: 'zakef-katon', en: 'Zakef Katon', he: 'זקף קטן', conj: false },
    { key: 'zakef-gadol', en: 'Zakef Gadol', he: 'זקף גדול', conj: false },
    { key: 'pashta', en: 'Pashta', he: 'פשטא', conj: false },
    { key: 'yetiv', en: 'Yetiv', he: 'יתיב', conj: false },
    { key: 'revii', en: "Revi'i", he: 'רביעי', conj: false },
    { key: 'legarmeh', en: 'Munach Legarmeh', he: 'מונח לגרמיה', conj: false },
    { key: 'segol', en: 'Segol', he: 'סגול', conj: false },
    { key: 'zarka', en: 'Zarka', he: 'זרקא', conj: false },
    { key: 'shalshelet', en: 'Shalshelet', he: 'שלשלת', conj: false },
    { key: 'tevir', en: 'Tevir', he: 'תביר', conj: false },
    { key: 'geresh', en: 'Azla / Azla-Geresh', he: 'אזלא גרש', conj: false },
    { key: 'gershayim', en: 'Gershayim', he: 'גרשיים', conj: false },
    { key: 'telisha-gedola', en: 'Telisha Gedola', he: 'תלישא גדולה', conj: false },
    { key: 'pazer', en: 'Pazer', he: 'פזר', conj: false },
    { key: 'karnei-para', en: 'Karnei Para', he: 'קרני פרה', conj: false },
    { key: 'munach', en: 'Munach', he: 'מונח', conj: true },
    { key: 'mercha', en: 'Mercha', he: 'מרכא', conj: true },
    { key: 'mahpach', en: 'Mahpach', he: 'מהפך', conj: true },
    { key: 'kadma', en: 'Kadma', he: 'קדמא', conj: true },
    { key: 'darga', en: 'Darga', he: 'דרגא', conj: true },
    { key: 'telisha-ketana', en: 'Telisha Ketana', he: 'תלישא קטנה', conj: true },
    { key: 'mercha-kefula', en: 'Mercha Kefula', he: 'מרכא כפולה', conj: true },
    { key: 'yerach-ben-yomo', en: 'Yerach Ben Yomo', he: 'ירח בן יומו', conj: true },
    { key: 'none', en: 'No trope mark', he: '', conj: true },
  ];
  const TROPE_BY_KEY = Object.fromEntries(TROPES.map((t) => [t.key, t]));

  // Preset palette: chosen to stay distinguishable from each other on both
  // the light and the dark background (dark mode lightens each color via
  // color-mix, see schemeToCss). No two warm yellows/oranges next to each
  // other — that was the first version's problem.
  const PALETTE = [
    '#d32f2f', '#1565c0', '#2e7d32', '#7b1fa2', '#00838f', '#ef6c00', '#c2185b',
    '#6d4c41', '#7cb342', '#3949ab', '#f9a825', '#0288d1', '#9e9d24', '#546e7a',
  ];

  function DEFAULT_SCHEME() {
    return {
      v: 1,
      followMaster: true,
      groups: [
        { id: 'g-sof', name: 'Sof Pasuk', color: '#d32f2f', keys: ['sof-pasuk', 'tipcha-sof'] },
        { id: 'g-etnachta', name: 'Etnachta', color: '#1565c0', keys: ['etnachta', 'tipcha-etnachta'] },
        { id: 'g-katon', name: 'Zakef Katon', color: '#2e7d32', keys: ['zakef-katon', 'pashta'] },
        { id: 'g-yetiv', name: 'Yetiv', color: '#9e9d24', keys: ['yetiv'] },
        { id: 'g-gadol', name: 'Zakef Gadol', color: '#7cb342', keys: ['zakef-gadol'] },
        { id: 'g-revii', name: "Revi'i", color: '#7b1fa2', keys: ['revii', 'legarmeh'] },
        { id: 'g-segol', name: 'Segol', color: '#00838f', keys: ['segol', 'zarka', 'shalshelet'] },
        { id: 'g-tevir', name: 'Tevir', color: '#ef6c00', keys: ['tevir'] },
        { id: 'g-geresh', name: 'Azla-Geresh', color: '#c2185b', keys: ['geresh', 'telisha-gedola'] },
        { id: 'g-gershayim', name: 'Gershayim', color: '#546e7a', keys: ['gershayim'] },
        { id: 'g-pazer', name: 'Pazer', color: '#6d4c41', keys: ['pazer', 'karnei-para'] },
      ],
    };
  }

  // Validates anything that came out of localStorage (could be old,
  // hand-edited or corrupt) and returns a usable scheme. A key may belong
  // to at most one group; unknown keys and bad colors are dropped.
  function normalizeScheme(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.groups)) return DEFAULT_SCHEME();
    const seen = new Set();
    const groups = [];
    s.groups.forEach((g, i) => {
      if (!g || typeof g !== 'object') return;
      const color = /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color.toLowerCase() : PALETTE[i % PALETTE.length];
      const id = /^[a-z0-9-]{1,40}$/i.test(g.id || '') ? g.id : 'g-' + i;
      const keys = (Array.isArray(g.keys) ? g.keys : []).filter((k) => TROPE_BY_KEY[k] && !seen.has(k));
      keys.forEach((k) => seen.add(k));
      groups.push({ id, name: String(g.name || 'Group').slice(0, 40), color, keys });
    });
    return { v: 1, followMaster: s.followMaster !== false, groups };
  }

  // Stylesheet for a scheme. Light: the color as chosen. Dark: the same
  // hue lightened toward white so it stays readable on the dark card.
  // A servant (conjunctive) that the user put into a group always gets
  // that group's color; a servant in no group follows its master when
  // followMaster is on (otherwise stays uncolored). Specificity: the
  // follow rule is .tw.tc.tm-X (3 classes); a servant's own rule is
  // .tw.tc.tk-Y (3 classes) and is emitted LAST, so it wins.
  function schemeToCss(scheme) {
    const s = normalizeScheme(scheme);
    const first = [], last = [];
    for (const g of s.groups) {
      const sel = [], own = [];
      for (const k of g.keys) {
        if (TROPE_BY_KEY[k].conj) own.push(`html[data-trope] .tw.tc.tk-${k}`);
        else {
          sel.push(`html[data-trope] .tw.tk-${k}`);
          if (s.followMaster) sel.push(`html[data-trope] .tw.tc.tm-${k}`);
        }
      }
      sel.push(`html[data-trope] .tg-${g.id}`);
      first.push({ sel, color: g.color });
      if (own.length) last.push({ sel: own, color: g.color });
    }
    const all = first.concat(last);
    const light = all.map(r => `${r.sel.join(',\n')}{color:${r.color};}`).join('\n');
    const dark = (ctx) => all.map(r =>
      `${r.sel.map(x => x.replace('html[data-trope]', ctx)).join(',\n')}{color:color-mix(in oklab, ${r.color} 62%, white);}`).join('\n');
    // Same two dark-mode contexts index.html uses everywhere else.
    return light +
      `\n@media(prefers-color-scheme:dark){\n${dark('html:not([data-theme="light"])[data-trope]')}\n}\n` +
      dark('html[data-theme="dark"][data-trope]') + '\n';
  }

  const stripTags = (html) => String(html).replace(/<[^>]+>/g, '');
  const hasLetters = (s) => /[א-ת]/.test(s);

  // Strongest accent on one word. null = not a word (petucha/setuma/paseq).
  function readWord(html) {
    // Petucha/setuma markers are tokens whose glyph IS a letter (פ / ס).
    if (/class="pm[ "]/.test(html)) return null;
    const text = stripTags(html);
    if (!hasLetters(text)) return null;
    if (text.includes(SOF_PASUK)) return { kind: 'disj', id: 'sof-pasuk' };
    let best = null;
    for (const ch of text) {
      const d = DISJ[ch];
      if (d && (!best || best.kind !== 'disj' || RANK[d] < RANK[best.id])) best = { kind: 'disj', id: d };
      const c = CONJ[ch];
      if (c && !best) best = { kind: 'conj', id: c };
    }
    return best || { kind: 'conj', id: 'none' };
  }

  // Classifies every token of one rendered reading (any span of whole
  // verses; results are identical whether run per verse or per chapter).
  // Mutates and returns the array: word tokens get
  // t.trope = {key, master, name} and their vowel HTML wrapped.
  function classifyTropeTokens(tokens) {
    const info = tokens.map((t) => readWord(t.vowel));

    // Munach directly before a paseq token is munach legarmeh (disjunctive).
    for (let i = 0; i < info.length; i++) {
      const w = info[i];
      if (w && w.kind === 'conj' && w.id === 'munach') {
        const next = tokens[i + 1];
        if (next && stripTags(next.vowel).trim() === PASEQ) info[i] = { kind: 'disj', id: 'legarmeh' };
      }
    }

    // Right-to-left: tipcha gets its context from the next etnachta / sof
    // pasuk; conjunctives get the key of the nearest following disjunctive.
    // No explicit verse reset needed — scanning leftward, the previous
    // verse's own sof pasuk overwrites both trackers. (Deliberately not
    // keyed off t.verseNum: congregation-repeat passages split one verse
    // into pseudo-verses, and a reset there would orphan words.)
    const keyOf = new Array(tokens.length).fill(null);
    const masterOf = new Array(tokens.length).fill(null);
    let nextKey = null;     // key of nearest following disjunctive word
    let nextMajor = null;   // 'etnachta' | 'sof'
    for (let i = tokens.length - 1; i >= 0; i--) {
      const w = info[i];
      if (!w) continue;
      if (w.kind === 'disj') {
        const k = w.id === 'tipcha' ? 'tipcha-' + (nextMajor || 'sof') : w.id;
        keyOf[i] = k;
        nextKey = k;
        if (w.id === 'etnachta') nextMajor = 'etnachta';
        if (w.id === 'sof-pasuk') nextMajor = 'sof';
      } else {
        keyOf[i] = w.id;
        masterOf[i] = nextKey;
      }
    }

    tokens.forEach((t, i) => {
      const k = keyOf[i];
      if (!k) return;
      let name = TROPE_BY_KEY[k].en;
      if (k === 'geresh') {
        // previous WORD — a paseq token can sit between kadma and azla
        let j = i - 1;
        while (j >= 0 && !keyOf[j]) j--;
        const prev = j >= 0 ? keyOf[j] : null;
        name = prev === 'kadma' ? 'Azla' : 'Azla-Geresh';
      } else if (k.startsWith('tipcha-')) name = 'Tipcha';
      const cls = ['tw', 'tk-' + k];
      if (TROPE_BY_KEY[k].conj) { cls.push('tc'); if (masterOf[i]) cls.push('tm-' + masterOf[i]); }
      t.trope = { key: k, master: masterOf[i], name };
      const title = k === 'none' ? '' : ` title="${name}"`;
      t.vowel = `<span class="${cls.join(' ')}"${title}>${t.vowel}</span>`;
    });
    return tokens;
  }

  const api = { classifyTropeTokens, readWord, TROPES, PALETTE, DEFAULT_SCHEME, normalizeScheme, schemeToCss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trope = api;
})(typeof window !== 'undefined' ? window : this);
