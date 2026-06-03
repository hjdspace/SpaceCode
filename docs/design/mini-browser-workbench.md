# 设计文档：右侧微型浏览器 + 输出联动工作台（类 Codex）

> 状态：设计阶段（仅设计，不含实现）
> 版本：v0.4.4 基线
> 关联截图：Codex App 的「框选 / 样式 tooltip / 评论浮条」交互

---

## 1. 背景与目标

Codex 桌面端在右侧提供了一个「微型浏览器 + 可视化改稿」工作台，体验上有三层：

1. **基础浏览**：地址栏、默认显示当前页（本地 HTML 或 localhost）、截图后直接送进输入框。
2. **可视化交互**：像 Chrome Inspector 一样**框选元素**（按 DOM 树逐级），选中后就地改文字/颜色，或写一段修改描述。
3. **输出拦截**：Agent 输出若是 HTML/Markdown/localhost，会引导到右侧工作台打开。

我们项目（SpaceCode，Electron + Vue3）已经具备**半个微型浏览器**，但 Agent 输出与右侧工作区**没有联动**。本设计的目标：**复用现有 webview + 输入框链路，补齐四个 MVP 功能点**，达到 Codex 同等的「看到→框选→改稿→发送」闭环。

### 1.1 MVP 范围（已与需求方确认）

| # | 功能点 | 一句话 |
|---|---|---|
| F1 | **localhost 链接联动右侧浏览器** | Agent 输出的 `localhost:5173` 这类地址能在右侧微型浏览器打开 |
| F2 | **截图发送到输入框** | webview 区域截图 / 整页截图 → 复用 `insertImageChip` 塞进输入框 |
| F3 | **元素框选 + 样式 tooltip** | 注入式 inspector，hover/点击选元素，显示 tag/color/font/尺寸 |
| F4 | **选中元素整合发送** | 元素区域截图 + DOM 信息 + 评论文字，合并成一条消息回传输入框 |

### 1.2 确认的关键决策

- **框选实现**：webview 注入 inspector 脚本（非第三方标注库）。
- **输出联动方式**：消息内显示「在工作台打开」按钮（手动点击，不自动弹出）。
- **截图范围**：`webview.capturePage()` 整页 + 按 boundingRect 裁剪元素区域（不引入桌面级 desktopCapturer）。

---

## 2. 现状基线（可直接复用的资产）

调研已确认以下能力**已存在**，本设计在其之上增量开发，不重构架构。

### 2.1 微型浏览器（已实现约 70%）

- `<webview>` 已启用：`electron/main.ts` 的 `webPreferences.webviewTag: true`。
- 完整 webview UI：`src/components/layout/InfoPanel.vue:60-84`
  - 地址栏（`url-input`）、前进/后退/刷新、在系统浏览器打开。
  - 事件：`did-navigate / page-title-updated / did-start-loading / did-fail-load`。
  - `partition="persist:webview-session"`，无 `preload`、未开 `nodeintegration`。
- 状态管理：`src/stores/app.ts`
  - `openWebview / navigateWebview / goBackWebview / goForwardWebview / closeWebview`
  - `webviewUrl / webviewHistory / currentHistoryIndex / webviewTitle / isLoading`
  - 标签类型 `InfoPanelTabType = 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview'`

### 2.2 输入框 / 图片附件（已实现 100%）

- 输入框：`src/components/chat/ChatInput.vue`
  - `insertImageChip(image)`（约 1478 行）：把图片以 chip 形式插入 contenteditable。
  - `ImageAttachment` 结构：`{ id, name, type:'image', mimeType, previewUrl, data }`，`data` 为 base64 data URL。
  - `collectAllAttachments()` / `handleSend()` 收集并发出 `emit('send', content, attachments)`。
- 发送链路：`ChatPanel.handleSend` → `chat.ts:sendMessage` → `preload.claudeCode.sendMessage` → `electron/sessionProcess.ts:sendMessage`
  - 主进程 `saveImageToTemp()` 把 base64 落盘到 `~/.claude/uploads/{sessionId}/`，生成 `@"path"` 引用拼进消息。

### 2.3 输出渲染 / 链接识别（已实现，需小改）

- `src/components/common/MarkdownRenderer.vue`
  - `isExternalURL()`（241 行）：**当前把 `localhost`/`127.0.0.1` 判为非外链** → 不进 webview（F1 要改这里）。
  - `handleLinkClick()`（约 277 行）：外链 → `appStore.openWebview(href)`；文件链接 → `appStore.openFile()`。

### 2.4 缺口总览

| 能力 | 现状 |
|---|---|
| localhost 进 webview | ❌ 被 `isExternalURL` 排除 |
| webview 截图 | ❌ 无 `capturePage` 调用 |
| 元素框选 / inspector | ❌ 无 |
| webview→宿主 数据通道 | ❌ webview 无 preload |
| 输出「在工作台打开」按钮 | ❌ 无 |

---

## 3. 总体架构

```
┌───────────────────────── 渲染进程 (Vue) ─────────────────────────┐
│                                                                   │
│  ChatPanel / MessageItem                    InfoPanel (webview)   │
│   └ MarkdownRenderer                          ├ webview-nav       │
│      ├ isExternalURL(含 localhost) ──F1──┐    ├ <webview          │
│      └ 「在工作台打开」按钮 ─────────────┼──▶  │    preload=inspector-preload.js  ←F3 新增 │
│                                          │    │    @ipc-message />  │
│                                          ▼    ├ 工具条: [截图][框选] ←F2/F3 │
│   ChatInput.insertImageChip ◀──F2/F4── BrowserToolbar/合成器      │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
            ▲ executeJavaScript(注入 inspector)     │ capturePage()
            │ sendToHost(选中数据)                   ▼
┌──────────────── webview 客体页面 (用户的 localhost 站点) ──────────┐
│  inspector overlay: hover 高亮 / 点击锁定 / DOM 树上下钻           │
│  读取 getComputedStyle + getBoundingClientRect → sendToHost       │
└───────────────────────────────────────────────────────────────────┘
```

核心思想：**webview 是宿主与客体两个世界**。注入脚本跑在客体页里，通过新增的 webview `preload` 暴露的 `ipcRenderer.sendToHost` 把选中数据推回宿主；宿主用 `webview.capturePage()` 截图、用 `webview.executeJavaScript()` 注入/控制 inspector。

---

## 4. 功能点详细设计

### F1 — localhost 链接联动右侧浏览器

**目标**：Agent 输出 `http://localhost:5173`、`127.0.0.1:3000` 等地址时，能在右侧微型浏览器打开，且地址栏默认显示当前页。

**改动点（最小）**：
1. `MarkdownRenderer.isExternalURL()`：移除/翻转对 `localhost`/`127.0.0.1` 的排除分支，使其归入「可在 webview 打开」一类。
   - 注意：要区分「在 webview 打开」与「真外链安全策略」。建议新增 `isWorkbenchURL(url)` 语义（http/https 且非纯锚点/相对路径即可在工作台打开），localhost 自然包含其中。
2. `app.ts:openWebview()` 已能处理，无需改；它会补协议、建 `webview` 标签。

**交互**：按已确认决策，**不自动弹出**。localhost 链接渲染为可点击；点击 → `openWebview`。同时配合 F-Output（见 §4.5）在消息下方给「在工作台打开」按钮。

**验收**：点击消息里的 `localhost:5173` → 右侧出现 webview 标签，地址栏显示该地址，页面加载成功。

---

### F2 — 截图发送到输入框

**目标**：在微型浏览器工具条点「截图」，把当前页（或选中元素区域）截图直接作为图片附件塞进输入框。

**技术方案**：
- 整页截图：`webviewRef.capturePage()` → 返回 `NativeImage` → `.toDataURL()` 得到 base64 → 构造 `ImageAttachment` → 调用 `ChatInput.insertImageChip()`。
- 区域截图（配合 F3）：`capturePage(rect)` 传入选中元素的 `{ x, y, width, height }`（来自 `getBoundingClientRect`，需按 `devicePixelRatio` 与 webview 缩放换算）。

**跨组件通道**：InfoPanel（webview 所在）与 ChatInput 不在同一父级。设计一个轻量 store 动作：
- 在 `app.ts` 新增 `pendingInputAttachments`（或事件总线方法 `pushAttachmentToInput(payload)`）。
- ChatInput 侦听该 store 信号 → 调用本地 `insertImageChip` + 追加文本。
- 复用现有 `ImageAttachment` 结构，**主进程链路（saveImageToTemp）零改动**。

**交互**：
- 工具条按钮：`[截图]`（截当前可见页）。
- 截图后给一个轻确认（toast 或预览缩略图），随即注入输入框。

**验收**：点「截图」→ 输入框出现图片 chip；发送后 Agent 能收到该图片（走既有 `@"path"` 链路）。

---

### F3 — 元素框选 + 样式 tooltip（核心）

**目标**：复刻 Codex 图2/图3：进入「框选模式」后，hover 高亮元素并显示尺寸蓝框，点击锁定，浮层 tooltip 显示 `标签 / color / font / 宽×高`；支持按 DOM 树父子级上下钻（类似 Chrome 选取器）。

#### 4.3.1 注入式 inspector（跑在客体页）

一段独立脚本（`inspector.js`，作为字符串通过 `executeJavaScript` 注入，或打包进 webview preload 后按需 enable），职责：

- **覆盖层**：在客体页 `document.body` 上挂一个高 z-index 的 overlay（高亮框 + 尺寸标签 + tooltip），`pointer-events:none` 不挡交互；用 `mousemove` 命中 `document.elementFromPoint`。
- **hover**：实时高亮 `elementFromPoint`，画 `getBoundingClientRect` 的蓝框 + 尺寸（如 `468x46`）。
- **tooltip 内容**：`tagName`、`getComputedStyle(el).color`、`font`（size + family）、`width×height`。
- **点击锁定**：`click` 捕获阶段 `preventDefault + stopPropagation`，锁定当前元素为「选中」。
- **DOM 树上下钻**：锁定后用方向键 / 滚轮 / 浮条按钮在 `parentElement` ↔ `firstElementChild` 间移动选区（对应「按组件 / 按最细微元素」）。
- **元素指纹**：生成稳定描述，供 Agent 定位：
  - CSS selector 路径（nth-of-type 链）、`id`/`class`、`outerHTML` 摘要（截断）、文本内容摘要、`boundingRect`、关键 computed 样式。

#### 4.3.2 宿主 ↔ 客体通信（最终方案：console-message 通道）

> **实现决策更新**：原方案拟新增 `electron/webviewInspectorPreload.ts` + vite 构建入口走 `sendToHost`/`@ipc-message`。实测有更简单的等价方案，已采用，**省掉整个 preload 构建管线、零 vite 配置改动**：

- **客体 → 宿主**：注入脚本在「锁定选中」时执行 `console.log('SPACECODE_INSPECTOR_SELECT:' + JSON.stringify(payload))`（退出时发 `SPACECODE_INSPECTOR_CLEAR:`）。宿主 `<webview @console-message="onConsoleMessage">` 按魔法前缀解析。
  - 高频的 hover 高亮与 tooltip **完全在客体页内绘制、不回传**，所以只需要这条「最终选中一次性回传」的轻通道即可，无需 preload/IPC。
- **宿主 → 客体**：`webviewRef.executeJavaScript('window.__SPACECODE_INSPECTOR__.enable()/.disable()/.moveSelection("up"|"down")')` 控制开关与 DOM 树上下钻。
- 注入脚本全局对象 `window.__SPACECODE_INSPECTOR__`（幂等：重复注入仅触发 enable）。

实现文件：`src/utils/webviewInspector.ts`（`INSPECTOR_SCRIPT` 字符串 + `INSPECTOR_SELECT_PREFIX`/`INSPECTOR_CLEAR_PREFIX` + `buildSelectionMessage` + `InspectorSelection` 类型）。

> 设计取舍：tooltip 与高亮**画在客体页内**（注入脚本负责）最还原 Codex；宿主只接收「最终选中」的结构化数据用于 F4。避免宿主 overlay 与 webview 坐标换算的复杂度，也避免为 webview 引入独立 preload 构建。

#### 4.3.3 webview 工具条（宿主新增 UI）

在 `InfoPanel.vue` 的 `webview-nav` 下新增一行轻工具条（`webview-tools`）：
- `[框选/退出框选]` 切换 inspector 开关（高亮态）。
- `[截图]`（F2）。
- 选中后浮出「评论浮条」（见 F4），浮条内含 **DOM 树上下钻按钮 `[↑父级] [↓子级]`**（调用 `moveSelection`），方向键 ↑↓ 为辅助、Esc 退出。

**验收**：开启框选 → hover 任意元素出现蓝框 + 尺寸 + 样式 tooltip；点击锁定；浮条按钮 / 方向键能在父子元素间切换；选中数据经 console-message 回传宿主。

---

### F4 — 选中元素整合发送

**目标**：选中元素后，弹出「Add a comment」浮条；用户输入修改描述（或直接改文字/颜色），点发送，把 **元素区域截图 + DOM 信息 + 评论** 合并为一条消息塞进输入框。

**合成内容（送进 ChatInput 的一条 payload）**：
1. **图片**：`capturePage(选中元素 rect)` 裁剪出的区域截图 → `ImageAttachment`（复用 F2 通道）。
2. **结构化文字块**（拼进输入框文本，便于 Agent 精确定位）：
   ```
   【可视化改稿】
   元素: <h1.title>  (selector: body > div.app > h1:nth-of-type(1))
   尺寸: 468×46    样式: color #000000; font 32px sans-serif
   页面: http://localhost:5173
   修改需求: {用户在浮条里写的评论}
   ```
3. 两者通过 §4.2 的 `pushAttachmentToInput` 一次性注入：图片走 chip，文字 append 到光标处。

**「直接改文字/颜色」的轻量增强（可选，排在 F4 之后）**：浮条提供「改文字 / 改颜色」快捷项，本质是预填一句结构化指令（如 `把文字颜色改为 #1677ff`），降低用户打字成本——不直接改客体 DOM（那是 Agent 的活）。

**验收**：选中元素 → 写评论 → 发送 → 输入框同时出现区域截图 chip + 结构化文字；用户确认后一键发给 Agent。

---

### 4.5 F-Output — 输出「在工作台打开」按钮（联动）

**目标**：Agent 最终输出里出现可在工作台打开的内容时，在该消息下方显示按钮引导（**手动**，不自动弹出）。

**识别规则（在 `MarkdownRenderer` / `MessageItem` 渲染后扫描）**：
- localhost / http(s) 链接 → 按钮「在浏览器打开」→ `openWebview(url)`。
- `.html` 文件路径 → 「在工作台预览」→ 现有 `openFile`（或 webview 加载 `file://`）。
- `.md` 文件路径 → 「在工作台预览」→ 现有 `openFile`（markdown 模式）。

**实现位置**：`MessageItem.vue` 在 assistant 消息尾部条件渲染一个 `WorkbenchHintBar`，数据来自对 `message.content` 的一次轻量扫描（复用 `MarkdownRenderer` 已有的 URL/文件正则，避免重复造轮子）。

**验收**：输出含 `localhost:5173` 的消息底部出现「在工作台打开」按钮，点击 → 右侧 webview 打开该页。

---

## 5. 数据结构与接口（新增）

```ts
// app.ts —— 跨组件把附件/文字推给输入框
interface InputInjectPayload {
  text?: string                 // 追加到输入框光标处的文字（含结构化改稿块）
  image?: ImageAttachment       // 复用现有结构
}
function pushToInput(payload: InputInjectPayload): void   // ChatInput 侦听

// inspector 选中回传（webview → host，经 console-message 魔法前缀解析）
interface InspectorSelection {
  selector: string              // 稳定 CSS 路径
  tagName: string
  idClass: string               // #id.class
  rect: { x: number; y: number; width: number; height: number }  // CSS px
  styles: { color: string; font: string; [k: string]: string }
  textSnippet: string
  outerHTMLSnippet: string      // 截断
  pageUrl: string
  devicePixelRatio: number      // 截图裁剪换算用
}
```

涉及文件清单（已落地）：

| 文件 | 改动性质 |
|---|---|
| `src/components/common/MarkdownRenderer.vue` | 改 `isExternalURL`（F1，localhost 进 webview） |
| `src/utils/workbench-targets.ts` | **新增**：识别输出中可在工作台打开的 URL/HTML/MD |
| `src/components/chat/MessageItem.vue` | 新增工作台快捷入口按钮条（F-Output） |
| `src/i18n/locales/{zh-CN,en-US}.ts` | 新增 `workbench.*` 文案 |
| `src/stores/app.ts` | 新增 `normalizeWebUrl` / `pushToInput` / `consumeInputInjection` 注入通道 |
| `src/components/chat/ChatInput.vue` | 侦听 `pendingInputInjection` → `insertImageChip` + 追加文本 |
| `src/utils/webviewInspector.ts` | **新增**：注入式 inspector 脚本 + `buildSelectionMessage` |
| `src/components/layout/InfoPanel.vue` | webview 工具条/评论浮条/截图/`@console-message`（F2/F3/F4） |
| `tests/utils/workbenchTargets.test.ts` | **新增**：纯函数单测（8 用例） |

> 注：原设计的 `electron/webviewInspectorPreload.ts` 与 `vite.config.ts` 构建入口**已不需要**——改用 console-message 通道（见 §4.3.2）。

---

## 6. 边界、风险与取舍

1. **坐标换算**：`capturePage(rect)` 用的是物理像素，`getBoundingClientRect` 是 CSS 像素，需乘 `devicePixelRatio`，并考虑页面滚动偏移。需要在裁剪前把元素滚入视口或用整页截图 + JS 侧裁剪兜底。
2. **跨域 / 客体页 CSP**：注入脚本走 `executeJavaScript`（主世界）一般不受 CSP `script-src` 限制；但若客体页有严格 CSP，overlay 样式需用内联 style 注入。localhost 自有站点通常无碍。
3. **webview preload 安全**：preload 只暴露 `sendToHost` 单一窄接口，不暴露 `require`/fs，遵循现有 `contextIsolation` 策略。
4. **inspector 与页面交互冲突**：框选模式下吞掉客体页的 click（捕获阶段 `preventDefault`），退出模式后必须彻底解绑，避免污染用户站点。
5. **性能**：`mousemove` + `elementFromPoint` 高频，需 `requestAnimationFrame` 节流（与项目里 MarkdownRenderer 的节流风格一致）。
6. **不做的事（划界）**：不引入桌面级 `desktopCapturer`；不引入 fabric/annotorious；inspector 不直接改客体 DOM（改稿交给 Agent）。

---

## 7. 分阶段实施建议（设计层面的优先级）

| 阶段 | 内容 | 价值 / 风险 |
|---|---|---|
| P1 | F1（localhost 联动）+ F-Output 按钮 | 改动最小、立刻可用、风险最低 |
| P2 | F2（整页截图 → 输入框） | 打通 webview→输入框通道，为 F4 铺路 |
| P3 | F3（webview preload + inspector 框选/tooltip） | 核心难点，独立可测 |
| P4 | F4（区域截图 + DOM 信息 + 评论整合发送） | 依赖 P2/P3，闭环收口 |

---

## 8. 自动化测试策略（后续，先记录）

> 本阶段仅设计；待功能定稿后落测试。项目现有 `tests/electron/*.test.ts`（`node --test`）与 vue-tsc 类型门禁可复用。

- **单元 / 纯函数**：
  - `isExternalURL`/`isWorkbenchURL`：localhost、127.0.0.1、http(s)、相对路径、锚点的判定矩阵。
  - inspector 指纹生成：给定 DOM 片段产出稳定 selector / styles 的快照测试（jsdom）。
  - 区域截图 rect 换算：devicePixelRatio + 滚动偏移的数值用例。
- **组件 / 集成**（可选 Vitest + @vue/test-utils）：
  - 点击 localhost 链接 → 断言 `openWebview` 被调用且生成 webview 标签。
  - `pushToInput` → 断言 ChatInput 出现 image chip + 文本。
  - assistant 消息含 localhost → 断言渲染出「在工作台打开」按钮。
- **端到端 / Electron**（最贴近真实，成本最高）：
  - 用既有 electron 测试框架启动窗口，加载一个内置 fixture 页面到 webview，模拟 enable inspector → 注入脚本回传 selection → 校验合成 payload。
  - webview `capturePage()` 产出非空 dataURL 的冒烟测试。
- **建议**：P1/P2 以单元+组件测试为主即可验收；P3/P4 的 inspector 与截图建议补一条 Electron 端到端冒烟，覆盖「注入→选中→截图→入框」主链路。

---

## 9. 开放问题（落地前再确认）

1. inspector 的 DOM 上下钻交互用**键盘方向键**、**滚轮**还是**浮条按钮**为主？（建议浮条按钮 + 键盘辅助）
2. 「改文字/改颜色」快捷项是否纳入 F4 首版，还是延后为 P5？
3. webview 是否需要独立的「打开当前项目本地预览」入口（不依赖 Agent 输出链接，用户主动开）？
