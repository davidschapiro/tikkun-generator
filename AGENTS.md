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
  the only available retry mechanism is a new commit.

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

**Open work, in priority order:**

1. **Step 4 of line-sync (print-time computation).** Currently print
   reuses whatever line breaks were last computed for the on-screen width
   — works, but isn't the originally-designed fixed-reference-width
   computation. Plan (already scoped, not yet built): compute breaks
   lazily inside the print button's `onclick`, measured against a fixed
   ~650–700px reference width, independent of whatever device triggered
   the print. Full design rationale: `line-sync/README.md` on the
   `line-sync-tikkun` branch (kept for reference, never merged — its git
   history diverged from `main`, see §5/§6 above. Don't try to merge it;
   re-read it for context, then build Step 4 on a *fresh* branch off
   current `main`).

2. **Unverified assumption**: line-sync always measures against the
   *vowel* column as the reference for break-points, on the theory that
   it's generally the wider/more-constraining column (cantillation + ketiv
   annotations add width). This has held in every real-data test so far,
   but was never deliberately stress-tested against a verse where
   *scroll* might end up wider (e.g. many maqaf-joined words rendered
   with a visual space). Worth a dedicated check before considering
   line-sync fully closed.

3. **Lower priority, only if the project keeps growing** (see §7 and §9):
   CI workflow running the test on every push; moving embedded schedule
   data to separate fetched JSON files.

**Already done, don't redo:** tokenizer extraction (§9), the full
line-sync mechanism for screen rendering — Side-by-Side, Either-Or, resize,
initial-load timing fix (§3), all the Hebrew-text-processing edge cases
(§2), the paseq scroll-removal fix.

**Nothing is currently broken on `main`.** The `extract-tokenizer` branch
(tokenizer.js split out + automated test) is verified and ready to merge
whenever convenient — it's not urgent, just good hygiene.
