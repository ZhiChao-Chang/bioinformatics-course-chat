import { chatEndpoint } from './config.js';
import { examples } from './examples.js';

const byId = id => document.getElementById(id);
const promptInput = byId('prompt');
const workspace = byId('workspace');
const messages = byId('messages');
const dialog = byId('access-dialog');
const storageKey = 'bioinformatics-course-chat.v1';
const accessKey = 'bioinformatics-class-code';
let conversations = readHistory();
let currentId = conversations[0]?.id;
let controller;
let pendingQuestion;
let chatReady = false;

function readHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(conversations)); }
  catch { showNotice('当前浏览器无法保存对话，本次仍可继续使用。'); }
}

function accessCode() {
  try { return sessionStorage.getItem(accessKey) || ''; }
  catch { return ''; }
}

function showNotice(message = '', error = false) {
  byId('notice').textContent = message;
  byId('notice').classList.toggle('error', error);
}

function toggleMenu(open) {
  byId('sidebar').classList.toggle('open', open);
  byId('scrim').hidden = !open;
  byId('menu').setAttribute('aria-expanded', String(open));
}

function busy(active) {
  byId('send').hidden = active;
  byId('stop').hidden = !active;
  byId('send').disabled = active;
}

function appendInline(parent, text) {
  for (const part of text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const bold = document.createElement('strong');
      bold.textContent = part.slice(2, -2);
      parent.append(bold);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.append(code);
    } else parent.append(document.createTextNode(part));
  }
}

function formatAnswer(parent, value) {
  parent.replaceChildren();
  const pieces = value.split(/```/);
  pieces.forEach((part, index) => {
    if (index % 2) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = part.replace(/^[\w+-]*\r?\n/, '').trimEnd();
      pre.append(code);
      parent.append(pre);
      return;
    }
    for (const block of part.trim().split(/\n\s*\n/)) {
      if (!block) continue;
      const lines = block.split('\n');
      const ordered = /^\d+\.\s+/.test(lines[0]);
      const unordered = /^[-*]\s+/.test(lines[0]);
      if ((ordered || unordered) && lines.every(line => /^(?:[-*]|\d+\.)\s+/.test(line))) {
        const list = document.createElement(ordered ? 'ol' : 'ul');
        for (const line of lines) {
          const item = document.createElement('li');
          appendInline(item, line.replace(/^(?:[-*]|\d+\.)\s+/, ''));
          list.append(item);
        }
        parent.append(list);
      } else {
        const paragraph = document.createElement('p');
        appendInline(paragraph, block.replace(/^#{1,6}\s+/gm, ''));
        parent.append(paragraph);
      }
    }
  });
}

function renderMessage(message, draft = false) {
  const article = document.createElement('article');
  article.className = 'message ' + message.role;
  const heading = document.createElement('h2');
  heading.textContent = message.role === 'user' ? '你' : (message.example ? '课程示例' : 'BIOBOT');
  const body = document.createElement('div');
  body.className = 'content chunk';
  if (draft) body.setAttribute('aria-busy', 'true');
  if (message.role === 'assistant' && !draft) formatAnswer(body, message.content);
  else body.textContent = message.content;
  article.append(heading, body);
  messages.append(article);
  return body;
}

function render() {
  const conversation = conversations.find(item => item.id === currentId);
  byId('welcome').hidden = Boolean(conversation?.messages.length);
  messages.hidden = !conversation?.messages.length;
  messages.replaceChildren();
  for (const message of conversation?.messages || []) renderMessage(message);
  const history = byId('history');
  history.replaceChildren();
  for (const item of conversations) {
    const button = document.createElement('button');
    button.textContent = item.title;
    button.title = item.title;
    button.setAttribute('aria-current', String(item.id === currentId));
    button.addEventListener('click', () => {
      controller?.abort();
      currentId = item.id;
      toggleMenu(false);
      showNotice();
      render();
    });
    history.append(button);
  }
  if (!conversations.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = '暂无对话';
    history.append(empty);
  }
  workspace.scrollTop = workspace.scrollHeight;
}

function addQuestion(question) {
  let conversation = conversations.find(item => item.id === currentId);
  if (!conversation) {
    conversation = { id: crypto.randomUUID(), title: question.slice(0, 38), messages: [] };
    currentId = conversation.id;
  }
  conversations = [conversation, ...conversations.filter(item => item.id !== currentId)].slice(0, 30);
  conversation.messages.push({ role: 'user', content: question });
  return conversation;
}

function showExample(example) {
  currentId = undefined;
  const conversation = addQuestion(example.question);
  conversation.messages.push({ role: 'assistant', content: example.answer, example: true });
  persist();
  render();
  showNotice('你正在阅读预置课程示例。');
}

function requestCode(question) {
  pendingQuestion = question;
  byId('access-code').value = '';
  dialog.showModal();
}

async function readStream(response, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let finished = false;
  let truncated = false;

  function parse(line) {
    if (!line.startsWith('data:')) return;
    const value = line.slice(5).trim();
    if (value === '[DONE]') {
      finished = true;
      return;
    }
    const event = JSON.parse(value);
    if (event.error) throw new Error('BIOBOT 暂时未能完成回复，请稍后重试。');
    const choice = event.choices?.[0];
    if (choice?.finish_reason === 'length') truncated = true;
    if (choice?.delta?.content) {
      output += choice.delta.content;
      onText(output);
    }
  }

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) parse(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) parse(line);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!finished || !output.trim()) throw new Error('回复不完整，请重试。');
  return { output, truncated };
}

function chatContext(items) {
  const recent = [];
  let size = 0;
  for (const item of items.slice(-16).reverse()) {
    if (size + item.content.length > 20000) break;
    recent.unshift({ role: item.role, content: item.content });
    size += item.content.length;
  }
  return recent;
}

async function send(question) {
  if (!question || controller) return;
  if (!chatReady) {
    const example = examples.find(item => item.question === question);
    if (example) showExample(example);
    else showNotice('实时问答尚未接入。可以先打开上方的课程示例。');
    return;
  }
  if (!accessCode()) {
    requestCode(question);
    return;
  }

  const conversation = addQuestion(question);
  persist();
  promptInput.value = '';
  resizeInput();
  showNotice();
  render();
  const draft = renderMessage({ role: 'assistant', content: '正在生成回复…' }, true);
  const task = new AbortController();
  controller = task;
  busy(true);

  try {
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessCode() },
      body: JSON.stringify({ messages: chatContext(conversation.messages) }),
      signal: task.signal
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) sessionStorage.removeItem(accessKey);
      throw new Error(error.message || '暂时无法连接课堂问答，请稍后重试。');
    }
    const answer = await readStream(response, text => {
      if (currentId !== conversation.id) return;
      const follow = workspace.scrollHeight - workspace.scrollTop - workspace.clientHeight < 120;
      draft.textContent = text;
      if (follow) workspace.scrollTop = workspace.scrollHeight;
    });
    conversation.messages.push({ role: 'assistant', content: answer.output });
    if (currentId === conversation.id && answer.truncated) showNotice('回复已达长度上限，可以发「继续」。');
  } catch (error) {
    // Restore the original draft on failure so a retry sends it only once.
    conversation.messages.pop();
    if (!conversation.messages.length) conversations = conversations.filter(item => item.id !== conversation.id);
    if (currentId === conversation.id) {
      promptInput.value = question;
      resizeInput();
      showNotice(task.signal.aborted ? '已停止生成。' : error.message, !task.signal.aborted);
    }
  } finally {
    controller = undefined;
    busy(false);
    persist();
    render();
  }
}

function resizeInput() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(134, promptInput.scrollHeight) + 'px';
}

async function checkAvailability() {
  if (chatEndpoint) {
    try {
      const response = await fetch(new URL('./health', new URL(chatEndpoint, location.href)), {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000)
      });
      chatReady = response.ok && (await response.json()).ready === true;
    } catch {
      chatReady = false;
    }
  }
  byId('mode').textContent = chatReady ? '在线' : '示例预览';
  byId('access').hidden = !chatReady;
  byId('composer-note').textContent = chatReady ?
    'Enter 发送 · Shift + Enter 换行 · 提问由外部模型服务处理' :
    'Enter 发送 · Shift + Enter 换行';
  if (chatReady) {
    if (byId('notice').textContent.startsWith('实时问答尚未接入')) showNotice();
  } else showNotice('实时问答尚未接入。点击示例即可查看课程讲解。');
}

void checkAvailability();
for (const example of examples) {
  const button = document.createElement('button');
  button.className = 'example';
  const title = document.createElement('strong');
  title.textContent = example.label;
  const subtitle = document.createElement('span');
  subtitle.textContent = example.caption;
  button.append(title, subtitle);
  button.addEventListener('click', () => {
    if (controller) return;
    if (chatReady) {
      promptInput.value = example.question;
      resizeInput();
      promptInput.focus();
    } else showExample(example);
  });
  byId('examples').append(button);
}
byId('composer').addEventListener('submit', event => {
  event.preventDefault();
  void send(promptInput.value.trim());
});
promptInput.addEventListener('input', resizeInput);
promptInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    byId('composer').requestSubmit();
  }
});
byId('stop').addEventListener('click', () => controller?.abort());
byId('new-chat').addEventListener('click', () => {
  controller?.abort();
  currentId = undefined;
  promptInput.value = '';
  toggleMenu(false);
  showNotice(chatReady ? '' : '实时问答尚未接入。点击示例即可查看课程讲解。');
  render();
  resizeInput();
  promptInput.focus();
});
byId('clear-history').addEventListener('click', () => {
  if (conversations.length && !confirm('清除这个浏览器里的全部课程对话？')) return;
  controller?.abort();
  conversations = [];
  currentId = undefined;
  persist();
  toggleMenu(false);
  showNotice();
  render();
});
byId('menu').addEventListener('click', () => toggleMenu(byId('menu').getAttribute('aria-expanded') !== 'true'));
byId('scrim').addEventListener('click', () => toggleMenu(false));
byId('access').addEventListener('click', () => requestCode());
byId('cancel-access').addEventListener('click', () => dialog.close());
byId('access-form').addEventListener('submit', event => {
  event.preventDefault();
  const code = byId('access-code').value.trim();
  if (!code) return;
  sessionStorage.setItem(accessKey, code);
  const question = pendingQuestion;
  dialog.close();
  showNotice('课堂访问码已保存在当前标签页。');
  if (question) void send(question);
});
dialog.addEventListener('close', () => {
  pendingQuestion = undefined;
  byId('access-code').value = '';
});
render();
