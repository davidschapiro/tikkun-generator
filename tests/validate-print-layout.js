// Validates Step 4 of line-sync: print-time line breaks must be computed
// against a fixed reference width (PRINT_REF_WIDTH, ~680px), independent
// of whatever viewport/device triggered the print — NOT just whatever
// breaks happened to be on screen already.
//
// Architecture under test: hidden .col-*-print twin columns are kept
// fresh automatically by refreshAllPrintColumns() (called from
// syncAllPracticeColumns(), i.e. on every initial render + resize) and
// only revealed via @media print CSS — NOT computed reactively inside a
// click handler. This matters because native/OS print triggers (browser
// menu, share-sheet, Ctrl+P) never run our JS at all, so anything that
// only fires on our in-app Print button's onclick would silently fail
// for those paths. This test simulates that gap directly: it never calls
// printSection() or clicks the button — it only waits for the normal
// render path to finish, then inspects the hidden print columns, exactly
// as a real native-print trigger would see them.
//
// Run with: node tests/validate-print-layout.js

const { chromium } = require('playwright');
const path = require('path');

const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

function makeFakeTokens(n) {
  const words = ['אֱלֹהִים','בָּרָא','אֶת','הַשָּׁמַיִם','וְאֵת','הָאָרֶץ','וְהָאָרֶץ','הָיְתָה','תֹהוּ','וָבֹהוּ'];
  const scrollWords = ['אלהים','ברא','את','השמים','ואת','הארץ','והארץ','היתה','תהו','ובהו'];
  const tokens = [];
  for (let i = 0; i < n; i++) {
    tokens.push({
      vowel: words[i % words.length],
      scroll: scrollWords[i % scrollWords.length],
      verseNum: (i % 7 === 0) ? Math.floor(i / 7) + 1 : null,
    });
  }
  return tokens;
}

async function injectFakeAliyahAndSync(page, tokens) {
  await page.evaluate((tokens) => {
    let section = document.querySelector('.practice-section');
    if (!section) {
      section = document.createElement('div');
      section.className = 'practice-section visible';
      document.body.appendChild(section);
    } else {
      section.classList.add('visible');
    }

    const id = 'test-token-id';
    window.__aliyahTokenRegistry[id] = tokens;

    let body = document.querySelector(`.practice-body[data-token-id="${id}"]`);
    if (!body) {
      body = document.createElement('div');
      body.className = 'practice-body';
      body.dataset.tokenId = id;
      body.innerHTML = `<div class="col-scroll" dir="rtl"></div>
        <div class="col-vowel" dir="rtl"></div>
        <div class="col-scroll-print" dir="rtl"></div>
        <div class="col-vowel-print" dir="rtl"></div>`;
      section.appendChild(body);
    }
    window.syncAllPracticeColumns();
  }, tokens);
  await page.waitForTimeout(100);
}

async function getCounts(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.practice-body[data-token-id="test-token-id"]');
    const screenVowel = body.querySelector('.col-vowel').innerHTML;
    const printVowel = body.querySelector('.col-vowel-print').innerHTML;
    const printScroll = body.querySelector('.col-scroll-print').innerHTML;
    const count = (html) => (html.match(/<br>/g) || []).length;
    return {
      screenBr: count(screenVowel),
      printVowelBr: count(printVowel),
      printScrollBr: count(printScroll),
      printVowelHtml: printVowel,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let failures = 0;
  const tokens = makeFakeTokens(120);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(FILE_URL);
  await injectFakeAliyahAndSync(page, tokens);
  const narrow = await getCounts(page);

  if (narrow.printVowelBr === 0) {
    console.log('FAIL: print columns are empty after a normal render — native print triggers would print nothing useful.');
    failures++;
  } else {
    console.log(`PASS: print columns auto-populated without clicking Print (${narrow.printVowelBr} breaks).`);
  }

  await page.setViewportSize({ width: 1400, height: 900 });
  await injectFakeAliyahAndSync(page, tokens);
  const wide = await getCounts(page);

  if (narrow.printVowelHtml !== wide.printVowelHtml) {
    console.log(`FAIL: print columns differ between 360px and 1400px viewports (${narrow.printVowelBr} vs ${wide.printVowelBr} breaks) — should be viewport-independent.`);
    failures++;
  } else {
    console.log(`PASS: print columns identical across 360px and 1400px viewports (${wide.printVowelBr} breaks each).`);
  }

  if (wide.screenBr === wide.printVowelBr) {
    console.log(`FAIL: on-screen breaks (${wide.screenBr}) at 1400px match print breaks (${wide.printVowelBr}) — expected them to differ (print targets ~680px).`);
    failures++;
  } else {
    console.log(`PASS: on-screen breaks at 1400px (${wide.screenBr}) differ from print breaks (${wide.printVowelBr}), as expected.`);
  }

  if (wide.printVowelBr !== wide.printScrollBr) {
    console.log(`FAIL: print vowel/scroll columns have different break counts (${wide.printVowelBr} vs ${wide.printScrollBr}) — token alignment broken.`);
    failures++;
  } else {
    console.log(`PASS: print vowel/scroll columns have identical break counts (${wide.printVowelBr} each).`);
  }

  await page.emulateMedia({ media: 'print' });
  const visibility = await page.evaluate(() => {
    const body = document.querySelector('.practice-body[data-token-id="test-token-id"]');
    const disp = (el) => window.getComputedStyle(el).display;
    return {
      screenVowelDisplay: disp(body.querySelector('.col-vowel')),
      screenScrollDisplay: disp(body.querySelector('.col-scroll')),
      printVowelDisplay: disp(body.querySelector('.col-vowel-print')),
      printScrollDisplay: disp(body.querySelector('.col-scroll-print')),
    };
  });
  if (visibility.screenVowelDisplay !== 'none' || visibility.screenScrollDisplay !== 'none') {
    console.log('FAIL: live screen columns are not hidden under print media — would double-print content.', visibility);
    failures++;
  } else if (visibility.printVowelDisplay === 'none' || visibility.printScrollDisplay === 'none') {
    console.log('FAIL: print columns are hidden under print media — nothing would print.', visibility);
    failures++;
  } else {
    console.log('PASS: under print media, live columns hidden and print columns visible, as expected.');
  }
  await page.emulateMedia({ media: 'screen' });

  await browser.close();

  if (failures > 0) {
    console.log(`\n${failures} FAILURE(S)`);
    process.exit(1);
  } else {
    console.log('\nALL PASS');
  }
})();
