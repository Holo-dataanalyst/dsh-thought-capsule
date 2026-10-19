# 思维胶囊（dsh-thought-capsule）

干活时脑子里冒出来的点子、待试的插件、要回头查的东西，一句话丢进去；左侧栏胶囊图标里整理成**未整理 → 待办 → 已完成 → 归档**，六种固定分类自动归类，也能建自己的分组。
面板里有搜索、**本周回看**（这周新增/完成/停了 7 天没动的待办）、**导出 JSON**；读长文时划一段话会在选区旁边浮出「记下来」，一键存成「阅读」胶囊。
Agent 也有 `capsule_add / capsule_list / capsule_update` 三个工具（**没有删除工具**，删条目只能由用户自己在面板确认）。

> 第一次用：直接看 [docs/tutorial.md](docs/tutorial.md)（五分钟上手 + 五个场景 + 常见问题）。

## 安装

```bash
# 跟随 main
dsh plugin --profile <档案> add github:Holo-dataanalyst/dsh-thought-capsule

# 钉死某个 Release 的 tag（推荐）
dsh plugin --profile <档案> add github:Holo-dataanalyst/dsh-thought-capsule#v0.2.2

# 不装 git 也行：直接装 Release 附件
dsh plugin --profile <档案> add https://github.com/Holo-dataanalyst/dsh-thought-capsule/releases/download/v0.2.2/dsh-thought-capsule-0.2.2.tgz
```

装完重启 DSH。要求 DSH `>= 0.1.7-rc.2`（`dsh.engines` 会挡旧版本）、Node `>= 22`。

也可以从插件市场里搜 `thought-capsule` 一键安装。

## 快速开始

1. 入口：左侧栏的胶囊图标打开面板；或在面板 ⚙ 里打开悬浮球，点它弹便签。
2. 记一条：面板上方输入框写完按 `Enter`（`Shift+Enter` 换行），进「未整理」。
3. 整理：卡片底部的四段状态点一下就挪；✎ 就地改文字与分类。

典型用法：

- **随手记**：对话里说「记一下：试试 better-sidebar 插件」，Agent 会调 `capsule_add`；也可以直接写进面板输入框。
- **交给 AI**：单条点「转给 AI」，或勾多条点「批量转给 AI」→ 选工作区与会话 → 「准备提交」只把内容放进那条会话的输入框、不自动发送；转出去之后这条自动变「已完成」并记下转给了谁。
- **找回漏掉的**：面板右上「找漏掉的待办」，读最近会话列出可能忘掉的事，逐行「存胶囊」或「忽视」。
- **回看**：页签右边「本周回看」，看这周新增/完成和停了 N 天的待办。

## 命令行

装好后就有 `dsh-thought-capsule` 命令（`bin` → `lib/cli.js`），跟面板、Agent 工具读写同一份 `capsules.json`：

```bash
dsh-thought-capsule add "试试 better-sidebar 插件"      # 记一条，自动分类
dsh-thought-capsule add "周五交汇报" -c work --due 2026-10-23 --tag 汇报
dsh-thought-capsule list                                # 全部（默认 20 条）
dsh-thought-capsule list -s todo -n 5                   # 待办 5 条
dsh-thought-capsule update <id> -s done                 # 挪到已完成
dsh-thought-capsule categories                          # 分类表
dsh-thought-capsule path                                # 打印数据目录
dsh-thought-capsule export > capsules.json              # 导出整份
```

- 数据目录：`--data <dir>` > `--profile <name>`（`$DSH_HOME/profiles/<name>`）> `$DSH_HOME` > `~/.dsh`。
- 桌面端档案常在别的根下，`$DSH_HOME` 不在环境里时用 `--data` 直接指到 `<profile>` 目录；找错目录时命令会把「我找的是哪个文件」打到 stderr，不会静默给空列表。
- 读命令都支持 `--json`。

## 数据与备份

- 数据文件：`<profile 目录>/.dsh-thought-capsule/capsules.json`（单文件，纯 JSON），配置 `dataDir` 可覆盖。
- 实际路径看 `GET /thought-capsule/api/health` 返回的 `dir` / `file`。
- 备份：设置里点「导出 JSON」下载整库；换机器时放回同名位置即可。
- 写入方式是「备份旧文件 → 临时文件 + 改名 → 回读校验」，写坏了自动用 `.bak` 恢复。

## 常见问题

- **刷新后没看到新功能**：客户端 bundle 在页面加载时取，`Ctrl+R` 刷一次；还不对就看 `GET /thought-capsule/api/client-report` 的 `build` 与 `failures`。
- **左侧栏没有胶囊图标**：`client-report` 404 → 宿主半边没加载（查 profile 接线与 junction）；`slotsResolved:false` → 席位名不对。
- **数据到底写在哪**：`GET /api/health` 里的 `dir` 就是真实目录；想换地方，在插件 config 里设 `dataDir`。
- **悬浮球挡事**：拖动它，或在 ⚙ / 设置卡里调大小与不透明度；`Alt+C` 快速隐藏（焦点在输入框时不抢键）。
- **划词没反应**：划词捕获默认关，在 ⚙ 或设置卡里打开；选区至少 2 个字。
- **为什么 Agent 不能删胶囊**：故意不提供删除工具，删除只能在面板里二次确认。

## 面板里能做的事

- **搜索**：输入框上方那一行，边打边筛（本地 `Array.filter`，不建索引），只搜当前页签 + 当前分类；清空即恢复。
- **本周回看**：页签右边的小按钮，纯本地统计——这周新增、完成、归档各几条，哪个分类最活跃，哪些待办超 7 天没动。不调模型，所以瞬时。
- **划词捕获**：读网页/文档时选中一段话（至少 2 字），选区旁边浮出「记下来」小气泡，一点就存成「阅读」胶囊并带上来源会话；拖动/滚动即收起。设置里可开（`settings.float.capture`，**默认关**）。
- **导出 JSON**：设置面板里的「导出 JSON」= `GET /api/export`，整库原样落下，换设备/备份用。
- **归档**：卡片状态段里的「归档」= 做完但先不删，进「归档」页，带归档时间；归档页里可以移回待办或删除。
- **转给 AI**：选好目标（新会话 / 某个已有会话，按未归档工作区分组）后点「准备提交」，正文进那条会话的输入框并打开它，**不发送**。
- **悬浮胶囊**：面板右上角 ⚙ →「在桌面上显示彩色思维胶囊」。`shell.overlay` 席位上的彩色小球，点一下弹便签，可拖动，位置/大小/透明度/图标存在库里。
- **设置卡**：`设置 → 插件 → dsh-thought-capsule` 的插件页卡片（官方 keyed 席位 `plugins.bundle.config`），和面板 ⚙ 读写同一份 `/api/settings`。
- **找我漏掉的待办**：`POST /api/find-missed` 读最近会话（滤掉宿主注入的上下文噪音），用宿主默认模型问一次，面板里直接渲染成表格（事项 / 出自会话 / 判断依据）。全程不新开会话。

## 接口

prefix `/thought-capsule`：`GET /api/health`、`GET /api/state`、`POST /api/items`、`PATCH /api/items/:id`、`DELETE /api/items/:id`、`POST /api/client-report`（自检）、`GET /api/sessions`、`GET /api/workspaces`、`GET /api/scan`、`POST /api/find-missed`、`GET /api/review?days=7`、`GET /api/export`、`GET|PUT /api/settings`、`POST /api/categories`、`GET|PUT /api/draft`。

分类 id：内置 `tools work idea read life other` + 用户自建 `g-xxxxxxxx`；状态：`inbox todo done archived`（`archived` 带 `archivedAt`，仍可 DELETE）。
胶囊可选字段：`tags`（最多 8 个、自动去 `#`）、`dueDate`（只存 `YYYY-MM-DD`，不做提醒）、`sourceSessionId`、`routedSessionId` + `routedAt`。

## 开发

```bash
npm test        # smoke + cli，必须 exit 0
```

- `lib/index.js` 宿主半边：注册路由、工具、系统提示。
- `lib/client.js` 浏览器半边：面板、悬浮球、划词气泡。
- `lib/store.js` 存储；`lib/routes.js` HTTP 路由；`lib/classify.js` 关键词分类。
- 宿主半边**不 import 任何 `@deepseek-ai` 包**：工具描述就是普通数据对象，直接交给 `ctx.tools.register`。
- 客户端改动后刷新页面即生效（bundle 在页面加载时取）。

## 许可

MIT，见 [LICENSE](LICENSE)。
