/**
 * Agent 面工具：capsule_add / capsule_list / capsule_update。
 *
 * 刻意「只有加、查、改」，没有删除工具：删条目必须由用户在面板里二次确认，
 * 避免模型自作主张抹掉用户的记录。
 *
 * 这里**不 import 任何 @deepseek-ai 包**（也不用 defineTool）：profile 的 Node
 * 解析路径里不一定有宿主安装目录，import 会 MODULE_NOT_FOUND 并拖垮整个宿主半边。
 * 工具描述就是普通数据，直接交给 ctx.tools.register。
 */
import { categoryLabel } from './classify.js';
import { addItem, allCategories, listItems, loadStore, updateItem } from './store.js';

const STATUS_LABELS = { inbox: '未整理', todo: '待办', done: '已完成', archived: '已归档' };

/** 工具描述表；category 接受内置 id 或用户自建的分组 id，写入时由 store 校验。 */
const TOOL_SPECS = [
  {
    "name": "capsule_add",
    "description": "把用户想到的一个点子、待办或待试的插件记进「思维胶囊」暂存箱（默认状态 inbox=未整理，按关键词自动分类，用户随后在左侧栏面板里整理）。当用户说\"记一下\"\"别忘了\"\"待会试试这个\"\"回头看看这个\"，或在干活时顺口提到某个插件/工具/链接/想法时调用。只记录用户实际说过的内容和关键细节，不要自行补全、改写或添加建议。",
    "parameters": {
      "text": {
        "type": "string",
        "description": "要记录的一句话，保留用户的原始说法和关键细节。",
        "required": true
      },
      "category": {
        "type": "string",
        "description": "可选分类 id：内置 tools/work/idea/read/life/other，或用户自建的分组 id。不传则按关键词自动判断。"
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "可选：用户自己说了的标签（最多 8 个，去掉 # 前缀）。用户没提就别加。"
      },
      "dueDate": {
        "type": "string",
        "description": "可选：截止日 YYYY-MM-DD，只记录不提醒。用户说了具体哪天再传。"
      }
    },
    "run": "add"
  },
  {
    "name": "capsule_list",
    "description": "列出「思维胶囊」里的记录（默认最多 20 条，按创建时间从新到旧）。用户问\"我记的那些东西呢\"\"还有什么没做\"\"今天记了什么\"时调用。返回每条的状态、分类、时间和完整 id；要改某条就用 capsule_update，并且必须用返回的完整 id。",
    "parameters": {
      "status": {
        "type": "string",
        "enum": [
          "inbox",
          "todo",
          "done",
          "archived",
          "all"
        ],
        "description": "按状态过滤：inbox=未整理、todo=待办、done=已完成、archived=已归档、all=全部。默认 all。"
      },
      "category": {
        "type": "string",
        "description": "可选：按分类 id 过滤（内置六个或用户自建分组）。"
      },
      "limit": {
        "type": "integer",
        "description": "最多返回几条，默认 20，范围 1–200。"
      }
    },
    "run": "list"
  },
  {
    "name": "capsule_update",
    "description": "修改一条「思维胶囊」记录：改文字、改分类，或移动状态（inbox 未整理 → todo 待办 → done 已完成 → archived 已归档）。先用 capsule_list 拿到完整 id。用户说\"这条我做完了\"\"这个归到工作\"\"把它挪到待办\"时调用。没有删除能力：用户要删某条时，告诉他去左侧栏胶囊面板里手动删除。",
    "parameters": {
      "id": {
        "type": "string",
        "description": "要修改的卡片 id（capsule_list 返回值里的完整 uuid）。",
        "required": true
      },
      "text": {
        "type": "string",
        "description": "可选：新的文字内容（会 trim 后覆盖原文字）。"
      },
      "category": {
        "type": "string",
        "description": "可选：新的分类 id（内置六个或用户自建分组）。"
      },
      "status": {
        "type": "string",
        "enum": [
          "inbox",
          "todo",
          "done",
          "archived"
        ],
        "description": "可选：新的状态。archived=归档（做完且不打算再看的事，带归档时间，仍可在面板里删除）。"
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "可选：整体替换标签（传 [] 就是清空）。"
      },
      "dueDate": {
        "type": "string",
        "description": "可选：新的截止日 YYYY-MM-DD；传空串清空。"
      }
    },
    "run": "update"
  }
];

/**
 * 分类显示名：内置六类走常量表，用户自建分组从库里取 label。
 *
 * @param {() => any} getPaths
 * @param {string} id
 */
function labelOf(getPaths, id) {
  try {
    const found = allCategories(loadStore(getPaths())).find((cat) => cat.id === id);
    if (found) return found.zh || found.id;
  } catch (err) {
    /* 读不到库就退化到 id */
  }
  return categoryLabel(id);
}

/** @param {string} text */
function textBlock(text) {
  return [{ type: 'text', text }];
}

/** @param {string} iso */
function shortTime(iso) {
  const raw = typeof iso === 'string' ? iso : '';
  return raw ? raw.slice(0, 16).replace('T', ' ') : '';
}

/**
 * 把上面的「属性表」编译成宿主 register() 认的 JSON Schema。
 *
 * register() 不像 defineTool 那样帮忙包一层：definition.parameters 会被原样
 * 序列化进模型请求。属性表直接传过去时没有 type，服务端就报
 * `Invalid schema for function "capsule_add": ... got "type: null"`，
 * 整轮请求都会失败（不是这个工具失败，是这条消息发不出去）。
 * 所以这里必须显式补 type/properties，并把属性里的 required: true 提到根上。
 *
 * @param {any} properties
 * @returns {{ type: 'object', properties: any, required?: string[] }}
 */
function propertyMapToJsonSchema(properties) {
  /** @type {Record<string, any>} */
  const props = {};
  /** @type {string[]} */
  const required = [];
  for (const key of Object.keys(properties)) {
    const prop = { ...properties[key] };
    if (prop.required === true) {
      required.push(key);
      delete prop.required;
    }
    props[key] = prop;
  }
  const schema = { type: 'object', properties: props };
  if (required.length > 0) schema.required = required;
  return schema;
}

/**
 * 取某个工具的描述对象（给测试与调试用）。
 * @param {string} name
 */
export function toolSpec(name) {
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) return undefined;
  return {
    name: spec.name,
    description: spec.description,
    parameters: propertyMapToJsonSchema(spec.parameters),
  };
}

export const TOOL_NAMES = TOOL_SPECS.map((s) => s.name);

/**
 * 把可选字段拼成「，标签：a/b，截止：2026-10-20」，没有就返回空串。
 * @param {any} item
 */
function extrasTail(item) {
  /** @type {string[]} */
  const parts = [];
  if (Array.isArray(item.tags) && item.tags.length) parts.push('标签：' + item.tags.join('/'));
  if (item.dueDate) parts.push('截止：' + item.dueDate);
  return parts.length ? '，' + parts.join('，') : '';
}

async function runAdd(args, getPaths) {
  const item = addItem(getPaths(), { text: args.text, category: args.category, tags: args.tags, dueDate: args.dueDate, source: 'agent' });
  return (
    '已记入思维胶囊（状态：' + STATUS_LABELS[item.status] + '，分类：' + labelOf(getPaths, item.category) + extrasTail(item) + '）\n' +
    'id: ' + item.id + '\n' +
    '内容：' + item.text
  );
}

async function runList(args, getPaths) {
  const result = listItems(getPaths(), {
    status: args.status || 'all',
    category: args.category,
    limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 20,
  });
  const counts = result.counts;
  const head =
    '思维胶囊：共 ' + counts.total + ' 条（未整理 ' + counts.inbox + ' / 待办 ' + counts.todo + ' / 已完成 ' + counts.done + ' / 已归档 ' + counts.archived + '），本次返回 ' + result.items.length + ' 条。';
  if (!result.items.length) return head + '\n（没有匹配的胶囊）';
  const lines = result.items.map((item, index) => {
    return (
      index + 1 + '. [' + STATUS_LABELS[item.status] + ' · ' + labelOf(getPaths, item.category) + ' · ' + shortTime(item.createdAt) + ' · ' + (item.source === 'agent' ? 'agent 记录' : '用户记录') + extrasTail(item) + ']\n' +
      '   ' + String(item.text).replace(/\r?\n/g, '\n   ') + '\n' +
      '   id: ' + item.id
    );
  });
  return head + '\n\n' + lines.join('\n\n');
}

async function runUpdate(args, getPaths) {
  const item = updateItem(getPaths(), args.id, {
    text: args.text,
    category: args.category,
    status: args.status,
    tags: args.tags,
    dueDate: args.dueDate,
  });
  return '已更新：状态=' + STATUS_LABELS[item.status] + '，分类=' + labelOf(getPaths, item.category) + extrasTail(item) + '\n内容：' + item.text + '\nid: ' + item.id;
}

const RUNNERS = { add: runAdd, list: runList, update: runUpdate };

/**
 * 注册三个工具，返回清理函数。
 *
 * @param {any} ctx 已能拿到 tools 服务的作用域
 * @param {() => { dir: string, file: string, backup: string }} getPaths
 * @returns {() => void}
 */
export function registerCapsuleTools(ctx, getPaths) {
  /** @type {Array<() => void>} */
  const disposers = [];

  for (const spec of TOOL_SPECS) {
    const run = RUNNERS[spec.run];
    const registration = {
      ...toolSpec(spec.name),
      output: {
        schema: { type: 'string' },
        render: (_args, value) => textBlock(String(value || '')),
      },
      execute: (args) => run(args && typeof args === 'object' ? args : {}, getPaths),
    };
    disposers.push(ctx.tools.register(registration));
  }

  return () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch (err) {
        /* noop */
      }
    }
    disposers.length = 0;
  };
}
