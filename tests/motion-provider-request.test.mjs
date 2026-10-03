import test from 'node:test';
import assert from 'node:assert/strict';
import {complete} from '../server/providers.mjs';

const messages = [{role: 'system', content: 'Return a JSON motion verdict.'}, {role: 'user', content: [{type: 'text', text: '{"frameIndices":[0,1],"duration":2}'}]}];
const official = {name: 'Mock DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai', model: 'deepseek-flash'};

async function capture(provider, purpose) {
  let sent;
  const result = await complete({provider, purpose, messages, fetchImpl: async (url, options) => {
    sent = {url, body: JSON.parse(options.body)};
    const content = '{"verdict":{"status":"uncertain"}}';
    return Response.json(provider.protocol === 'anthropic' ? {content: [{type: 'text', text: content}]}
      : provider.protocol === 'gemini' ? {candidates: [{content: {parts: [{text: content}]}}]}
        : {choices: [{message: {content}, finish_reason: 'stop'}]});
  }});
  assert.equal(JSON.parse(result.content).verdict.status, 'uncertain');
  return sent;
}

test('motion evaluation disables reasoning and bounds JSON output on the two supported official DeepSeek models', async () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
    const request = await capture({...official, model}, 'motion-coach');
    assert.equal(request.url, 'https://api.deepseek.com/v1/chat/completions');
    assert.deepEqual(request.body, {model, messages, stream: false, thinking: {type: 'disabled'}, response_format: {type: 'json_object'}, max_tokens: 2400});
    assert.equal(request.body.reasoning_effort, undefined);
  }
});

test('motion request tuning does not change chat, nutrition or unrelated OpenAI-compatible targets', async () => {
  for (const [provider, purpose] of [
    [official, undefined], [official, 'chat'], [official, 'training'],
    [{...official, model: 'deepseek-chat'}, 'motion-coach'],
    [{...official, model: 'deepseek-reasoner'}, 'motion-coach'],
    [{...official, baseUrl: 'http://127.0.0.1:9988/deepseek/v1'}, 'motion-coach'],
  ]) {
    const {body} = await capture(provider, purpose);
    assert.deepEqual(body, {model: provider.model, messages, stream: false}, `${purpose || 'default'}: ${provider.baseUrl} ${provider.model}`);
  }
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
    const {body} = await capture({...official, model}, 'nutrition-advice');
    assert.deepEqual(body.thinking, {type: 'enabled'}, 'Nutrition retains its independent low-reasoning configuration');
    assert.equal(body.reasoning_effort, 'low');
    assert.deepEqual(body.response_format, {type: 'json_object'});
    assert.equal(body.max_tokens, undefined, 'The motion output budget must not truncate nutrition advice');
  }
});

test('native protocols keep their own request structure without OpenAI-only motion options', async () => {
  for (const protocol of ['anthropic', 'gemini']) {
    const {body} = await capture({...official, protocol}, 'motion-coach');
    assert.equal(body.thinking, undefined);
    assert.equal(body.response_format, undefined);
    assert.equal(body.reasoning_effort, undefined);
    if (protocol === 'anthropic') {
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.system, messages[0].content);
      assert.deepEqual(body.messages, messages.slice(1));
    } else {
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.systemInstruction.parts[0].text, messages[0].content);
      assert.deepEqual(body.contents[0].parts, [{text: messages[1].content[0].text}]);
    }
  }
});
