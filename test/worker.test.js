import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest } from '../worker/index.js';

const origin = 'https://class.github.io';
const env = {
  ALLOWED_ORIGIN: origin,
  DEEPSEEK_API_KEY: 'fixture-provider-key',
  CLASS_ACCESS_CODE: 'fixture-class-code',
  CHAT_LIMITER: { limit: async () => ({ success: true }) }
};
const upstreamNotExpected = async () => assert.fail('Invalid classroom request reached DeepSeek');
const question = { role: 'user', content: '解释序列比对。' };

function request({ from = origin, code = env.CLASS_ACCESS_CODE, method = 'POST', messages = [question], raw } = {}) {
  return new Request('https://worker.example/chat', {
    method,
    headers: { Origin: from, Authorization: 'Bearer ' + code, 'Content-Type': 'application/json' },
    body: method === 'POST' ? raw ?? JSON.stringify({ messages }) : undefined
  });
}

test('rejects bad origins, incorrect access codes, and unavailable credentials before upstream', async () => {
  assert.equal((await handleRequest(request({ from: 'https://other.example' }), env, upstreamNotExpected)).status, 403);
  assert.equal((await handleRequest(request({ code: 'wrong' }), env, upstreamNotExpected)).status, 401);
  assert.equal((await handleRequest(request(), { ...env, DEEPSEEK_API_KEY: '' }, upstreamNotExpected)).status, 503);
});

test('limits oversized requests, client system messages and excess calls', async () => {
  assert.equal((await handleRequest(request({ raw: ' '.repeat(65537) }), env, upstreamNotExpected)).status, 400);
  assert.equal((await handleRequest(request({ messages: [{ role: 'system', content: 'custom' }, question] }), env, upstreamNotExpected)).status, 400);
  const limited = { ...env, CHAT_LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await handleRequest(request(), limited, upstreamNotExpected)).status, 429);
});

test('allows CORS preflight and streams allowed questions using only the server key', async () => {
  const preflight = await handleRequest(request({ method: 'OPTIONS' }), env, upstreamNotExpected);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  const sse = 'data: {"choices":[{"delta":{"content":"比对"}}]}\n\ndata: [DONE]\n\n';
  const response = await handleRequest(request(), env, async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.DEEPSEEK_API_KEY);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages.at(-1), question);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /BIOBOT/);
    assert.equal(body.max_tokens, 1200);
    return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), sse);
});

test('reports exhausted provider balance without relaying upstream errors', async () => {
  const response = await handleRequest(request(), env, async () => new Response('raw upstream response', { status: 402 }));
  assert.equal(response.status, 502);
  assert.match(await response.text(), /额度暂不可用/);
});

test('availability reports only whether secrets and the limiter are ready', async () => {
  const health = () => new Request('https://worker.example/health', { headers: { Origin: origin } });
  assert.deepEqual(await (await handleRequest(health(), env, upstreamNotExpected)).json(), { ready: true });
  assert.deepEqual(await (await handleRequest(health(), { ...env, DEEPSEEK_API_KEY: '' }, upstreamNotExpected)).json(), { ready: false });
});

test('identity questions return the course identity through the usual stream', async () => {
  for (const content of ['你好，你是谁？', '请介绍一下你自己。', '你是 DeepSeek 吗？']) {
    const response = await handleRequest(request({ messages: [{ role: 'user', content }] }), env, upstreamNotExpected);
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.match(output, /我是 BIOBOT/);
    assert.match(output, /data: \[DONE\]/);
    assert.doesNotMatch(output, /DeepSeek/i);
  }
});

test('a course question mentioning a provider name still reaches the model', async () => {
  const messages = [{ role: 'user', content: 'DeepSeek 和 BLAST 在序列分析中有什么区别？' }];
  const response = await handleRequest(request({ messages }), env, async (_, options) => {
    assert.deepEqual(JSON.parse(options.body).messages.slice(1), messages);
    return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  assert.equal(response.status, 200);
});
