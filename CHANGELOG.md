# 变更记录

## 0.2.0 — 2026-10-19

新增命令行入口，插件不再只能在面板里用。

- **新增** `dsh-thought-capsule` 命令（`bin` → `lib/cli.js`）：`add` / `list` / `update` / `categories` / `path` / `export`，与面板、Agent 工具读写同一份 `capsules.json`
- **新增** 数据目录解析 `--data <dir>` / `--profile <name>`（`$DSH_HOME/profiles/<name>`），默认沿用 `$DSH_HOME` → `~/.dsh`
- **新增** `--json` 输出，方便脚本接
- **新增** `test/cli.mjs`（18 项检查），`npm test` 串起 smoke + cli
- **修复** `test/smoke.mjs` 的目录兜底断言受外部 `DSH_HOME` 影响
- **新增** `.gitignore`（`*.bak*` 等）与 `LICENSE`（MIT），不再把 `.bak` 文件推上仓库
- 版本 0.1.0 → 0.2.0

## 0.1.0 — 2026-10-18

首个公开版本：左侧栏面板（未整理 → 待办 → 已完成 → 归档、六内置分类 + 自建分组、搜索、本周回看、导出 JSON）、划词记下、悬浮便签、`capsule_add` / `capsule_list` / `capsule_update` 三个 Agent 工具。
