# Daily Quote Implementation Plan

> **For agentic workers:** Execute inline in the current authorized workspace. Track the steps below and verify before completion.

**Goal:** Replace the sidebar's fixed text with 60 daily messages while preserving its existing layout and animation.

**Architecture:** A dependency-free browser module exports immutable short messages and a local-calendar-day selector. The app changes only text nodes; the existing polling interval and visibility event refresh the message after midnight.

**Tech Stack:** ES modules, browser DOM, Node.js native test runner.

## Global Constraints

- Header: `今日寄语`; no visible date or added controls.
- Keep all CSS, font sizes, spacing, icon markup, and twelve animated bars unchanged.
- Titles have at most 9 characters; each of two body lines has at most 12 characters.
- Stable throughout each local day, changes across midnight, works offline.
- Work in the user's current workspace; this is a small authorized change.

## Task 1: Daily message selection and sidebar integration

**Files:**
- Create `public/daily-quotes.js` and `tests/daily-quotes.test.mjs`.
- Modify `public/app.js`, `public/index.html`, `public/sw.js`, and `package.json`.

**Interface:** `dailyQuotes` is an immutable array of `{title, lines}`; `getDailyQuote(date = new Date())` returns one entry.

- [x] Add tests for same-day stability, adjacent days including leap/year boundaries, a 60-day cycle without repeats, compact copy lengths, and a daylight-saving transition. Run `node --test tests/daily-quotes.test.mjs` and confirm the missing module fails.
- [x] Add 60 unique original message triples, then freeze entries and their two body lines. Select using the local calendar day:

```js
export function getDailyQuote(date = new Date()) {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = Math.round((day - Date.UTC(2026, 9, 2)) / 86400000);
  return dailyQuotes[((offset % dailyQuotes.length) + dailyQuotes.length) % dailyQuotes.length];
}
```

- [x] Import the selector in `public/app.js`. Keep the existing `.side-note` element, replace its header text, add `data-daily-quote-title` to the existing strong element and two inline spans with `data-daily-quote-line`, retaining the intervening `<br>` and existing bar markup. Fill them immediately after shell rendering:

```js
function updateSidebarQuote() {
  const card = $('.side-note'), now = new Date(), date = today(now);
  if (!card || card.dataset.quoteDate === date) return;
  const quote = getDailyQuote(now);
  $('[data-daily-quote-title]', card).textContent = quote.title;
  quote.lines.forEach((line, index) => {
    $(`[data-daily-quote-line="${index}"]`, card).textContent = line;
  });
  card.dataset.quoteDate = date;
}
```

- [x] Call `updateSidebarQuote()` when visible in the existing visibility handler and 30-second interval, independently of sync or network availability.
- [x] Bump the app entry version in `public/index.html`; bump the service-worker cache and add `/daily-quotes.js` to its shell list; add `node --check public/daily-quotes.js` to `npm run check`.
- [x] Run the focused tests, `npm.cmd run check`, `npm.cmd test`, and `git diff --check`. Inspect the final diff for unchanged styles and animated bars. Verify the rendered card and daily changes in a local browser.

## Verification results

- Four focused tests passed after the expected initial missing-module failure.
- Syntax checks passed; the complete suite passed 250 tests with zero failures.
- Actual Chrome rendering matched the original card metrics: 217 × 179 px, 18 px padding, 8 px header, 17 px heading, 11 px body. No stylesheet changed.
- All twelve `energy-bars` animations remained active. Offline day changes through visibility restoration and polling retained the original bar DOM nodes.
- Same-day navigation and reload preserved the selected message; no runtime exceptions occurred.
- Preview screenshot: `.qa/daily-quote-card.png` (local ignored QA artifact).
