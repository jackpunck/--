import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dailyQuotes, getDailyQuote} from '../public/daily-quotes.js';

test('同一天从凌晨到深夜保持同一组寄语', () => {
  const morning = getDailyQuote(new Date(2026, 9, 2, 0, 0));
  assert.deepEqual(morning, {
    title:'每一步，都算数。',
    lines:['不必每天都走得很远，', '愿意出发，就是进步。'],
  });
  assert.strictEqual(getDailyQuote(new Date(2026, 9, 2, 23, 59, 59)), morning);
  assert.strictEqual(getDailyQuote(new Date(2026, 9, 2, 12)), morning);
});

test('跨日、跨年和闰日都展示不同的寄语', () => {
  for (const [before, after] of [
    [new Date(2026, 9, 2, 23, 59, 59), new Date(2026, 9, 3)],
    [new Date(2026, 11, 31, 23, 59, 59), new Date(2027, 0, 1)],
    [new Date(2028, 1, 28, 23, 59, 59), new Date(2028, 1, 29)],
    [new Date(2028, 1, 29, 23, 59, 59), new Date(2028, 2, 1)],
    [new Date(2026, 8, 30, 23, 59, 59), new Date(2026, 9, 1)],
  ]) {
    assert.notDeepEqual(getDailyQuote(before), getDailyQuote(after));
  }
});

test('六十组短文案在一个完整周期内不重复', () => {
  assert.equal(dailyQuotes.length, 60);
  const messages = new Set();
  for (let index = 0; index < 60; index++) {
    const quote = getDailyQuote(new Date(2026, 9, 2 + index));
    assert(quote.title.length > 0 && [...quote.title].length <= 9, quote.title);
    assert.equal(quote.lines.length, 2);
    for (const line of quote.lines) assert(line.length > 0 && [...line].length <= 12, line);
    messages.add(JSON.stringify(quote));
  }
  assert.equal(messages.size, 60);
  assert.deepEqual(getDailyQuote(new Date(2026, 9, 2 + 60)), getDailyQuote(new Date(2026, 9, 2)));
});

test('夏令时切换按当地日历日期更新，不能按经过的小时计天', () => {
  const moduleUrl = new URL('../public/daily-quotes.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {getDailyQuote} from ${JSON.stringify(moduleUrl)};
    for (const [year, month, day] of [[2026, 2, 8], [2026, 10, 1]]) {
      const dawn = getDailyQuote(new Date(year, month, day));
      assert.deepEqual(getDailyQuote(new Date(year, month, day, 23, 59, 59)), dawn);
      assert.notDeepEqual(getDailyQuote(new Date(year, month, day + 1)), dawn);
    }
    assert.equal(new Date(2026, 2, 8).getTimezoneOffset(), 300);
    assert.equal(new Date(2026, 2, 8, 23).getTimezoneOffset(), 240);
  `], {env:{...process.env, TZ:'America/New_York'}, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});
