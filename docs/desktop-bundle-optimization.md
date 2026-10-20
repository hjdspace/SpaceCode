# 桌面端打包体积优化报告

> 日期：2026-09-18　版本基线：0.8.1（对照产物为 release/ 下 0.7.10 构建）
> 结论：**Windows 解包体积 1040.4 MB → 736.0 MB（-29.3%）**，功能无裁剪。

---

## 1. 体积构成分析（优化前）

`release/win-unpacked` 全部 1040.4 MB，构成如下：

| 分区 | 体积 | 说明 |
| --- | --- | --- |
| `SpaceCode.exe` | 228.3 MB | Electron 主二进制，**不可压缩** |
| `locales/` | 46.6 MB | Electron 自带 **55 个语言包**，实际只用 2 个 |
| `dxcompiler.dll` + 其他 DLL/PAK | ~67 MB | Chromium 运行时，不可动 |
| `LICENSES.chromium.html` | 19.4 MB | 许可证文本 |
| `icudtl.dat` | 10.4 MB | ICU 数据，不可动 |
| `resources/app.asar` | **285.5 MB** | ⚠️ 主要问题所在 |
| `resources/app.asar.unpacked` | **92.6 MB** | ⚠️ |
| `resources/engine` | 147.2 MB | `bun.exe` 110.9 + `cli.js` 28.4 + `rg.exe` 5.2 |
| `resources/skills-lib` | 73.7 MB | 技能库内容（含图片资源） |
| `resources/officecli` | 31.9 MB | officecli 可执行文件 |
| `resources/design-systems-lib` | 30.2 MB | 设计系统库（3999 个文件） |
| `resources/cua-driver` | 17.6 MB | 两个 exe |
| `resources/agents-lib` 等 | ~1 MB | — |

### 1.1 核心问题：app.asar 里塞了整个生产依赖树

`build.files` 里只写了 4 条：

```json
"files": [
  "dist/**/*",
  "dist-electron/**/*",
  "node_modules/node-pty/**/*",
  "node_modules/@mariozechner/**/*"
]
```

但 asar 里实际含 **780+ 个包 / 353 MB**。原因是 **electron-builder 会把 `package.json` 里全部 `dependencies` 强制打进 asar**，`files` 只能对其做「再加一条 `!` 排除」，无法做「白名单」。实际测量（按唯一 offset 去重）：

| 包 | 体积 | 是否运行时需要 |
| --- | --- | --- |
| `mermaid` | 79.9 MB | ❌ 渲染进程已被 vite 打进入 `dist/` |
| `koffi` | 26.6 MB | ✅ pi-coding-agent 依赖（18 个平台预编译） |
| `better-sqlite3` | 26.0 MB | ✅ 主进程原生模块 |
| `lucide-vue-next` | 22.8 MB | ❌ 渲染进程 |
| `@mariozechner/pi-ai` | 12.2 MB | ✅ |
| `openai` / `@google/genai` / `@mistralai/mistralai` | 31 MB | ✅ pi 依赖 |
| `@mermaid-js/parser` | 11.3 MB | ❌ 渲染进程 |
| `node-pty` | 10.0 MB | ✅ |
| `cytoscape` + `cytoscape-fcose` | 14.3 MB | ❌ 渲染进程 |
| `web-streams-polyfill` | 8.5 MB | ❌ 渲染进程 |
| `vue` / `vue-i18n` / `pinia` / `@vue-flow/*` / `katex` / `@xterm/xterm` / `highlight.js`(顶层) / `lowlight` / `qrcode` / `fuse.js` … | ~60 MB | ❌ 渲染进程 |
| `*.js.map` | ~4 MB | ❌ 生产不需要 |

**判定依据**：主进程产物 `dist-electron/main.js` 是完整 bundle，静态扫描全部 6698 个 JS 文件后确认——
`dist/` 与 `dist-electron/` 中**不存在任何指向 node_modules 的裸模块引用**（仅 `electron` + `better-sqlite3` + `node-pty` + Node 内置模块）。
`@mariozechner/pi-coding-agent` 是以**独立子进程**方式执行的（`node <pkg>/dist/cli.js`），因此它及其完整依赖闭包必须保留。

> ⚠️ 本节「pi 及其闭包必须保留」的判定已在 issue #52 被推翻，见 §5：子进程从 asar 里读不到裸依赖，
> 那份副本根本跑不起来；现在 pi 是 devDependency，产物只带 `dist/bundle` 的自包含副本。

---

## 2. 实施的优化

### 2.1 排除渲染进程专用依赖（-198 MB 源文件）

在 `build.files` 末尾追加 240 条精确排除规则，形如：

```json
"!**/node_modules/mermaid/**/*",
"!**/node_modules/lucide-vue-next/**/*",
...（由 scripts/gen-bundle-excludes.cjs 自动生成）
```

保留集合 = `node-pty` + `better-sqlite3` + `@mariozechner/pi-coding-agent` 的**完整依赖闭包**（含 `openai`、`@google/genai`、`@mistralai/mistralai`、`koffi`、`zod`、`typebox`、`highlight.js`、`cli-highlight` 等）。

**维护方式**：新增/移除依赖后执行一次

```sh
node scripts/gen-bundle-excludes.cjs          # 重新生成并写入 build.files
node scripts/gen-bundle-excludes.cjs --dry    # 只打印，不改文件
```

否则新装的渲染进程依赖会重新被整包打进 asar（体积静默回涨）。

> ⚠️ 必须写成 `!**/node_modules/<pkg>/**/*`，不能写成 `!node_modules/<pkg>/**/*`。
> electron-builder 对 node_modules 的过滤用的是 `stat.moduleFullFilePath`（**绝对目标路径**），缺少前置 `**/` 的规则永不命中。

### 2.2 裁剪跨平台原生产物与 source map

```json
"!**/node_modules/**/*.map",
"!**/node_modules/better-sqlite3/deps/**/*",              // C 源码，仅构建期需要
"!**/node_modules/better-sqlite3/prebuilds/win32-arm64*",
"!**/node_modules/better-sqlite3/prebuilds/linuxmusl-*",
"!**/node_modules/node-pty/prebuilds/win32-arm64*",
"!**/node_modules/node-pty/third_party/conpty/**/win10-arm64/**/*",
"!**/node_modules/koffi/build/koffi/freebsd_*",
"!**/node_modules/koffi/build/koffi/openbsd_*",
"!**/node_modules/koffi/build/koffi/musl_*",
"!**/node_modules/koffi/build/koffi/linux_loong64",
"!**/node_modules/koffi/build/koffi/linux_riscv64d",
"!**/node_modules/koffi/build/koffi/linux_ia32",
"!**/node_modules/koffi/build/koffi/linux_armhf",
"!**/node_modules/koffi/build/koffi/win32_ia32",
"!**/node_modules/koffi/build/koffi/win32_arm64"
```

只剔除「win / mac / linux 三个已配置目标都用不到」的平台，`darwin_*`、`linux_x64/arm64`、`win32_x64` 全部保留，跨平台出包不受影响。

### 2.3 语言包裁剪

```json
"electronLanguages": ["zh-CN", "en-US"]
```

`locales/` 从 55 个文件 46.6 MB → 2 个文件 1.1 MB。

### 2.4 踩过的坑（重要）

第一版把原生裁剪规则放进了 `win.files` / `mac.files` / `linux.files`，结果 asar 暴涨到 **5.6 GB**（整个工程目录被打进去）。

原因：electron-builder 的 `normalizeFiles()` 会把**顶层 `files` 数组整体折叠成一个 `{from: undefined, to: undefined, filter: [...]}` FileSet**，其中的字符串规则不再进入 `defaultMatcher`。此时 `win.files` 里的字符串规则反而成了 `defaultMatcher` 的全部内容，而它全是 `!` 开头的排除规则 → 触发 `containsOnlyIgnore()` → 自动补一条 `**/*` → 主匹配器退化为「打包整个工程」。

**结论：所有文件规则必须写在同一个顶层 `files` 数组里，不要用 `win.files` / `mac.files` / `linux.files`。**

---

## 3. 优化结果

| 项目 | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| **NSIS 安装包** | **282.5 MB** | **237.4 MB** | **-45.1 MB（-16.0%）** |
| `resources/app.asar` | 285.5 MB | **82.1 MB** | -203.4 MB |
| `resources/app.asar.unpacked` | 92.6 MB | **44.3 MB** | -48.3 MB |
| `locales/` | 46.6 MB | **1.1 MB** | -45.5 MB |
| **win-unpacked（安装后占用）** | **1040.4 MB** | **743.1 MB** | **-297.3 MB（-28.6%）** |

> 上表为 `npm run electron:build:win` 完整流水线的实测结果（含 `build:proxy` 产物，故 `app.asar` 略大于纯 `--dir` 打包的 75.1 MB）。

安装包降幅小于解包降幅，是因为被裁掉的内容以 JS 文本为主（LZMA 压缩率约 17%），而 Electron 二进制/DLL 本身已不可再压。

`app.asar.unpacked` 明细（原生模块，自动解包）：

| 包 | 优化前 | 优化后 |
| --- | --- | --- |
| `@mariozechner` | 27.6 MB | 15.9 MB |
| `koffi` | 26.6 MB | 8.6 MB |
| `better-sqlite3` | 26.0 MB | 9.9 MB |
| `node-pty` | 10.0 MB | 7.5 MB |

### 功能完整性校验

1. **依赖闭包校验**：打包后 asar 内 214 个顶层包覆盖 `node-pty` / `better-sqlite3` / `@mariozechner/pi-coding-agent` 的完整依赖闭包，无缺包。
2. **引用完整性校验**：扫描 asar 内 6698 个 JS 文件的所有 `require` / `import` / `import()`，未发现指向被裁包的引用（剩余告警全部来自第三方包自身的 test/bench/可选依赖，优化前同样未打包）。
3. **渲染产物校验**：`dist/` 与 `dist-electron/` 中零裸模块引用，确认渲染依赖已全部 bundle。

---

## 4. 未动的部分（可选后续优化）

当前 736 MB 里，剩下的大头都不是「打包配置」问题，而是**内容资源**：

| 项目 | 体积 | 可行方案 |
| --- | --- | --- |
| `SpaceCode.exe` | 228.3 MB | Electron 本体，无解（除非换 Electron 版本） |
| `resources/engine/bin/bun.exe` | 110.9 MB | 引擎运行时，无解 |
| `resources/skills-lib` | 73.7 MB | 其中 `huashu-design/assets` 占 30 MB；可做按需下载 |
| `resources/officecli` | 31.9 MB | 可改首次使用时下载 |
| `resources/design-systems-lib` | 30.2 MB | 同上（3999 个文件） |
| `engine/dist-desktop/cli.js` | 28.4 MB | 引擎 bundle，无解 |
| `resources/cua-driver` | 17.6 MB | 两个 exe，可改按需下载 |
| `LICENSES.chromium.html` | 19.4 MB | 可在 `afterPack` 中删除（注意合规） |
| 跨平台原生产物（darwin/linux 预编译） | ~15 MB | 需 `afterPack` 按 `electronPlatformName` 动态删 |

若把 skills-lib / design-systems-lib / officecli / cua-driver（合计 ~153 MB）改成「首次使用时下载」，解包体积可再降到 **约 580 MB**。

---

## 5. pi 改为 devDependency + extraResources bundle（issue #52）

上面 §1.1 的判定错在把「子进程能读到 cli.js」当成「子进程能跑起来」。实测：

- `asarUnpack` 只搬出 `node_modules/@earendil-works/**`，而 `chalk` / `undici` / `file-type` / `typebox`
  这些裸依赖按 §2.1 的机制留在 asar 里 —— 独立子进程从 `app.asar.unpacked/...` 起，模块解析走到
  `app.asar.unpacked/node_modules` 就找不到它们，直接 `ERR_MODULE_NOT_FOUND`。
- 于是运行时一路 fall through 到 `where pi` 命中的**用户全局安装的 pi**。升级票把 dev 依赖钉到 1.3.x
  对打包版毫无影响：引擎版本由装机的那台机器决定。
- 那份 asar 里的 20+ MB 依赖闭包，从头到尾没有被任何进程读过。

### 5.1 现在的做法

| 项 | 变化 |
| --- | --- |
| `@earendil-works/pi-coding-agent` | `dependencies` → `devDependencies`。electron-builder 只强制打包 `dependencies` 的闭包（§1.1），移到 dev 侧才是真的从 asar 里去掉 |
| `build.files` / `build.asarUnpack` | 删掉 `node_modules/@earendil-works/**/*` 及它的三条裁剪规则 |
| `build.extraResources` | 新增 `{ from: node_modules/@earendil-works/pi-coding-agent, to: pi, filter: [package.json, dist/bundle/**/*] }`，实测 9.0 MB |
| `piCliResolver`（新增） | 打包态唯一候选是 `resources/pi/dist/bundle/cli.js`；找不到就判不可用，**不再**退回全局 `pi` 或 `npx` |

为什么是 `dist/bundle`：1.3.0 起包内 `dist/bundle/*.js` 是上游自己的发行入口（`package.json` 的 `bin.pi`
就指它），里面**零个裸依赖 import**，且 `dist/bundle/cli.js` 自带 `main(["--mode","rpc", …])` 语义，
不需要 node_modules 闭包 —— 绕开整类「依赖没跟着搬出 asar」的问题。

`package.json` 必须与 bundle 一起搬：pi 启动时向上走目录找 `package.json` 定 `VERSION`，只搬 bundle 会
找到宿主的清单（实测把 SpaceCode 自己的 `0.8.10` 当成 pi 版本报出来）。

### 5.2 版本下限与 fail-closed

`piCliResolver` 读版本（bundled/dev 走包根 `package.json`，全局 `pi` 走 `--version` 探针），低于
`MIN_PI_VERSION`（1.0.0，宿主事件契约要求的 delta 顶层 `id`/`toolName`）或问不出来，一律 `available: false`。
`claude-code:isEngineAvailable` 回的是 `{ available, reason, version, installable }`，界面据此置灰并给文案；
`engineGateway.startSession` 不再静默换成 claude-code 跑。

### 5.3 防线

这条路径没有类型检查和单测能覆盖，漂移只会表现在装好包的机器上，因此：

- `scripts/gen-bundle-excludes.cjs` 现在校验 `dependencies` 归属、`build.files`、`build.asarUnpack`（此前无人对比）
  与 `extraResources` 的源/目标/filter，并在漂移时以非 0 退出。
- `tests/integration/bundledPiPackaging.test.ts` 按 `build` 配置摆一个假的 `resources/`，断言解析器要找的
  路径与之完全一致。

## 6. plan 模式的权限闸扩展也走 extraResources（issue #45）

Pi 不内置权限闸：1.3.0 的 `docs/security.md` 仍写着 *"it does not ask for approval before every tool call"*，
命令行里也没有 `--permission-mode` 可拼。界面上的「计划模式」要真的拦住 `write` / `edit` / `mcp__*`，
唯一的入口是起进程时 `--extension` 加载 `@narumitw/pi-plan-mode`，于是它变成第二个「必须随产物走、
且必须在 asar 外」的东西。

| 项 | 变化 |
| --- | --- |
| `@narumitw/pi-plan-mode` | 进 `devDependencies`（宿主进程从不 require 它） |
| `build.extraResources` | 新增四条，落成 `resources/pi-extensions/node_modules/{@narumitw/pi-plan-mode,@narumitw/pi-tui-kit,highlight.js,grok-mermaid}`，实测约 3.1 MB |
| `piPlanModeExtension.ts`（新增） | 打包态只认 `resources/pi-extensions` 下那份入口；解析不到返回 null，由进程池 fail closed |
| `PiSessionProcess` | 意图是 plan 才拼 `--extension`；非 plan 的会话一律不带（那两个 helper 工具会凭空出现在模型面前） |

为什么闭包必须整个搬：bundle 入口只把 `@earendil-works/pi-coding-agent`、`pi-tui`、`pi-ai`、
`pi-agent-core` 与 `typebox` 这几个 specifier 做成**虚拟模块**（`dist/core/extensions/loader.js` 的
`usesEmbeddedModules` + `virtual-modules.js` 的表）。扩展自己的运行时依赖 —— `@narumitw/pi-tui-kit`
及其嵌套的 `diff`、`highlight.js`、`grok-mermaid` —— 不在那张表上，得按 node 的目录规则在盘上
解析得到。少搬一个的表现是 dev 一切正常、打包后只在子进程 stderr 里留下一行加载失败，而界面照旧
显示「计划模式」。

`pi-tui-kit` 下的 `diff` 是嵌套副本（它要 9.x，顶层是 7.x），所以那条条目的 filter 带上
`node_modules/**/*`。

### 6.1 防线

- `scripts/gen-bundle-excludes.cjs` 增算扩展的依赖闭包，逐个断言「有 extraResources 条目且源在盘上」。
- `tests/integration/piPlanModePackaging.test.ts` 把 build 配置与 `resolvePlanModeExtensionPath()` 钉成同一个字符串。
- `electron/engine/engines/__tests__/piSessionProcess.planMode.realPi.test.ts`（`PI_REAL=1`）用真 pi +
  本地假上游证明：`/plan start` 拿到扩展回执、上游要求的 `write` 没落盘、扩展的 `select` 菜单被宿主取消后
  命令仍有 ack（不回帧就会整条会话挂死）。

## 7. 子代理扩展也走 extraResources（issue #46）

Pi 1.3.0 没有 `--agent` 旗子，`dist/cli/args.js` 里根本没有它，README.md:19 仍写着
*"Pi ships with powerful defaults but skips features like sub-agents and plan mode"*。
界面上的「所选 agent」要变成引擎里真实存在的东西，走的还是 #45 那条 `--extension` 通道，
加载 `@tintinweb/pi-subagents`；`.claude/agents` 里的人设它从不读（只读 `.pi/agents`、
`.agents/agents`、`$PI_CODING_AGENT_DIR/agents`），所以那部分靠 `--append-system-prompt` 注入。

| 项 | 变化 |
| --- | --- |
| `@tintinweb/pi-subagents` | 进 `devDependencies`（宿主进程从不 require 它） |
| `build.extraResources` | 新增两条：扩展本体（入口是包清单声明的 `src/index.ts`，filter 带 `node_modules/**/*` 以随带嵌套的 `nanoid@5`）与 `croner`，实测约 1.1 MB |
| `piExtensionPackage.ts`（新增） | 两个扩展共用的候选序列：打包态只认 `resources/pi-extensions`，dev 只认 `node_modules`，asar 路径一概不算 |
| `PiSessionProcess` | 选了 agent 才拼这两样（`--extension` + persona 文件）；没选的会话命令行形态不变 |

`@tintinweb/pi-subagents` 的 `nanoid` 是**嵌套副本**（它要 ^5.1.16，顶层是 3.3.18），随包一起搬；
`croner` 在顶层，需要自己的条目。两者都不在 bundle 的虚拟模块表上，少搬一个就是 dev 正常、
打包后扩展静默加载失败 —— 而界面上的 agent 徽章照样亮着。

### 7.1 防线

- `scripts/gen-bundle-excludes.cjs` 的扩展闭包断言同时覆盖两个扩展。
- `tests/integration/piSubagentsPackaging.test.ts` 把 build 配置与 `resolveSubagentsExtensionPath()`
  钉成同一个字符串，并断言入口就是包清单 `pi.extensions` 声明的那个文件。
- `electron/engine/engines/__tests__/piSessionProcess.agent.realPi.test.ts`（`PI_REAL=1`）用真 pi +
  本地假上游证明：上游收到的系统提示里带该 agent 的正文，且工具清单里出现了扩展注册的 `Agent` ——
  「argv 里拼了 `--extension`」只说明我们想装，回执才是装上了。
