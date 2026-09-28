import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { readSse, streamChat } from '../server/chat-stream.mjs';
import { createServer } from '../server.mjs';

const provider = { name: 'Fixture', model: 'stream-model', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai', apiKey: 'private-test-key' };
const messages = [{ role: 'system', content: 'System' }, { role: 'user', content: '你好' }];
const tools = [{ type: 'function', function: { name: 'get_training_plan', description: 'Read', parameters: { type: 'object', properties: {} } } }];
const frame = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const delta = (content, finish_reason = null) => ({ choices: [{ index: 0, delta: { content }, finish_reason }] });
const callFrame = (name, args, id = 'call-1') => frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }) + frame('[DONE]');
function sse(text, fragment = 7) {
  const bytes = Buffer.from(text);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += fragment) controller.enqueue(bytes.subarray(i, i + fragment)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const textReply = content => sse(frame(delta(content)) + frame(delta('', 'stop')) + frame('[DONE]'));
async function run(options = {}) {
  const events = [];
  const result = await streamChat({ provider, messages, tools: [], onEvent: (name, data) => events.push({ name, data }), ...options });
  return { result, events };
}

test('server SSE decoder handles split UTF-8, CRLF, comments and multiline data', async () => {
  const events = [];
  for await (const event of readSse(sse(': ping\r\nevent: delta\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\n', 1).body)) events.push(event);
  assert.deepEqual(events, [{ event: 'delta', data: '{"text":\n"你好"}' }]);
  await assert.rejects(async () => { for await (const ignored of readSse(sse('data: {"x":1}').body)) void ignored; }, /中途断开/);
});

test('server emits text before upstream completion, redacts split keys, and accepts JSON compatibility', async () => {
  let controller, firstText;
  const first = new Promise(resolve => { firstText = resolve; }), events = [];
  const task = streamChat({ provider, messages, fetchImpl: async () => new Response(new ReadableStream({ start(value) { controller = value; controller.enqueue(Buffer.from(frame(delta('你好 private-')))); } }), { headers: { 'Content-Type': 'text/event-stream' } }), onEvent(name, data) { events.push({ name, data }); if (name === 'delta') firstText(); } });
  await first;
  assert.equal(events.filter(item => item.name === 'delta').map(item => item.data.text).join(''), '你好 ');
  controller.enqueue(Buffer.from(frame(delta('test-key。')) + frame(delta('', 'stop')) + frame('[DONE]'))); controller.close();
  assert.equal((await task).content, '你好 [密钥已隐藏]。');
  const json = await run({ fetchImpl: async () => Response.json({ choices: [{ message: { content: '整段兼容回复' } }] }) });
  assert.equal(json.result.content, '整段兼容回复');
  assert.equal(json.events.filter(item => item.name === 'delta').length, 1);
});

test('OpenAI native tool loop assembles arguments and preserves reasoning in continuation', async () => {
  const requests = [], executed = [];
  const first = frame({ choices: [{ index: 0, delta: { reasoning_content: 'private-test-key reasoning', tool_calls: [{ index: 0, id: 'call-a', type: 'function', function: { name: 'get_training_plan', arguments: '{"value":' } }] } }] }) + frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"中文"}' } }] }, finish_reason: 'tool_calls' }] }) + frame('[DONE]');
  const { result, events } = await run({ tools, fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return requests.length === 1 ? sse(first, 1) : textReply('读取完成'); }, executeTool(name, args) { executed.push({ name, args }); return { ok: true, message: '读取成功' }; } });
  assert.deepEqual(executed, [{ name: 'get_training_plan', args: { value: '中文' } }]);
  assert.equal(requests[1].messages.at(-2).reasoning_content, 'private-test-key reasoning');
  assert.equal(requests[1].messages.at(-1).role, 'tool');
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'call-a');
  assert.equal(result.reasoningContent, '[密钥已隐藏] reasoning');
  assert.equal(events.filter(item => item.name === 'tool_result').length, 1);
});

test('Anthropic preserves thinking signatures and native tool result blocks', async () => {
  const requests = [];
  const first = [
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'claude-call', name: 'get_training_plan', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
    { type: 'content_block_stop', index: 1 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' },
  ].map(value => frame(value, value.type)).join('');
  const { result } = await run({ provider: { ...provider, protocol: 'anthropic' }, tools, executeTool: () => ({ ok: true, message: 'read' }), fetchImpl: async (url, options) => {
    assert.match(url, /\/messages$/); requests.push(JSON.parse(options.body));
    return requests.length === 1 ? sse(first) : Response.json({ content: [{ type: 'text', text: '已读取' }], stop_reason: 'end_turn' });
  } });
  assert.equal(result.content, '已读取');
  assert.deepEqual(requests[1].messages.at(-2).content[0], { type: 'thinking', thinking: 'reasoning', signature: 'opaque-signature' });
  assert.equal(requests[1].messages.at(-1).content[0].tool_use_id, 'claude-call');
  assert.ok(requests[0].tools[0].input_schema);
});

test('Gemini preserves thought signatures, native ids, function declarations and response parts', async () => {
  const requests = [], original = { functionCall: { id: 'gemini-tool-id', name: 'get_training_plan', args: {} }, thoughtSignature: 'opaque-gemini-signature' };
  const { result } = await run({ provider: { ...provider, protocol: 'gemini' }, tools, executeTool: () => ({ ok: true, message: 'read' }), fetchImpl: async (url, options) => {
    assert.match(url, /:streamGenerateContent\?alt=sse$/); requests.push(JSON.parse(options.body));
    return sse(frame({ candidates: [{ index: 0, content: { role: 'model', parts: requests.length === 1 ? [original] : [{ text: '已读取' }] }, finishReason: 'STOP' }] }));
  } });
  assert.equal(result.content, '已读取');
  assert.deepEqual(requests[1].contents.at(-2).parts, [original]);
  assert.equal(requests[1].contents.at(-1).parts[0].functionResponse.id, 'gemini-tool-id');
  assert.ok(requests[0].tools[0].functionDeclarations[0].parametersJsonSchema);
});

test('incomplete, invalid and truncated tool streams cannot execute writes', async t => {
  const invalidArgs = frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-x', function: { name: 'get_training_plan', arguments: '{"bad":' } }] }, finish_reason: 'tool_calls' }] }) + frame('[DONE]');
  for (const [label, value] of [['incomplete', callFrame('get_training_plan', {}).replace(frame('[DONE]'), '')], ['invalid', invalidArgs], ['length', callFrame('get_training_plan', {}).replace('tool_calls"}', 'length"}')]]) await t.test(label, async () => {
    let writes = 0;
    await assert.rejects(run({ tools, fetchImpl: async () => sse(value), executeTool: () => { writes++; return { ok: true }; } }));
    assert.equal(writes, 0);
  });
});

test('caller abort cancels upstream stream and stops before executing partial tools', async () => {
  const abort = new AbortController(); let observedSignal, cancelled = false, started, writes = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const promise = run({ signal: abort.signal, tools, fetchImpl: async (_url, options) => { observedSignal = options.signal; return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(frame(delta('开始')))); started(); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }); }, executeTool: () => { writes++; } });
  await ready; abort.abort(new DOMException('stopped', 'AbortError'));
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(observedSignal.aborted, true); assert.equal(cancelled, true); assert.equal(writes, 0);
});

test('unsupported tool capability explicitly falls back; other upstream failures never retry', async () => {
  let requests = 0;
  const { result, events } = await run({ tools, fetchImpl: async (_url, options) => { requests++; const body = JSON.parse(options.body); if (requests === 1) return Response.json({ error: { message: 'tools are not supported for this model' } }, { status: 400 }); assert.equal(body.tools, undefined); return textReply('可以提供建议'); } });
  assert.equal(result.content, '可以提供建议');
  assert.equal(events.find(item => item.name === 'tool_result').data.code, 'TOOLS_UNSUPPORTED');
  requests = 0;
  await assert.rejects(run({ tools, fetchImpl: async () => { requests++; return Response.json({ error: 'private-test-key' }, { status: 401 }); } }), /拒绝认证/);
  assert.equal(requests, 1);
  await assert.rejects(run({ fetchImpl: async () => sse(frame(delta('部分')) + frame({ error: { message: 'private-test-key' } }, 'error')) }), /流式响应失败/);
});

test('secret-bearing tool names and nested arguments never execute or leak into receipts', async () => {
  for (const [name, args] of [['get_training_plan', { plan: { name: provider.apiKey } }], ['get_training_plan', { plan: { exercises: [{ exerciseId: provider.apiKey }] } }], [provider.apiKey, {}], ['get_training_plan', { [provider.apiKey]: 'value' }]]) {
    let requests = 0, writes = 0;
    const { result, events } = await run({ tools, fetchImpl: async () => ++requests === 1 ? sse(callFrame(name, args)) : textReply('未执行'), executeTool() { writes++; return { ok: true }; } });
    assert.equal(writes, 0);
    assert.equal(result.toolResults[0].code, 'SENSITIVE_TOOL_ARGUMENT');
    assert.equal(JSON.stringify({ result, events }).includes(provider.apiKey), false);
  }
  let requests = 0;
  const redacted = await run({ tools, fetchImpl: async () => ++requests === 1 ? sse(callFrame('get_training_plan', {})) : textReply('完成'), executeTool: () => ({ ok: true, record: { data: { notes: [provider.apiKey] } }, message: provider.apiKey }) });
  assert.equal(JSON.stringify(redacted).includes(provider.apiKey), false);
});

test('API streams account-scoped CRUD, replays committed receipts and rejects secret persistence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fitness-chat-api-')), upstream = [];
  const plan = { name: '对话创建', days: [{ name: '训练日', rest: false, exercises: [{ exerciseId: 'squat', sets: 3, reps: '8–12', restSeconds: 90 }] }] };
  const server = createServer({ dataDir: directory, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); upstream.push(body);
    if (body.messages[0].content.includes('当前请求已经完成的真实操作回执')) return textReply('此请求已经执行。');
    const previous = body.messages.at(-1), user = body.messages.filter(item => item.role === 'user').at(-1).content;
    if (user === '敏感参数测试' && previous.role !== 'tool') return sse(callFrame('create_training_plan', { plan: { ...plan, name: provider.apiKey } }));
    if (previous.role !== 'tool') return sse(callFrame('get_training_plan', {}));
    const receipt = JSON.parse(previous.content);
    if (receipt.name !== 'get_training_plan') return textReply(receipt.message);
    if (user === '查看') return textReply(receipt.exists ? receipt.record.data.name : '没有计划');
    const name = user === '创建' ? 'create_training_plan' : user === '修改' ? 'update_training_plan' : 'delete_training_plan';
    return sse(callFrame(name, name === 'delete_training_plan' ? { expectedVersion: receipt.currentVersion, userId: 'another-user' } : { plan: { ...plan, name: user === '修改' ? '对话更新' : plan.name }, ...(name === 'update_training_plan' ? { expectedVersion: receipt.currentVersion } : {}) }));
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); await rm(directory, { recursive: true, force: true }); });
  async function api(client, path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { Cookie: client.cookie || '', ...(client.id ? { 'X-Fitness-User': client.id } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.headers.get('set-cookie')) client.cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  }
  async function register(name) {
    const client = {};
    client.id = (await (await api(client, '/api/auth/register', 'POST', { email: `${name}@stream.test`, name, password: 'strong-password' })).json()).user.id;
    await api(client, '/api/providers', 'PUT', { providers: [{ ...provider, id: 'fixture', models: [{ id: provider.model }] }], tasks: { chat: 'fixture' }, taskModels: { chat: provider.model } });
    return client;
  }
  const alice = await register('alice'), bob = await register('bob');
  async function chat(client, content, requestId = randomUUID()) {
    const response = await api(client, '/api/ai', 'POST', { task: 'chat', stream: true, requestId, messages: [{ role: 'user', content }], context: { plan: { name: 'spoofed', version: 999 } } });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const events = [];
    for await (const event of readSse(response.body)) events.push({ name: event.event, data: JSON.parse(event.data) });
    assert.equal(events.at(-1).name, 'done', JSON.stringify(events)); return events;
  }
  const requestId = randomUUID(), created = await chat(alice, '创建', requestId);
  assert.equal(created.at(-1).data.toolResults.at(-1).record.version, 1);
  const replay = await chat(alice, '创建', requestId);
  assert.equal(replay.at(-1).data.toolResults[0].replayed, true);
  assert.equal((await chat(bob, '查看')).at(-1).data.content, '没有计划');
  assert.equal((await chat(alice, '修改')).at(-1).data.toolResults.at(-1).record.version, 2);
  const deleted = await chat(alice, '删除');
  assert.equal(deleted.at(-1).data.toolResults.at(-1).record.deleted, true);
  assert.equal(deleted.at(-1).data.toolResults.at(-1).record.version, 3);
  const blocked = await chat(alice, '敏感参数测试');
  assert.equal(blocked.at(-1).data.toolResults[0].code, 'SENSITIVE_TOOL_ARGUMENT');
  assert.equal(JSON.stringify(blocked).includes(provider.apiKey), false);
  const aliceState = await (await api(alice, '/api/state')).json();
  assert.equal(aliceState.records.find(record => record.id === 'active-plan').version, 3);
  assert.equal(JSON.stringify(aliceState).includes(provider.apiKey), false);
  assert.deepEqual((await (await api(bob, '/api/state')).json()).records, []);
  assert.equal((await api(alice, '/api/ai', 'POST', { task: 'chat', stream: true, messages: [{ role: 'user', content: 'hi' }] })).status, 400);
  assert.ok(upstream.every(body => body.stream === true));
});

test('real HTTP transport forwards headers, streams progressively, aborts on disconnect and accepts JSON fallback', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fitness-chat-transport-'));
  let upstreamClosed, streamFinished = false;
  const disconnected = new Promise(resolve => { upstreamClosed = resolve; });
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push({ headers: req.headers, body, path: req.url });
    if (body.messages.at(-1).content === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '真实 JSON 兼容回复' }, finish_reason: 'stop' }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.flushHeaders();
    // Keep the stream open. The downstream client must see this delta now and
    // its disconnect must tear down this upstream response before it finishes.
    res.write(frame(delta('实时第一段')));
    const timeout = setTimeout(() => { streamFinished = true; res.end(frame(delta('超时尾段', 'stop')) + frame('[DONE]')); }, 5000);
    res.once('close', () => { clearTimeout(timeout); upstreamClosed(); });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const server = createServer({ dataDir: directory, aiTimeoutMs: 10000 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([server, upstream].map(value => new Promise(resolve => { value.close(resolve); value.closeAllConnections(); })));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const registered = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'transport@stream.test', name: 'Transport', password: 'strong-password' }) });
  const cookie = registered.headers.get('set-cookie').split(';')[0], userId = (await registered.json()).user.id;
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-Fitness-User': userId };
  const configured = await fetch(`${base}/api/providers`, { method: 'PUT', headers, body: JSON.stringify({ providers: [{ ...provider, id: 'transport', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, models: [{ id: provider.model }] }], tasks: { chat: 'transport' }, taskModels: { chat: provider.model } }) });
  assert.equal(configured.status, 200); await configured.json();
  const abort = new AbortController();
  const response = await fetch(`${base}/api/ai`, { method: 'POST', headers, signal: abort.signal, body: JSON.stringify({ task: 'chat', stream: true, requestId: randomUUID(), messages: [{ role: 'user', content: 'stream' }] }) });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  let firstDelta;
  for await (const event of readSse(response.body)) {
    if (event.event === 'delta') { firstDelta = JSON.parse(event.data).text; abort.abort(); break; }
  }
  assert.equal(firstDelta, '实时第一段'); assert.equal(streamFinished, false);
  let watchdog;
  await Promise.race([disconnected, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('upstream did not abort after client disconnected')), 1500); })]).finally(() => clearTimeout(watchdog));
  assert.equal(streamFinished, false);
  assert.equal(requests[0].headers.authorization, `Bearer ${provider.apiKey}`);
  assert.equal(requests[0].headers['content-type'], 'application/json');
  assert.equal(requests[0].path, '/v1/chat/completions');
  assert.equal(requests[0].body.stream, true);
  const fallback = await fetch(`${base}/api/ai`, { method: 'POST', headers, body: JSON.stringify({ task: 'chat', stream: true, requestId: randomUUID(), messages: [{ role: 'user', content: 'json' }] }) });
  const events = []; for await (const event of readSse(fallback.body)) events.push({ name: event.event, data: JSON.parse(event.data) });
  assert.equal(events.at(-1).name, 'done');
  assert.equal(events.at(-1).data.content, '真实 JSON 兼容回复');
  assert.equal(events.filter(event => event.name === 'delta').length, 1);
});
