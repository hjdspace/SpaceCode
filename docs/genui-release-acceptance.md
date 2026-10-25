# 生成式 UI 卡片 — 发布验收矩阵（票 09）

口径来源：`docs/prd/genui-cards.md` §7–§8、`docs/adr/0015-genui-card-sandbox-origin.md`、
`docs/genui-h5-sandbox-deployment.md` 与 `.scratch/genui-cards/issues/09-packaging-release-hardening.md`。

这份表是**发布前的最后一道门**。任何一行标为「失败」都阻塞发布；「仅开发模式能过」不算通过。

## 0. 怎么执行与怎么留证据

- 顺序：先跑 §1 的自动化门禁，全绿再动手工行。
- 结果只写三种：`通过` / `失败（阻塞发布）` / `待执行`。失败时在证据列写下现象与日志时间戳，不要只写"不行"。
- 截图存 `docs/acceptance/genui/`（首轮执行时建目录），命名 `YYYY-MM-DD-<行号>.png`（例：`2026-10-26-D2.png`）。
- 日志取 `~/.claude/debug/app-<YYYY-MM-DD>.log`（主进程 `info`/`warn` 都写这里，agent trace 在 `traces/` 子目录）。
  表里引用日志时写**关键行的时间戳 + 前 40 字符**，回归时能直接 grep 到。
- 回归对照：改沙箱承载、CSP、握手协议或动作白名单的 PR，都要重跑 §2 全部行 + §4 的 E1/E2。

## 1. 自动化门禁（可注入的逻辑与响应，全在 CI）

| 检查 | 测试 | 钉住什么 |
| --- | --- | --- |
| 沙箱产物形状与两侧 CSP | `tests/genui-sandbox-artifact.test.ts` | 真构建的四件产物；沙箱 CSP meta 与下发口径同源；主窗口 `script-src` 保持 `'self'`，无 `unsafe-eval`；调试件只随开发产物存在 |
| 打包合同与假安装树 | `tests/integration/genuiSandboxPackaging.test.ts` | `build.files` 覆盖 `dist/genui-sandbox` 且无排除规则命中它；打包脚本链在 electron-builder 之前构建沙箱；资源根与产物目录同源；自定义协议与 H5 第二端口都能从安装目录布局读到真产物 |
| 卡片可达面 | `src/lib/genui/__tests__/cardActionAdapters.test.ts`（属性访问全路径记录） | 桌面适配器能读到的宿主能力只有 `clipboard.writeText` 与 `shell.openExternal`；`expand` 与 `submit` 根本不经这条端口（`GenuiCardFrame.test.ts` 钉住） |
| 开发期沙箱主机的启动判据 | `electron/genui/__tests__/sandboxStaticServer.test.ts`「开发期沙箱主机的启动判据」 | 打包态一律不起那个本机端口，与 `NODE_ENV` 的取值无关 |
| 协议处理器与文件闸门 | `electron/genui/__tests__/sandboxProtocol.test.ts`、`sandboxStaticServer.test.ts` | 逐响应 CSP + nonce 换新；穿越/软链/目录列举/白名单外类型全拒 |
| frame 导航闸门 | `electron/genui/__tests__/sandboxFrameGuard.test.ts` | 非主 frame 只允许精确的卡片文档 URL |
| 桥的信任边界 | `src/lib/genui/__tests__/cardBridge.test.ts` | nonce + `event.source` 双闸门；动作白名单、限额、协议版本 |
| iframe 授权面 | `src/components/genui/__tests__/GenuiCardFrame.test.ts` | `sandbox` 恰为 `allow-scripts`（无 `allow-same-origin`、无 `allow-popups`） |
| H5 逐响应策略 | `electron/h5/__tests__/h5DocumentPolicy.test.ts`、`h5Server.sandbox.test.ts` | 反代/隧道下的源推导；`frame-src` 与引导脚本出自同一次计算；没注入源时不开 iframe |
| 生命周期与配额 | `tests/lib/genuiCardPersistence.test.ts`、`src/lib/genui/__tests__/cardLifecycle.test.ts` | 8 卡/条、64KB schema、512KB 会话预算；坏记录与旧会话不阻塞打开 |
| 技能产物不漂移 | `tests/genui-skill-artifact.test.ts` | `SKILL.md` 与当前安装的 OpenTiny 依赖逐字一致 |

跑法：

```sh
npm run test:changed   # 改动期
npm run build          # vue-tsc + vite build + 沙箱产物 + 技能产物
npm run test           # 收尾全量（CI 也跑一次 test:coverage）
```

## 2. 桌面

| 行 | 场景 | 步骤 | 预期观察 |
| --- | --- | --- | --- |
| D1 | 开发模式握手 | `npm run dev`，让模型出一张卡 | 卡片渲染；DevTools Network 里 `localhost:5174/index.html` 与 `sandbox.js` 均 200；日志有 `GenUI sandbox dev host ready on localhost:5174` |
| D2 | **打包产物握手** | 装 `release/SpaceCode-Setup-<版本>.exe`，**不开** dev、本机没有 5174 监听，打开带卡会话 | 卡片渲染；文档请求是 `spacecode-genui://genui/index.html`；`netstat -ano \| findstr :5174` 为空；日志仍有 `GenUI sandbox protocol registered` |
| D3 | 断网 | 关闭网络后重启应用，打开带卡会话，点 copy / openLink | 卡片照常渲染与交互；`connect-src 'none'` 下卡片自身请求全失败；copy 走宿主剪贴板成功，openLink 只在系统浏览器里失败（域名解析），不出现应用内报错弹窗 |
| D4 | 导航拦截 | 开发模式下用自检卡或临时 schema 让卡片执行 `location.href='https://evil.example'` | frame 不跳转；日志 `Blocked card frame navigation \| reason=not-card-document` |
| D5 | 新窗口拒绝 | 卡片执行 `window.open('https://evil.example')` | 被 iframe 沙箱拦下（`sandbox` 里没有 `allow-popups`），不产生新窗口 |
| D6 | 超限与配额 | 一条消息要 9 张卡；单卡 schema >64KB；submit 里塞 >64KB；会话卡片总量 >512KB | 第 9 张不渲染并留降级说明；超大 schema 不成卡（正文保留）；超大 submit 在卡片下方给"内容过大"；最旧的卡片转可见过期占位，会话仍能打开 |
| D7 | 提交后重载 | 提交一张卡 → 完全退出应用 → 重开 | 卡片仍在原位且只读，摘要带读得出来；正文里没有裸 `schemaJson` 围栏 |
| D8 | 普通文本回归 | 问一个明显不需要卡片的问题 | 纯文本回复，没有卡片外壳；同会话里工具调用与推理块照常 |
| D9 | design 模式回归 | 切 design 模式生成一个 HTML 产物并持续改 | 预览流式更新、无白屏闪烁（本票没动这条链路；其安全债见 Issue #62） |
| D10 | 旧会话升级 | 保留 v0.8.12 的会话数据升级安装（或备份 `%APPDATA%/SpaceCode` 后覆盖安装） | 无卡片的旧会话逐字不变；早期开发版留下的、没有 `protocolVersion` 字段的卡片记录降级为"协议版本不一致"说明，不开 iframe |

## 3. H5

按 `docs/genui-h5-sandbox-deployment.md` 第 3 节的方案配好后执行。

| 行 | 场景 | 步骤 | 预期观察 |
| --- | --- | --- | --- |
| H1 | H5 桌面浏览器（局域网直连） | 设置 → H5 远程访问开启；另一台机器开 `http://<ip>:<端口>/?token=…`，连上当前会话并出卡 | 卡片渲染；Network 里沙箱来自 `<端口+1>`；父文档响应头 `frame-src` 就是那个源 |
| H2 | H5 手机 | 手机浏览器走同一条地址，出卡 → 填 → 提交 → 下拉刷新 | 渲染与提交成功；复制在 http 非安全上下文里给"复制失败"文案（浏览器限制，非沙箱拦的） |
| H3 | **反代后的完整往返** | 部署文档方案 B（nginx `8443` + `8444`，`Host $host:$server_port`），走 `https://host:8443` 做一遍「渲染 → 提交 → 刷新」 | 沙箱源推导为 `https://host:8444` 且可达；提交落进对话；刷新后卡片仍只读、原位 |
| H4 | 只暴露主端口 | 反代只映射 8443 | 卡片显示"卡片沙箱源无法访问：H5 部署请确认第二个端口已随主端口一起暴露"，其余消息不受影响 |
| H5 | https 页面配 http 沙箱源 | 故意把第二端口按 http 暴露 | 浏览器按混合内容拦掉，卡片给出与 H4 同一句可见说明，不静默白屏 |
| H6 | 第二端口被占 | 先占掉 `主端口+1` 再开 H5 | 设置页显示"未监听"；卡片立刻显示"当前宿主未接入卡片沙箱"，不出现 5 秒空白 iframe 再超时 |
| H7 | 服务端未起第二端口时的源 | 把 `sandboxPort` 配成非法值（70000） | 主服务照常；文档不广播沙箱源；`frame-src` 不被放宽 |

## 4. 引擎与技能

| 行 | 场景 | 步骤 | 预期观察 |
| --- | --- | --- | --- |
| E1 | Claude 出卡 | Claude Code 引擎，请求一个部署参数表单 | 回复里是 ```` ```schemaJson ```` 围栏，被投影成卡片；围栏之外没有解释性散文 |
| E2 | Pi 出卡 | 同一提示词换 Pi 引擎 | 读同一份 `SKILL.md`（ADR 0016），渲染结果与 E1 一致；Pi 侧技能来源与同源校验都通过 |
| E3 | 技能分发失败路径 | 临时改名安装目录里的 `builtin-skills/genui-card`，再新开会话 | seed 不覆盖用户目录、不崩；模型没有该技能时普通文本照常回复（卡片能力只是不出现） |
| E4 | 物料版本漂移 | 升级 `@opentiny/*` 依赖但不跑 `npm run build:genui-skill` | `tests/genui-skill-artifact.test.ts` 红（发布阻塞项，不靠人工记忆） |

## 5. 安全审计清单（票 09 第 3、4 条）

逐条给出"在哪钉住"，失败即阻塞发布：

- [x] 主窗口 CSP 无 `unsafe-eval`：`index.html` 的 `script-src 'self'`；`tests/genui-sandbox-artifact.test.ts` 与 `scripts/check-build-performance.cjs` 都会红。
- [x] 沙箱 CSP 完整下发：`default-src 'none'` + `connect-src 'none'` + `form-action 'none'` + `frame-src 'none'` + `object-src 'none'` + `base-uri 'none'`，逐响应下发且 meta 与响应头同值（`sandboxFiles.sandboxResponse`）。
- [x] `unsafe-eval` 只在沙箱源：物料运行时按 `new Function` 求值 JSExpression，是它唯一的用途；主文档与 H5 父页面都不放开。
- [x] iframe 无 `allow-same-origin`：`sandbox="allow-scripts"` 恰好一条，`GenuiCardFrame.test.ts` 钉住。
- [x] 桥校验 source、nonce 与动作白名单：`cardBridge.ts` 两道闸门 + `parseCardAction`；被拒消息只在本卡留痕，不转通用 IPC。
- [x] 卡片无 shell(命令)/文件/代码/引擎/通用 IPC 通路：可达面只有 `clipboard.writeText`、`shell.openExternal`（桌面）与 Clipboard API、`noopener` 新窗口（H5）——`tests/genui-release-security.test.ts` 用属性访问记录钉住。
- [x] 外链仅 `http:` / `https:`：`isSafeExternalUrl` 拒绝相对地址、`javascript:`、`file:`、`data:`。
- [x] 导航被拒：`sandboxFrameGuard` 只放行精确卡片文档 URL；跨源自跳转在父页面 `frame-src` 就被拦。
- [x] 新窗口被拒：卡片侧由 `sandbox` 不含 `allow-popups` 拦下（D5）。
- [x] 生产构建不含开发沙箱服务：这条要的是**装好的应用不多开一个本机端口**，而不是"字节不在 bundle 里"。
  `electron/main.ts` 用 `shouldStartDesktopSandboxHost({ isPackaged, nodeEnv })` 决定起不起这条主机；判据是运行时的，
  Rollup 不会把 `!app.isPackaged` 折成常量，所以函数体仍在主进程产物里，但打包态那条分支不可达、端口不会被绑定。
  判据由 `electron/genui/__tests__/sandboxStaticServer.test.ts` 钉住（含"打包态即使 `NODE_ENV` 不是 production 也不起"），
  可观察性质由 **D2** 的 `netstat -ano | findstr :5174`（应为空）实测核对。
- [x] 生产构建不含调试 fixture / 开发专用入口：沙箱产物按 `__GENUI_DEBUG__=false` 构建，`FixtureCard` 与自检件不在里面；渲染端 `window.__SPACECODE_GENUI_DEBUG__` 只在 `import.meta.env.DEV` 分支注册，实测生产 bundle 无该符号。
- [x] 打包配置包含沙箱构建产物：`build.files` 的 `dist/**/*` 覆盖 `dist/genui-sandbox`，资源根统一由 `app.getAppPath()` 锚点解析（`tests/integration/genuiSandboxPackaging.test.ts`）。

### 审计记下但没有在本票收紧的两处（属于残余风险，见 §6）

- 打包后的 `dist/index.html` 里 `frame-src` 仍带 `http://localhost:5174`：同一份 HTML 服务 dev 与 packaged 两个形态，按 `isPackaged` 分叉需要动构建产物注入。实际风险有限——`sandboxFrameGuard` 只放行精确的沙箱卡片文档 URL，且卡片 iframe 的源由渲染端选定。
- 主窗口没注册 `setWindowOpenHandler`：design 打印预览与"在资源管理器中打开"依赖 `window.open`，一刀切 deny 会伤既有功能。卡片链路本身拿不到 `window.open`（沙箱属性不含 `allow-popups`）。

## 6. 已知残余风险（写入发布说明）

- **H5 端只有跨 origin，没有进程隔离**：第二端口与主服务同 site，恶意卡片的死循环会拖住同一渲染进程。桌面端由 OOPIF 隔离，H5 明确不做（PRD Out of Scope）。
- **沙箱源允许 `unsafe-eval`**：卡片协议用 `new Function` 求值 `JSExpression`，这是官方物料的运行前提。该授权只落在 opaque origin 的沙箱源，永不进主文档。
- **H5 第二端口无鉴权**：它服务的就是构建产物本身，公开可读。不要往 `dist/genui-sandbox/` 放任何私有内容。
- **DesignPreview 桥的安全债**：产物预览的 `srcdoc` 传输桥没有密钥与来源校验，iframe 还带 `allow-popups allow-downloads`。本票只记录不修，由 GitHub Issue [#62](https://github.com/hjdspace/SpaceCode/issues/62) 独立跟踪。
- **打包 CSP 的 `frame-src` 含本机开发源**、**主窗口无 `setWindowOpenHandler`**：见 §5 末尾两条，均有缓解因素。

## 7. 本轮执行记录

### 7.1 已执行（2026-10-26，本机 Windows / Node 24 / Electron 43）

| 检查 | 命令或方法 | 结果 |
| --- | --- | --- |
| 类型检查 + 生产构建 | `npm run build`（vue-tsc → vite build → 沙箱生产产物 → 技能产物） | 通过 |
| 全量自动化 | `npm run test` | 502 个文件通过、3 跳过、0 失败（`npm run test:changed` 17 个文件通过） |
| 生产产物不含调试入口 | 对构建产物 grep | `dist/assets/*.js` 无 `__SPACECODE_GENUI_DEBUG__`；`dist/genui-sandbox/sandbox.js` 无 `sandbox self-check` / `FixtureCard` / `parent document unreadable`。**注意**：`dist-electron/main.js` 里仍能找到开发期沙箱主机的函数体，那条分支由运行时的 `isPackaged` 关掉（见 §5 与 D2），不要把"字节还在"读成"打包后也会监听 5174" |
| 安装目录布局下的协议读取 | `tests/integration/genuiSandboxPackaging.test.ts`（真构建产物摆进假安装树） | 13 项通过：四件产物按 `files` 语义确认会被带进安装包、文档与它引用的每个资源都从安装目录取到、逐响应 CSP + nonce、缺失只回 404 |
| **asar 这层 fs 包装**（假安装树覆盖不到的一层） | 一次性 spike：`@electron/asar` 造出 `resources/app.asar/dist/genui-sandbox/`，真 Electron 43 进程里跑 `realpathSync` / `statSync` / `readFileSync` | 通过。`realpathSync` 在 asar 路径上返回 asar 原路径（`pathBoundary.canonicalize` 的归属判定在打包态仍成立）；`statSync().isFile()` 为真；文档读得出；缺失文件抛 `ENOENT` → 闸门回 404。脚本 `.scratch/genui-cards/spike/asar-read-probe.cjs`（一次性，不入仓库） |
| H5 第二端口的默认资源根 | `electron/h5/__tests__/h5Server.sandbox.test.ts`「没注入资源根时按 app path 定位沙箱产物」 | 通过（第二端口服务的是 `app.getAppPath()` 下那份） |
| 卡片可达面 | `tests/genui-release-security.test.ts`（属性访问记录） | 通过：只有 `clipboard.writeText` 与 `shell.openExternal` |

### 7.2 待人工执行（真实安装包 / 真实设备 / 真实模型，自动化替代不了）

- 桌面：D1–D10。其中 **D2**（打包产物握手 + `netstat` 确认无 5174 监听）与 **D10**（旧会话升级）
  需要装 `release/SpaceCode-Setup-<版本>.exe`，是发布前不可跳的两行。
- H5：H1–H7。**H3** 是票 09 第 5 条要求的那一次「渲染 → 提交 → 刷新」，必须在真实反代后面做，
  直连通过不算通过。
- 引擎：E1–E3（需要真实模型会话）。E4 由 `tests/genui-skill-artifact.test.ts` 自动钉住。

### 7.3 审计产出（不在本票修，已单独跟踪）

- DesignPreview 的 `srcdoc` 传输桥缺来源与密钥校验 → GitHub Issue #62。
- 打包 CSP 的 `frame-src` 含本机开发源、主窗口无 `setWindowOpenHandler` → §5 末尾两条，
  有缓解因素，接受并写进发布说明。
