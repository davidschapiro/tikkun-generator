function resolveKetivQere(s, forScroll) {
  const pat1 = /<span class="mam-kq">\s*<span class="mam-kq-k">\(([^)]*)\)<\/span>\s*<span class="mam-kq-q">\[([^\]]*)\]<\/span>\s*<\/span>/g;
  const pat2 = /<span class="mam-kq">\s*<span class="mam-kq-q">\[([^\]]*)\]<\/span>\s*<span class="mam-kq-k">\(([^)]*)\)<\/span>\s*<\/span>/g;
  const repl = (ketiv, qere) => {
    // Multi-word qere: glue with WORD JOINER (invisible, non-\s) so it
    // survives as ONE token through the later whitespace-split.
    const gluedQere = qere.replace(/\s+/g, '\u2060');
    return forScroll ? ketiv : `${gluedQere}##KT_${ketiv}_END##`;
  };
  s = s.replace(pat1, (m, k, q) => repl(k, q));
  s = s.replace(pat2, (m, q, k) => repl(k, q));
  return s;
}

function processHeToWords(raw, forScroll) {
  let s = raw;
  s = s.replace(/<sup class="footnote-marker">\*<\/sup><i class="footnote">\(.*?\)<\/i>/gs, '');
  s = resolveKetivQere(s, forScroll);
  s = s.replace(/<span[^>]*mam-spi-pe[^>]*>\{פ\}<\/span>/g,     '##PE##');
  s = s.replace(/<span[^>]*mam-spi-samekh[^>]*>\{ס\}<\/span>/g, '##SAM##');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g,' ').replace(/&thinsp;/g,' ').replace(/\u00a0/g,' ').trim();
  if (forScroll) {
    // Exclude U+05C0 (paseq) and U+05C6 (inverted nun) — these are scribal/
    // sectioning marks, not nikud, and must survive in both columns equally.
    s = s.replace(/[\u0591-\u05BD\u05BF\u05C1-\u05C5\u05C7]/g, '');
  }
  return s.split(/\s+/).filter(w => w.length > 0);
}

function wordToHtml(word, forScroll) {
  let s = word
    .replace(/\u2060/g, ' ')  // restore real space within merged multi-word qere
    .replace(/##PE##/g,  '<span class="pm">פ</span>')
    .replace(/##SAM##/g, '<span class="pm">ס</span>')
    .replace(/##KT_(.*?)_END##/g, ' <span class="kt">\u05db\u05f3 $1</span>');
  if (forScroll) {
    s = s.replace(/\u05BE/g, ' ');
  }
  return s;
}

function buildTokens(verses) {
  const tokens = [];
  const mismatches = [];
  for (const {v, he} of verses) {
    const vowelWords  = processHeToWords(he, false);
    const scrollWords = processHeToWords(he, true);
    if (vowelWords.length !== scrollWords.length) {
      mismatches.push({v, vowelWords, scrollWords});
    }
    vowelWords.forEach((vw, i) => {
      tokens.push({
        vowel: wordToHtml(vw, false),
        scroll: wordToHtml(scrollWords[i] || '', true),
        verseNum: i === 0 ? v : null
      });
    });
  }
  return {tokens, mismatches};
}

module.exports = { buildTokens, processHeToWords, wordToHtml };

if (require.main === module) {
  const testVerses = [
    {v:11, he:'וַתֹּ֥אמֶר לֵאָ֖ה <span class="mam-kq"><span class="mam-kq-k">(בגד)</span> <span class="mam-kq-q">[בָּ֣א גָ֑ד]</span></span> וַתִּקְרָ֥א אֶת־שְׁמ֖וֹ גָּֽד׃'},
  ];
  const {tokens, mismatches} = buildTokens(testVerses);
  tokens.forEach((t, i) => console.log(`[${i}] vowel="${t.vowel}" scroll="${t.scroll}"`));
  console.log(`Mismatches: ${mismatches.length}`);
}
