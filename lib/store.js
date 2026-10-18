/**
 * 思维胶囊的存储层：<baseDir>/.dsh-thought-capsule/capsules.json
 *
 * 全部用同步 fs：Node 单线程下，一次 read-modify-write 不会被另一个 HTTP 请求插进来，
 * 所以这里不需要写队列/锁。
 * ponytail: 单进程假设；将来若要支持多进程并发写，才需要文件锁或独立的写入进程。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CATEGORIES, inferCategory } from './classify.js';

export const DIR_NAME = '.dsh-thought-capsule';
export const FILE_NAME = 'capsules.json';
export const MAX_TEXT = 2000;
export const MAX_LABEL = 24;
export const MAX_DRAFT = 4000;
/** 自定义图标最大体积：data URL 字符数。 */
export const MAX_ICON = 150000;
/** 悬浮胶囊的直径范围（px）与便签不透明度范围。 */
export const FLOAT_MIN_SIZE = 32;
export const FLOAT_MAX_SIZE = 160;
/** 便签/设置面板相对胶囊的开向：auto=按屏幕位置自动换边。 */
export const FLOAT_SIDES = ['auto', 'left', 'right', 'above', 'below'];
/** @type {string[]} */
export const STATUSES = ['inbox', 'todo', 'done', 'archived'];

export class CapsuleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CapsuleError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 数据目录解析：config.dataDir → profileContext.dir → $DSH_HOME → ~/.dsh
 *
 * @param {{ config?: any, ctx?: any, env?: Record<string, string | undefined> }} [options]
 * @returns {string}
 */
export function resolveBaseDir(options = {}) {
  const { config, ctx, env } = options;
  const configured = config && typeof config.dataDir === 'string' ? config.dataDir.trim() : '';
  if (configured) return path.resolve(configured);
  try {
    const profileContext = ctx && typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined;
    const dir = profileContext && typeof profileContext.dir === 'string' ? profileContext.dir.trim() : '';
    if (dir) return path.resolve(dir);
  } catch (err) {
    /* profileContext 没就绪时静默回落 */
  }
  const fromEnv = (env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME : process.env.DSH_HOME) || '';
  if (fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.dsh');
}

/**
 * @param {string} baseDir
 * @returns {{ dir: string, file: string, backup: string }}
 */
export function storePaths(baseDir) {
  const dir = path.join(baseDir, DIR_NAME);
  const file = path.join(dir, FILE_NAME);
  return { dir, file, backup: file + '.bak' };
}

/**
 * @param {any} item
 * @returns {any | null}
 */
function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id) return null;
  if (typeof item.text !== 'string' || !item.text.trim()) return null;
  const createdAt = typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString();
  const normalized = {
    id: item.id,
    text: item.text.slice(0, MAX_TEXT),
    category: typeof item.category === 'string' && item.category ? item.category : 'other',
    status: STATUSES.includes(item.status) ? item.status : 'inbox',
    source: item.source === 'agent' ? 'agent' : 'user',
    createdAt,
    updatedAt: typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : createdAt,
  };
  if (normalized.status === 'done' || normalized.status === 'archived') {
    normalized.doneAt = typeof item.doneAt === 'string' && item.doneAt ? item.doneAt : normalized.updatedAt;
  }
  if (normalized.status === 'archived') {
    normalized.archivedAt = typeof item.archivedAt === 'string' && item.archivedAt ? item.archivedAt : normalized.updatedAt;
  }
  /** 可选字段只在真的有值时写进去：老库读进来不会凭空多出空数组/空串。 */
  const tags = normalizeTags(item.tags);
  if (tags.length) normalized.tags = tags;
  const dueDate = normalizeDueDate(item.dueDate);
  if (dueDate) normalized.dueDate = dueDate;
  if (typeof item.sourceSessionId === 'string' && item.sourceSessionId.trim()) {
    normalized.sourceSessionId = item.sourceSessionId.trim().slice(0, 128);
  }
  if (typeof item.routedSessionId === 'string' && item.routedSessionId.trim()) {
    normalized.routedSessionId = item.routedSessionId.trim().slice(0, 128);
    normalized.routedAt = typeof item.routedAt === 'string' ? item.routedAt : normalized.updatedAt;
  }
  return normalized;
}

/**
 * 标签：去 # 前缀、去空、去重、最多 8 个。
 *
 * @param {any} raw
 * @returns {string[]}
 */
function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const tags = [];
  for (const tag of raw) {
    const clean = String(tag === undefined || tag === null ? '' : tag).trim().replace(/^#+/, '').slice(0, 24);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    tags.push(clean);
    if (tags.length >= 8) break;
  }
  return tags;
}

/**
 * 截止日只存 YYYY-MM-DD（不做提醒，只用来记录和排序）。
 * ponytail: 纯日期字符串，不引日期库；用户传完整 ISO 时取前 10 位。
 *
 * @param {any} raw
 * @returns {string}
 */
function normalizeDueDate(raw) {
  if (typeof raw !== 'string') return '';
  const day = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

/**
 * @param {any} data
 * @returns {{ version: number, updatedAt: string, items: any[], categories: any[], draft: any, recoveredFrom?: string }}
 */
function normalizeStore(data) {
  const items = Array.isArray(data && data.items) ? data.items.map(normalizeItem).filter(Boolean) : [];
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const categories = Array.isArray(data && data.categories) ? data.categories.map(normalizeCategory).filter(Boolean) : [];
  const draft = data && data.draft && typeof data.draft.text === 'string' && data.draft.text
    ? { text: data.draft.text.slice(0, MAX_DRAFT), updatedAt: typeof data.draft.updatedAt === 'string' ? data.draft.updatedAt : '' }
    : null;
  return {
    version: 1,
    updatedAt: typeof (data && data.updatedAt) === 'string' ? data.updatedAt : '',
    items,
    categories,
    draft,
    settings: { float: normalizeFloat(data && data.settings && data.settings.float) },
  };
}

/**
 * 悬浮胶囊的设置。icon 只有两种合法形态：预设 id（如 'pill'）或一张图片的 data URL。
 *
 * @param {any} raw
 * @returns {{ enabled: boolean, icon: string, x: number | null, y: number | null }}
 */
function normalizeFloat(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const icon = typeof source.icon === 'string' && source.icon.length <= MAX_ICON ? source.icon : 'pill';
  return {
    enabled: source.enabled === true,
    icon,
    x: typeof source.x === 'number' && Number.isFinite(source.x) ? Math.round(source.x) : null,
    y: typeof source.y === 'number' && Number.isFinite(source.y) ? Math.round(source.y) : null,
    size: clampNumber(source.size, FLOAT_MIN_SIZE, FLOAT_MAX_SIZE, 54),
    opacity: clampNumber(source.opacity, 0.2, 1, 0.96),
    /** 便签正文的字号（px）：只在浮层里用，面板不读。 */
    noteFont: clampNumber(source.noteFont, 11, 20, 13),
    side: FLOAT_SIDES.includes(source.side) ? source.side : 'auto',
    /** 划词捕获：选中文字后是否浮出「记下来」小气泡。跟悬浮胶囊互不影响。 */
    capture: source.capture === true,
  };
}

/**
 * 数值夹取：非法/缺省回落默认值。
 *
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampNumber(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

/**
 * 用户自建分组：{ id, label, createdAt }。内置六类仍是常量，只有自建的存盘。
 *
 * @param {any} category
 * @returns {any | null}
 */
function normalizeCategory(category) {
  if (!category || typeof category !== 'object') return null;
  if (typeof category.id !== 'string' || !category.id) return null;
  if (typeof category.label !== 'string' || !category.label.trim()) return null;
  return {
    id: category.id,
    label: category.label.trim().slice(0, MAX_LABEL),
    createdAt: typeof category.createdAt === 'string' ? category.createdAt : new Date().toISOString(),
  };
}

/** 内置分类 + 用户自建分类，按「内置在前、自建在后」排列。 */
export function allCategories(store) {
  const custom = Array.isArray(store && store.categories) ? store.categories : [];
  return [
    ...CATEGORIES.map((c) => ({ id: c.id, zh: c.zh, en: c.en, custom: false })),
    ...custom.map((c) => ({ id: c.id, zh: c.label, en: c.label, custom: true })),
  ];
}

/**
 * 读库。文件不存在 → 空库；内容损坏 → 改名留档后当空库继续，绝不因为坏文件让人记不了东西。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 */
export function loadStore(paths) {
  let raw;
  try {
    raw = fs.readFileSync(paths.file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return normalizeStore(null);
    throw new CapsuleError('read-failed', '读取胶囊数据失败：' + errorMessage(err), 500);
  }
  try {
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    const quarantine = paths.file.replace(/\.json$/, '.corrupt-' + Date.now() + '.json');
    try {
      fs.renameSync(paths.file, quarantine);
    } catch (renameError) {
      /* 连改名都失败就退回空库，至少还能继续记 */
    }
    const recovered = normalizeStore(null);
    recovered.recoveredFrom = quarantine;
    return recovered;
  }
}

/**
 * @param {string} file
 * @param {string} text
 */
function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch (cleanupError) {
      /* noop */
    }
    throw err;
  }
}

/**
 * 写库三段护栏：先备份旧文件 → tmp+rename 原子写 → 回读 parse 校验，校验失败用备份恢复。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {{ items: any[] }} store
 */
export function saveStore(paths, store) {
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: Array.isArray(store.items) ? store.items : [],
    categories: Array.isArray(store.categories) ? store.categories : [],
    draft: store.draft && typeof store.draft.text === 'string' && store.draft.text ? store.draft : null,
    settings: { float: normalizeFloat(store.settings && store.settings.float) },
  };
  const text = JSON.stringify(next, null, 2) + '\n';
  let hadPrevious = false;
  try {
    fs.mkdirSync(paths.dir, { recursive: true });
    hadPrevious = fs.existsSync(paths.file);
    if (hadPrevious) fs.copyFileSync(paths.file, paths.backup);
  } catch (err) {
    throw new CapsuleError('backup-failed', '写入前备份失败，已放弃本次写入：' + errorMessage(err), 500);
  }
  try {
    writeAtomic(paths.file, text);
  } catch (err) {
    throw new CapsuleError('write-failed', '写入胶囊数据失败：' + errorMessage(err), 500);
  }
  let verified = null;
  try {
    verified = JSON.parse(fs.readFileSync(paths.file, 'utf8'));
  } catch (err) {
    verified = null;
  }
  if (!verified || !Array.isArray(verified.items) || verified.items.length !== next.items.length) {
    if (hadPrevious) {
      try {
        fs.copyFileSync(paths.backup, paths.file);
      } catch (restoreError) {
        /* noop */
      }
    }
    throw new CapsuleError('verify-failed', '写盘后回读校验失败，已尝试用 .bak 恢复', 500);
  }
  return verified;
}

/**
 * @param {any} text
 * @returns {string}
 */
function requireText(text) {
  if (typeof text !== 'string') throw new CapsuleError('invalid-text', 'text 必须是字符串');
  const clean = text.trim();
  if (!clean) throw new CapsuleError('invalid-text', '内容不能为空');
  if (clean.length > MAX_TEXT) throw new CapsuleError('text-too-long', '内容最多 ' + MAX_TEXT + ' 字，当前 ' + clean.length + ' 字');
  return clean;
}

/**
 * @param {any} category
 * @param {any} [store]
 * @returns {string}
 */
function requireCategory(category, store) {
  const known = allCategories(store).map((c) => c.id);
  if (!known.includes(category)) {
    throw new CapsuleError('invalid-category', '未知分组：' + String(category) + '（可用：' + known.join(', ') + '）');
  }
  return category;
}

/**
 * @param {any} status
 * @returns {string}
 */
function requireStatus(status) {
  if (!STATUSES.includes(status)) {
    throw new CapsuleError('invalid-status', '未知状态：' + String(status) + '（可用：' + STATUSES.join(', ') + '）');
  }
  return status;
}

/**
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {{ text: string, category?: string, source?: 'user' | 'agent' }} input
 */
export function addItem(paths, input) {
  const text = requireText(input && input.text);
  const store = loadStore(paths);
  const category = input && input.category ? requireCategory(input.category, store) : inferCategory(text);
  const now = new Date().toISOString();
  const item = {
    id: randomUUID(),
    text,
    category,
    status: 'inbox',
    source: input && input.source === 'agent' ? 'agent' : 'user',
    createdAt: now,
    updatedAt: now,
  };
  const tags = normalizeTags(input && input.tags);
  if (tags.length) item.tags = tags;
  const dueDate = normalizeDueDate(input && input.dueDate);
  if (dueDate) item.dueDate = dueDate;
  const sourceSessionId = input && typeof input.sourceSessionId === 'string' ? input.sourceSessionId.trim().slice(0, 128) : '';
  if (sourceSessionId) item.sourceSessionId = sourceSessionId;
  store.items.unshift(item);
  saveStore(paths, store);
  return item;
}

/**
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {any} patch
 */
export function updateItem(paths, id, patch) {
  if (typeof id !== 'string' || !id) throw new CapsuleError('invalid-id', '缺少卡片 id');
  const store = loadStore(paths);
  const item = store.items.find((it) => it.id === id);
  if (!item) throw new CapsuleError('not-found', '找不到这条胶囊（可能已被删除）', 404);
  const source = patch && typeof patch === 'object' ? patch : {};
  let touched = false;
  if (source.text !== undefined) {
    item.text = requireText(source.text);
    touched = true;
  }
  if (source.category !== undefined) {
    item.category = requireCategory(source.category, store);
    touched = true;
  }
  if (source.status !== undefined) {
    const status = requireStatus(source.status);
    if (status !== item.status) {
      item.status = status;
      const now = new Date().toISOString();
      if (status === 'done') {
        item.doneAt = now;
        delete item.archivedAt;
      } else if (status === 'archived') {
        if (!item.doneAt) item.doneAt = now;
        item.archivedAt = now;
      } else {
        delete item.doneAt;
        delete item.archivedAt;
      }
      touched = true;
    }
  }
  if (source.sourceSessionId !== undefined) {
    const sid = typeof source.sourceSessionId === 'string' ? source.sourceSessionId.trim().slice(0, 128) : '';
    if (sid) item.sourceSessionId = sid;
    else delete item.sourceSessionId;
    touched = true;
  }
  if (source.tags !== undefined) {
    const tags = normalizeTags(source.tags);
    if (tags.length) item.tags = tags;
    else delete item.tags;
    touched = true;
  }
  if (source.dueDate !== undefined) {
    const dueDate = normalizeDueDate(source.dueDate);
    if (dueDate) item.dueDate = dueDate;
    else delete item.dueDate;
    touched = true;
  }
  if (source.routedSessionId !== undefined) {
    const routed = typeof source.routedSessionId === 'string' ? source.routedSessionId.trim().slice(0, 128) : '';
    if (routed) {
      item.routedSessionId = routed;
      item.routedAt = typeof source.routedAt === 'string' && source.routedAt ? source.routedAt : new Date().toISOString();
    } else {
      delete item.routedSessionId;
      delete item.routedAt;
    }
    touched = true;
  }
  if (!touched) {
    throw new CapsuleError(
      'nothing-to-update',
      '没有需要更新的字段（text / category / status / tags / dueDate / sourceSessionId 至少给一个）',
    );
  }
  item.updatedAt = new Date().toISOString();
  saveStore(paths, store);
  return item;
}

/**
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {string} id
 */
export function removeItem(paths, id) {
  if (typeof id !== 'string' || !id) throw new CapsuleError('invalid-id', '缺少卡片 id');
  const store = loadStore(paths);
  const index = store.items.findIndex((it) => it.id === id);
  if (index === -1) throw new CapsuleError('not-found', '找不到这条胶囊（可能已被删除）', 404);
  const [removed] = store.items.splice(index, 1);
  saveStore(paths, store);
  return removed;
}

/**
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {{ status?: string, category?: string, limit?: number }} [filter]
 */
export function listItems(paths, filter = {}) {
  const store = loadStore(paths);
  const status = filter.status && filter.status !== 'all' ? requireStatus(filter.status) : '';
  const category = filter.category ? requireCategory(filter.category, store) : '';
  const rawLimit = Number.isFinite(Number(filter.limit)) ? Math.floor(Number(filter.limit)) : 20;
  const limit = Math.min(200, Math.max(1, rawLimit));
  const items = store.items
    .filter((it) => (status ? it.status === status : true))
    .filter((it) => (category ? it.category === category : true))
    .slice(0, limit);
  return { items, counts: countItems(store.items), total: store.items.length, categories: allCategories(store) };
}

/**
 * 新建一个用户分组。重名（忽略大小写）直接返回已有那条，不报错。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {any} label
 */
export function createCategory(paths, label) {
  if (typeof label !== 'string' || !label.trim()) throw new CapsuleError('invalid-label', '分组名不能为空');
  const clean = label.trim().slice(0, MAX_LABEL);
  const store = loadStore(paths);
  const existing = store.categories.find((c) => c.label.toLowerCase() === clean.toLowerCase());
  if (existing) return { category: existing, categories: allCategories(store) };
  const category = { id: 'g-' + randomUUID().slice(0, 8), label: clean, createdAt: new Date().toISOString() };
  store.categories.push(category);
  saveStore(paths, store);
  return { category, categories: allCategories(store) };
}

/**
 * 半截草稿：存盘，面板下次打开时回填输入框。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {any} text
 */
export function saveDraft(paths, text) {
  if (typeof text !== 'string') throw new CapsuleError('invalid-text', 'text 必须是字符串');
  const clean = text.slice(0, MAX_DRAFT);
  const store = loadStore(paths);
  const draft = clean.trim() ? { text: clean, updatedAt: new Date().toISOString() } : null;
  if (!draft && !store.draft) return { draft: null };
  store.draft = draft;
  saveStore(paths, store);
  return { draft };
}

/**
 * @param {{ dir: string, file: string, backup: string }} paths
 * @returns {{ draft: any }}
 */
export function readDraft(paths) {
  return { draft: loadStore(paths).draft || null };
}

/**
 * 悬浮胶囊设置：读。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 */
export function readSettings(paths) {
  return { settings: loadStore(paths).settings };
}

/**
 * 悬浮胶囊设置：合并写（只传要改的字段）。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {any} patch
 */
export function saveSettings(paths, patch) {
  const source = patch && typeof patch === 'object' ? patch : {};
  const store = loadStore(paths);
  const merged = { ...store.settings.float, ...source };
  store.settings = { float: normalizeFloat(merged) };
  saveStore(paths, store);
  return { settings: store.settings };
}

/**
 * 导出：把落盘的 capsules.json 原样吐出来（用户自己备份/换设备用）。
 * 读不到就按空库导出，不报错——备份功能不该因为一次磁盘抖动失败。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 * @returns {{ text: string, file: string }}
 */
export function exportStore(paths) {
  try {
    const text = fs.readFileSync(paths.file, 'utf8');
    return { text, file: paths.file };
  } catch (err) {
    const empty = { version: 1, updatedAt: new Date().toISOString(), items: [], categories: [], draft: null, settings: { float: normalizeFloat(null) } };
    return { text: JSON.stringify(empty, null, 2), file: paths.file };
  }
}

/**
 * 「本周回看」：纯本地统计，不调模型。
 * ponytail: 文档里想复用 find-missed 的模型通道，但「这周新增多少、哪条待办停了 7 天」全是确定性的，
 * 走模型只会多等 70 秒、多花钱，还可能编数；真需要 AI 写点评时再给这个结构加一段 askModel。
 *
 * @param {{ dir: string, file: string, backup: string }} paths
 * @param {{ days?: number }} [options]
 */
export function weeklyDigest(paths, options = {}) {
  const rawDays = Number(options.days);
  const days = Number.isFinite(rawDays) ? Math.min(60, Math.max(1, Math.floor(rawDays))) : 7;
  const store = loadStore(paths);
  const since = Date.now() - days * 24 * 3600 * 1000;
  const fresh = (iso) => {
    const stamp = Date.parse(typeof iso === 'string' ? iso : '');
    return Number.isFinite(stamp) && stamp >= since;
  };
  const added = store.items.filter((it) => fresh(it.createdAt));
  const done = store.items.filter((it) => fresh(it.doneAt));
  const archived = store.items.filter((it) => fresh(it.archivedAt));
  /** @type {Map<string, number>} */
  const byCategory = new Map();
  for (const item of added) byCategory.set(item.category, (byCategory.get(item.category) || 0) + 1);
  const stale = store.items
    .filter((it) => it.status === 'todo' && !fresh(it.updatedAt))
    .map((it) => ({
      id: it.id,
      text: String(it.text).slice(0, 140),
      category: it.category,
      updatedAt: it.updatedAt,
      ageDays: Math.max(0, Math.floor((Date.now() - Date.parse(it.updatedAt || it.createdAt)) / 86400000)),
    }))
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 20);
  return {
    days,
    since: new Date(since).toISOString(),
    added: added.length,
    done: done.length,
    archived: archived.length,
    byCategory: [...byCategory.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    stale,
    counts: countItems(store.items),
  };
}

/**
 * @param {any[]} items
 */
export function countItems(items) {
  const counts = { inbox: 0, todo: 0, done: 0, archived: 0, total: Array.isArray(items) ? items.length : 0 };
  for (const item of Array.isArray(items) ? items : []) {
    if (item && STATUSES.includes(item.status)) counts[item.status] += 1;
  }
  return counts;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessage(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.message ? err.message : String(err);
}
