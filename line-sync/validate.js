const fs = require('fs');
const { buildTokens } = require('./test_tokenize4.js');

const data = JSON.parse(fs.readFileSync('/home/claude/full_torah.json', 'utf8'));
const byChapter = {};
for (const [ref, he] of data) {
  const m = ref.match(/^(.+) (\d+):(\d+)$/);
  const [, book, ch, v] = m;
  const key = `${book}.${ch}`;
  (byChapter[key] = byChapter[key] || []).push({v: parseInt(v), he});
}

let totalMismatches = 0, totalTokens = 0;
for (const [key, verses] of Object.entries(byChapter)) {
  const {tokens, mismatches} = buildTokens(verses);
  totalTokens += tokens.length;
  if (mismatches.length > 0) {
    totalMismatches += mismatches.length;
    mismatches.forEach(m => {
      console.log(`MISMATCH ${key}:${m.v} — vowel=${m.vowelWords.length} scroll=${m.scrollWords.length}`);
      console.log('  vowel:', m.vowelWords);
      console.log('  scroll:', m.scrollWords);
    });
  }
}
console.log(`\nTotal tokens: ${totalTokens}`);
console.log(`Total mismatches: ${totalMismatches}`);

// Also re-verify maqaf renders correctly now
const testV = [{v:11, he:'אֶת־שְׁמ֖וֹ'}];
const {wordToHtml, processHeToWords} = require('./test_tokenize4.js');
const scrollWords = processHeToWords(testV[0].he, true);
console.log('\nMaqaf check — scroll words:', scrollWords);
console.log('Rendered:', wordToHtml(scrollWords[0], true));
