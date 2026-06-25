function resolveKetivQere(s, forScroll) {
  // Multi-word qere: glue with WORD JOINER (invisible, non-\s) so it
  // survives as ONE token through the later whitespace-split.
  const pat1 = /<span class="mam-kq">\s*<span class="mam-kq-k">\(([^)]*)\)<\/span>\s*<span class="mam-kq-q">\[([^\]]*)\]<\/span>\s*<\/span>/g;
  const pat2 = /<span class="mam-kq">\s*<span class="mam-kq-q">\[([^\]]*)\]<\/span>\s*<span class="mam-kq-k">\(([^)]*)\)<\/span>\s*<\/span>/g;
  const repl = (ketiv, qere) => {
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
  // Paseq (U+05C0) is a vocalization/cantillation mark used in printed
  // texts — it is NOT written in an actual sefer Torah, so it must be
  // dropped from the scroll column. But it always appears as its own
  // standalone token (e.g. "קוּמָה ׀ יְהֹוָה"); naively stripping the
  // character would leave an empty "word" that gets filtered out of the
  // scroll array but not the vowel array, breaking 1:1 token alignment.
  // Convert to a placeholder first so both columns keep the same word
  // count; resolved differently per column in wordToHtml.
  s = s.replace(/<(?:b|small)>\u05C0<\/(?:b|small)>/g, '##PASEQ##');
  s = resolveKetivQere(s, forScroll);
  s = s.replace(/<span[^>]*mam-spi-pe[^>]*>\{פ\}<\/span>/g,     '##PE##');
  s = s.replace(/<span[^>]*mam-spi-samekh[^>]*>\{ס\}<\/span>/g, '##SAM##');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g,' ').replace(/&thinsp;/g,' ').replace(/\u00a0/g,' ').trim();
  if (forScroll) {
    // U+05C6 (inverted nun) is a scribal/sectioning mark, not nikud —
    // excluded from stripping so it survives in both columns.
    s = s.replace(/[\u0591-\u05BD\u05BF-\u05C5\u05C7]/g, '');
  }
  return s.split(/\s+/).filter(w => w.length > 0);
}

function wordToHtml(word, forScroll) {
  let s = word
    .replace(/\u2060/g, ' ')
    .replace(/##PE##/g,  '<span class="pm">פ</span>')
    .replace(/##SAM##/g, '<span class="pm">ס</span>')
    .replace(/##KT_(.*?)_END##/g, ' <span class="kt">\u05db\u05f3 $1</span>');
  if (forScroll) {
    s = s.replace(/\u05BE/g, ' ');
    s = s.replace(/##PASEQ##/g, ''); // not written in an actual scroll
  } else {
    s = s.replace(/##PASEQ##/g, '\u05C0');
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

// ── BIMA: simple flowing render, no break-sync needed (single column) ──

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolveKetivQere, processHeToWords, wordToHtml, buildTokens };
}
