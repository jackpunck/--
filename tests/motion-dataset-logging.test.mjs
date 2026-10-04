import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {redactMotionProviderPayload} from '../scripts/motion-dataset-logging.mjs';

test('provider trace preserves actual configuration/text but stores only image hashes', () => {
  const bytes = Buffer.from('test-image-byte-sequence'), encoded = bytes.toString('base64'), secret = 'test-secret-not-a-real-key';
  const payload = {model: 'deepseek-flash', thinking: {type: 'disabled'}, temperature: 0, max_tokens: 2400, stream: false,
    apiKey: secret, authorization: 'Bearer ' + secret, messages: [{role: 'system', content: 'Evaluate visible movement.'},
      {role: 'user', content: [{type: 'text', text: 'Literal ' + secret + ' must be redacted.'}, {type: 'image_url', image_url: {url: `data:image/jpeg;base64,${encoded}`, detail: 'high'}}]}]};
  const before = JSON.stringify(payload), traced = redactMotionProviderPayload(payload, secret), text = JSON.stringify(traced);
  assert.equal(JSON.stringify(payload), before, 'Logging must not modify the real request.');
  assert.equal(traced.model, 'deepseek-flash');
  assert.deepEqual(traced.thinking, {type: 'disabled'});
  assert.equal(traced.temperature, 0);
  assert.equal(traced.max_tokens, 2400);
  assert.equal(traced.messages[0].content, payload.messages[0].content);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(encoded), false);
  assert.equal(text.includes('authorization'), false);
  assert.deepEqual(traced.messages[1].content[1].image, {mimeType: 'image/jpeg', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), detail: 'high'});
});

test('remote URLs and unsupported rich content cannot disclose credentials through trace', () => {
  const value = redactMotionProviderPayload({messages: [{role: 'user', content: [{type: 'image_url', image_url: {url: 'https://user:password@example.test/image?token=secret'}}, {type: 'unknown', data: 'secret'}]}]});
  assert.equal(JSON.stringify(value).includes('password'), false);
  assert.equal(JSON.stringify(value).includes('secret'), false);
  assert.equal(value.messages[0].content[0].image.omitted, true);
});
