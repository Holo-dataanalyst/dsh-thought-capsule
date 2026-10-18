/**
 * 宿主半边 HTTP：prefix '/thought-capsule'。
 *   GET    /api/health          → { ok, file, storeExists }
 *   GET    /api/state           → { ok, categories, items, counts, total, updatedAt }
 *   POST   /api/items           → { ok, item, counts }        body: { text, category? }
 *   PATCH  /api/items/:id       → { ok, item, counts }        body: { text?, category?, status? }
 *   DELETE /api/items/:id       → { ok, removed, counts }
 *   POST   /api/categories      → { ok, category, categories } body: { label }
 *   GET    /api/draft           → { ok, draft }              半截未保存的想法
 *   PUT    /api/draft           → { ok, draft }              body: { text }
 *   GET    /api/settings        → { ok, settings }           悬浮胶囊开关/图标/位置/大小/透明度/便签方向
 *   PUT    /api/settings        → { ok, settings }           body: { enabled?, icon?, x?, y?, size?, opacity?, side? }
 *   GET    /api/sessions        → { ok, workspaces, loose, defaultWorkspaceId }  已落盘、未归档的会话按工作区分组
 *   GET    /api/scan            → { ok, sessions, prompt, workspaceId }          扫近期会话里的待办线索，拼成给 AI 的请求
 *   POST   /api/find-missed     → { ok, sessions, rows, raw, model }             面板内直接问宿主模型，要回 JSON 数组
 *   POST   /api/client-report   → 浏览器半边自检回传（内存里留最近一次，排障用）
 */
import fs from 'node:fs';
import { CATEGORY_IDS } from './classify.js';
import {
  CapsuleError,
  addItem,
  countItems,
  createCategory,
  errorMessage,
  exportStore,
  listItems,
  loadStore,
  readDraft,
  readSettings,
  removeItem,
  resolveBaseDir,
  saveDraft,
  saveSettings,
  storePaths,
  updateItem,
  weeklyDigest,
} from './store.js';

export const PREFIX = '/thought-capsule';

const BODY_LIMIT = 32 * 1024;
const CLIENT_REPORT_LIMIT = 64 * 1024;

/** 最近一次浏览器半边自检（只在内存里，重启即清） */
let lastClientReport = null;

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function sendJson(res, status, body) {
  let text;
  try {
    text = JSON.stringify(body);
  } catch (err) {
    text = JSON.stringify({ ok: false, error: '响应序列化失败' });
  }
  try {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(text);
  } catch (err) {
    /* 连接已断开，忽略 */
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit]
 * @returns {Promise<any>}
 */
function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    /** @type {Buffer[]} */
    const chunks = [];
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(new CapsuleError('body-too-large', '请求体过大（上限 ' + limit + ' 字节）', 413));
        try {
          req.destroy();
        } catch (err) {
          /* noop */
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch (err) {
        reject(new CapsuleError('bad-json', '请求体不是合法 JSON'));
      }
    });
    req.on('error', (err) => fail(err));
  });
}

/**
 * 兼容「宿主已剥掉 prefix」和「没剥」两种 req.url 形态。
 *
 * @param {string} rawUrl
 */
function routeOf(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl || '/', 'http://127.0.0.1');
  } catch (err) {
    url = new URL('/', 'http://127.0.0.1');
  }
  let path = url.pathname;
  if (path === PREFIX) path = '/';
  else if (path.startsWith(PREFIX + '/')) path = path.slice(PREFIX.length);
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return { path, query: url.searchParams };
}

/**
 * 宿主会话检索服务：没就绪时给一条能读懂的错误，而不是 500 堆栈。
 *
 * @param {any} ctx
 */
function sessionService(ctx) {
  let service;
  try {
    service = ctx && typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined;
  } catch (err) {
    service = undefined;
  }
  if (!service || typeof service.listSessions !== 'function') {
    throw new CapsuleError('no-session-service', '当前宿主没有会话检索服务，暂时读不到历史会话', 503);
  }
  return service;
}

/** @param {number} value @param {number} min @param {number} max */
function clampInt(value, min, max) {
  const n = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : min;
  return Math.min(max, Math.max(min, n));
}

/**
 * 已归档的会话 id。宿主把归档信息放在 workspaceRegistry 上（archivedSessionIds），
 * 归档过的会话会从工作区的 sessionIds 里移走，所以不能只看分组——否则它们会掉进
 * 「不在工作区里」那堆，被当成可选会话列出来。
 *
 * @param {any} ctx
 */
function archivedIds(ctx) {
  let registry;
  try {
    registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
  } catch (err) {
    registry = undefined;
  }
  const raw = registry && Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : [];
  return new Set(raw.map(String));
}

/**
 * 会话所在的工作区（没有则返回空串）。客户端要新建会话必须先知道 workspaceId。
 *
 * @param {any} ctx
 * @param {string} sessionId
 */
function workspaceFor(ctx, sessionId, cwd) {
  let registry;
  try {
    registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
  } catch (err) {
    registry = undefined;
  }
  if (!registry || typeof registry.list !== 'function' || !sessionId) return '';
  let list = [];
  try {
    list = registry.list() || [];
  } catch (err) {
    return '';
  }
  for (const workspace of list) {
    const ids = Array.isArray(workspace && workspace.sessionIds) ? workspace.sessionIds : [];
    if (ids.map(String).includes(String(sessionId))) return String(workspace.id || '');
  }
  // 宿主的工作区索引可能还没收录这条会话，退一步按 cwd 认工作区。
  if (cwd) {
    for (const workspace of list) {
      if (workspace && String(workspace.path || '') === String(cwd)) return String(workspace.id || '');
    }
  }
  return '';
}

/**
 * 兜底：拿最新建立的工作区（宿主按创建顺序返回）。会话/路径都对不上时用它安家。
 *
 * @param {any} ctx
 */
function newestWorkspaceId(ctx) {
  let registry;
  try {
    registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
  } catch (err) {
    registry = undefined;
  }
  if (!registry || typeof registry.list !== 'function') return '';
  try {
    const list = registry.list() || [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i] && list[i].id) return String(list[i].id);
    }
  } catch (err) {
    /* noop */
  }
  return '';
}

/**
 * 最近 N 个会话（新的在前），只带标题，不读事件——给「发给已有会话」的选择列表用。
 *
 * @param {any} ctx
 * @param {number} limit
 */
async function listRecentSessions(ctx, limit) {
  const service = sessionService(ctx);
  const archived = archivedIds(ctx);
  const records = (await service.listSessions())
    .filter((rec) => rec && rec.persisted === true && rec.header && !archived.has(String(rec.header.id)))
    .slice(0, limit);
  const ids = records.map((rec) => (rec && rec.header ? rec.header.id : '')).filter(Boolean);
  /** @type {Map<string, string>} */
  const titles = new Map();
  try {
    const observed = await service.readTitleSnapshots(ids);
    for (const entry of observed) {
      if (entry && entry.status === 'fulfilled' && entry.value && entry.value.title) {
        const title = entry.value.title.title;
        if (typeof title === 'string' && title) titles.set(String(entry.sessionId), title);
      }
    }
  } catch (err) {
    /* 标题折叠失败不该让列表整体失败，回落到 id */
  }
  return records
    .map((rec) => {
      const header = rec && rec.header ? rec.header : {};
      const id = String(header.id || '');
      if (!id) return null;
      return {
        id,
        title: titles.get(id) || '',
        createdAt: Number(header.createdAt) || 0,
        live: rec.live === true,
        cwd: String(header.cwd || ''),
      };
    })
    .filter(Boolean);
}

/**
 * 会话按「工作区」分组：工作区来自宿主的 durable registry，它的 sessionIds 已经排除了归档会话，
 * 所以这里天然只列未归档的那些。不在任何工作区里的会话单独放一组。
 *
 * @param {any} ctx
 * @param {number} perWorkspace
 */
/**
 * 全部工作区（含还没有会话的空工作区），给「新会话放在哪个工作区」当选项。
 * 只读 workspaceRegistry，不建不改。
 *
 * @param {any} ctx
 * @returns {Array<{id: string, title: string, path: string, sessionCount: number}>}
 */
function listWorkspaces(ctx) {
  let registry;
  try {
    registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
  } catch (err) {
    registry = undefined;
  }
  if (!registry || typeof registry.list !== 'function') return [];
  return registry
    .list()
    .map((workspace) => ({
      id: String((workspace && workspace.id) || ''),
      title: String((workspace && (workspace.title || workspace.path)) || ''),
      path: String((workspace && workspace.path) || ''),
      sessionCount: Array.isArray(workspace && workspace.sessionIds) ? workspace.sessionIds.length : 0,
    }))
    .filter((workspace) => workspace.id);
}

async function listSessionGroups(ctx, perWorkspace) {
  const service = sessionService(ctx);
  const archived = archivedIds(ctx);
  const records = (await service.listSessions()).filter(
    (rec) => rec && rec.persisted === true && rec.header && !archived.has(String(rec.header.id)),
  );
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const rec of records) {
    const header = rec && rec.header ? rec.header : {};
    const id = String(header.id || '');
    if (id) byId.set(id, rec);
  }
  /** @type {Map<string, string>} */
  const titles = new Map();
  const allIds = Array.from(byId.keys()).slice(0, 200);
  if (allIds.length) {
    try {
      const observed = await service.readTitleSnapshots(allIds);
      for (const entry of observed) {
        if (entry && entry.status === 'fulfilled' && entry.value && entry.value.title) {
          const title = entry.value.title.title;
          if (typeof title === 'string' && title) titles.set(String(entry.sessionId), title);
        }
      }
    } catch (err) {
      /* 标题失败只影响显示，不影响分组 */
    }
  }
  const shape = (id) => {
    const rec = byId.get(id);
    const header = rec && rec.header ? rec.header : {};
    return { id, title: titles.get(id) || '', createdAt: Number(header.createdAt) || 0, live: rec && rec.live === true };
  };

  let registry;
  try {
    registry = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
  } catch (err) {
    registry = undefined;
  }

  const covered = new Set();
  const workspaces = [];
  if (registry && typeof registry.list === 'function') {
    for (const workspace of registry.list()) {
      const ids = (Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [])
        .map(String)
        // ponytail: 没标题的会话基本就是建了没说话的空会话，直接不列；宿主真要给空标题的正式会话取名时再放宽。
        .filter((id) => byId.has(id) && titles.get(id))
        .slice(0, perWorkspace);
      if (!ids.length) continue;
      for (const id of ids) covered.add(id);
      workspaces.push({
        id: String(workspace.id || ''),
        title: String(workspace.title || workspace.path || ''),
        path: String(workspace.path || ''),
        sessions: ids.map(shape),
      });
    }
  }
  const loose = records
    .map((rec) => String((rec && rec.header ? rec.header.id : '') || ''))
    .filter((id) => id && !covered.has(id) && titles.get(id))
    .slice(0, perWorkspace * 2)
    .map(shape);

  // 新建会话要落在一个工作区里：用「最近有动静的那个工作区」当默认值。
  let defaultWorkspaceId = '';
  let newest = -Infinity;
  for (const workspace of workspaces) {
    for (const session of workspace.sessions) {
      if (session.createdAt > newest) {
        newest = session.createdAt;
        defaultWorkspaceId = workspace.id;
      }
    }
  }

  return { workspaces, loose, defaultWorkspaceId };
}

/**
 * 扫描最近会话里「我说过的话」，拼成给 AI 的待办盘点请求。
 * 只读会话日志，不写胶囊、不入库。
 *
 * @param {any} ctx
 * @param {number} limit
 */
/** 会话日志的 user/message 里混着宿主注入的上下文（运行时快照、记忆提醒、压缩摘要…），
 *  这些不是用户说的话，混进盘点 prompt 只会让 AI 去总结噪音。 */
const NOISE_PREFIXES = [
  'Current runtime context',
  'Time sampled while preparing',
  'Browser time zone for this request',
  '[Compressed conversation section]',
  '[ACP]',
  '📦 [ACP]',
  '❌ [ACP]',
  '以下由 untrusted-memory',
  'The following skills are available',
  '> 🧠 **From Hindsight memory',
];

function isNoiseText(text) {
  if (!text) return true;
  if (text.startsWith('<') || text.startsWith('<!--')) return true;
  if (text.includes('managed-by: dsh-agents-md')) return true;
  if (text.includes('hindsight_knowledge')) return true;
  if (/^(Agent|Background subagent) [\w-]+ (sent a message|finished)/.test(text)) return true;
  for (const prefix of NOISE_PREFIXES) {
    if (text.startsWith(prefix)) return true;
  }
  return false;
}

async function buildScan(ctx, limit) {
  const service = sessionService(ctx);
  const recent = await listRecentSessions(ctx, limit);
  const sessions = [];
  for (const session of recent) {
    /** @type {string[]} */
    let texts = [];
    try {
      const docs = await service.filterEvents(session.id, [{ kind: 'type', values: ['user/message'] }]);
      const seen = new Set();
      const kept = [];
      for (const doc of docs) {
        const text = String((doc && doc.text) || '').replace(/\s+/g, ' ').trim();
        if (isNoiseText(text) || seen.has(text)) continue;
        seen.add(text);
        kept.push(text.length > 200 ? text.slice(0, 200) + '…' : text);
      }
      texts = kept.slice(-10);
    } catch (err) {
      texts = [];
    }
    if (!texts.length) continue;
    sessions.push({ id: session.id, title: session.title || '（未命名会话）', createdAt: session.createdAt, texts });
  }

  const head =
    '帮我盘点一下：下面是我最近在 DSH 里说过的话（按会话分组，可能被截断）。' +
    '请找出我提到过、但可能还没落地的待办、承诺和计划。\n\n' +
    '要求：\n' +
    '1. 只做这一件事，先不要调用任何工具，不要创建胶囊。\n' +
    '2. 用 Markdown 表格输出，表头固定为：| 事项 | 出自会话 | 判断依据 |。\n' +
    '3. 已经做完的、纯提问和闲聊不要列。\n' +
    '4. 最多 20 行，按我可能忘掉的程度排序。\n' +
    '5. 表格之后不要再写别的段落。\n\n' +
    '=== 我的历史会话 ===\n';
  const chunks = [];
  let size = head.length;
  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    const block =
      '[' + (i + 1) + '] ' + session.title + '\n' +
      '（会话 id：' + session.id + '）\n' +
      session.texts.map((text) => '- ' + text).join('\n');
    if (size + block.length > 12000) break;
    chunks.push(block);
    size += block.length;
  }

  return {
    sessions: sessions.map((session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, count: session.texts.length })),
    prompt: head + chunks.join('\n\n'),
    workspaceId: sessions.length ? workspaceFor(ctx, sessions[0].id, sessions[0].cwd) || newestWorkspaceId(ctx) : '',
  };
}

/**
 * 面板里直接跑「找漏掉的待办」：用宿主自己的模型通道问一次，不新开会话。
 * 复用 agentDefaultModel 的当前路由，用户不必配第二份凭据。
 */
async function findMissed(ctx, limit) {
  const llm = ctx && typeof ctx.get === 'function' ? ctx.get('llm') : undefined;
  if (!llm || typeof llm.stream !== 'function') {
    throw new CapsuleError('no-llm-service', '宿主没有可用的模型服务（llm），面板内盘点不可用', 503);
  }
  const selection = defaultSelection(ctx);
  if (!selection) {
    throw new CapsuleError('no-model-selection', '取不到当前默认模型（agentDefaultModel），请先在一个会话里选好模型', 503);
  }
  const scan = await buildScan(ctx, limit);
  const text = await askModel(llm, selection, MISSED_SYSTEM, scan.prompt);
  return { sessions: scan.sessions, rows: parseMissedRows(text), raw: text.slice(0, 4000), model: selection.provider + '/' + selection.model };
}

const MISSED_SYSTEM =
  '你是一个待办审计员。用户在 DSH 里跟我聊了很多东西，你要从这些聊天里挑出他可能忘掉、没跟进的事项。' +
  '只输出一个 JSON 数组，不要代码围栏、不要解释。每项形如 ' +
  '{"todo":"事项（一句中文，动词开头）","session":"出自哪个会话（用给的会话标题）","why":"为什么可能漏了（不超过30字）"}。' +
  '没有就输出 []。最多 8 项。已经明确做完的、纯提问、闲聊都不要列。';

/** 取当前默认模型路由；ctx.get('agentDefaultModel').currentSelection() 是同步的。 */
function defaultSelection(ctx) {
  const service = ctx && typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined;
  if (!service || typeof service.currentSelection !== 'function') return null;
  const selection = service.currentSelection();
  if (!selection || !selection.provider || !selection.model) return null;
  return selection;
}

/** 跑一次流式补全，把文本拼起来。 */
async function askModel(llm, selection, system, userText) {
  const options = {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
  };
  let out = '';
  for await (const chunk of llm.stream(options)) {
    if (chunk.type === 'text-delta') out += chunk.text;
    if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        const failure = chunk.reason.failure || {};
        throw new CapsuleError('model-failed', '模型调用失败：' + (failure.message || chunk.reason.kind), 502);
      }
    }
  }
  return out;
}

/** 从模型输出里抠出 JSON 数组；模型偶尔裹代码围栏或前后加话。 */
export function parseMissedRows(text) {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const todo = String(entry.todo || '').trim();
    if (!todo) continue;
    rows.push({
      todo: todo.slice(0, 200),
      session: String(entry.session || '').trim().slice(0, 120),
      why: String(entry.why || '').trim().slice(0, 120),
    });
  }
  return rows.slice(0, 20);
}

/**
 * @param {{ config?: any, ctx?: any }} deps
 */
export function createHandler(deps) {
  const resolvePaths = () =>
    storePaths(resolveBaseDir({ config: deps && deps.config, ctx: deps && deps.ctx, env: process.env }));

  return async function handle(req, res) {
    const method = (req && req.method ? req.method : 'GET').toUpperCase();
    const { path, query } = routeOf(req && req.url);

    try {
      if (method === 'GET' && path === '/api/health') {
        const paths = resolvePaths();
        let storeExists = false;
        try {
          storeExists = fs.existsSync(paths.file);
        } catch (err) {
          storeExists = false;
        }
        sendJson(res, 200, { ok: true, dir: paths.dir, file: paths.file, storeExists });
        return;
      }

      if (method === 'GET' && path === '/api/state') {
        const paths = resolvePaths();
        const status = query.get('status') || 'all';
        const category = query.get('category') || '';
        const limit = Number(query.get('limit') || '500');
        const result = listItems(paths, { status, category, limit });
        sendJson(res, 200, {
          ok: true,
          categories: result.categories,
          items: result.items,
          counts: result.counts,
          total: result.total,
        });
        return;
      }

      if (method === 'POST' && path === '/api/categories') {
        const body = await readBody(req);
        const paths = resolvePaths();
        const created = createCategory(paths, body.label);
        sendJson(res, 201, { ok: true, category: created.category, categories: created.categories });
        return;
      }

      if (method === 'GET' && path === '/api/draft') {
        const paths = resolvePaths();
        sendJson(res, 200, { ok: true, draft: readDraft(paths).draft });
        return;
      }

      if (method === 'PUT' && path === '/api/draft') {
        const body = await readBody(req);
        const paths = resolvePaths();
        sendJson(res, 200, { ok: true, draft: saveDraft(paths, typeof body.text === 'string' ? body.text : '').draft });
        return;
      }

      if (method === 'GET' && path === '/api/settings') {
        const paths = resolvePaths();
        sendJson(res, 200, { ok: true, settings: readSettings(paths).settings });
        return;
      }

      if (method === 'PUT' && path === '/api/settings') {
        const body = await readBody(req);
        const paths = resolvePaths();
        const patch = {};
        if (body.enabled !== undefined) patch.enabled = body.enabled === true;
        if (body.icon !== undefined) patch.icon = body.icon;
        if (body.x !== undefined) patch.x = body.x;
        if (body.y !== undefined) patch.y = body.y;
        if (body.size !== undefined) patch.size = body.size;
        if (body.opacity !== undefined) patch.opacity = body.opacity;
        if (body.noteFont !== undefined) patch.noteFont = body.noteFont;
        if (body.side !== undefined) patch.side = body.side;
        sendJson(res, 200, { ok: true, settings: saveSettings(paths, patch).settings });
        return;
      }

      if (method === 'POST' && path === '/api/items') {
        const body = await readBody(req);
        const paths = resolvePaths();
        const item = addItem(paths, {
          text: body.text,
          category: body.category,
          tags: body.tags,
          dueDate: body.dueDate,
          sourceSessionId: body.sourceSessionId,
          source: 'user',
        });
        sendJson(res, 201, { ok: true, item, counts: countItems(loadStore(paths).items) });
        return;
      }

      if (method === 'GET' && path === '/api/export') {
        const paths = resolvePaths();
        const dump = exportStore(paths);
        const stamp = new Date().toISOString().slice(0, 10);
        try {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('content-disposition', 'attachment; filename="thought-capsules-' + stamp + '.json"');
          res.setHeader('cache-control', 'no-store');
          res.end(dump.text);
        } catch (err) {
          /* 连接已断开 */
        }
        return;
      }

      if (method === 'GET' && path === '/api/review') {
        const paths = resolvePaths();
        const days = clampInt(query.get('days') || '7', 1, 60);
        const digest = weeklyDigest(paths, { days });
        sendJson(res, 200, {
          ok: true,
          ...digest,
          categories: listItems(paths, { status: 'all', limit: 1 }).categories,
        });
        return;
      }

      const itemMatch = /^\/api\/items\/([^/]+)$/.exec(path);
      if (itemMatch) {
        let id;
        try {
          id = decodeURIComponent(itemMatch[1]);
        } catch (err) {
          throw new CapsuleError('invalid-id', '卡片 id 无法解码');
        }
        const paths = resolvePaths();
        if (method === 'PATCH') {
          const body = await readBody(req);
          const item = updateItem(paths, id, body);
          sendJson(res, 200, { ok: true, item, counts: countItems(loadStore(paths).items) });
          return;
        }
        if (method === 'DELETE') {
          const removed = removeItem(paths, id);
          sendJson(res, 200, { ok: true, removed, counts: countItems(loadStore(paths).items) });
          return;
        }
        sendJson(res, 405, { ok: false, error: '该路径只支持 PATCH / DELETE' });
        return;
      }

      if (method === 'GET' && path === '/api/workspaces') {
        sendJson(res, 200, { ok: true, workspaces: listWorkspaces(deps && deps.ctx) });
        return;
      }

      if (method === 'GET' && path === '/api/sessions') {
        const groups = await listSessionGroups(deps && deps.ctx, clampInt(query.get('limit') || '12', 1, 40));
        sendJson(res, 200, {
          ok: true,
          workspaces: groups.workspaces,
          loose: groups.loose,
          defaultWorkspaceId: groups.defaultWorkspaceId,
        });
        return;
      }

      if (method === 'POST' && path === '/api/find-missed') {
        const body = await readBody(req, BODY_LIMIT);
        const limit = clampInt(body && body.limit ? String(body.limit) : query.get('limit') || '6', 1, 10);
        const found = await findMissed(deps && deps.ctx, limit);
        sendJson(res, 200, { ok: true, sessions: found.sessions, rows: found.rows, raw: found.raw, model: found.model });
        return;
      }

      if (method === 'GET' && path === '/api/scan') {
        const scan = await buildScan(deps && deps.ctx, clampInt(query.get('limit') || '6', 1, 10));
        sendJson(res, 200, { ok: true, sessions: scan.sessions, prompt: scan.prompt, workspaceId: scan.workspaceId });
        return;
      }

      if (method === 'POST' && path === '/api/client-report') {
        lastClientReport = await readBody(req, CLIENT_REPORT_LIMIT);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && path === '/api/client-report') {
        sendJson(res, 200, { ok: true, report: lastClientReport });
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: '未知接口：' + method + ' ' + path,
        known: [
          'GET /api/health',
          'GET /api/state',
          'POST /api/items',
          'PATCH /api/items/:id',
          'DELETE /api/items/:id',
          'POST /api/categories',
          'GET /api/draft',
          'PUT /api/draft',
          'GET /api/sessions',
          'GET /api/workspaces',
          'GET /api/scan',
          'POST /api/find-missed',
          'POST /api/client-report',
        ],
        categories: CATEGORY_IDS,
      });
    } catch (err) {
      const status = err instanceof CapsuleError && Number.isInteger(err.status) ? err.status : 500;
      const code = err instanceof CapsuleError ? err.code : 'internal-error';
      sendJson(res, status, { ok: false, code, error: errorMessage(err) });
    }
  };
}
