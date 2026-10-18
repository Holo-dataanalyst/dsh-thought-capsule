#!/usr/bin/env node
/**
 * 命令行入口：`dsh-thought-capsule <cmd>`（装好后也可 `npx dsh-thought-capsule`）。
 *
 * 面板走 HTTP、Agent 走工具，这里走同一份 capsules.json —— 三者读写同一个文件，
 * 所以不另写一套存储，直接复用 store.js。
 *
 * 数据目录解析顺序（第一项生效）：
 *   --data <dir>  >  --profile <name>（$DSH_HOME/profiles/<name>）  >  $DSH_HOME  >  ~/.dsh
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import {
  addItem,
  allCategories,
  errorMessage,
  exportStore,
  listItems,
  loadStore,
  resolveBaseDir,
  STATUSES,
  storePaths,
  updateItem,
} from './store.js';

const USAGE = `思维胶囊命令行

用法:
  dsh-thought-capsule add <内容...>     记一条（默认进「未整理」）
  dsh-thought-capsule list              列胶囊
  dsh-thought-capsule update <id>       改文字 / 分类 / 状态
  dsh-thought-capsule categories        列分类
  dsh-thought-capsule path              打印数据目录
  dsh-thought-capsule export            导出整份 JSON

公共选项:
  --data <dir>        数据目录（默认 $DSH_HOME 或 ~/.dsh）
  --profile <name>    按 DSH 档案取目录（$DSH_HOME/profiles/<name>）
  --json              输出 JSON

add:     -c/--category <id>  --tag <t>（可重复）  --due <YYYY-MM-DD>
list:    -s/--status <${STATUSES.join('|')}>  -c/--category <id>  -n/--limit <n>
update:  --text <新文字>  -c/--category <id>  -s/--status <状态>  --tag <t>（可重复，替换全部）

状态: inbox=未整理  todo=待办  done=已完成  archived=归档`;

/** @param {string} name @returns {string} */
function env(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {{ data?: string, profile?: string }} opts
 * @returns {{ dir: string, file: string, backup: string }}
 */
function pathsFrom(opts) {
  if (opts.data) return storePaths(path.resolve(opts.data));
  if (opts.profile) {
    const home = env('DSH_HOME') || path.join(os.homedir(), '.dsh');
    return storePaths(path.join(path.resolve(home), 'profiles', opts.profile));
  }
  return storePaths(resolveBaseDir({}));
}

/**
 * @param {string} status
 * @returns {string}
 */
function statusZh(status) {
  return (
    { inbox: '未整理', todo: '待办', done: '已完成', archived: '已归档' }[status] || status
  );
}

/**
 * @param {any} item
 * @returns {string}
 */
function line(item) {
  const flags = [statusZh(item.status), item.category];
  if (item.dueDate) flags.push('到期 ' + item.dueDate);
  if (item.tags && item.tags.length) flags.push(item.tags.map((t) => '#' + t).join(' '));
  const head = flags.join(' · ');
  const when = (item.createdAt || '').slice(0, 10);
  return `${item.id}  [${head}]  ${when}\n    ${item.text.replace(/\n/g, '\n    ')}`;
}

/**
 * 数据文件还不存在不是错误（第一次就是空的），但必须说清「我找的是哪个目录」——
 * 否则换个 DSH_HOME 就静默列出空列表，看起来像数据丢了。
 * @param {{ file: string }} paths
 * @param {{ profile?: string }} opts
 * @param {string[]} argv
 */
function warnIfMissing(paths, opts, argv) {
  if (fs.existsSync(paths.file)) return;
  const home = env('DSH_HOME');
  let hint = `dsh-thought-capsule: 没读到数据文件 ${paths.file}\n`;
  if (argv.includes('--data')) {
    hint += '  --data 指的目录里还没有库；add 一条就会创建\n';
  } else if (opts.profile) {
    hint += home
      ? `  --profile 按 $DSH_HOME=${home} 解析；不对就用 --data <真实目录> 直接指\n`
      : `  $DSH_HOME 未设置，--profile 按 ${path.join(os.homedir(), '.dsh')} 解析；桌面端档案常在别的根下，用 --data <真实目录> 指\n`;
  } else {
    hint += '  桌面端数据在 profiles/<name>/.dsh-thought-capsule 下，用 --profile <name> 或 --data <dir> 指定\n';
  }
  process.stderr.write(hint);
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
async function main(argv) {
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  const command = argv[0];
  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        data: { type: 'string' },
        profile: { type: 'string' },
        json: { type: 'boolean', default: false },
        category: { type: 'string', short: 'c' },
        status: { type: 'string', short: 's' },
        limit: { type: 'string', short: 'n' },
        tag: { type: 'string', multiple: true },
        due: { type: 'string' },
        text: { type: 'string' },
      },
    });
  } catch (err) {
    process.stderr.write('dsh-thought-capsule: ' + errorMessage(err) + '\n\n' + USAGE + '\n');
    return 2;
  }
  const opts = parsed.values;
  const rest = parsed.positionals;
  const paths = pathsFrom(opts);
  const asJson = (value) => {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return 0;
  };

  switch (command) {
    case 'add': {
      const text = rest.join(' ').trim();
      if (!text) {
        process.stderr.write('dsh-thought-capsule: add 需要内容，例如 dsh-thought-capsule add "试试 better-sidebar"\n');
        return 2;
      }
      const item = addItem(paths, { text, category: opts.category, tags: opts.tag, dueDate: opts.due });
      if (opts.json) return asJson(item);
      process.stdout.write(`已记下 → ${statusZh(item.status)} · ${item.category}\n${item.id}\n`);
      return 0;
    }
    case 'list': {
      warnIfMissing(paths, opts, argv);
      const result = listItems(paths, {
        status: opts.status,
        category: opts.category,
        limit: opts.limit,
      });
      if (opts.json) return asJson(result);
      if (!result.items.length) {
        const counts = result.counts;
        process.stdout.write(
          `没有符合条件的胶囊（全部 ${result.total} 条：未整理 ${counts.inbox} / 待办 ${counts.todo} / 已完成 ${counts.done} / 归档 ${counts.archived}）\n`,
        );
        return 0;
      }
      process.stdout.write(
        result.items.map(line).join('\n\n') +
          `\n\n共 ${result.total} 条，未整理 ${result.counts.inbox} / 待办 ${result.counts.todo} / 已完成 ${result.counts.done} / 归档 ${result.counts.archived}\n`,
      );
      return 0;
    }
    case 'update': {
      const id = rest[0];
      if (!id) {
        process.stderr.write('dsh-thought-capsule: update 需要 id（先用 list 查）\n');
        return 2;
      }
      const patch = {};
      if (opts.text !== undefined) patch.text = opts.text;
      if (opts.category !== undefined) patch.category = opts.category;
      if (opts.status !== undefined) patch.status = opts.status;
      if (opts.tag !== undefined) patch.tags = opts.tag;
      const item = updateItem(paths, id, patch);
      if (opts.json) return asJson(item);
      process.stdout.write(`已更新 → ${statusZh(item.status)} · ${item.category}\n${line(item)}\n`);
      return 0;
    }
    case 'categories': {
      warnIfMissing(paths, opts, argv);
      return asJson(allCategories(loadStore(paths)));
    }
    case 'path': {
      process.stdout.write(paths.dir + '\n');
      return 0;
    }
    case 'export': {
      warnIfMissing(paths, opts, argv);
      process.stdout.write(exportStore(paths).text);
      return 0;
    }
    default:
      process.stderr.write(`dsh-thought-capsule: 未知命令 ${command}\n\n${USAGE}\n`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const text = errorMessage(err);
    process.stderr.write('dsh-thought-capsule: ' + text + '\n');
    process.exitCode = err && err.status === 404 ? 1 : 2;
  },
);
