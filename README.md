# 思维胶囊（dsh-thought-capsule）

干活时脑子里冒出来的点子、待试的插件、要回头查的东西，一句话丢进去；左侧栏胶囊图标里整理成**未整理 → 待办 → 已完成 → 归档**，六种固定分类自动归类，也能建自己的分组。
面板里有搜索、**本周回看**（这周新增/完成/停了 7 天没动的待办）、**导出 JSON**；读长文时划一段话会在选区旁边浮出「记下来」，一键存成「阅读」胶囊。
Agent 也有 `capsule_add / capsule_list / capsule_update` 三个工具（**没有删除工具**，删条目只能由用户自己在面板确认）。

> 第一次用：直接看 [docs/tutorial.md](docs/tutorial.md)（五分钟上手 + 五个场景 + 常见问题）。

## 现在装在哪（重要）

| 项 | 路径 |
| --- | --- |
| 源码（改这里） | `C:\Users\kaisa\.dsh\thought-capsule` |
| 安装副本（宿主读这里） | `E:\AI\DSHTauri\thought-capsule` |
| 接线 profile（真正在跑的） | `E:\AI\DSHTauri\.dsh\profiles\core-021-4`（会随桌面端切换而变；以 `GET /api/health` 的 `dir` 为准，`scripts\install.mjs` 自动挑 `.harness.pid` 最新的那份，可用 `--profile` 指定） |
| junction | `<profile>\node_modules\dsh-thought-capsule` → 安装副本 |
| 数据 | `<profileContext.dir>\.dsh-thought-capsule\capsules.json`（配置 `dataDir` 可覆盖） |
| 备份（改 profile 前自动留） | `<profile>\package.json.bak-thought-capsule` |

> 只改源码不够：宿主读的是安装副本。改完跑一次 `node scripts\install.mjs`，再重启 DSH 桌面端。

## 快速开始

1. 接线（只需一次）：`node scripts\install.mjs` → 重启 DSH 桌面端。
2. 入口：左侧栏的胶囊图标打开面板；或在面板 ⚙ 里打开悬浮球，点它弹便签。
3. 记一条：面板上方输入框写完按 `Enter`（`Shift+Enter` 换行），进「未整理」。

典型用法：

- **随手记**：对话里说「记一下：试试 better-sidebar 插件」，Agent 会调 `capsule_add`；也可以直接写进面板输入框。
- **整理**：卡片底部的四段状态点一下就挪（未整理 / 待办 / 完成 / 归档）；✎ 就地改文字与分类。
- **交给 AI**：单条点「转给 AI」，或勾多条点「批量转给 AI」→ 选工作区与会话 → 「准备提交」只把内容放进那条会话的输入框、不自动发送；转出去之后这条自动变「已完成」并记下转给了谁。
- **找回漏掉的**：面板右上「找漏掉的待办」，读最近会话列出可能忘掉的事，逐行「存胶囊」或「忽视」。
- **回看**：页签右边「本周回看」，看这周新增/完成和停了 N 天的待办。

## 常见问题

- **刷新后没看到新功能**：客户端 bundle 在页面加载时取，`Ctrl+R` 刷一次；还不对就看 `GET /thought-capsule/api/client-report` 的 `build` 与 `failures`。
- **左侧栏没有胶囊图标**：`client-report` 404 → 宿主半边没加载（查 profile 接线与 junction）；`slotsResolved:false` → 席位名不对。
- **数据到底写在哪**：`GET /api/health` 里的 `dir` 就是真实目录；想换地方，在插件 config 里设 `dataDir`。
- **悬浮球挡事**：拖动它，或在 ⚙ / 设置卡里调大小与不透明度；`Alt+C` 快速隐藏（焦点在输入框时不抢键）。
- **划词没反应**：划词捕获默认关，在 ⚙ 或设置卡里打开；选区至少 2 个字。
- **为什么 Agent 不能删胶囊**：故意不提供删除工具，删除只能在面板里二次确认。
- **改完代码不生效**：先 `node scripts\install.mjs` 同步安装副本（宿主读的是 `E:\AI\DSHTauri\thought-capsule`），再重启桌面端。

## 为什么上一次「重启后没出现胶囊」

两个坑叠在一起，都已修：

1. **接错了 profile**。插件被接进了 `profiles\core-021`，而本机真正在跑的是 `profiles\tauri`（它的 `node_modules\plugin-reviewer` 指向 `E:\AI\DSHTauri\plugin-manager`）。那个 profile 永远不启动，插件自然从不加载。`scripts\install.mjs` 的默认 `--profile` 已改成 tauri。
2. **宿主包 import 在本机解析不到**。DSH 用**普通 Node ESM** 求值插件，没有为插件装 resolve hook；`E:` 盘上的安装目录不在宿主安装目录的解析家族里，从 `profiles\tauri\package.json` 解析 `@deepseek-ai/dsh-tools` 直接 `MODULE_NOT_FOUND`。原 `lib/tools.js` 第一行就 import 了它 → 整个宿主半边起不来，连 HTTP 路由都没有。
   - 已改成：工具描述就是普通数据对象，直接交给 `ctx.tools.register`，**不 import 任何 `@deepseek-ai` 包**。
   - `lib/index.js` 里工具注册整段包了 try/catch：工具面挂了只 warn，面板与路由不受影响。
   - 本机铁律：这样挂在 profile 上的插件，node 半边不要 `import '@deepseek-ai/...'`（`plugin-manager` 能跑就是因为一个都没 import）。

## 已验证 / 未验证

已验证（可重复执行）：
- `node --check` 全部通过；`node test\smoke.mjs` → `smoke OK — 138 checks passed`。
- 用真实锚点（`profiles\tauri\package.json` 的 `createRequire().resolve.paths`）解析并 import 宿主半边：导出 `apply/inject/name`，无宿主包依赖，`apply` 依次注册 → 路由 → 工具 → 系统提示。
- 起本地 http 服务跑真实请求：`GET /api/health` 200、`POST /api/items` 201（自动分类 tools）、`GET /api/state`、`PATCH /api/items/:id`（inbox→todo）、`POST /api/client-report` 200；磁盘文件落盘状态一致。
- 三个工具直接调 `execute`：`capsule_add`（自动分类 工作/插件工具）、`capsule_list`（统计 + 完整 id）、`capsule_update`（inbox→done），`output.render` 输出 text 块。
- 浏览器半边已真的跑起来：`GET /thought-capsule/api/client-report` 回 `build:"…-ui16"`、`slotsResolved:true`、`registered:["shell.overlay","shell.overlay","sidebar.panellist","main","plugins.bundle.config"]`、`failures:[]`（悬浮胶囊 + 划词气泡两个 overlay 席位、侧栏图标、主面板、插件设置卡都挂上了）。
- 真宿主上的新路由：`GET /api/review?days=7` 回真实统计（`added/done/archived/byCategory/stale/counts`），`GET /api/export` 回整库 JSON。

排障用的 `/api/client-report` 判读：404 → 宿主半边没加载（查 profile 接线、junction、桌面端确实重启了）；`{applied:false}` → client.js 求值了但 `apply` 没被调用（`dsh.client.inject` 服务名要再核）；`slotsResolved:false` → 席位名不对。

## 接口

prefix `/thought-capsule`：`GET /api/health`、`GET /api/state`、`POST /api/items`、`PATCH /api/items/:id`、`DELETE /api/items/:id`、`POST /api/client-report`（自检）、`GET /api/sessions`（已落盘、未归档的会话按工作区分组，带 `defaultWorkspaceId`，给「转给 AI」的选择器）、`GET /api/workspaces`（全部工作区，含空工作区，给「新会话放哪个工作区」当选项）、`GET /api/scan`（把最近的用户消息清成一份「盘点遗漏待办」的 prompt）、`POST /api/find-missed`（面板内直接问宿主模型，回 `rows:[{todo,session,why}]`）、`GET /api/review?days=7`（本周回看统计：新增/完成/归档/分类分布/停了 N 天没动的待办）、`GET /api/export`（原样吐出 `capsules.json`，带 attachment 头，当备份用）、`GET|PUT /api/settings`（悬浮胶囊：`enabled/icon/x/y/size/opacity/noteFont/side/capture`）、`POST /api/categories`、`GET|PUT /api/draft`。
分类 id：内置 `tools work idea read life other` + 用户自建 `g-xxxxxxxx`；状态：`inbox todo done archived`（`archived` 带 `archivedAt`，仍可 DELETE）。
胶囊可选字段：`tags`（最多 8 个、自动去 `#`）、`dueDate`（只存 `YYYY-MM-DD`，不做提醒）、`sourceSessionId`（来源会话，转给 AI / 划词捕获时自动带）、`routedSessionId` + `routedAt`（转出去过哪条会话）。

### 面板里能做的事

- **搜索**：输入框上方那一行，边打边筛（本地 `Array.filter`，不建索引），只搜当前页签 + 当前分类；清空即恢复。
- **本周回看**：页签右边的小按钮，纯本地统计——这周新增、完成、归档各几条，哪个分类最活跃，哪些待办超 7 天没动。不调模型，所以瞬时；要 AI 写点评再给 `weeklyDigest` 加一段 `askModel`。
- **划词捕获**：读网页/文档时选中一段话（至少 2 字），选区旁边浮出「记下来」小气泡，一点就存成「阅读」胶囊并带上来源会话；拖动/滚动即收起。设置里可开（`settings.float.capture`，**默认关**——聊天里划词复制太常见，默认开等于到处冒泡）。
- **导出 JSON**：设置面板里的「导出 JSON」= `GET /api/export`，整库原样落下，换设备/备份用。
- **归档**：卡片状态段里的「归档」= 做完但先不删，进「归档」页，带归档时间；归档页里可以移回待办或删除。
- **转给 AI**：卡片上的「转给 AI」按钮。正文 = 这条胶囊 + 你补的一句话 + 其余所有胶囊（当背景，告诉 AI 可用 `capsule_list`/`capsule_update`）。选好目标（新会话 / 某个已有会话，按未归档工作区分组）后点 **「准备提交」**：本插件用 `sessions.retain(id,{source:'controllerOperation'})` 拿到 binding，再调 `conversation.input.requestDraftInitialization(binding, {prompt})` 把正文放进那条会话的输入框并打开它，**不发送**——你在会话界面确认后自己按回车。
- **悬浮胶囊**：面板右上角 ⚙ →「在桌面上显示彩色思维胶囊」。它注册在 `shell.overlay` 席位，是 `position:fixed` 的彩色小球；点一下弹便签、`Enter`/「保存」即进「未整理」，再点收起；按住可拖动，位置、大小、便签透明度、图标都存进库（`settings.float`，图标可选内置 emoji 或上传一张 <100 KB 的图）。便签和设置面板的开向默认 `side:'auto'`：胶囊在屏幕左半边就往右展开，右半边往左展开；也可以在 ⚙ 里固定成上/下/左/右。真·系统桌面/桌宠级别的悬浮窗属于 Tauri 窗口层，网页半边做不到；要和别的桌宠共存就只留一个。`Alt+C` 也能开关它（焦点在输入框/可编辑区时不抢键）。
- **设置卡**：`设置 → 插件 → dsh-thought-capsule` 的插件页里有一张卡（注册在官方 keyed 席位 `plugins.bundle.config`），开关悬浮球 / 划词捕获、调大小与不透明度、选展开方向、导出 JSON。它和面板右上角 ⚙ 读写的是同一份 `/api/settings`，改完互相广播。
- **找我漏掉的待办**（面板右上角）：`POST /api/find-missed` 读宿主 sessionQuery 的最近会话（滤掉宿主注入的上下文噪音），用宿主自己的 `agentDefaultModel` 路由问一次模型，要回 JSON 数组，面板里直接渲染成表格（事项 / 出自会话 / 判断依据），表里的会话名可点 `openSession` 跳过去。全程不新开会话。

## 已知取舍

- `resolveBaseDir` 回落顺序 `config.dataDir → ctx.get('profileContext').dir → $DSH_HOME → ~/.dsh`。首次加载时若 `profileContext` 未就绪，数据会落到 `~/.dsh`；看一眼 `health.dir` 即可确认。
- 存储层同步 fs + 单进程假设（`lib/store.js` 里已标 ponytail）。
- `lib/client.js` 顶部有一条模块级自检上报（`phase:'factory'`），排障用；正常运行只是多一条 POST。

## 改动流程

```powershell
cd C:\Users\kaisa\.dsh\thought-capsule
node test\smoke.mjs          # 138 checks，必须 exit 0
node scripts\install.mjs     # 同步到 E:\AI\DSHTauri\thought-capsule 并接线 profile（幂等）
# 重启 DSH 桌面端，再验 health / client-report
```

## 回滚

删掉 `profiles\tauri\package.json` 里的 `dsh-thought-capsule`（dependencies 一行 + bundles 一项）与 junction，或直接恢复 `package.json.bak-thought-capsule`，然后重启桌面端。
