// Full-Torah validation for tokenizer.js.
// Run: node tests/validate-tokenizer.js
// Requires both columns to produce the SAME word count for every verse —
// a mismatch breaks line-sync between scroll and vowel columns.
// See AGENTS.md §2 and §4 for why this matters and what's been caught here before.
const fs = require('fs');
const path = require('path');
const { buildTokens } = require(path.join(__dirname, '..', 'tokenizer.js'));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'full-torah-reference.json'), 'utf8'));
const byChapter = {};
for (const [ref, he] of data) {
  const m = ref.match(/^(.+) (\d+):(\d+)$/);
  const [, book, ch, v] = m;
  const key = `${book}.${ch}`;
  (byChapter[key] = byChapter[key] || []).push({ v: parseInt(v), he });
}

let totalTokens = 0, totalMismatches = 0;
const failures = [];
for (const [key, verses] of Object.entries(byChapter)) {
  const { tokens, mismatches } = buildTokens(verses);
  totalTokens += tokens.length;
  totalMismatches += mismatches.length;
  if (mismatches.length) failures.push({ key, mismatches });
}

console.log(`Total tokens: ${totalTokens}`);
console.log(`Total mismatches: ${totalMismatches}`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach(f => console.log(JSON.stringify(f)));
  process.exit(1);
} else {
  console.log('PASS — 0 mismatches across the entire Torah.');
  process.exit(0);
}
