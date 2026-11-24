const providerUrl = 'https://api.deepseek.com/chat/completions';
const maxBodyBytes = 65536;
const maxMessageLength = 20000;
const streamType = 'text/event-stream; charset=utf-8';
const identityReply = '我是 BIOBOT，《生物信息学与计算生物学》的课程助教。';
const systemMessage = {
  role: 'system',
  content: '你的公开名称是 BIOBOT，你是《生物信息学与计算生物学》的课程助教。提问者问你叫什么、你是谁、或请你自我介绍时，用 BIOBOT 和课程助教的身份回答。回答课程问题时直接解释内容，避免主动提及底层模型名称或提供方。用提问者使用的语言解释概念、读图和公开数据分析，给出循序渐进的讲解。课程作业优先给思路或提示。示例使用虚构或教学序列，区分已知事实与推断，不编造引用。对能帮助增强病原体危害、规避合成审查或实施攻击的请求，仅提供安全的背景和防护知识。'
};

function json(status, message, headers) {
  return Response.json({ message }, { status, headers });
}

function authorized(request, expected) {
  const encoder = new TextEncoder();
  const input = encoder.encode(request.headers.get('Authorization') || '');
  const reference = encoder.encode('Bearer ' + expected);
  if (input.length !== reference.length) return false;
  let difference = 0;
  for (let i = 0; i < input.length; i++) difference |= input[i] ^ reference[i];
  return difference === 0;
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > maxBodyBytes || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let count = 0;
  let raw = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function validMessages(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 16 || items.at(-1)?.role !== 'user') return false;
  let count = 0;
  for (const item of items) {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim()) return false;
    count += item.content.length;
  }
  return count <= maxMessageLength && items.at(-1).content.length <= 3000;
}

function isIdentityQuestion(question) {
  const text = question.trim().toLowerCase().replace(/[\s，,。？！!?]+/g, '');
  return /^(?:你好)?(?:请)?(?:你是谁|你是什么|你叫什么(?:名字)?|你的名字是什么|(?:介绍一下|介绍)你自己|自我介绍(?:一下)?|你是(?:deepseek|chatgpt|biobot)(?:吗)?|你是(?:什么|哪个)模型|你用的(?:是)?(?:什么|哪个)模型)$/.test(text);
}

export async function handleRequest(request, env, fetchUpstream = fetch) {
  const { pathname } = new URL(request.url);
  if (!['/chat', '/health'].includes(pathname)) return new Response('Not found', { status: 404 });
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return new Response(null, { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const ready = Boolean(env.DEEPSEEK_API_KEY && env.CLASS_ACCESS_CODE && env.CHAT_LIMITER);
  if (pathname === '/health') {
    if (request.method !== 'GET') return json(405, '请求方法无效。', headers);
    return Response.json({ ready }, { headers });
  }
  if (request.method !== 'POST') return json(405, '请使用课堂网页发送问题。', headers);
  if (!ready) return json(503, '课堂问答正在配置中。', headers);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.CHAT_LIMITER.limit({ key: ip });
  if (!success) return json(429, '请求过于频繁，请稍后再试。', headers);
  if (!authorized(request, env.CLASS_ACCESS_CODE)) return json(401, '课堂访问码不正确，请重新输入。', headers);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json(415, '请求格式无效。', headers);
  const body = await readBody(request);
  if (!validMessages(body?.messages)) return json(400, '问题或对话长度超出范围。', headers);

  if (isIdentityQuestion(body.messages.at(-1).content)) {
    const chunk = JSON.stringify({ choices: [{ delta: { content: identityReply } }] });
    return new Response('data: ' + chunk + '\n\ndata: [DONE]\n\n', {
      headers: { ...headers, 'Content-Type': streamType }
    });
  }

  let response;
  try {
    response = await fetchUpstream(providerUrl, {
      method: 'POST',
      // Workers supports manual redirects. Keep the key on the configured origin.
      redirect: 'manual',
      signal: request.signal,
      headers: { Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-flash',
        thinking: { type: 'disabled' },
        stream: true,
        max_tokens: 1200,
        messages: [systemMessage, ...body.messages.map(({ role, content }) => ({ role, content }))]
      })
    });
  } catch {
    return json(502, 'BIOBOT 当前连接不稳定，请稍后再试。', headers);
  }
  if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
    await response.body?.cancel().catch(() => {});
    const status = response.status;
    return json(status === 429 ? 429 : 502,
      status === 402 ? '课堂问答额度暂不可用，请联系课程组织者。' :
      status === 429 ? 'BIOBOT 正忙，请稍后再试。' :
      'BIOBOT 暂时无法完成请求，请稍后再试。', headers);
  }
  return new Response(response.body, { headers: { ...headers, 'Content-Type': streamType } });
}

export default { fetch: (request, env) => handleRequest(request, env) };
