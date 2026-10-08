# 滚动条迁移记录（scrollbar-overlay backlog）

原存量清单（110 处滚动面 / 74 个文件）**已全部处理完毕**，本文件从待办清单转为迁移记录：
保留判定口径与结论，供后续新增滚动面时对照。

## 统一做法

仓库滚动条样式只有两个入口，都在 `src/styles/_mixins.scss`，由 `vite.config.mts` 的
`additionalData` 全局注入 —— 任何 `<style lang="scss">` 里直接 `@include`，无需 import：

| mixin | 用在哪儿 | 效果 |
| --- | --- | --- |
| `scrollbar-overlay` | 正文、列表、代码区等有高度的滚动面 | 轨道透明，滑块靠 3px 透明描边收窄成 4px 悬浮胶囊，颜色走 `color-mix(... var(--text-muted) ...)`，四套主题都可见 |
| `scrollbar-hidden`（本轮新增） | 行高容不下滚动条的面：tab 条、chip 行、逐行滚动的代码行 | 只滚不画（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`） |

两处都是**裸调用**，不传参。

## 判定口径

1. 紧跟 `overflow` 声明写 `@include`，不要手抄规则。
2. 只滚横向、外层已有纵向滚动器的面 → `overflow: auto hidden` 再套 `scrollbar-overlay`。
   横向滚动条占掉的高度会变成纵向溢出，画出一条滑块铺满轨道的幽灵纵向滚动条；
   这个坑在 `MarkdownViewer` / `CodeViewer` / `SessionContextTaskPanel` 的注释里都记过。
3. 矮行文本条继续隐藏滚动条，不要画 10px 轨道 —— 轨道会吃掉文本高度。
   先例：`ToolDiffViewer` 的 `.grep-text`、`SideTaskPanel`、`TerminalTabBar`、`ProfileCards`。
4. 恒定深色面板（`BashToolCard` / `TaskOutputToolCard` 的 `.terminal-content`，底色硬编码
   `#0d1117`）保持现有 `#30363d` 滑块，**不要**换成主题变量 —— 那里写死是对的。
5. `white-space: pre-wrap` + `word-break` 的块（`ToolCallCard` 的 `.code-block`、
   `McpServerEditor` 的 `.json-example`、`AgentTimeline` 的同型块）**不动**：
   内容会自动换行，根本不会横向溢出，那条 `overflow-x: auto` 是残留声明。
6. 每批改完跑 `npm run build && npm run test`（AGENTS.md 的门禁）。

## 本轮落点

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| y / xy 滚动面 → `scrollbar-overlay` | 98 | 原清单主体，全部裸调用 |
| 纯横向 → `overflow: auto hidden` + `scrollbar-overlay` | 2 | `ImSettings` 的 `pre`、`DesignSystemPreviewModal` 的 `:deep(pre)` |
| 纯横向 → `scrollbar-hidden` | 8 | `amp-tabs` · `asp-agent-strip` · `install-tabs` · `publisher-row` · `agent-strip` · `sds-tabs` · `teammate-tabs` · `diff-content` |
| 纯横向 → 判定后不动 | 2 | 见口径 5：`ToolCallCard` 的 `.code-block`、`McpServerEditor` 的 `.json-example` |
| 局部 `@mixin scrollbar-thin` 清理 | 2 | `explorer/SessionList`、`layout/Sidebar` 各删掉一份与全局同名但参数不同的定义（6px / `--surface-border`），调用点统一走 `scrollbar-overlay`，消除遮蔽隐患 |
| 按**规则**复核新增 | 5 | `SettingsPanel` 的 `.sidebar-nav`（hidden）· `ChatInput` 的 `.inline-editor` 与 `.dropdown-list` · `MessageSelector` 的 `.message-list` · `TaskOutputToolCard` 的 `.raw-output-text`（走 `scrollbar-overlay`：`--code-bg` 是主题变量，并非口径 4 说的硬编码深色面） |

合计 `@include scrollbar-overlay` 106 处、`@include scrollbar-hidden` 9 处，涉及 81 个文件。

## 复核方式

按文件扫描会漏（同一文件里第二个未处理的滚动面不报），复核脚本改成**逐规则**判定：
解析 `<style>` 块的花括号树，凡规则自身声明了 `overflow*: auto|scroll`，就要求它自己的声明里
有 `@include scrollbar*` / `scrollbar-width` / `scrollbar-gutter`，或其子选择器里带 `scrollbar`。
残留的两条即口径 5，另有两条是脚本的已知误报（`MarkdownRenderer` 里 JS 注释中的字面量
`<style>`；`CodeViewer` 的 `.edit-textarea` 拆成两条规则，滚动条由另一条上的 mixin 提供）。
产物侧也抽查过：`dist/assets` 里这些选择器都确实生成了 `::-webkit-scrollbar` 规则。

## 顺带记录的两类坑

- `<style scoped>` 不带 `lang="scss"` 时，`additionalData` 不生效，写进去的 `@include` 会被当成
  未知 at-rule 原样输出并被浏览器丢弃 —— 静默失效，滚动条照旧是原生的，而且 `npm run build`
  一路绿灯、毫无告警。本轮补了 3 个：`chat/CodeRewindConfirmDialog`、
  `chat/tools/PermissionRequestCard`、`settings/BrowserUseLiveView`。新增滚动面时先确认样式块语言。
- 清单里有两个文件当前**没有被任何地方引用**（`chat/ToolCallCard.vue`、
  `settings/BrowserUseLiveView.vue`，产物中也找不到其作用域样式）。改动本身正确但运行时不生效，
  想确认效果别在这两个组件上找。

## 未做（有意留给后续）

- `layout/Sidebar.vue` 还有一份与全局重名的局部 `@mixin flex-center`，本轮只按清单处理滚动条，未动。
- 既有 27 处 `scrollbar-overlay` 用法与本轮 98 处一致，均为裸调用；`scrollbar` / `scrollbar-thin`
  两个旧 mixin 仍在 `_mixins.scss` 里被若干文件使用，未做统一收敛。
