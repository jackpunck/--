import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {forceMotionDatasetCpu} from '../scripts/motion-dataset-instrumentation.mjs';

test('CPU QA instrumentation only changes two production initial delegate literals', async () => {
  const source = await readFile(new URL('../public/motion-video.js', import.meta.url), 'utf8');
  const {body, audit} = forceMotionDatasetCpu(source);
  const sourceLines = source.split('\n'), instrumentedLines = body.split('\n');
  assert.equal(sourceLines.length, instrumentedLines.length);
  const changed = sourceLines.flatMap((line, index) => line === instrumentedLines[index] ? [] : [{before: line, after: instrumentedLines[index]}]);
  assert.equal(changed.length, 2);
  for (const line of changed) assert.equal(line.before.replace("'GPU'", "'CPU'"), line.after);
  assert.equal(audit.changedLiterals, 2);
  assert.notEqual(audit.originalSha256, audit.servedSha256);
  assert.throws(() => forceMotionDatasetCpu(body), /no longer matches/);
  assert.throws(() => forceMotionDatasetCpu(source + source), /no longer matches/);
});
