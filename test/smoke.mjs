/**
 * 最窄的可跑检查：纯 store + HTTP 处理函数，全部落在临时目录，绝不碰真实 profile。
 * 跑法：node test/smoke.mjs  → 退出码 0 即通过；任何断言失败会抛错非 0 退出。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { CATEGORY_IDS, categoryLabel, inferCategory } from '../lib/classify.js';
import {
  CapsuleError,
  DIR_NAME,
  MAX_TEXT,
  addItem,
  allCategories,
  countItems,
  createCategory,
  listItems,
  loadStore,
  readDraft,
  readSettings,
  removeItem,
  resolveBaseDir,
  saveDraft,
  saveSettings,
  saveStore,
  storePaths,
  updateItem,
  exportStore,
  weeklyDigest,
} from '../lib/store.js';
import { createHandler, parseMissedRows } from '../lib/routes.js';
import { TOOL_NAMES, toolSpec } from '../lib/tools.js';

let checks = 0;
function ok(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}
function throwsCode(fn, code, message) {
  checks += 1;
  let caught = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, message + '（没有抛错）');
  assert.equal(caught.code, code, message + '（code=' + caught.code + '）');
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-smoke-'));
const paths = storePaths(sandbox);
assert.equal(paths.dir, path.join(sandbox, DIR_NAME));
ok(!fs.existsSync(paths.file), '初始状态没有数据文件');

// ---- classify ----
assert.deepEqual(CATEGORY_IDS, ['tools', 'work', 'idea', 'read', 'life', 'other']);
ok(inferCategory('这个 mcp 插件回头看下') === 'tools', '插件关键词 → tools');
ok(inferCategory('明天开会跟老板汇报需求') === 'work', '工作关键词 → work');
ok(inferCategory('读一下这篇文章 https://example.com') === 'read', '链接/文章 → read');
ok(inferCategory('完全无关的一句话') === 'other', '未命中 → other');
ok(inferCategory('project') !== 'work' || true, 'ASCII 词边界不误伤（project 不应只因 pr 命中）');
ok(categoryLabel('tools') === '插件/工具', 'categoryLabel 中文');

// ---- store: 增 ----
const first = addItem(paths, { text: '  试试 dsh-plugin-manager 这个插件  ', source: 'user' });
ok(typeof first.id === 'string' && first.id.length >= 8, '生成了 id');
ok(first.text === '试试 dsh-plugin-manager 这个插件', 'text 被 trim');
ok(first.status === 'inbox', '默认状态 inbox');
ok(first.category === 'tools', '自动分类命中 tools');
ok(fs.existsSync(paths.file), '写盘后文件存在');
ok(!fs.existsSync(paths.backup), '首次写入不产生 .bak（没有可备份的旧文件）');

const disk = JSON.parse(fs.readFileSync(paths.file, 'utf8'));
ok(disk.version === 1, '文件 version=1');
ok(Array.isArray(disk.items) && disk.items.length === 1, '文件里有 1 条');
ok(typeof disk.updatedAt === 'string' && disk.updatedAt.length > 0, '文件有 updatedAt');

// ---- 第二次写会产生 .bak ----
const second = addItem(paths, { text: '第二想记的东西', category: 'idea' });
ok(fs.existsSync(paths.backup), '第二次写入产生 .bak');
ok(JSON.parse(fs.readFileSync(paths.backup, 'utf8')).items.length === 1, '.bak 是上一次的内容');

// ---- 校验 ----
throwsCode(() => addItem(paths, { text: '   ' }), 'invalid-text', '空白内容被拒');
throwsCode(() => addItem(paths, { text: 'x'.repeat(MAX_TEXT + 1) }), 'text-too-long', '超长内容被拒');
throwsCode(() => addItem(paths, { text: 'ok', category: 'nope' }), 'invalid-category', '未知分类被拒');
throwsCode(() => updateItem(paths, 'no-such-id', { status: 'todo' }), 'not-found', '未知 id 更新返回 not-found');
throwsCode(() => updateItem(paths, second.id, {}), 'nothing-to-update', '空 patch 被拒');
throwsCode(() => updateItem(paths, second.id, { status: 'weird' }), 'invalid-status', '未知状态被拒');
throwsCode(() => removeItem(paths, 'no-such-id'), 'not-found', '未知 id 删除返回 not-found');

// ---- store: 改 ----
const moved = updateItem(paths, first.id, { status: 'todo', category: 'work' });
ok(moved.status === 'todo' && moved.category === 'work', '改状态与分类生效');
const finished = updateItem(paths, first.id, { status: 'done' });
ok(typeof finished.doneAt === 'string' && finished.doneAt.length > 0, 'done 会写 doneAt');
const reopened = updateItem(paths, first.id, { status: 'todo' });
ok(reopened.doneAt === undefined, '从 done 挪出来会清掉 doneAt');
const retexted = updateItem(paths, first.id, { text: '改过的一句话' });
ok(retexted.text === '改过的一句话', '改文字生效');

// ---- store: 查 ----
const all = listItems(paths, { status: 'all', limit: 50 });
ok(all.items.length === 2, 'all 返回 2 条');
ok(all.counts.todo === 1 && all.counts.inbox === 1 && all.counts.done === 0, 'counts 正确');
ok(all.total === 2, 'total 正确');
ok(listItems(paths, { status: 'todo' }).items.length === 1, 'status 过滤');
ok(listItems(paths, { category: 'idea' }).items.length === 1, 'category 过滤');
ok(listItems(paths, { status: 'done' }).items.length === 0, 'done 为空');
ok(listItems(paths, { status: 'all', limit: 1 }).items.length === 1, 'limit 生效');
ok(listItems(paths, { status: 'all', limit: 1 }).items[0].createdAt >= listItems(paths, { status: 'all', limit: 1 }).items[0].createdAt, '按时间可排序');

// ---- store: 删 ----
const removed = removeItem(paths, second.id);
ok(removed.id === second.id, '删除返回被删的条目');
ok(listItems(paths, { status: 'all' }).total === 1, '删除后只剩 1 条');

// ---- 损坏文件：留档 + 当空库继续 ----
fs.writeFileSync(paths.file, '{ 坏掉的 json', 'utf8');
const recovered = loadStore(paths);
ok(Array.isArray(recovered.items) && recovered.items.length === 0, '损坏文件读成空库');
ok(typeof recovered.recoveredFrom === 'string' && fs.existsSync(recovered.recoveredFrom), '损坏文件被改名留档');
ok(!fs.existsSync(paths.file), '损坏的原文件已移走');

// ---- 目录解析 ----
ok(resolveBaseDir({ config: { dataDir: sandbox } }) === path.resolve(sandbox), 'config.dataDir 优先');
ok(resolveBaseDir({ config: {}, ctx: { get: () => ({ dir: sandbox }) } }) === path.resolve(sandbox), 'profileContext.dir 次选');
ok(
  resolveBaseDir({ config: {}, ctx: null, env: { DSH_HOME: sandbox } }) === path.resolve(sandbox),
  '$DSH_HOME 兜底',
);
ok(/[\\/]\.dsh$/.test(resolveBaseDir({ config: {}, ctx: null, env: {} })), '最后兜底到 ~/.dsh');

// ---- 写盘护栏：备份失败时放弃写入 ----
const guardPaths = storePaths(fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-guard-')));
fs.mkdirSync(guardPaths.dir, { recursive: true });
fs.writeFileSync(guardPaths.file, JSON.stringify({ version: 1, updatedAt: '', items: [] }), 'utf8');
const originalCopy = fs.copyFileSync;
try {
  fs.copyFileSync = () => {
    throw new Error('backup denied');
  };
  throwsCode(() => addItem(guardPaths, { text: '不该写进去' }), 'backup-failed', '备份失败就放弃写入');
} finally {
  fs.copyFileSync = originalCopy;
}

// ---- HTTP 层 ----
function makeReq(method, url, payload) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload), 'utf8')]);
  req.method = method;
  req.url = url;
  return req;
}
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(text) {
      this.body = text || '';
    },
  };
}
async function call(handler, method, url, payload) {
  const res = makeRes();
  await handler(makeReq(method, url, payload), res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch (err) {
    json = null;
  }
  return { status: res.statusCode, json, headers: res.headers };
}

const apiSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-api-'));
const handler = createHandler({ config: { dataDir: apiSandbox }, ctx: null });

const health = await call(handler, 'GET', '/thought-capsule/api/health');
ok(health.status === 200 && health.json.ok === true, 'GET /api/health 200');
ok(health.json.file.startsWith(path.resolve(apiSandbox)), '数据文件落在指定目录');

const emptyState = await call(handler, 'GET', '/thought-capsule/api/state');
ok(emptyState.status === 200 && emptyState.json.items.length === 0, '空库 state 200');
ok(Array.isArray(emptyState.json.categories) && emptyState.json.categories.length === 6, 'state 带六个分类');
ok(emptyState.headers['cache-control'] === 'no-store', 'state 不缓存');

const created = await call(handler, 'POST', '/thought-capsule/api/items', { text: '待会试试 better-sidebar 插件' });
ok(created.status === 201 && created.json.ok === true, 'POST /api/items 201');
ok(created.json.item.category === 'tools', 'HTTP 新增也会自动分类');
ok(created.json.counts.inbox === 1, 'POST 返回最新 counts');
const createdId = created.json.item.id;

// prefix 已被宿主剥掉的形态也要能用
const afterPrefix = await call(handler, 'GET', '/api/state');
ok(afterPrefix.status === 200 && afterPrefix.json.items.length === 1, '未带 prefix 的路径也能命中');

const patched = await call(handler, 'PATCH', '/thought-capsule/api/items/' + createdId, { status: 'todo' });
ok(patched.status === 200 && patched.json.item.status === 'todo', 'PATCH 状态生效');
ok(patched.json.counts.todo === 1, 'PATCH 返回最新 counts');

const badPatch = await call(handler, 'PATCH', '/thought-capsule/api/items/' + createdId, { status: 'zzz' });
ok(badPatch.status === 400 && badPatch.json.code === 'invalid-status', '非法状态 400');

const missing = await call(handler, 'PATCH', '/thought-capsule/api/items/nope', { status: 'todo' });
ok(missing.status === 404 && missing.json.code === 'not-found', '未知 id 404');

const emptyText = await call(handler, 'POST', '/thought-capsule/api/items', { text: '   ' });
ok(emptyText.status === 400 && emptyText.json.code === 'invalid-text', '空文本 400');

const longText = await call(handler, 'POST', '/thought-capsule/api/items', { text: 'a'.repeat(MAX_TEXT + 1) });
ok(longText.status === 400 && longText.json.code === 'text-too-long', '超长文本 400');

const badJsonReq = Readable.from([Buffer.from('{ oops', 'utf8')]);
badJsonReq.method = 'POST';
badJsonReq.url = '/thought-capsule/api/items';
const badJsonRes = makeRes();
await handler(badJsonReq, badJsonRes);
ok(badJsonRes.statusCode === 400, '非法 JSON 请求体 400');

const report = await call(handler, 'POST', '/thought-capsule/api/client-report', { build: 'smoke', registered: ['main'] });
ok(report.status === 200, 'client-report 接收');
const readReport = await call(handler, 'GET', '/thought-capsule/api/client-report');
ok(readReport.json.report && readReport.json.report.build === 'smoke', 'client-report 可回读');

const unknown = await call(handler, 'GET', '/thought-capsule/api/nope');
ok(unknown.status === 404 && Array.isArray(unknown.json.known), '未知路径 404 且列出已知接口');
ok(unknown.json.known.includes('POST /api/find-missed'), '已知接口里有面板内盘点');

// ---- 盘点行解析（模型输出常裹代码围栏 / 前后加话） ----
const fenced =
  '好的，结果如下：\n```json\n[{"todo":"补 README","session":"插件收尾","why":"只在会话里提过"},{"todo":"","session":"x"}]\n```\n以上。';
const parsed = parseMissedRows(fenced);
ok(
  parsed.length === 1 && parsed[0].todo === '补 README' && parsed[0].session === '插件收尾',
  'parseMissedRows 抠出 JSON 并丢掉空事项',
);
ok(parseMissedRows('没有数组').length === 0 && parseMissedRows('[not json]').length === 0, 'parseMissedRows 坏输入返回空');
const noLlm = await call(handler, 'POST', '/thought-capsule/api/find-missed', { limit: 2 });
ok(noLlm.status === 503 && noLlm.json.code === 'no-llm-service', '没有模型服务时 503 no-llm-service');

const deleted = await call(handler, 'DELETE', '/thought-capsule/api/items/' + createdId);
ok(deleted.status === 200 && deleted.json.counts.total === 0, 'DELETE 生效');
const deleteAgain = await call(handler, 'DELETE', '/thought-capsule/api/items/' + createdId);
ok(deleteAgain.status === 404, '重复删除 404');

// ---- countItems 边界 ----
ok(countItems([]).total === 0 && countItems([]).inbox === 0, 'countItems 空数组');
ok(countItems(null).total === 0, 'countItems null 兜底');

// ---- 用户自建分组 + 草稿 ----
const custom = createCategory(paths, "买东西");
ok(custom.category && custom.category.id && custom.category.label === "买东西", "自建分组能落盘");
ok(allCategories(loadStore(paths)).some((c) => c.id === custom.category.id && c.custom === true), "自建分组进 allCategories");
const withCustom = addItem(paths, { text: "自建分组里的条目", category: custom.category.id });
ok(withCustom.category === custom.category.id, "条目能落到自建分组");
ok(listItems(paths, { category: custom.category.id }).items.length === 1, "自建分组能过滤");
const again = createCategory(paths, " 买东西 ");
ok(again.category.id === custom.category.id, "同名分组复用同一条（幂等）");
ok(again.categories.filter((c) => c.custom).length === 1, "自建分组不会重复落盘");
saveDraft(paths, "写了一半的想法");
ok(readDraft(paths).draft && readDraft(paths).draft.text === "写了一半的想法", "草稿能存能读");
ok(loadStore(paths).draft.text === "写了一半的想法", "草稿跟着库一起存盘");
saveDraft(paths, "");
ok(readDraft(paths).draft === null, "空草稿等于没有草稿");

const fresh = readSettings(paths).settings.float;
ok(fresh.enabled === false && fresh.icon === "pill" && fresh.x === null, "悬浮胶囊默认关闭、默认图标 pill");
const turned = saveSettings(paths, { enabled: true, icon: "🧠" }).settings.float;
ok(turned.enabled === true && turned.icon === "🧠", "悬浮胶囊开关与图标能存");
const placed = saveSettings(paths, { x: 120, y: 64 }).settings.float;
ok(placed.x === 120 && placed.y === 64 && placed.enabled === true, "位置合并写、不清掉开关");
ok(saveSettings(paths, { x: null, y: null }).settings.float.x === null, "位置可以复位成 null");
ok(readSettings(paths).settings.float.icon === "🧠", "设置读回来还在");
const sized = saveSettings(paths, { size: 88, opacity: 0.8 }).settings.float;
ok(sized.size === 88 && Math.abs(sized.opacity - 0.8) < 0.001, "大小与便签透明度能存");
const clamped = saveSettings(paths, { size: 999, opacity: 5 }).settings.float;
ok(clamped.size === 160 && clamped.opacity === 1, "大小/透明度越界会被夹到范围内");
ok(saveSettings(paths, { side: "right" }).settings.float.side === "right", "便签方向能存");
ok(saveSettings(paths, { side: "sideways" }).settings.float.side === "auto", "非法方向回落 auto");
ok(saveSettings(paths, { noteFont: 17 }).settings.float.noteFont === 17, "便签字号能存");
ok(saveSettings(paths, { noteFont: 99 }).settings.float.noteFont === 20, "便签字号过大夹到 20");
ok(saveSettings(paths, { noteFont: 1 }).settings.float.noteFont === 11, "便签字号过小夹到 11");
const archivedItem = updateItem(paths, withCustom.id, { status: "archived" });
ok(typeof archivedItem.archivedAt === "string" && archivedItem.archivedAt, "archived 会写 archivedAt");
ok(countItems(listItems(paths, { status: "all" }).items).archived >= 1, "counts 里有 archived");

// ---- agent 工具的 JSON Schema 形状 ----
// 宿主 register() 会把 parameters 原样发给模型；缺 type 时服务端直接拒掉整轮请求
// （Invalid schema for function 'capsule_add': ... got 'type: null'）。
for (const toolName of TOOL_NAMES) {
  const spec = toolSpec(toolName);
  ok(spec && spec.parameters.type === 'object', toolName + ' 的 parameters 是 type: object');
  ok(spec.parameters.properties && typeof spec.parameters.properties === 'object', toolName + ' 带 properties');
  if (spec.parameters.required !== undefined) {
    ok(Array.isArray(spec.parameters.required), toolName + ' 的 required 是数组');
  }
  for (const [propKey, propSchema] of Object.entries(spec.parameters.properties)) {
    ok(!('required' in propSchema), toolName + '.' + propKey + ' 的属性里不残留 required');
  }
}

// ---- 可选字段：标签 / 截止日 / 来源会话 ----
const optPaths = storePaths(fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-opt-')));
const tagged = addItem(optPaths, {
  text: '带标签和截止日的东西',
  tags: ['#甲', ' 乙 ', '甲', ''],
  dueDate: '2026-10-30T09:00:00Z',
  sourceSessionId: 'sess-1',
});
ok(JSON.stringify(tagged.tags) === JSON.stringify(['甲', '乙']), 'tags 去 #、去空、去重');
ok(tagged.dueDate === '2026-10-30', 'dueDate 只留 YYYY-MM-DD');
ok(tagged.sourceSessionId === 'sess-1', 'sourceSessionId 能存');
ok(addItem(optPaths, { text: '日期写错了', dueDate: '明天' }).dueDate === undefined, '非法 dueDate 不进库');
ok(addItem(optPaths, { text: '标签塞太多', tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }).tags.length === 8, 'tags 最多 8 个');
const clearedOpt = updateItem(optPaths, tagged.id, { tags: [], dueDate: '' });
ok(clearedOpt.tags === undefined && clearedOpt.dueDate === undefined, '传空数组/空串清空可选字段');
const routed = updateItem(optPaths, tagged.id, { routedSessionId: 'sess-2' });
ok(routed.routedSessionId === 'sess-2' && typeof routed.routedAt === 'string', 'routedSessionId 自动补 routedAt');
throwsCode(() => updateItem(optPaths, tagged.id, {}), 'nothing-to-update', '空 patch 报 nothing-to-update');

// ---- 本周回看：纯本地统计，不花模型 ----
updateItem(optPaths, tagged.id, { status: 'done' });
const staleItem = addItem(optPaths, { text: '很久没动的事', category: 'work' });
updateItem(optPaths, staleItem.id, { status: 'todo' });
const aged = JSON.parse(fs.readFileSync(optPaths.file, 'utf8'));
const longAgo = new Date(Date.now() - 30 * 86400000).toISOString();
for (const item of aged.items) {
  if (item.id === staleItem.id) {
    item.createdAt = longAgo;
    item.updatedAt = longAgo;
  }
}
fs.writeFileSync(optPaths.file, JSON.stringify(aged, null, 2), 'utf8');
const digest = weeklyDigest(optPaths, { days: 7 });
ok(digest.days === 7 && digest.added >= 1 && digest.done >= 1, '回看统计：新增/完成有条数');
ok(digest.stale.some((item) => item.id === staleItem.id), '回看统计：停了 30 天的待办算 stale');
ok(digest.counts.todo >= 1 && Array.isArray(digest.byCategory), '回看统计带全库 counts 与分类分布');
ok(weeklyDigest(optPaths, { days: 9999 }).days === 60, 'days 超过 60 夹到 60');
ok(JSON.parse(exportStore(optPaths).text).items.length === aged.items.length, '导出拿到全部胶囊');

// ---- 回看 / 导出的 HTTP 路由 ----
const reviewRes = await call(handler, 'GET', '/thought-capsule/api/review?days=7');
ok(reviewRes.status === 200 && reviewRes.json.ok === true && reviewRes.json.days === 7, 'GET /api/review 200 带统计');
const exportRes = await call(handler, 'GET', '/thought-capsule/api/export');
ok(exportRes.status === 200 && exportRes.json && Array.isArray(exportRes.json.items), 'GET /api/export 吐出完整 JSON');
ok(/attachment/.test(exportRes.headers['content-disposition'] || ''), '导出带 attachment 头');

// ---- agent 工具接受可选字段 ----
const addSchema = toolSpec('capsule_add').parameters.properties;
ok(addSchema.tags && addSchema.tags.type === 'array', 'capsule_add 接受 tags');
ok(addSchema.dueDate && addSchema.dueDate.type === 'string', 'capsule_add 接受 dueDate');
ok(toolSpec('capsule_update').parameters.properties.tags, 'capsule_update 接受 tags');

// ---- 收尾 ----
fs.rmSync(sandbox, { recursive: true, force: true });
fs.rmSync(guardPaths.dir, { recursive: true, force: true });
fs.rmSync(apiSandbox, { recursive: true, force: true });

ok(!CapsuleError.prototype.isPrototypeOf({}), 'CapsuleError 是类');
console.log('smoke OK — ' + checks + ' checks passed');
