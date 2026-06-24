# Line-Sync Tikkun — Working Notes

**Status as of this checkpoint: Step 1 (tokenization layer) complete and fully
validated. Step 2 (DOM measurement + line-break rendering) not yet started.
Nothing in this folder is wired into `index.html` yet.**

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
   the entire Torah. **Done, this checkpoint.**
2. ⬜ Measure-and-break pipeline for **screen only** (Side-by-Side +
   Either-Or). Prototype and verify via headless browser before adding
   anything else.
3. ⬜ Debounced resize listener, re-running step 2's logic.
4. ⬜ Lazy print-time computation (separate measurement, fixed print-width
   reference), wired into the existing `printSection()` click handlers.

Each step should be fully verified (headless browser, real DOM inspection —
not just "should work" reasoning) before moving to the next, and before
anything is pushed to `main`.

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

## Open questions / things to revisit in Step 2

- Confirm vowel-column-as-measurement-reference is always the wider/safer
  choice, or whether some verses need scroll-width as the constraint instead.
- Exact desktop max-width value (currently undecided, "tune by eye").
- Whether U+05C0/U+05C6 should be *styled* differently in scroll view (e.g.
  smaller, since they're not literal text content but scribal marks) — they
  now survive in both columns, but no cosmetic treatment decided yet.
- Confirm the print reference width (~650–700px) against an actual printed
  page test, not just assumption.
