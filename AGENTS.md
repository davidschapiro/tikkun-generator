# AGENTS.md — Engineering memory for the Tikkun Generator

This file exists so that a future Claude session (or any future contributor)
can pick up this project without re-discovering the same bugs, re-falling
for the same false leads, or repeating the same workflow mistakes. It is
**not** user-facing documentation — see `README.md` for that. This is
internal engineering memory: what we tried, what worked, what didn't, and
why.

If you are an AI agent starting a fresh session on this repo: **read this
entire file before making any change.** It will save you (and the person
you're working with) real time and real frustration.

---

## 1. Project shape, in one paragraph

A single-file HTML/CSS/JS web app (`index.html`, currently ~137KB) that
generates Torah/holiday reading practice sheets ("tikkunim"). No build step,
no framework, no backend. Data (parasha schedules, holiday leyning, the
Hebrew font) is fetched live from Sefaria/Hebcal at runtime *or* embedded as
base64/JSON directly in the file. Hosted on GitHub Pages with a custom
domain. A GitHub Action refreshes the embedded schedule data twice a year.

---

## 2. Critical domain knowledge (Hebrew text specifics)

This is the part most likely to bite a future agent who doesn't know it.

### Ketiv/Qere (כתיב/קרי)
Some words in the Torah are *written* one way (ketiv) but *read aloud*
another way (qere). Sefaria encodes both: `<span class="mam-kq-k">(written)
</span> <span class="mam-kq-q">[read]</span>` (order varies — sometimes
ketiv-then-qere, sometimes qere-then-ketiv; this is just an artifact of how
different sections of Sefaria's source data were transcribed, not
semantically meaningful — handle both orderings).

- **Scroll column** must show only the ketiv.
- **Vowelized column** must show the qere (with its real vowels/cantillation)
  plus a small ketiv annotation alongside.
- **Edge case, 2 occurrences in the whole Torah** (Genesis 30:11,
  Deuteronomy 33:2): the qere is *multiple words* mapping to a *single*
  ketiv word. If you don't special-case this, you get a silent word-count
  mismatch between columns. Fixed by gluing multi-word qere together with
  U+2060 (WORD JOINER — invisible, and critically *not* matched by `\s` in a
  regex split) before attaching the ketiv annotation, so the whole thing
  survives as one atomic token.

### Paseq (פסק, U+05C0, renders as `׀`)
A cantillation/pause mark used in *printed* vocalized texts. **Not written
in an actual sefer Torah.** Must be stripped from scroll, kept in vowelized.
Always appears as its own standalone space-separated token, wrapped in
`<b>` or `<small>` tags by Sefaria. **The naive fix (just strip the
character) is wrong** — it leaves an empty "word" that gets filtered out of
the scroll array but not the vowel array, shifting every subsequent token's
index alignment for that verse. Correct fix: convert to a placeholder
(`##PASEQ##`) *before* any stripping, so both columns keep the same word
count; resolve the placeholder differently per column at final render
(`׀` for vowel, empty string for scroll).

### Inverted nun (נון הפוכה, U+05C6, renders as `׆`)
Brackets the "ויהי בנסע" passage (Numbers 10:35–36). Historically debated
whether it's literally written in scrolls or is a Masoretic/print
convention only. **We left this one alone** — it survives in both columns
currently. If someone reports this as wrong, it's the same class of issue
as paseq and should be fixed the same way (placeholder technique), but
verify with a rabbi/sofer first since the sources are genuinely mixed,
unlike paseq which is unambiguous.

### Maqaf (מקף, U+05BE, renders as `־`)
Hyphenates two words into one (e.g. `אֶל־מֹשֶׁה`). In the vowelized column,
keep it as the real hyphen character. In the scroll column, the visual
convention is to show it as a *space* — but it must **stay as a single
atomic token**, not be split into two array entries. (Naively converting
maqaf to a space *before* splitting on whitespace creates exactly this
bug — we hit it once.) Convert maqaf to a space only at final render, after
tokenization, within that one token's own string.

### Footnote/manuscript-variant notes
Sefaria embeds editorial notes like `<sup class="footnote-marker">*</sup>
<i class="footnote">(spelling variant in Sephardi/Ashkenazi mss...)</i>`.
These are not text to be read at all — strip them entirely, in both
columns, before any other processing.

### Paragraph markers (פ/ס)
`{פ}` (petucha) and `{ס}` (setuma) mark section breaks. Rendered in both
columns as a small gold `<span class="pm">`. Uses the same placeholder
technique as everything above (`##PE##` / `##SAM##`).

### Verse-number display format (chapter:verse vs. bare number)
`buildTokens` (tokenizer.js) decides, per verse, whether to show a bare
verse number (`15`) or the full `chapter:verse` form (`19:15`) as the
`<sup class="vn">` content. Rule: full form at the start of every chapter
(`v === 1` — Torah verses always restart at 1 for a new chapter, so this
alone correctly catches every transition, including ones that happen
mid-aliyah), every 15th verse as a periodic orientation aid (`v % 15 ===
0`), and always for the very first verse of whatever `verses` array was
passed in (even if it doesn't start at `v === 1` — e.g. an aliyah
beginning mid-chapter at verse 10 still needs to tell the reader which
chapter they're in, immediately, not wait for the next periodic mark).
Bare number everywhere else. Requires the caller to supply `ch` per verse
(`{ch, v, he}`, matching `index.html`'s real `fetchVerses` exactly) — if
`ch` is omitted (as in some older test fixtures, see the `v: i+1` note
below), it silently falls back to bare numbers throughout, same as
before this feature existed. Verified: full-Torah scan confirms 492
chapter-display + 5354 bare-display verse-number tokens = 5846 total,
exactly the known total verse count in the Torah, zero malformed.

### The general pattern
**Every one of the above bugs had the same shape**: a Sefaria HTML
annotation that, if naively stripped or processed, either (a) leaks
unwanted text into the rendered output, or (b) silently changes the word
count in one column but not the other, breaking 1:1 token-index alignment
between scroll and vowel. **If you add ANY new text transformation to this
pipeline, ask: does this change word count? Does it survive identically in
both columns where it should?** Then validate against the full Torah
(see §4) before trusting it.

---

## 3. Architecture: how the line-sync mechanism actually works

(Full design rationale and history: see `line-sync/README.md` on the
`line-sync-tikkun` branch — kept for reference, not merged, since its git
history diverged from main; see §6.)

- `buildTokens(verses)` is the **single source of truth** for both Bima
  and Practice rendering. It returns `{tokens, mismatches}` where each
  token is `{vowel, scroll, verseNum}` and index `i` means the *same
  logical word* in both `vowel` and `scroll`.
- **Bima** (`buildBimaFlow`): tokens joined with natural spaces, no
  break-syncing, single column, fully responsive.
- **Practice**: tokens are registered in `window.__aliyahTokenRegistry`,
  keyed by a generated `data-token-id`. Empty column containers are
  inserted into the DOM first; `syncAllPracticeColumns()` runs *after*
  insertion (measurement needs real layout) and calls
  `renderSyncedColumns(tokens, vowelEl, scrollEl)` per aliyah:
  1. Render vowel tokens as `<span class="ttok">` inline-blocks.
  2. Measure `offsetTop` to detect line membership → break indices.
  3. Rebuild *both* columns with identical `<br>` tags at those indices.
- Recompute triggers: debounced window resize (150ms), and explicitly on
  Side-by-Side ↔ Either-Or toggle (the available column width changes
  from half to full — **this does not happen automatically**, you must
  call `syncAllPracticeColumns()` whenever anything changes the column's
  effective width).
- **Robustness fixes baked in** — don't remove these without understanding
  why they're there:
  - If the vowel column is `display:none` (Either-Or + Scroll-view mode)
    when a recompute fires, `offsetTop` reads are meaningless.
    `renderSyncedColumns` temporarily force-shows it via inline style,
    measures, then restores.
  - If the *whole* Practice section is hidden (Bima tab active),
    `syncAllPracticeColumns` skips silently rather than measuring a
    layout-less subtree; the tab-switch handler recomputes when Practice
    becomes visible again, catching up on anything missed.
- **The initial-load timing bug** (see §5 for the full story): the very
  first measurement on freshly-inserted content is unreliable. Fixed with
  `setTimeout(syncAllPracticeColumns, 0)` after the first call — a
  same-tick double-call does **not** work, you need a real event-loop
  yield. Root cause not fully isolated (likely font glyph-shaping or
  layout settling on first paint) — this is a verified-working fix, not a
  fully-understood one. Don't "simplify" it away without re-testing across
  multiple fresh page loads.

---

## 4. Testing methodology — this is what actually catches bugs here

**Every real bug in this codebase was caught by one of two techniques.
Opinions, code review, or "this looks right" reasoning caught none of
them.**

### Technique A: full-Torah token validation
Whenever you touch `processHeToWords`, `wordToHtml`, `resolveKetivQere`,
or `buildTokens`: extract the *exact* function bodies from `index.html`
(don't trust a separately-maintained copy — they can silently diverge),
run them against all 5,846 verses of the Torah, and check for word-count
mismatches between the vowel and scroll arrays.

```bash
python3 -c "
with open('index.html') as f:
    html = f.read()
start = html.index('function resolveKetivQere(s, forScroll) {')
end = html.index('function buildBimaFlow')
extracted = html[start:end]
with open('extracted.js', 'w') as f:
    f.write(extracted)
    f.write('\nmodule.exports = { buildTokens, processHeToWords, wordToHtml };\n')
"
node validate.js   # full-Torah reference data needed — see below
```

The full-Torah reference dataset (`[ref, rawHebrewHtml]` pairs, fetched
from Sefaria) is committed at
`line-sync/full-torah-reference.json` on the `line-sync-tikkun` branch
(1.6MB — too big for GitHub's API to inline as base64; fetch it via
`raw.githubusercontent.com/.../line-sync-tikkun/line-sync/full-torah-reference.json`,
not the Contents API, which silently returns empty for files >1MB).

**0 mismatches is the bar.** Every fix in this project's history that
claimed correctness was verified at 69,561/69,561 tokens, 0 mismatches,
before being trusted.

### Technique B: headless browser (Playwright), real data, real DOM reads
Playwright + Chromium is available in this environment
(`playwright install chromium --with-deps`). For anything touching
rendering, layout, or interactivity:

1. Write the test as a real `.py` script using `sync_playwright()`.
2. Load the *actual* `index.html` (or a copy at `/tmp/test_index.html` —
   convenient for iterating without re-pushing).
3. Interact with real selectors (`page.click`, `page.select_option`,
   `page.set_viewport_size`).
4. Read real computed values: `bounding_box()`, `getComputedStyle()`,
   `.locator(...).count()`, `inner_html()`, `inner_text()`. Never assume —
   read what the browser actually did.
5. **Run trials, not just one pass.** The initial-load timing bug only
   showed up reliably across *repeated* fresh page loads — a single test
   run would have looked fine by luck roughly half the time in early
   debugging.

**Take screenshots and actually look at them** (`page.screenshot(...)`,
then view the image) before claiming a visual bug is fixed. Several bugs
in this project were only correctly diagnosed by looking at a screenshot
the user provided — text descriptions of "it's misaligned" are not enough
to locate the actual cause.

### Things that do NOT count as testing
- "The code looks correct."
- Testing only the standalone extracted function without re-confirming it
  matches what's actually in `index.html`.
- Testing one scenario (e.g. Side-by-Side) and assuming Either-Or,
  holidays, Bima, resize, and print all inherit correctness for free. They
  don't — several of the worst bugs in this project were exactly this
  class of false assumption (Either-Or used stale Side-by-Side breaks;
  Bima-tab-hidden broke measurement; resize-while-Scroll-view-active broke
  measurement).

---

## 5. False leads — what we tried that DIDN'T work (so you don't repeat it)

Documented honestly, including the wrong turns, because the wrong turns
are exactly what wastes a future session's time if not written down.

- **Theory: font-loading race (`font-display: swap`) caused the
  initial-load break-count bug.** Disproven — `document.fonts.status`
  showed `"loaded"` immediately, yet the bug persisted. Don't assume font
  loading is the cause of a first-paint-only layout bug without checking
  `document.fonts.status` first.
- **Fix attempt: call `syncAllPracticeColumns()` twice, same tick, no
  delay.** Did not work — confirmed across 5 trials, still wrong every
  time. A same-tick re-invocation gives the browser zero opportunity to do
  whatever it needs to do between calls.
- **Fix attempt: chain 3 `requestAnimationFrame` callbacks before
  recomputing.** Did not work either — still wrong. Whatever needs to
  settle takes longer than ~3 paint frames.
- **What actually worked: `setTimeout(syncAllPracticeColumns, 0)`** — a
  genuine macrotask boundary, not just "more frames" or "more calls."
  **The exact root cause of why this is needed was never fully isolated.**
  If you have spare capacity and want closure on this, it's worth
  revisiting — but don't break the working fix while investigating.
- **Initial misdiagnosis trap**: early debugging calls that ran *before*
  `generate()` had finished its async Sefaria fetches were silent no-ops
  (the DOM elements didn't exist yet), which initially looked like
  evidence for a completely different (wrong) theory. **If a test result
  doesn't match your theory, check whether your test ran before the
  relevant DOM elements even existed.**
- **Attempting a `git merge` via GitHub's API between a long-lived feature
  branch and `main`** after `main` had moved on with unrelated commits
  → `409 Conflict` (diverged history), even though the branch's actual
  *content* was a verified superset of `main`. Don't fight the merge API
  in this situation — compare the actual file content first
  (`/repos/{repo}/compare/main...branch`), and if the content is
  genuinely correct, push it directly as a content update rather than
  trying to force a clean git-level merge. (See §6 for the right way to
  avoid this happening again.)
- **Test scripts must use `v: i+1` (bare integer) for verseNum, matching
  production exactly — not the full English reference string.** Several
  one-off verification scripts in `scripts/` build `verses` from
  `full-torah-reference.json`, whose first element is a full reference
  like `"Exodus 26:2"`. Passing that directly as `v` to `buildTokens`
  (production passes a bare integer, see `index.html` line ~569:
  `verses.push({ch, v:i+1, he:...})`) sets `verseNum` to the full string,
  which itself contains a space ("Exodus" + " " + "26:2") — when stripped
  of tags by `countSpaceGaps()`, that embedded space gets miscounted as
  an inter-word gap that doesn't exist in real data. This produced a
  convincing but entirely artifactual reproduction of a "paseq line still
  broken after the fix" report — the real fix worked fine; only the debug
  reproduction's fixture was wrong. Always construct test verses the same
  way `index.html` actually does (`{ch, v: i+1, he}`), not by reusing a
  reference-string field from an unrelated JSON fixture for convenience.
- **GitHub Pages build occasionally errors transiently** (status:
  `errored`, generic "Page build failed" message, no useful detail) and
  then **succeeds on a retry with identical content** — this has happened
  3+ times across this project's history. It is NOT caused by `.nojekyll`
  absence (added it once to test that theory — didn't fix it, confirming
  it's unrelated). If a build errors, check `/pages/builds?per_page=5` for
  the pattern (errored → built on retry); if you see that pattern, just
  trigger a new commit (even a no-op one) rather than debugging the repo
  contents. The PAT used in this project does not have Pages-write scope,
  so manually requesting a rebuild via `/pages/builds` POST returns 403 —
  the only available retry mechanism is a new commit. (New occurrence:
  the paseq-fix commit 16dcbe2 never appeared in `/pages/builds` at all —
  not even as an `errored` entry, just silently absent, with the build
  list jumping straight from the prior commit to the next one after it.
  Different failure shape than the previously-documented errored→retry
  pattern, but the same fix worked: push another commit, e.g.
  `git commit --allow-empty`.)
- **Print-time reference width: 680px was wrong, badly, and the mistake
  shipped before being caught.** When building line-sync Step 4
  (print-time break computation, see §3/§9 history), the original
  README's note "~650-700px reference print-page width" was misread as a
  *single column's* width and hardcoded directly as the probe width fed
  to `computeBreaksAtWidth`. It is NOT a single column's width — it's
  (approximately) the FULL two-column printed page's content width.
  Feeding the full-page figure into a single-column probe let roughly
  *twice* as much text fit per computed "line" as a real printed column
  can actually hold, so each pre-broken `<br>`-delimited line silently
  re-wrapped a second time inside the real narrow column at print time —
  producing exactly the "jumbled, misaligned" output a user will report
  after printing, while every automated test still passed (the tests
  checked internal consistency — same breaks on both columns, viewport-
  independence — not real-world physical wrap-fit, which no DOM
  measurement catches without literally generating a paginated PDF).
  **Caught by:** generating a real PDF via `page.pdf({format:'Letter'})`
  (NOT `page.emulateMedia({media:'print'})` alone — that only flips which
  CSS rules match, it does NOT simulate real print pagination/margins, so
  measuring `.col-vowel-print`'s `getBoundingClientRect().width` under
  plain `emulateMedia` gave 407px with implied zero margins, which is
  *also* not trustworthy as a real-world figure) and rendering it to a
  PNG (`pdftoppm`) for actual visual inspection. **Fix:** added an
  explicit `@page { margin: 0.5in; }` so the printable area is
  deterministic instead of depending on whatever margin the browser/OS
  print dialog defaults to, then picked a deliberately conservative
  per-column width (300px, calculated as roughly 327px available, used
  300 as safety margin) — erring short is the safe failure direction
  (wastes a little paper) vs. erring long (jumbled re-wrap). **If you
  ever touch `PRINT_REF_WIDTH` again: verify with an actual rendered PDF
  page, on both Letter and A4, not just an automated test asserting
  internal consistency between the two columns.** Internal consistency
  and real-world physical correctness are different claims, and only one
  of them is checked by `tests/validate-print-layout.js`.

---

## 6. GitHub/git workflow — do's, don'ts, and gotchas specific to this repo

- **Always branch fresh off current `main`** before starting new work. Do
  not resume work on an old branch whose base has since diverged from
  `main` — this is exactly what caused the `409 Conflict` in §5. If you
  must continue old branch work, re-pull `main` into a *new* branch first.
- **The PAT needs `Contents: Read and write` at minimum.** It does NOT
  have `Pages: write` (manual rebuild trigger returns 403) or
  `Actions: write` (can't push `.github/workflows/*.yml` via API — must be
  added through the GitHub web UI directly).
- **Files over ~1MB**: the Contents API returns `encoding: "none"` and an
  empty `content` field. Use the `download_url` (or
  `raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`) instead.
- **Verify before pushing, every time** — extract the actual code that
  will ship, run it against the full-Torah validation, run the Playwright
  suite, *then* push. This project's entire low-defect track record comes
  from this discipline; the one time a fix was pushed based on reasoning
  alone without re-validation (paseq, first attempt), it shipped a real
  bug (357 mismatches).
- **`/mnt/user-data/outputs/` can intermittently throw I/O errors** in
  this environment (observed at least once). If it does, keep working from
  `/home/claude/` and retry the outputs copy later — it's recovered every
  time so far.

---

## 7. Long-term risks of the single-file architecture

Honest assessment, not a recommendation to rewrite anything right now.

**What's worked well so far:**
- Zero build step, instant deploy, easy to reason about for a small
  project.
- Trivial to give a person the whole app as one downloadable file.
- An AI agent (i.e. me) can hold the entire app in context and make
  surgical edits without a build/bundler step getting in the way.

**Risks that will compound as the project grows:**

1. **Editing fragility.** Every edit so far has been a find-and-replace on
   a giant string. We've repeatedly hit "old_block not found" errors from
   whitespace mismatches, and at least once accidentally deleted an
   entire working function (`aliyahSection`) because it sat between two
   *other* functions being replaced in the same edit. This risk gets worse,
   not better, as the file grows — there is no compiler or linter catching
   "you just deleted something you didn't mean to."

2. **No real separation of concerns.** Data (embedded JSON schedules, the
   base64 font), markup, styles, and logic are all interleaved in one
   file. A change intended to touch only the rendering logic has no
   structural barrier preventing it from also touching data or styles by
   accident.

3. **Testing requires re-extraction, which is itself a manual step that
   can silently go stale.** Every validation run in this project's history
   re-extracted the tokenizer functions from the live file rather than
   trusting a separately maintained copy — *because* separately maintained
   copies have already drifted from the live file at least once in this
   project. This is a correct safeguard, but it's manual and easy to skip
   under time pressure.

4. **Git diffs and merges get harder, not easier, over time.** We already
   hit a real merge conflict (`409`) caused by two branches independently
   modifying overlapping regions of one giant file. With multiple files
   (e.g. `tokenizer.js`, `ui.js`, `data.json` as separate files), unrelated
   changes would usually not even touch the same file, let alone the same
   lines — conflicts would become rarer and smaller when they do happen.

5. **Bundle bloat with no code-splitting.** Currently ~137KB total,
   including embedded multi-year schedule data and an embedded font. Every
   visitor downloads all of it on every visit regardless of which single
   day they actually want. This is fine at the current size, but if
   schedule data, holiday detail, or future features (e.g. more festivals,
   more granular leyning options) grow substantially, there's no
   mechanism to lazy-load anything — it all ships in one block.

6. **Steeper onboarding for a future human contributor** who isn't an AI
   agent with full conversation history. A 137KB+ single file with no
   inline architectural map is a much harder thing to "get into" than a
   small multi-file project with obvious entry points — which is a
   meaningful part of why this very file (AGENTS.md) exists.

**Mitigations available without a full rewrite, if/when this becomes a
real problem:**
- Extract the tokenizer (`resolveKetivQere`, `processHeToWords`,
  `wordToHtml`, `buildTokens`) into a real standalone `tokenizer.js` file,
  loaded via `<script src="tokenizer.js">`. This alone would remove the
  "re-extract before testing" manual step entirely, since the test suite
  could just `require()` the real shipped file directly.
- Move the embedded schedule JSON out of inline `<script>` tags into
  separate `.json` files, fetched once at runtime and cached in
  `localStorage`. Removes the biggest chunk of dead weight from the HTML
  itself.
- Neither of these requires a build step or framework — just `<script
  src>` and `fetch()`, which is a small, low-risk migration whenever it's
  worth the time. **Not urgent at the current size and complexity**, but
  worth revisiting if the project keeps growing at its current pace.

---

## 8. Quick-reference checklist for any future change

- [ ] Pull fresh `main` into a *new* branch (don't resume an old diverged one)
- [ ] If touching text-processing logic: re-extract the live functions,
      run full-Torah validation (§4A), confirm 0 mismatches
- [ ] If touching rendering/layout/interactivity: write a Playwright test,
      run multiple trials if timing could matter, take screenshots and
      actually look at them
- [ ] Check the bug isn't a repeat of §2 (token-count mismatch) or §5
      (a false lead already ruled out)
- [ ] Push to the branch first; only merge/push to `main` after the person
      using the tool confirms it actually looks right in a real browser
- [ ] If GitHub Pages build errors, check for the errored→built-on-retry
      pattern before assuming the content is broken


---

## 9. Update: tokenizer extracted to a standalone file (post-AGENTS.md v1)

`resolveKetivQere`, `processHeToWords`, `wordToHtml`, `buildTokens` now
live in `tokenizer.js`, loaded via `<script src="tokenizer.js"></script>`
in `index.html`, not inline. GitHub Pages serves separate `.js`/`.css`/
`.json` files exactly like any static host — no CORS issue, same-origin.

This removes the single biggest fragility called out in §7: tests no
longer need to re-extract code from the HTML string before validating —
`tests/validate-tokenizer.js` does a plain `require('../tokenizer.js')`
against the *actual shipped file*. There is no longer a "the test copy
silently drifted from the real file" failure mode for this part of the
codebase. Run it with `node tests/validate-tokenizer.js`; needs
`full-torah-reference.json` (1.6MB, fetch via `raw.githubusercontent.com`
if missing — see §4A, same as before).

**Deliberately NOT extracted**: the font (stays embedded base64 — was
embedded specifically to avoid a network dependency, extracting it would
be a regression, not an improvement). The rendering/sync logic
(`renderSyncedColumns`, `syncAllPracticeColumns`, etc.) — left inline for
now since it's tightly coupled to the DOM structure rendered by the rest
of `index.html`; a future session could extract this too, but it's lower
priority than the tokenizer was, since it was never the thing going stale
between test runs.

**Not yet done, lower priority, consider if the project keeps growing:**
- CI: a GitHub Actions workflow running `node tests/validate-tokenizer.js`
  on every push. Needs `Actions: write` PAT scope (not available via API —
  must paste the YAML into the GitHub web UI directly, same as the
  biannual refresh workflow).
- Moving embedded schedule data (`PARASHA_LISTS`, `HOLIDAY_DATA`) to
  separate `.json` files fetched at runtime — the single biggest remaining
  chunk of `index.html`'s size, but works fine as-is; only worth doing if
  size becomes a real problem.

## 10. A note on context window economics

This entire project (tikkun.kahal-masorti.org) has been built across one
very long conversation. By this point in that conversation, every new
message carries the full accumulated history — hundreds of tool calls,
file contents, screenshots — which makes every subsequent message
significantly more expensive than it needs to be.

**If you are an agent starting fresh on this repo: you almost certainly
don't need that history.** Read this file, read `README.md`, and you have
the actual institutional knowledge without the conversational overhead.
**Strongly prefer starting a new conversation for new work** rather than
continuing an already-long one — point it at this file first.


---

## 11. TODO — consolidated, single source of truth

If you're starting a fresh conversation, this section is the answer to
"what's left to do." Everything else in this file is *why* and *how*;
this is *what*.

**Done since last update — shipped to `main`:**
- **Mid-verse petucha token-gluing fixed** (Numbers 26:1, Genesis 35:22).
  Root cause: source data embeds a literal `<br>` right after the
  petucha span, with no surrounding whitespace, when the petucha falls
  mid-verse and more text follows in the same string. The generic
  tag-strip in `processHeToWords` dropped `<br>` with zero replacement
  (unlike `&nbsp;`, which becomes a space), gluing the next word onto
  `##PE##` into one token — silently breaking the `isPetucha` check
  downstream and skipping the forced line-break. Fixed by treating
  `<br>` as whitespace before the tag-strip. Confirmed via full-Torah
  scan these were the only two real cases.
- **Paragraph-final-line justification exemption.** A line ending in a
  petucha marker is a paragraph's last line, not just any line — per
  typesetting convention it should never be stretched to fill the
  column, same as the column's true last line. Added
  `isParagraphFinalLine`, detected via the existing forced-break
  invariant (line whose last token is the petucha marker).
- **Hebcal UTC/local date-boundary bug fixed.** `dateStr()` built the
  API query date via `d.toISOString().split('T')[0]` (UTC), while
  `toShabbat()` finds "this Saturday" via `getDay()`/`setDate()` (local
  time). For anyone in a timezone ahead of UTC (e.g. CEST), between
  local midnight and 2am the two disagreed: the Saturday was correct in
  local terms, but the ISO conversion rolled its calendar date back by
  one, sending FRIDAY's date to Hebcal. Hebcal answered correctly with
  `items:[]` (no `parashat` category on a non-Saturday), which then
  threw "Could not reach Hebcal" — a connectivity-sounding message for
  what was actually an empty, correctly-answered query for the wrong
  date. Explained a real user-reported symptom exactly: a ~2-hour
  local-time window reproducing every day, not network flakiness. Fixed
  by building the date string from local Y/M/D components.
- **Mobile defaults to Either-Or / Tikkun view.** Side-by-Side squeezes
  both columns to half-width each — cramped on a phone. Below 680px
  (matching the existing mobile breakpoint elsewhere in this file),
  defaults to Either-Or instead, via the real click handler rather than
  a duplicated state change. Desktop default (Side-by-Side) unchanged.
- **Aliyot filter: single-select dropdown → multi-select popover.**
  Originally tried as an always-expanded chip row; user feedback was
  that it took up visible header space and lost the verse range that
  was in the old dropdown option text. Replaced with a closed-by-default
  trigger button matching the old dropdown's exact footprint/styling,
  opening a checkbox popover on tap (verse range restored in each row)
  and closing on outside-click. A bold "All Aliyot" checkbox sits at
  the top, above a divider — reflects reality (checked only when every
  aliyah actually is selected, auto-unchecking the moment even one
  isn't) and clicking it always restores every aliyah at once. The
  filter is global across both tabs (Practice and Bima share the same
  `.aliyah[data-aliyah]` keys), and reuses the exact same `display:none`
  mechanism the print CSS already respects, so printing whatever's
  currently selected needed zero extra plumbing. Guards against
  deselecting the last remaining checkbox.
- **Print buttons show selection count when narrowed**, e.g.
  "Print (3/6)". Deliberately not a permanent on-screen notice — the
  selection resets to "all" on every parasha/date change (rebuilt fresh
  inside `generate()`), so the real risk isn't forgetting a narrowed
  selection from last week, it's narrowing mid-session to check
  something and printing without remembering to widen back. Both tabs'
  print buttons update together, same reason as the filter being global.
- **"Regular Maftir" toggle for Triennial mode.** Some communities read
  the regular (full-kriyah) maftir even on a triennial week, rather
  than the triennial cycle's own maftir — confirmed real and not
  hypothetical against live Hebcal data for Parashat Pinchas: triennial
  maftir is `Numbers 26:48-26:51` (just a repeat of the tail of
  triennial aliyah 7), regular maftir is `Numbers 29:35-30:1` (the
  special "occurring after 17 Tammuz" reading) — genuinely different
  verses, not a no-op toggle. Checkbox shown only when Triennial mode
  is active AND no holiday is currently selected (meaningless under
  Full Kriyah or on a holiday, both of which already always use the
  regular maftir regardless); persists via `localStorage` like the
  other toggles. Visibility is set from inside `generate()` itself,
  tied to the same `isHoliday` the rendering logic actually branches
  on — not a separate, easier-to-drift check in `init()` keyed only off
  `state.mode` (an earlier version of this had exactly that gap:
  Triennial + holiday-selected showed the checkbox with no effect that
  week; fixed and verified end-to-end against live Hebcal data,
  including selecting an actual holiday from the real dropdown and
  confirming the checkbox hides, then reappears switching back).
- **All four minor fast days added** (Tzom Gedaliah, Asara B'Tevet,
  Ta'anit Esther, Tzom Tammuz) — previously entirely missing, root
  cause: `refresh_data.py`'s Hebcal query used `mf=off`. Confusingly,
  Hebcal's "minor holidays" flag is `min` (Chanukah candle nights,
  Purim, Tu BiShvat — these WERE showing) and minor FASTS are a
  separate flag, `mf` — easy to misread as the same thing, which is
  presumably how `mf=off` went unnoticed this long. Flipped to `mf=on`.
- **Mincha reading added for all five public fasts** (the four minor
  fasts + Tisha B'Av), not just Tisha B'Av as initially requested —
  added for all five since they share the identical Mincha structure,
  confirmed against multiple halachic sources rather than assumed: the
  "Vayechal Moshe" Torah portion (Exodus 32:11-14, 34:1-10) and the
  haftarah "Dirshu Hashem" (Isaiah 55:6-56:8). Hebcal's API never
  exposes a separate Mincha leyning object for these (same gap as Yom
  Kippur, which `refresh_data.py` already hand-fixed) — generalized
  that existing YK-Mincha special-case into a loop covering all five.
  For the four minor fasts, Mincha is literally Shacharit's own reading
  repeated (reused directly, not re-derived); Tisha B'Av's Shacharit is
  a different portion (Devarim 4:25-40), so its Mincha Vayechal Moshe
  needed supplying directly, using the exact same verse split Hebcal
  itself uses for the minor fasts' Shacharit. Verified end-to-end
  (not just the data): selected an actual minor fast and Tisha B'Av
  (Mincha) from the real dropdown, confirmed both generate real text
  starting "ויחל משה" with no errors.
- **Separate dropdown bug found and fixed along the way**, distinct
  from the missing data above: `rebuildDropdown()`'s holiday filter
  reused `currentDateStr` (the UPCOMING Shabbat, via `toShabbat(new
  Date())`) as its "is this in the past" cutoff — correct for parshiot,
  which only ever fall on a Saturday, but wrong for holidays, which can
  fall on any weekday. A fast falling between today and the coming
  Shabbat (e.g. Tzom Tammuz, a Thursday, with this coming Saturday
  being later than that) was wrongly excluded as "past" even though it
  was still genuinely upcoming. Fixed by using today's actual date
  (`dateStr(new Date())`) as the holiday-specific cutoff instead.
  Confirmed live: Tzom Tammuz the week of this fix went from absent to
  present in the dropdown and generated correctly once fixed.
- **Dropdown now groups holidays alongside each year's parshiot**,
  instead of every year's parshiot first followed by every year's
  holidays dumped at the very end of the whole multi-year list — which
  buried this year's own upcoming holidays behind 1-2 years of
  unrelated future parshiot. `rebuildDropdown()` now computes the union
  of years present in either the parasha or holiday data, and for each
  year (sorted) appends that year's book-optgroups followed immediately
  by that year's Holidays optgroup, rather than two fully separate
  top-level loops. Confirmed via Playwright: optgroup order is now
  `2026 · Numbers, 2026 · Deuteronomy, 2026 · Genesis, 2026 · Holidays,
  2027 · Exodus, ...` etc., and a real selection from a regrouped
  Holidays optgroup still generates correctly.

**Done since last update — shipped to `main` (was: in progress on branch `setuma-edge-pull`):**

Setuma (ס, closed parasha) visual treatment, in two steps plus a final
tuning decision:

- **Step 1: gap-width/overflow bug, fixed.** Gave the setuma a gap
  sized in samech-glyph-widths rather than a flat em/px guess, measured
  live per column/font via `measureNaturalWidth`, so it looks the same
  shape regardless of column width, screen vs print, or font. This
  surfaced a real bug along the way: the break-DETECTION pass (offsetTop
  measurement in `renderSyncedColumns`/`computeBreaksAtWidth`) was
  rendering the bare, undersized setuma glyph while the RENDER pass
  (`buildJustifiedColumnHTML`) separately swelled it to the full gap —
  so a line that measured as "fits" during detection would then
  overflow once the real margin was applied, and the browser silently
  shoved the overflow word onto its own orphan line. Fixed by factoring
  both passes through one shared function, `measurableTokenHtml`, so
  detection and render always agree on the setuma's true width.

- **Step 2: edge-pull, implemented, working better than not at all but
  not 100%.** A setuma sitting as the very first or last token of a
  line is visually indistinguishable from a petucha (which always sits
  at a line edge by design) UNLESS the glyph itself disambiguates it —
  see the gap-size decision below for why this stopped being a hard
  blocker. Added `pullSetumaCompanion`, modeled on the existing
  `pullPetuchaCompanion` word-shift but bidirectional — pull the
  previous line's last word forward if the setuma starts a line, pull
  the next line's first word backward if it ends one, do both at once
  if the setuma is alone on a single-token line. Each shift is verified
  against the REAL, FULL candidate line's natural width (not just the
  moved pair) before being applied, with a modest compression allowance
  (reusing the existing `-3px/gap` `COMPRESSION_FLOOR_PX`, not a bigger
  invented tolerance), and bails out — leaving the edge case
  cosmetically imperfect rather than risking an overflow regression —
  if there's no token safe to pull or the result wouldn't fit.

- **Gap-size decision: settled on 1x samech-width per side** (down from
  an initial 3x, then 1.5x as a midpoint). The original reasoning for a
  wide gap was a "no-glyph" end-goal — make the gap itself wide enough
  to read unambiguously as a setuma even with the gold פ/ס glyphs
  eventually removed from the scroll column (real Torah scrolls don't
  print paragraph markers). That end-goal is now SHELVED, not
  abandoned outright but explicitly deprioritized: the glyph is staying
  permanently as the real disambiguator, because removing it would mean
  a setuma stuck at a line edge reads as an actual petucha with no way
  to tell otherwise — not cosmetic at that point, genuinely wrong. Once
  the glyph stays, the gap only needs to be visible breathing room, not
  self-sufficient, so smaller became strictly better: more slack for
  the edge-pull, less of the line's width consumed.

  Confirmed via a real Playwright reproduction against Numbers 20:11-13
  (Mei Merivah) at a 320px phone column, instrumenting
  `pullSetumaCompanion` directly rather than guessing: at 3x the gap
  measured ~49.7px each side (~a third of the line's width before any
  Hebrew word is placed) and both edge cases bailed out. At 1.5x
  (~24.8px each side) both still bailed, but the shortfall on one case
  dropped from ~36.5px to ~20px. At 1x (~16.6px each side) one of the
  two cases now succeeds outright (needed 284.9px against a 285.8px
  threshold); the other still falls short by ~20px. Accepted as a
  residual edge case (not a bug to keep hunting) rather than loosening
  the compression allowance further to force it through — a whole
  extra Hebrew word's width will sometimes exceed what any reasonable
  gap size leaves room for on a narrow column, and inflating the
  compression tolerance to paper over that risks real overflow
  elsewhere just to win one passage.

  Repro script for this exact scenario (real tokens, real
  Playwright-measured `renderSyncedColumns` against Numbers 20:7-21,
  with optional console.log instrumentation patched into
  `pullSetumaCompanion`'s decision points) is reusable if this gets
  revisited — see chat history for the harness if not preserved in
  `scripts/`.

  Still outstanding, deferred: a dedicated petucha+setuma test covering
  both open and closed paragraph behavior together (one test, not two
  separate passes — the repo's hard-won lesson, repeated multiple times
  now: an automated pass/fail check is not sufficient, always also
  eyeball a real screenshot at a real device width). The "remove the
  glyphs entirely" end-goal is shelved per above, not deferred to a
  specific trigger — would need the edge-pull to work essentially
  always, not just more often than before, which is a meaningfully
  bigger problem than gap-tuning (possibly needs reserving slack near a
  setuma DURING line-breaking itself, rather than hoping it's there
  afterward) and isn't currently planned.

**Done since last update (prior session):**
- Step 4 of line-sync (print-time computation) — see prior note above.
- Aesthetic fixes — aliyah heading restyled to a 3-column grid (English
  left, verse range centered, Hebrew right); Hebrew aliyah labels now use

  Arimo (bold) instead of ShlomoSemiStam, reserving the Torah-text font
  for actual Torah text; verse-number font-size bumped 0.58rem → 0.68rem
  → 0.7rem-equivalent contrast fix (color `--ink-pale` → `--ink-soft`,
  darker in light mode / lighter in dark mode); English aliyah labels
  0.78rem → 0.9rem; verse-range label 0.7rem → 0.82rem. Verified no
  overflow at 360px across every real aliyah range string, checked in
  both light/dark color schemes and in an actual rendered print PDF.
- **Vowel-vs-scroll width assumption — RETRACTED, then reopened as a
  confirmed real bug.** Originally claimed "verified closed, zero
  overflows" via `scripts/check-vowel-vs-scroll-width.js` (still in
  repo). **That result was invalid**: the script launched a blank
  Playwright page and never loaded `index.html`, so it measured every
  line using the browser's fallback font (Arimo/sans-serif), NOT the real
  embedded ShlomoSemiStam font actually used in production. Caught while
  building block-justify format (below): a line that the real font
  measured at 688.77px natural width — genuinely wider than the 680px
  container, no justify math involved at all — had been silently passing
  the fallback-font version of the same check. **Re-verified properly**
  (load the real `index.html`, use real fonts) via
  `scripts/check-justify-overflow.js`, restricted to the three widths
  that are actually reachable in production (300/400/530px — confirmed
  empirically that `.content{max-width:1100px}` caps the real column
  width at ~530px even on a 2400px-wide screen, so the earlier script's
  680px test case was also testing an impossible scenario on top of using
  the wrong font): **found ~3,859 real cases** across the full Torah
  where vowel's break point does not leave scroll enough room, causing
  scroll to silently wrap a second time on screen. This is a **live,
  pre-existing bug already on `main`**, predating both the justify work
  and this AGENTS.md entry's original (wrong) claim — promoted to item 1
  of open work below. Lesson for next time: a Playwright check that
  doesn't `page.goto()` the real file is not testing the real fonts —
  always load the actual page, not just reimplement its logic
  standalone, when the result depends on real glyph metrics.

**Done since last update:**
- Block-justify format. Every line in both columns now stretches to fill
  the full column width (CSS `text-align:justify` was already set but
  does NOTHING for our hard-`<br>`-broken lines — confirmed by direct
  measurement that every major browser excludes forced-break lines from
  justification, same exclusion as a block's true last line — so this
  required manual per-line word-spacing computation in JS, not a CSS
  fix). Last line of each column and any line with nothing to add space
  between are left unstretched, per design. Two real bugs found and fixed
  during full-Torah verification (see `scripts/check-justify-overflow.js`
  history/commit message for both): (1) undercounting stretchable gaps —
  CSS word-spacing affects every space character including ones INSIDE a
  single token's HTML (maqaf-converted space in scroll, ketiv-annotation
  space in vowel), not just inter-token boundaries; (2) wrapping a line
  in a `word-spacing:calc(...)` span measurably widened it even at ~0
  intended extra, enough to overflow an already-razor-thin natural fit —
  fixed by skipping the wrapper entirely when there's nothing meaningful
  to stretch. Confirmed both fixes via instrumentation: every remaining
  test-script failure has zero stretch applied (see next item — it's a
  separate, pre-existing bug, not caused by this work).

**Done since last update:**
- **Vowel-vs-scroll overflow — fixed, by compression, not re-breaking.**
  Was ~3,859 lines across the full Torah (max ~7.4px overflow — genuinely
  tiny). Two real bugs fixed, plus a three-stage design process worth
  remembering in full:
  1. The actual root bug: `computeBreaksAtWidth`'s probe never set
     `word-spacing` (defaulted to `normal`/0), while real rendering
     always applies a 0.05em baseline — making break-detection think
     lines were narrower than they'd actually render, letting one too
     many tokens onto borderline lines. A real, independent,
     deterministic bug (not flaky/timing-related) — fixed by setting
     `word-spacing:0.05em` on the probe to match.
  2. **The actual fix that shipped**: `buildJustifiedColumnHTML` now
     allows `extraPerGap` to go NEGATIVE (slightly compress word-spacing
     below baseline) when scroll's natural width for a line slightly
     exceeds the column, floored at `COMPRESSION_FLOOR_PX = -3` (real
     worst-case need confirmed empirically: ~1.6px/gap at the narrowest
     width, 300px — the floor leaves ~2x headroom). No break list is
     touched; no word ever moves to a different line. Applies to the
     LAST line too (never stretched, but still protected from
     overflowing) — see the `isLastLine && extraPerGap >= 0` check.
  - **Two earlier attempts were built, tested, shown to the user, and
    explicitly rejected** — both inserted extra line breaks instead of
    compressing, and both looked wrong on a real device despite passing
    every automated check:
    - *Attempt A (blanket union)*: take the union of vowel's AND
      scroll's independently-computed natural breaks, applied
      everywhere. Provably zero-overflow, but broke far more lines than
      necessary (~75% more lines overall) — any line where EITHER
      column's own greedy-wrap wanted an earlier break got shortened,
      producing visibly sparse 1-2-word lines on mobile.
    - *Attempt B (surgical re-break)*: only insert an extra break where
      a SPECIFIC line's scroll text would actually overflow (much more
      targeted — only 1-5% of lines touched). Better, but still visibly
      wrong: moving an entire word to a new line to fix an overflow
      that's only ever a few pixels is wildly disproportionate, and
      produces orphaned single-word "rogue" lines even where there's no
      open-paragraph reason for one. The user caught this immediately on
      a real device; the automated overflow-count test had no way to
      flag it, since by its own metric (zero overflow) attempt B was a
      complete success.
    - The pattern across both rejections: **an automated test that only
      checks "did it overflow" cannot tell you "does it look right."**
      Both attempts needed an actual screenshot on a real narrow
      viewport to reveal the problem. If touching this code again,
      get a visual on mobile width before considering it done, no matter
      how clean the numbers look.
  - Verified (final, shipped version): zero overflows across the full
    Torah at all three realistic widths, line counts at every width
    EXACTLY match the original pre-fix counts (13267/9753/7256 — meaning
    not one single line moved), full existing regression suite passes,
    visual check at desktop/mobile/print all match the original
    pre-bug-fix quality with no orphans, no sparse lines, nothing visibly
    different at all except the (invisible, sub-2px) spacing compression
    on the handful of lines that needed it.
- **Dropdown no longer shows past parshiot/holidays.**
  `rebuildDropdown()` filters `PARASHA_LISTS`/`HOLIDAY_DATA` to only
  entries `>= dateStr(toShabbat(new Date()))`, computed fresh on every
  call — so the list is naturally self-updating week to week with no
  extra state to maintain. **A first attempt added a separate pinned
  "★ This week: ..." option at the top instead of filtering** — user
  immediately called it redundant and asked for the actual filtering
  instead, which is what shipped. Manual prev/next date navigation still
  works for past dates (the filter only affects the dropdown's jump-
  list, not navigation); verified both Diaspora and Israel calendars
  correctly start at the current week's real parasha.

**Open work, in priority order:**

1. **Paragraph style as visual line-breaking, not glyphs.** Currently
   open/closed parasha breaks (פ/ס) still render as a small gold `<span
   class="pm">` glyph inline (§2, "Paragraph markers") — that part is
   unchanged. Replacing it with physical-Torah-style visual layout,
   applied identically to *both* scroll and vowel/tikkun columns, in
   sub-steps:

   **Step 1 — DONE: open parasha (petucha, פ) forces a new line.**
   Implementation went through two versions — the second one is what
   shipped, and the difference matters if this code is touched again:
   - *First version (had a real bug, caught by the user on a live
     screenshot)*: computed vowel's natural breaks first, then unioned
     in an extra break right after each petucha marker
     (`addPetuchaBreaks`, since removed). This looked correct in
     automated testing (289/289 petucha markers followed by *a* break)
     but produced a "rogue" single-word line immediately AFTER several
     petuchot — e.g. "וַיֵּשֶׁב" alone, with the rest of that same verse
     ("יִשְׂרָאֵל בַּשִּׁטִּים...") pushed to the line after. Root cause:
     the segment after the inserted break was whatever tokens were LEFT
     OVER from the original, un-split natural line — not a fresh
     width-constrained wrap starting at that point. The existing
     overflow-style check (does every line fit) had no way to flag this,
     since the leftover segment obviously fits (it's short) — the
     automated test simply wasn't checking the right thing.
   - **Second version (shipped)**: the petucha rule is now baked
     directly into the measurement phase itself — an actual `<br>` is
     inserted right after the marker's span when building the
     offsetTop-measurable token spans (both in `renderSyncedColumns` for
     screen and `computeBreaksAtWidth` for print), instead of being
     unioned in after natural breaks are already computed. The browser's
     own line-wrapping engine then correctly continues a fresh,
     width-constrained wrap for everything after the forced break — the
     same way it already handles continuing after any other break.
     `PETUCHA_HTML` constant + the `isPetucha` check are the only moving
     parts now; no separate union/patching function exists anymore.
   Verified (second version): all 289 petucha markers in the full Torah
   still followed by a break at all three realistic widths; a dedicated
   full-Torah scan specifically for "is the line right after any petucha
   exactly 1 word" → zero everywhere; zero overflow regressions; real
   visual check on the EXACT case the user flagged (Numbers 25:1, after
   "...לְדַרְכּוֹ: פ") on screen (desktop + mobile) and in an actual
   rendered print PDF.
   **Lesson, worth repeating since it's now happened three times in this
   project (print width, vowel-vs-scroll overflow, and now this): an
   automated check that only verifies one property (here: "is there *a*
   break after every petucha") can pass cleanly while something else
   about the result still looks wrong. Get an actual visual — on a real
   narrow viewport and via the real print path — before considering a
   line-breaking change done, not just a passing test count.**

   **Still open — not yet built:**
   - **DONE since this note was written: petucha-never-alone rule.**
     `pullPetuchaCompanion(tokens, breaks, containerWidthPx, fontSpec)`
     ensures a petucha is never left as the sole occupant of its line —
     if natural wrapping would otherwise push it onto an empty line by
     itself (because the line before it was already full), the boundary
     shifts back by one token so the previous line's last word joins the
     petucha instead. Real, confirmed cases — NOT a hypothetical: 15
     instances at the actual real screen width (~350px, measured
     directly from the live site), 6 at 530px. (An earlier investigation
     in this same conversation incorrectly "found" 76 cases at a
     synthetic 300px-with-desktop-font combination that doesn't
     correspond to any real screen or print rendering — that specific
     claim was wrong and retracted; this fix is based on the corrected,
     verified-real numbers instead.) Verified: 0 lone petuchas remain at
     any of 300/350/400/530px after the fix (was 15-16 before, depending
     on width); zero overflow regressions; real visual check on an
     actual lone-petucha case (Genesis 30:34 area) on screen and in a
     rendered print PDF — the previously-stranded word now sits beside
     the petucha as intended.
     **What this is NOT**: the original idea in this TODO item described
     something more elaborate (pulling a word onto ITS OWN dedicated
     line before the petucha, preserving full block-justification on
     every resulting line). What shipped is simpler and was confirmed
     sufficient by the user after reviewing real screenshots: just
     guarantee at least one real word always accompanies the petucha — a
     petucha sharing a short line with one word is fine; a petucha fully
     alone is the only case that needed fixing.
   - **Closed parasha (ס, setuma):** insert a tab-like gap *within* a
     line (not a line break) — the line must end with at least one word
     from the paragraph before the gap and begin with at least one word
     from the paragraph after it. If a naive break would put the gap
     right at the line's end or start, shift the minimal number of words
     to/from the adjacent line so both conditions hold. Not started.
   - **Dedicated test, still needed — explicit ordering decision: build
     after setuma, not before.** The petucha-break checks done so far
     (289/289 followed by a break; 0 lone-petucha cases after the
     companion-pull fix) live in ad-hoc verification scripts, not a
     permanent test alongside `tests/validate-tokenizer.js` and
     `tests/validate-print-layout.js`. User explicitly decided to write
     the comprehensive test AFTER setuma lands too, so it can cover both
     open and closed parasha behavior together in one pass, rather than
     writing a petucha-only test now and a separate setuma-only test
     later. Still applies regardless of timing: always also check a real
     screenshot at a real device width — an automated assertion alone
     has already proven insufficient multiple times in this exact area
     of the codebase (print width, vowel-vs-scroll overflow, the
     rogue-single-word bug, and the retracted "76 cases at an unrealistic
     synthetic width" claim above).
   - **Stated end goal (from the user, not yet started):** once the
     visual paragraph layout (line-break for petucha, gap for setuma)
     is solid for both open and closed parasha, the explicit gold "פ"/"ס"
     glyphs should be removed from the SCROLL column entirely — a real
     Torah scroll has no printed paragraph-marker characters; the
     physical line-break/gap convention itself is what signals the
     paragraph structure. (The vowel/tikkun column may keep the glyph —
     not yet decided.) This depends on the line-break/gap mechanics
     being fully correct first, hence the ordering: petucha line-break
     (done) → petucha-never-alone (done) → setuma gap (not started) →
     dedicated test (not started) → THEN revisit whether/how to drop the
     glyph from scroll.

2. **Lower priority, only if the project keeps growing** (see §7 and §9):
   CI workflow running the test on every push (the PAT now has `Actions:
   write`, so unlike the earlier note in §6/§9, the workflow YAML *can* be
   pushed via the API directly — no need to paste it through the GitHub
   web UI); moving embedded schedule data to separate fetched JSON files.

**Already done, don't redo:** tokenizer extraction (§9), the full
line-sync mechanism for screen rendering — Side-by-Side, Either-Or, resize,
initial-load timing fix (§3), all the Hebrew-text-processing edge cases
(§2), the paseq scroll-removal fix.

**Nothing currently known to be broken on `main`** — the vowel-vs-scroll
overflow (formerly listed here) is fixed, see "Done since last update"
above.
