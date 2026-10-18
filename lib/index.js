/**
 * 宿主半边入口。
 *
 * 三件事：
 *   1. 注册 /thought-capsule 的 HTTP 路由（面板读写数据）
 *   2. 注册 capsule_add / capsule_list / capsule_update 三个 Agent 工具
 *   3. 往系统提示里加一段，告诉模型什么时候该记、什么时候该查
 *
 * 不导出 Config：本机 profile 下只解析得到 cosmokit / schemastery 两个 @deepseek-ai 包，
 * 为一个固定配置去引 schemastery 不值当，config 一律防御式读取。
 */
import { CATEGORIES } from './classify.js';
import { PREFIX, createHandler } from './routes.js';
import { registerCapsuleTools } from './tools.js';
import { resolveBaseDir, storePaths } from './store.js';

export const name = 'thought-capsule';
export const inject = ['webServer', 'systemPrompt'];

const PROMPT_NAME = 'plugin:dsh-thought-capsule';
const PROMPT_ORDER = 900;

/**
 * @param {any} config
 * @returns {{ enabled: boolean, announceToAgent: boolean, dataDir: string }}
 */
function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {};
  return {
    enabled: raw.enabled !== false,
    announceToAgent: raw.announceToAgent !== false,
    dataDir: typeof raw.dataDir === 'string' ? raw.dataDir : '',
  };
}

/**
 * @param {string} message
 * @param {any} [detail]
 */
function warn(message, detail) {
  try {
    console.warn('[dsh-thought-capsule] ' + message, detail === undefined ? '' : detail);
  } catch (err) {
    /* noop */
  }
}

function promptText() {
  const names = CATEGORIES.map((c) => c.id + '=' + c.zh).join('、');
  return [
    '「思维胶囊」(thought capsule) 是用户的低摩擦暂存箱，左侧栏有胶囊图标面板，数据是用户自己的。',
    '',
    '什么时候用：',
    '- 用户随口说“记一下 / 别忘了 / 待会试试这个 / 回头看看这个”时，调用 capsule_add 记一条，不要拒绝，也不要说你记不住。',
    '- 用户在干活时提到某个插件、工具、链接或想法，即使当前任务用不上，也值得 capsule_add 一条——这正是这个插件存在的理由（怕待会忘了）。',
    '- 用户问“我记的那些东西呢 / 还有什么没做 / 今天记了什么”时，调用 capsule_list 再回答。',
    '- 用户说某条已经做完、要改分类、要挪进待办时，先 capsule_list 拿到完整 id，再 capsule_update。',
    '',
    '纪律：',
    '- 记录时原样保留用户的关键细节（名字、链接、想验证什么），不要改写、补全或塞进自己的建议。',
    '- 不要替用户删除条目：胶囊没有给 Agent 删除工具，删除只能在面板里由用户自己确认。',
    '- 记录成功后一句话回执即可（含分类与状态），不要长篇复述。',
    '',
    '分类：六个内置分类，传 id —— ' + names + '。',
    '用户还能在面板里自建分组，id 形如 g-xxxxxxxx；capsule_list 结果里能看到当前全部分类。遇到没见过的分类 id 就是自建分组，照原样传回去，不要改成内置分类。',
    '状态：inbox=未整理、todo=待办、done=已完成、archived=归档（带归档时间；归档后只有用户能在面板里删除）。',
    '可选字段：tags（字符串数组，最多 8 个）、dueDate（YYYY-MM-DD，只记录不提醒）、sourceSessionId（这条来自哪个会话）。用户没提就别硬塞。',
    '',
    '面板里还有两件事不是工具，但对话里会碰到：',
    '- 「找我漏掉的待办」：宿主自己的模型扫用户最近的会话，列出可能漏掉的待办，由用户逐行决定存成胶囊或忽视。',
    '- 「转给 AI」：用户把某条胶囊（或当前列表）作为草稿放进会话输入框，不会自动发送。所以对话里出现“胶囊内容 + id”时，多半是用户从面板转过来的，直接用 capsule_list / capsule_update 接着干。',
  ].join('\n');
}

/**
 * @param {any} ctx
 * @param {any} [config]
 */
export function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  if (!cfg.enabled) {
    warn('disabled by config, nothing registered');
    return;
  }

  const getPaths = () => storePaths(resolveBaseDir({ config: cfg, ctx, env: process.env }));

  try {
    ctx.inject(['webServer'], (hostCtx) => {
      hostCtx.effect(() => {
        const handler = createHandler({ config: cfg, ctx });
        const dispose = hostCtx.webServer.register({ kind: 'prefix', path: PREFIX, handler });
        return () => {
          try {
            if (typeof dispose === 'function') dispose();
          } catch (err) {
            /* noop */
          }
        };
      }, 'dsh-thought-capsule: routes');
    });
  } catch (err) {
    warn('注册 HTTP 路由失败', err);
  }

  // 工具面是可选增强：任何失败（服务没起来、注册签名不匹配、运行期抛错）都只警告，
  // 绝不让它连累上面的 HTTP 路由与整个 profile 启动。
  try {
    ctx.inject(['tools'], (toolCtx) => {
      try {
        toolCtx.effect(() => registerCapsuleTools(toolCtx, getPaths), 'dsh-thought-capsule: tools');
      } catch (err) {
        warn('注册 agent 工具失败（面板不受影响）', err);
      }
    });
  } catch (err) {
    warn('注册 agent 工具失败（面板不受影响）', err);
  }

  if (cfg.announceToAgent) {
    try {
      const dispose = ctx.systemPrompt.section({ name: PROMPT_NAME, order: PROMPT_ORDER, text: promptText() });
      try {
        ctx.effect(
          () => () => {
            try {
              if (typeof dispose === 'function') dispose();
            } catch (err) {
              /* noop */
            }
          },
          'dsh-thought-capsule: prompt',
        );
      } catch (err) {
        /* 没有 effect 就靠宿主卸载时丢弃 */
      }
    } catch (err) {
      warn('注入系统提示失败（面板与工具不受影响）', err);
    }
  }
}
