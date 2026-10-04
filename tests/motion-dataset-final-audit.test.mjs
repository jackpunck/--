import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditFinalMotionHoldout} from '../scripts/motion-dataset-final-audit.mjs';
const fixture = () => {
  const protocol = {reviewMode: 'efficient', visualCodeSha256: 'frozen', sampleFps: 7.5, model: 'deepseek-flash', thinking: 'disabled', temperature: 0, max_tokens: 2400, systemSha256: createHash('sha256').update('frozen prompt').digest('hex')};
  const manifest = {partition: 'holdout', items: [{id: 'clip-one', qualityLabel: 'author_good'}, {id: 'clip-two', qualityLabel: 'demonstration_unverified'}]};
  const row = {id: 'clip-one', expected: {}, status: 'ok', pose: {sampleFps: 7.5}, providerRequestFiles: ['trace.json']};
  const runs = [{inputImages: {'clip-one': ['a'.repeat(64)]}, report: {mode: 'coach', partition: 'holdout', reviewMode: 'efficient', codeHashes: {'server/motion-coach-visual.mjs': 'frozen'}, inference: {mock: false}, rows: [row, {id: 'clip-two', expected: {}, status: 'error'}]},
    traces: {'trace.json': {body: {model: 'deepseek-flash', thinking: {type: 'disabled'}, temperature: 0, max_tokens: 2400, stream: false,
      messages: [{role: 'system', content: 'frozen prompt'}, {role: 'user', content: [{type: 'image_url', image: {sha256: 'a'.repeat(64)}}]}]}}}}];
  return {protocol, manifest, runs};
};
test('final audit keeps local errors in the complete denominator and validates actual trace settings', () => {
  const {manifest, protocol, runs} = fixture(), result = auditFinalMotionHoldout(manifest, protocol, runs);
  assert.equal(result.clips, 2); assert.equal(result.authorFormLabelDenominator, 1); assert.equal(result.providerCalls, 1); assert.equal(result.localOnlyOutcomes, 1);
});
test('final audit rejects missing/duplicate targets, changed prompts, reference use and retries', () => {
  const mutations = [
    ({runs}) => runs[0].report.rows.pop(),
    ({runs}) => runs[0].report.rows.push({...runs[0].report.rows[0]}),
    ({runs}) => runs[0].report.inference.visualReferences = {id: 'reference'},
    ({runs}) => runs[0].traces['trace.json'].body.messages[0].content = 'changed',
    ({runs}) => runs[0].traces['trace.json'].body.thinking.type = 'enabled',
    ({runs}) => runs[0].report.rows[0].providerRequestFiles.push('trace.json'),
    ({runs}) => runs[0].inputImages['clip-one'][0] = 'b'.repeat(64),
  ];
  for (const mutate of mutations) {const data = fixture(); mutate(data); assert.throws(() => auditFinalMotionHoldout(data.manifest, data.protocol, data.runs));}
});
