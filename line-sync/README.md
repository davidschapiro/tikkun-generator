# Line-Sync Tikkun — Working Notes

**Status as of this checkpoint: Steps 1 and 2 complete and fully validated.
Step 2 IS wired into `index.html` on this branch (not yet merged to `main`).
Steps 3 (resize listener) and 4 (lazy print-time computation) — see below,
Step 3 turned out to be small enough to fold into Step 2's build; Step 4
remains genuinely separate and not yet started.**

---

## The problem

In the Tikkun Korim (practice) view, the Scroll column (consonants only) and
the Tikkun column (vowelized, with cantillation) are rendered as two
independently-flowing blocks of text. Because vowelized words and
consonant-only words don't have identical pixel widths, the two columns wrap
onto different lines at different points — so:

- In **Side-by-Side** mode, the two columns don't align row-for-row.
- In **Either-Or** mode (toggle between Scroll view / Tikkun view), flipping
  between the two causes a visible jump, since the content reflows differently.

## Why we didn't adopt tikkun.io's approach

We looked at github.com/akivajgordon/tikkun.io (MIT licensed, mature project,
245-page real Sefer Torah column data). Their solution is **not** an
algorithm — it's pre-baked, page-accurate scroll data: ~3.7MB of static JSON,
one file per physical page of an actual kosher Sefer Torah (245 columns,
~42 lines/column, matching the Vilna Gaon/Ashkenazi STa"M custom — not a strict
halacha, but a widely-followed minhag). Both their Scroll and Tikkun renders
pull from the *same* per-line array, so identical line breaks are guaranteed
by construction. Verse numbers are placed in the margin via CSS, which only
works because their layout is a **fixed-width, non-responsive page replica**.

**Decision: we are not adopting this.** We don't need physical scroll
authenticity (column widths/lengths vary by scribe/era anyway). We need
*internal* consistency between our two views, not a replica of a specific
physical scroll. Importing their dataset would also require MIT attribution
and importing baggage we don't need.

## The chosen approach: token-paired measurement

Build parallel **token arrays** — index `i` means the same logical word in
both Scroll and Tikkun. Each token is `{vowel, scroll, verseNum}`. Measure
where the Tikkun (vowelized) column's tokens wrap at the *current* rendered
column width, record the break points (which token indices start a new line),
then apply those *same* break indices to the Scroll column. This guarantees
row-for-row alignment without needing pre-baked physical-scroll data.

### Why measure against the vowelized column specifically
The vowelized column is generally the wider of the two (cantillation +
ketiv annotations add width), so using it as the reference for break-points
is the conservative choice — though this hasn't been stress-tested yet for
verses where the *scroll* column might unexpectedly be wider (e.g. many
maqaf-joined words, which become two visually-spaced words in scroll but
stay one token). **Worth revisiting in Step 2 testing.**

### Width handling
- **Desktop:** Tikkun Korim container gets a max-width cap (practical
  reading width — exact value to be tuned by eye in Step 2 prototype) so it
  can't stretch across an ultrawide monitor.
- **Mobile:** container width = actual device width, no cap. Full
  responsiveness preserved — this was a real concern raised and resolved:
  there is no responsiveness/line-sync tradeoff, both can coexist.
- **Resize handling:** a debounced resize listener re-runs the
  measure-and-break pass at the new width. Not yet implemented.

### Print handling (not yet implemented)
- **Rejected approach 1:** print whatever's on screen as-is. Breaks badly —
  if a user prints from a phone, the print engine would either leave it
  narrow with wasted space, or stretch it up to print-page width, blowing up
  font size absurdly.
- **Rejected approach 2:** precompute print-breaks eagerly at every
  generation. Wasteful — most generations are for reading, not printing.
- **Chosen approach:** compute print-breaks **lazily**, inside the print
  button's `onclick` handler, immediately before calling `window.print()`.
  Measured against a fixed reference print-page width (~650–700px),
  completely decoupled from whatever device initiated the print. We already
  call `window.print()` ourselves (not relying on the `beforeprint` event),
  so there's no race condition — we control the exact sequence.

## Build order (per user's explicit step-by-step request)

1. ✅ **Tokenization layer** — build token-paired arrays, validate against
   the entire Torah.
2. ✅ **Measure-and-break pipeline for screen** (Side-by-Side + Either-Or).
   Prototyped in isolation first (hand-typed tokens, then real Sefaria data),
   verified visually via screenshot before touching the real app. Then
   integrated into `index.html`: `aliyahSection()` now builds tokens and
   leaves empty `.col-vowel`/`.col-scroll` containers; `syncAllPracticeColumns()`
   runs after the HTML is in the live DOM (measurement needs real layout) and
   populates both columns with explicit, identical `<br>` breaks.
3. ✅ **Debounced resize listener** (150ms) — turned out small enough to
   build alongside Step 2 rather than as a separate pass. Re-runs
   `syncAllPracticeColumns()` on width change.
4. ⬜ **Lazy print-time computation** — still not started. Current print
   output uses whatever breaks were last computed for the on-screen width
   (verified this doesn't crash or lose content, but it's not yet the
   "fixed ~650–700px print reference, computed inside the print button's
   click handler" design from earlier discussion). This is the next and
   final step.

Each step has been fully verified via headless browser (Playwright) — real
DOM inspection, real Sefaria data, full-Torah validation re-run against the
*exact* code living in `index.html` (not just the standalone prototype) —
before being pushed to this branch. Nothing has been merged to `main` yet.

---

## Step 1 details: what was built and validated

### Files in this folder
- `tokenizer.js` — the core `buildTokens(verses)` function and its
  dependencies (`resolveKetivQere`, `processHeToWords`, `wordToHtml`).
  Exports `buildTokens`, `processHeToWords`, `wordToHtml`.
- `full-torah-reference.json` — all 5,846 verses of the Torah, fetched from
  Sefaria, in `[ref, rawHebrewHtml]` pairs. Used for full-corpus validation.
- `validate.js` — runs `buildTokens` against every chapter in the reference
  data and reports any verse where the vowel and scroll token arrays don't
  have matching lengths (which would break index-pairing).

### Validation result
**0 mismatches out of 69,561 tokens, across all 5,846 verses in the Torah.**

### Bugs found and fixed during this process (all real, all confirmed via
the full-corpus validation — not theoretical)

1. **Maqaf-to-space conversion was splitting tokens.** Originally, the
   scroll column converted maqaf (־) to a literal space *before* splitting
   on whitespace — so `אל־משה` (one word, hyphenated) became two separate
   tokens (`אל`, `משה`) in scroll, while the vowel column kept it as one
   token. Fix: keep maqaf as a real character through tokenization (so the
   word stays atomic), and only convert it to a visual space *inside* that
   single token's rendered HTML, at the final render step.

2. **Ketiv annotation was glued to the qere with a literal space.** The
   vowel column's replacement was `${qere} ##KT_${ketiv}_END##` (note the
   space) — which created an extra "word" after splitting, with no
   corresponding token in scroll. Fix: glue with no space
   (`${qere}##KT_${ketiv}_END##`), so it survives splitting as one token,
   and only insert the visual space when converting the placeholder back to
   HTML at render time.

3. **Multi-word qere ↔ single-word ketiv** (2 occurrences in the entire
   Torah: Genesis 30:11, Deuteronomy 33:2 — e.g. qere `בָּ֣א גָ֑ד` / ketiv
   `בגד`). A genuine, attested Masoretic phenomenon, not a bug in the
   source text. Fix: when the qere span contains multiple words, glue them
   together with the Unicode WORD JOINER (U+2060 — invisible, and crucially
   *not* matched by `\s` in a regex split) before attaching the ketiv
   placeholder, so the whole multi-word qere + annotation survives as one
   atomic token. The joiner is converted back to a real space at final
   render.

4. **U+05C0 (paseq) and U+05C6 (inverted nun) were being stripped from the
   scroll column only.** These are scribal/sectioning marks (the inverted
   nuns famously bracket "ויהי בנסע" in Numbers 10:35–36), not nikud — but
   the diacritic-stripping regex's range `\u05BF-\u05C7` accidentally
   included both codepoints. They survived in the vowel column (which
   doesn't run that regex) but vanished from scroll, breaking parity. Fix:
   carved out explicit gaps for U+05BE (maqaf, already excluded), U+05C0,
   and U+05C6 in the stripping regex:
   `/[\u0591-\u05BD\u05BF\u05C1-\u05C5\u05C7]/g`.
   Verified against Python's `re` module character-by-character before
   applying, to avoid another silent regex-range mistake.

### Token data format

```js
{
  vowel:    "<HTML string — vowelized word, possibly with a trailing
              <span class='kt'>...</span> ketiv annotation or
              <span class='pm'>...</span> paragraph marker>",
  scroll:   "<HTML string — bare consonants, maqaf rendered as a space,
              same markers where applicable>",
  verseNum: 7 | null   // verse number if this token starts a new verse
}
```

Built by `buildTokens(verses)` where
`verses = [{v: 7, he: "<raw Sefaria HTML for this verse>"}, ...]`.
Index `i` means the same logical word position in *both* `vowel` and
`scroll` arrays — that 1:1 correspondence is the entire point, and it's
the thing that was actually broken (4 ways) and is now fixed and verified.

---

## Step 2 details: what was built and validated

### Architecture
- `buildTokens(verses)` (unchanged from Step 1) is now the single source of
  truth for both Bima and Practice rendering — no more duplicate
  string-based `processHe`/`buildFlow` logic for two different paths.
- **Bima**: `buildBimaFlow(verses)` — tokens joined with natural spaces, no
  break-syncing (single column, responsive, exactly as before).
- **Practice**: `aliyahSection()` registers each aliyah's tokens in
  `window.__aliyahTokenRegistry`, keyed by a generated `data-token-id`, and
  renders *empty* `.col-vowel`/`.col-scroll` containers. After the full
  output HTML is inserted into the DOM (`output.innerHTML = ...`),
  `syncAllPracticeColumns()` runs once, finds every practice aliyah, and
  calls `renderSyncedColumns(tokens, vowelEl, scrollEl)` for each.
- `renderSyncedColumns()`: renders vowel tokens as `<span class="ttok">`
  inline-blocks (so the browser lays them out naturally first), measures
  `offsetTop` to detect line membership, records break indices, then
  rebuilds *both* columns with identical `<br>` tags at those indices.
- A debounced (150ms) `resize` listener re-runs `syncAllPracticeColumns()`
  on viewport width changes (covers window resize and phone rotation).

### Why measure against the vowel column specifically
Kept as originally planned — vowel tokens include cantillation and ketiv
annotations, generally making them the wider/more-constraining column.
**Not yet stress-tested** for a hypothetical verse where scroll ends up
wider (e.g. many maqaf-joined words rendered with a visual space). Worth
a dedicated check before merging to `main`, though no failure observed
across the full real-data testing done so far.

### Validation performed
- **Full-Torah token validation re-run against the exact code extracted
  from the live `index.html`** (not just the standalone `tokenizer.js`) —
  69,561 tokens, 0 mismatches. Confirms the integration didn't silently
  diverge from the verified Step 1 logic.
- **Headless browser (Playwright), real Sefaria data**: generated a full
  real parasha (Chukat-Balak, 8 aliyot) — 0 console/page errors, 160
  matching `<br>` breaks between vowel and scroll across all aliyot.
  Screenshot-verified row-for-row visual alignment.
- **Holiday reading** (Purim, 6 aliyot — different structure/count from a
  Shabbat parasha) — 0 errors, 18/18 matching breaks.
- **Bima tab** — confirmed still renders correctly (not broken by the
  shared-tokenizer refactor).
- **Either-Or mode** — confirmed default-to-Tikkun-view still works
  correctly with the new token-based columns.
- **Resize** — confirmed breaks recompute correctly at a new width (160 →
  210 breaks when narrowing from 800px to 380px), and vowel/scroll stay
  matched after recompute.
- **Print** — confirmed both columns still render with content and equal
  grid widths in `@media print`. **Not yet using a dedicated print-width
  computation** — see Step 4, still open.

### Known limitation carried into this checkpoint
Print currently shows whatever breaks were last computed for the
*on-screen* width at generation time — not yet the planned fixed
print-reference-width computation. This means if you print from a very
narrow phone screen, the printed columns will reflect the phone's narrow
breaks, not an optimized print layout. This is exactly the problem Step 4
is meant to solve, and is now the only remaining piece of the original plan.

## Open questions / things to revisit in Step 2

- Confirm vowel-column-as-measurement-reference is always the wider/safer
  choice, or whether some verses need scroll-width as the constraint instead.
- Exact desktop max-width value (currently undecided, "tune by eye").
- Whether U+05C0/U+05C6 should be *styled* differently in scroll view (e.g.
  smaller, since they're not literal text content but scribal marks) — they
  now survive in both columns, but no cosmetic treatment decided yet.
- Confirm the print reference width (~650–700px) against an actual printed
  page test, not just assumption.
