# 思维胶囊 · 社区同类调研与改善方案

> 目的：回答「思维胶囊相比 DSH 社区已有插件和 GitHub 开源项目，相同点/不同点/可改善点」，并给出一份按价值排序的落地方案。
> 基线源码：`C:\Users\kaisa\.dsh\thought-capsule`（2026-10 现状）。文中所有社区结论均来自公开页面，链接附在末尾。

## 1. 一句话定位

思维胶囊 = **DSH 内的低摩擦灵感暂存箱 + AI 联动入口**：左侧栏面板（inbox/todo/done/archived）、桌面悬浮胶囊球（可拖动/换图/改大小/透明度/便签方向）、四类 Agent 工具、两条 AI 联动（「转给 AI」草稿注入、「找我漏掉的待办」宿主 `llm.stream` 扫会话）。

它最接近的生态位不是「笔记」（笔记/知识管理已被 dsh-md-notes、dsh-web-notes、dsh-notes-plugin 占满），而是 **GTD 里的 Capture（收集）+ Inbox（未整理）**，加上一层「让 AI 帮你把漏掉的待办捞回来」的社区独有能力。

## 2. 社区同类插件（DSH 生态，已核实）

| 插件 | 作者 | 形态 | 与思维胶囊的重叠点 | 它更强的地方 |
|---|---|---|---|---|
| [dsh-md-notes](https://github.com/XieZongChen/dsh-md-notes) | XieZongChen | MD 笔记管理器+编辑器 | 持久记录、按工作区分组 | 全文搜索（命中行高亮+跳行）、assistant 消息一键「写入笔记」、对话内 `@` 引用笔记注入模型上下文、Git 同步、i18n、设置面板、更新提示 |
| [dsh-notes-plugin](https://awesome-dsh-plugin.com/p/PPawnsir/dsh-notes-plugin--packages-dsh-notes-plugin) | PPawnsir | Apple Notes 风浮窗+桌面气泡 | 快速捕获、桌面气泡、todo | **页面选区捕获**（选中即存 quote）、10 分钟内连续捕获自动合并、虚拟文件夹、约定类笔记自动注入系统提示（inject/injectRole/injectTo）、**待办一键 dispatch 到活跃会话**（注入召回上下文+指令并唤醒）、LLM 异步推断 topic、宿主服务全部 `ctx.get` + 存在性守卫降级 |
| [dsh-web-notes](https://github.com/Shrbuz/dsh-web-notes) | Shrbuz | 右侧可拖浮动笔记本图标 + slide-over 面板 | 悬浮可拖图标、草稿不丢 | **选区「Save as note」气泡**（跟随滚动）、**一键插入 composer**（官方 `ctx.conversation.input.for(actx).setDraft`，无会话则复制剪贴板）、每会话/全局作用域 tabs、**设置命名空间 + Settings → Plugins 设置卡**（改完即生效免重启）、关面板自动存草稿（只有显式 Cancel 才丢）、触屏 44px 目标适配 |
| [dsh-todo-list](https://dshplugin.online/plugins/perry-ai--dsh-todo-list) | perry-ai | 待办管理 | 待办状态管理 | 截止日期、紧迫/重要度、5W1H 详情弹窗（可拖）、从对话/通知/公告/邮件识别事项、多选确认后才写入 |
| [dsh-session-notes](https://awesome-dsh-plugin.com/p/dsboylw/LazyNoobsCockloft--dsh-session-notes) / [dsh-session-note](https://deepseekplugins.org/plugins/makechange/dsh-session-note) | dsboylw / makechange | 按会话挂编号便签、右下角 `shell.overlay` 卡片 | 与思维胶囊共用 `shell.overlay` 席位 | 每个会话独立便签、概览可点击跳回会话、一键复制 prompt；是官方教学级示例（host 路由 + client slot 的最小范式） |
| dsh-memory 家族： [dsh-memory-notes](https://dshmp.com/en/plugins/dsh-memory-notes) / [dsh-memory](https://dshplugin.online/plugins/zhouzhencheng07--dsh-memory) / [dsh-memory-vault](https://github.com/flymysql/dsh-memory) / [@plur-ai/dsh](https://github.com/plur-ai/dsh-plugin) / 灵枢 lingshu / memsearch | 多作者 | 跨会话记忆 | 「Agent 侧读写同一份本地数据」 | 系统提示**注入**（plur 明确论证注入比工具调用可靠：工具 schema 每请求都计费、模型可能忽略提示）、block 级检索+时间衰减+可选向量、`memory_write` 宿主进程直写（read-only 会话也能用） |

生态位事实：本机运行的 profile（`E:\AI\DSHTauri\.dsh\profiles\core-021-3`）已装 `@furongjun1999/dsh-memory`（灵枢）、`@linxin666/dsh-client-ui-task-board`（5 列看板 + Cron + 真 agent 执行）、`@openviking/dsh-memory-plugin`、`@mengyuly/dsh-ponytail` 等——**「任务看板」和「跨会话记忆」都已经被占位**。思维胶囊若往这两个方向长，就是重复造轮子；它的差异化必须留在「灵感/暂存/低摩擦」。

## 3. GitHub 开源同类（跨生态，取设计灵感）

| 项目 | 一句话定位 | 值得抄的设计 |
|---|---|---|
| [Mindwtr](https://github.com/dongdongbh/Mindwtr) | 本地优先 GTD（全平台） | **Capture→Clarify→Organize→Reflect→Engage 的完整闭环**；全局热键捕获；Inbox 引导式整理（2 分钟法则）；周回顾向导；本地 REST API + MCP server 让 AI 管同一份任务 |
| [neuron-cli](https://github.com/steevin/neuron-cli) | 终端本地优先知识管理（Obsidian 兼容） | `neuron capture "想法"` 一行落盘、不开编辑器；**先存后整理**（capture → inbox → 归档到目录）；Markdown 是唯一真相源，可换编辑器 |
| [bin](https://github.com/Plynth-Labs/bin-selfhost) | 自托管「agent 可读的捕获 inbox」 | 单一 inbox + `source: app/agent/email` 字段区分来源；archive 时记录 `routed_to`（**归档=被路由到某处**）；一个 token 授权 |
| [cortex / crtxboard](https://github.com/moguls753/cortex) | 自托管个人记忆板（Telegram/web/MCP 捕获） | 低摩擦多端捕获 + LLM 五分类（带置信度）+ 低置信度内联按钮让用户一键改分类；daily/weekly digest 主动回看 |
| [OpenNapse](https://github.com/Xelson431/OpenNapse) | 开源「灵感→项目」工作区 | 一键 dump 原始灵感、promote 成项目、可换存储适配器、BYOK、无账号无遥测 |
| [tda](https://github.com/davidB/todoapp) | 本地优先任务树（人+AI 共用一个 backlog） | 同一个数据源人和 agent 都能操作；捕获速度优先于一切 |

## 4. 相同点与不同点

### 4.1 相同点（大家都有，属于「及格线」）
- 本地持久化、单用户、数据在自己机器上（capsules.json / md / sqlite）。
- 快速捕获优先：一个输入框/一个热键/一个悬浮按钮，Enter 即存。
- 状态机 + 分类/标签：inbox→todo→done、四态/五态、分类分组。
- Agent 可读写：工具或 MCP。
- 悬浮/桌面常驻入口。

### 4.2 思维胶囊已经领先的（差异化，要守住）
1. **AI 联动是双向的**：既能「把胶囊转给 AI」（草稿注入不自动发送，用户最后确认），又能「让 AI 扫近期会话找回漏掉的待办」并**在面板里以表格呈现**、行可忽视/可存胶囊/可跳转来源会话。社区里 dsh-notes-plugin 只有单向 dispatch；没有任何同类做「反向扫描」。
2. **宿主 `llm.stream` 直调**：扫描不走新会话、不烧 agent 循环，71 秒出结果，面板内完成。
3. **悬浮胶囊球**：可拖、可换图（含本地上传 data URL）、大小/透明度/便签方向（auto/left/right/above/below）全可存。
4. **自建分组 + 半截草稿自动保存**（社区里 dsh-web-notes 也有草稿保护，但自建分组少见）。
5. **Agent 面刻意不给删除工具**：删除只能用户在面板二次确认——这是对「模型抹掉用户记录」的主动防御。

### 4.3 明显短板（按影响排序）
| # | 短板 | 证据（本仓库） | 谁已经做好了 |
|---|---|---|---|
| 1 | **面板没有搜索** | `lib/client.js` 无搜索相关代码 | dsh-md-notes（命中行高亮）、dsh-web-notes、dsh-notes-plugin 全有 |
| 2 | **没有 Settings → Plugins 设置卡** | `lib/index.js` 只有 enabled/announceToAgent/dataDir；悬浮球设置只活在面板/球里 | dsh-web-notes（`notes` 命名空间，改完即生效）、dsh-memory（配置卡热重载） |
| 3 | **没有页面选区捕获** | 客户端无 selection 监听 | dsh-web-notes（气泡跟随滚动）、dsh-notes-plugin（选中即存 quote） |
| 4 | **系统提示落后于实现** | `lib/index.js:64-65` 仍写「分类（固定六种）」「状态：inbox/todo/done」 | ——（自身不一致，直接改） |
| 5 | **没有导出/备份** | 只有本地 JSON，无导出入口 | dsh-md-notes（Git 同步）、dsh-notes-plugin（import/export） |
| 6 | **归档 = 黑洞** | archived 之后只能删或改回，没有「归档=已处理」的出路 | bin 的 `routed_to`、Mindwtr 的 Reflect/周回顾 |
| 7 | **没有「今天/本周该回看」的主动提醒** | 无 digest/回顾视图 | cortex 的 daily/weekly digest、Mindwtr 的 weekly review |
| 8 | **Agent 工具只覆盖单机语义**：无 tag/截止日/来源会话 | `lib/tools.js` 三个工具 | dsh-todo-list（截止日+紧迫度）、bin（source 字段）、lingshu（来源溯源） |
| 9 | **面板无快捷键**（新建/保存/切 tab） | 只有 Enter 保存 | Mindwtr 全局热键、dsh-notes-plugin Alt+N |
| 10 | 移动端/触屏目标偏小 | 悬浮球与图标按钮 < 44px | dsh-web-notes 明确做了 44px 适配 |

## 5. 改善方案（按「低摩擦捕获 + 聚焦 DSH」目标排序）

### P0 — 一行文案级修复，先做（30 分钟内）
1. **修系统提示**（`lib/index.js:48-67`）：改为「分类：六内置 + 用户自建分组（id 形如 `g-xxxxxxxx`，用 `capsule_list` 可见）」「状态：inbox/todo/done/archived（archived 带归档时间，仅面板可删）」；补两条：胶囊可被「找我漏掉的待办」扫描、可被「转给 AI」引用。
   - 为什么优先：这是「Agent 知道插件真实能力」的唯一通道，落后等于自废武功。
2. **补导出**：`GET /api/export`（直接吐 capsules.json）+ 面板设置里「导出 JSON」。不需要 Git 同步（那是 dsh-md-notes 的战场），一个文件导出 + 已有原子写（tmp+rename+回读）已经够安全。

### P1 — 把「捕获」做到社区水准（1–2 天）
3. **面板搜索框**：本地过滤（text/category/status/时间），输入即滤；结果数显示在 tabs 计数旁。不需要全文索引——单用户数据量 < 千条，`Array.filter` 足够（ponytail：不上索引）。
4. **页面选区捕获**：客户端监听 `selectionchange`，非空选区在选区附近渲染「存为胶囊」气泡（`getBoundingClientRect` + `scroll` 重定位，参照 dsh-web-notes 的做法），点击 `POST /api/items {text, category:'read'}`。默认开启、设置里可关。
5. **设置卡**：注册 `thoughtCapsule` settings 命名空间（`enabled` / `selectionCapture` / `floatEnabled` / `floatSize` / `floatOpacity` / `noteSide`），让悬浮球的那堆设置出现在 Settings → Plugins；当前 `GET/PUT /api/settings` 已经存了 float，只是缺一个宿主侧 namespace + 设置卡 slot（`settings.plugin.item`，key 用 `thought-capsule`，参考 dsh-memory 的做法）。

### P2 — 让「聚焦 DSH 使用」成立（2–4 天）
6. **胶囊带来源会话**：新增 `sourceSessionId`（面板「转给 AI」和选区捕获时自动带；Agent 工具也接受可选参数）。卡片上渲染「来自会话 X」并可点击跳转（已有 `uiWorkspace.openSession`）。
7. **「回看」digest**：面板右上加「本周回看」→ 复用 `POST /api/find-missed` 的 digest 机制，但 prompt 改为「把本周新增/完成/归档的胶囊按分类汇总成表 + 指出超过 7 天没动过的待办」。这才是 Mindwtr Reflect 的轻量版，且完全不需要新会话。
8. **Agent 工具补 3 个可选字段**：`tags: string[]`、`dueDate`、`sourceSessionId`（都可选，向后兼容）。不做截止日提醒（那是 dsh-todo-list 的战场），只做「能记录、能过滤」。
9. **快捷键**：面板内 `Ctrl/Cmd+K` 聚焦输入框、`Ctrl/Cmd+Enter` 保存、`Alt+C` 显示/隐藏悬浮球（dsh-notes-plugin 用 Alt+N，可错开）。

### P3 — 可选增强（一周+）
10. 归档出路：archived 卡片上「已处理/已转出」标记（对应 bin 的 `routed_to`），避免归档变黑洞。
11. 触屏适配：悬浮球 hitbox 扩到 ≥44px（视觉大小仍可小），面板按钮最小 32px。
12. MCP/CLI 只读导出（`GET /api/export` 已有，加一个 `thought-capsule list` 子命令即可，参考 Mindwtr 的 local REST API + CLI）。

## 6. 明确不做（避免长成别人的插件）
- 不做笔记/知识图谱/全文检索引擎 → dsh-md-notes、lingshu 的战场。
- 不做任务看板/Cron/自动执行 → 本机已装 dsh-client-ui-task-board。
- 不做跨会话记忆注入 → 本机已装灵枢 + openviking + plur 同类。
- 不做 Git 同步/冲突解决 → dsh-md-notes；一个「导出 JSON」+ 原子写足够。
- 不做截止日/提醒/通知 → dsh-todo-list。

## 7. 建议落地顺序
1. P0.1 修系统提示（立刻，纯收益）
2. P0.2 导出
3. P1.3 面板搜索
4. P1.4 选区捕获
5. P1.5 设置卡
6. P2.6/P2.7 来源会话 + 本周回看
7. 其余按用户反馈

## 参考链接
- DSH 生态：[dsh-md-notes](https://github.com/XieZongChen/dsh-md-notes) ・ [dsh-notes-plugin](https://awesome-dsh-plugin.com/p/PPawnsir/dsh-notes-plugin--packages-dsh-notes-plugin) ・ [dsh-web-notes](https://github.com/Shrbuz/dsh-web-notes) ・ [dsh-todo-list](https://dshplugin.online/plugins/perry-ai--dsh-todo-list) ・ [dsh-session-notes](https://awesome-dsh-plugin.com/p/dsboylw/LazyNoobsCockloft--dsh-session-notes) ・ [dsh-session-note](https://deepseekplugins.org/plugins/makechange/dsh-session-note) ・ [dsh-memory-notes](https://dshmp.com/en/plugins/dsh-memory-notes) ・ [dsh-memory](https://dshplugin.online/plugins/zhouzhencheng07--dsh-memory) ・ [dsh-memory-vault](https://github.com/flymysql/dsh-memory) ・ [@plur-ai/dsh](https://github.com/plur-ai/dsh-plugin)
- GitHub 开源：[Mindwtr](https://github.com/dongdongbh/Mindwtr) ・ [neuron-cli](https://github.com/steevin/neuron-cli) ・ [bin](https://github.com/Plynth-Labs/bin-selfhost) ・ [cortex](https://github.com/moguls753/cortex) ・ [OpenNapse](https://github.com/Xelson431/OpenNapse) ・ [tda](https://github.com/davidB/todoapp)

## 8. 落地状态（2026-10-18 本轮）

已落地并验证（`node test\smoke.mjs` → 138 checks；`client-report` build `2026-10-18T23:45-ui17`、`registered:["shell.overlay","shell.overlay","sidebar.panellist","main","plugins.bundle.config"]`、`failures:[]`）：

| 项 | 状态 | 落地方式 |
| --- | --- | --- |
| P0.1 系统提示 | ✅ | 分类=六内置 + 自建 `g-xxxxxxxx`；状态含 `archived`（带时间、仅面板可删）；补了「胶囊可被扫 / 可被转给 AI」两条 |
| P0.2 导出 | ✅ | `GET /api/export` 原样吐 `capsules.json`（attachment 头）+ 设置面板「导出 JSON」 |
| P1.3 面板搜索 | ✅ | 本地 `Array.filter`，作用在 `visible` 上，只搜当前页签+分类；Ctrl/Cmd+K 或 `/` 聚焦 |
| P1.4 划词捕获 | ✅ | `shell.overlay` 第二个席位 `SelectionBubble`，选中 2 字以上就浮「记下来」，存成 `read` 胶囊并带会话；开关 `settings.float.capture` **默认关**（聊天里划词复制很常见，默认开等于到处冒泡），⚙ 与设置卡里开 |
| P1.5 设置卡 | ✅ | 注册官方 keyed 席位 `plugins.bundle.config`，`key:'dsh-thought-capsule'`，落在 `设置→插件→本插件` 页上；卡里是悬浮球/划词/大小/透明度/方向/导出，读写仍是那份 `/api/settings`（不另开 settings 命名空间，少一份配置源） |
| P2.6 来源会话 | ✅ | `sourceSessionId`（转给 AI / 划词时自动带）、`routedSessionId`+`routedAt`（转出去过哪条）；卡片显示「来自会话 / 已转给会话」，点击 `openSession` |
| P2.7 本周回看 | ✅ 但改了做法 | `GET /api/review?days=7` 纯本地统计（新增/完成/归档/分类分布/超 N 天没动），**不调模型**——这些数是确定性的，走 `llm.stream` 只会多等 70 秒还可能编数 |
| P2.8 工具可选字段 | ✅ | `capsule_add`/`capsule_update` 加 `tags`（≤8、去 `#`）、`dueDate`（只存 YYYY-MM-DD）、`sourceSessionId`，向后兼容 |
| P2.9 快捷键 | ✅ | Ctrl/Cmd+K・`/` 聚焦搜索、Ctrl/Cmd+E 聚焦输入、Ctrl/Cmd+Enter 保存、Esc 逐层收起、`Alt+C` 显示/隐藏悬浮球（在输入框/可编辑区里打字时不抢键） |
| P3.10 归档出路 | ✅ | 归档卡片标「已转给会话 X」；`capsule_update` 记 `routedSessionId` |
| P3.11 触屏 44px | ✅ | 一组 `@media (pointer:coarse)`：按钮/页签/分类片/段控 ≥44px 高，图标按钮 44×44；鼠标环境仍是紧凑尺寸 |
| P3.12 CLI/只读导出 | ✅ 等价 | 导出路由就是只读出口，`Invoke-RestMethod .../api/export` 即可备份，不另做 CLI |

仍未做（文档里划为「明确不做」的照旧不做）：全文索引、任务看板、跨会话记忆注入、Git 同步、截止日提醒通知。

## 9. 第二轮（2026-10-18 夜，按胶囊反馈）

| 反馈 | 落地 |
| --- | --- |
| 悬浮便签白底要黑字/黑底要白字 | 便签不再吃宿主继承色：`.tc-float-wrap` 自铺 `--tc-*` 变量，`textarea` 显式 `background:var(--tc-card); color:var(--tc-fg)` |
| 便签字号可调 | 新设置 `settings.float.noteFont`（11–20，默认 13），⚙ 与设置卡里都有滑块 |
| 转给 AI 后默认已完成 | 发送成功即 `routedSessionId/routedAt` + `status:'done'`（已在 done/archived 的只记转出） |
| 转出去别带上其他胶囊 | 文本只由当前目标生成（单条=那一条，批量=你勾的那几条），草稿里的列表不再混入勾选池 |
| 批量交给 AI | 「待办」页签里勾选 → 批量条（全选/清空/转给 AI），一次带上多条 |
| 胶囊可二次编辑 | 卡片 ✎ 就地切 textarea + 改分类，`Enter` 存 / `Esc` 取消（走 `PATCH /api/items/:id`） |
| 选工作区后只显示该工作区会话 | 会话选择器按工作区过滤；另给「新会话放哪个工作区」 |
| 转出文本含完整信息 | 每条带 `id / 状态 / 分类 / 来源会话 / 标签 / 截止 / 更新时间`，多条按编号分隔 |
