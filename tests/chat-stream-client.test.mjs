import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeChatEvents} from '../public/chat-stream.js';
import {setApiUser, streamChat} from '../public/store.js';

const encode = new TextEncoder();
const streamed = (text, size = 1) => {
  const bytes = encode.encode(text);
  return new ReadableStream({start(controller) {
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  }});
};
const event = (name, data) => `event: ${name}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;

test('chat SSE preserves split UTF-8, CRLF and event boundaries, and calls events before done', async () => {
  const events = [];
  const source = ': keepalive\r\n\r\n' + event('meta',{model:'test-model'}) + event('delta',{text:'中文 🏋️'}) + event('tool_result',{name:'update_training_plan',ok:true,message:'计划已修改'}) + event('done',{content:'中文 🏋️'});
  const result = await consumeChatEvents(streamed(source), async (type, data) => { await Promise.resolve(); events.push({type,data}); });
  assert.deepEqual(events.map(e => e.type), ['meta','delta','tool_result','done']);
  assert.equal(events[1].data.text,'中文 🏋️');
  assert.equal(result.content,'中文 🏋️');
});

test('chat SSE supports multiple data lines and final event without trailing newline', async () => {
  const text = 'event: done\ndata: {"content":\ndata: "完成"}';
  assert.deepEqual(await consumeChatEvents(streamed(text,7)),{content:'完成'});
});

test('chat SSE surfaces provider errors and incomplete streams instead of reporting success', async () => {
  await assert.rejects(consumeChatEvents(streamed(event('error',{error:'供应商密钥无效'}))), /供应商密钥无效/);
  let received='';
  await assert.rejects(consumeChatEvents(streamed(event('delta',{text:'保留部分'})),(_type,data)=>{received+=data.text;}), /连接中断/);
  assert.equal(received,'保留部分');
  await assert.rejects(consumeChatEvents(streamed('event: delta\ndata: {broken}\n\n')), /无效的流式数据/);
});

test('chat SSE cancellation unblocks pending read and cancels the reader', async () => {
  let canceled=false;
  const controller=new AbortController();
  const body=new ReadableStream({cancel(){canceled=true;}});
  const pending=consumeChatEvents(body,()=>{},controller.signal);
  controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(canceled,true);
});

test('chat transport binds the captured user and preserves request ID and HTTP errors', async () => {
  const previous=globalThis.fetch;
  try {
    setApiUser('another-account');
    globalThis.fetch=async (_url,options)=>{
      assert.equal(options.headers['X-Fitness-User'],'captured-account');
      assert.equal(options.headers.Accept,'text/event-stream');
      assert.deepEqual(JSON.parse(options.body),{requestId:'request-stable',messages:[],task:'chat',stream:true});
      return new Response(streamed(event('done',{content:'完成'})),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
    };
    assert.equal((await streamChat({requestId:'request-stable',messages:[]},{userId:'captured-account'})).content,'完成');
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'请重新登录'}),{status:401,headers:{'Content-Type':'application/json'}});
    await assert.rejects(streamChat({}),error=>error.status===401&&error.message==='请重新登录');
    globalThis.fetch=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}});
    await assert.rejects(streamChat({}),/未启用流式对话/);
  } finally {globalThis.fetch=previous;setApiUser(null);}
});
