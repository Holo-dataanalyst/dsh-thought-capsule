/**
 * 命令行入口的最窄检查：真起一个子进程跑 lib/cli.js，落在临时目录，绝不碰真实 profile。
 * 跑法：node test/cli.mjs  → 退出码 0 即通过。
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'cli.js');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-cli-'));
let checks = 0;

/** 跑一次 CLI，返回 { stdout, stderr, code }（不因非 0 退出抛错）。 */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args, '--data', sandbox], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_HOME: '' },
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.status ?? 1 };
  }
}

function ok(cond, label) {
  assert.ok(cond, label);
  checks += 1;
}

// ---- add / list ----
const added = run(['add', '试试 better-sidebar 插件', '--tag', 'dsh']);
ok(added.code === 0, 'add 退出 0');
ok(added.stdout.includes('已记下'), 'add 打印回执');
ok(!added.stdout.includes('false'), 'add 不夹带 JSON 开关的返回值');

const first = JSON.parse(run(['list', '--json']).stdout);
ok(first.items.length === 1, 'list 看到 1 条');
ok(first.items[0].category === 'tools', '自动分类命中 tools');
ok(first.items[0].tags[0] === 'dsh', 'tags 落盘');
const id = first.items[0].id;

// ---- update ----
ok(run(['update', id, '-s', 'todo']).stdout.includes('待办'), 'update 状态生效');
ok(JSON.parse(run(['list', '-s', 'todo', '--json']).stdout).items.length === 1, 'list -s todo 过滤到');
ok(run(['update', id, '--text', '改成这句']).stdout.includes('改成这句'), 'update 文字生效');

// ---- 只读命令 ----
ok(run(['path']).stdout.trim().endsWith('.dsh-thought-capsule'), 'path 指向数据目录');
ok(JSON.parse(run(['categories', '--json']).stdout).some((c) => c.id === 'tools'), 'categories 含内置分类');
ok(JSON.parse(run(['export']).stdout).items.length === 1, 'export 输出整份 JSON');

// ---- 错误路径 ----
ok(run(['update', 'no-such-id', '-s', 'done']).code === 1, '未知 id 退出 1');
ok(run(['frobnicate']).code === 2, '未知命令退出 2');
ok(run(['add']).code === 2, 'add 空内容退出 2');
ok(run(['update']).code === 2, 'update 无 id 退出 2');
ok(run(['--help']).stdout.includes('dsh-thought-capsule add'), '--help 打印用法');

// ---- 空库不报错 ----
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-cli-empty-'));
const emptyRun = execFileSync(process.execPath, [cli, 'list', '--data', empty], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
ok(emptyRun.includes('没有符合条件的胶囊'), '空库 list 正常返回');
fs.rmSync(empty, { recursive: true, force: true });

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('cli OK — ' + checks + ' checks passed');
