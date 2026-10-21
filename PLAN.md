# 为低覆盖率的 IPC 模块补充单元测试：editorLauncher + h5IpcHandlers

## Summary

项目 committed 的覆盖率报告（`coverage/`，2026-10-18 生成）已过期：`electron/ipc/coreIpcHandlers.ts` 在报告后（10-20 提交 e19bbce3）已获得完整测试。以当前代码树为准，`electron/ipc` 仍有 **4 个文件 0% 覆盖**（无任何测试 import 它们，已用 grep 验证）：

- `electron/ipc/editorLauncher.ts`（64 stmts / 34 branches / 22 fns）
- `electron/ipc/h5IpcHandlers.ts`（49 stmts / 18 branches / 13 fns）
- `electron/ipc/imIpcHandlers.ts`、`electron/ipc/rtkIpcHandlers.ts`（薄委托，价值低）

按「业务关键性 × 分支密度 × 可测性」挑选其中 **2 个**：`editorLauncher.ts`（纯 Node 逻辑：跨平台启动器表、WSL 路径转换、异步 spawn 生命周期）与 `h5IpcHandlers.ts`（H5 远程访问这一**安全边界**的服务器生命周期状态机）。两者同目录，沿用现有 `electron/ipc/__tests__/` 约定与 `coreIpcHandlers.test.ts` 已确立的 mocking 风格。

## 重要行为/接口变化

无生产代码改动，仅新增 2 个测试文件；不触碰 `vitest.config.ts`（新增覆盖不会威胁任何阈值；global 与分路径棘轮均不受影响）。不触碰工作区中无关的未提交改动（plan-mode-redesign 等）。

## 新增测试

### 1. `electron/ipc/__tests__/editorLauncher.test.ts`（首行 `// @vitest-environment node`）

Mock：`child_process.spawn`（返回带 once/emit/unref 的假 ChildProcess）、`fs.existsSync`、`../infra/logger`。注意该模块**不 import electron**，不要 mock electron。

- **启动器表**：对 8 个 editor（vscode/visualstudio/cursor/fileExplorer/terminal/gitBash/wsl/androidStudio）断言 `command()`/`args()` 的形状、`raw` 标志、`shell: raw==false`。
- **跨平台分支**：`isWin/isMac` 是模块加载时求值 —— 用 `Object.defineProperty(process, 'platform', { configurable: true, get: ... })` + `vi.resetModules()` + 动态 import 分别测 win32/darwin/linux 的 fileExplorer、terminal、gitBash、androidStudio 分支（finally 恢复 platform）。
- **WSL 路径转换**（经 `EDITOR_LAUNCHERS.wsl.args` 间接测私有 `toWslPath`）：`C:\foo\bar.txt` → `/mnt/c/foo/bar.txt`；大小写 drive；纯 POSIX 路径透传；无反斜杠路径。
- **`openPathInEditor` 分支/边界**：
  - 空/不存在 targetPath → `{ success:false, error:'Path does not exist' }`，spawn **不**被调用；
  - 存在但未知 editor → `{ success:false, error:'Unsupported editor: x' }`；
  - 成功路径：spawn 以 `command/args/{detached:true,stdio:'ignore',shell}` 调用；`spawn` 事件触发 `child.unref()` 并在 settle 后 resolve `{ success:true }`；
  - 失败路径：`error` 事件 → resolve `{ success:false, error: err.message }` 且 `logger.error` 被调用；
  - settle 守卫：先 `error` 后 `spawn`（或反序）只 resolve 一次（用假 child 手动 emit 事件驱动）。

### 2. `electron/ipc/__tests__/h5IpcHandlers.test.ts`（首行 `// @vitest-environment node`）

Mock：`electron`（ipcMain.handle 捕获到 probe.handlers）、`../h5/h5Server`（假 `H5Server` 类，方法全 vi.fn，构造函数 spy 以计数实例数）、`../h5/h5AuthService`（假 `H5AuthService` 类：enable/disable/regenerateToken/getSettings/updateSettings）、`fs.existsSync`。注意模块加载即 `new H5AuthService()`，故必须整模块 mock。

- **注册面**：8 个 `h5:*` channel 全部注册（enable/disable/regenerateToken/getStatus/getSettings/updateSettings/setMirrorSession/checkBuild）。
- **h5:enable**：首次调用创建 H5Server 并用 `settings.fixedPort` 调 `start(port)`；返回 `{ status, token }`；`registerProjectRoot(lastKnownProjectPath)` 重放；二次调用复用实例（构造函数计数=1）。
- **h5:disable**：有服务器时 `stop()`；无服务器时不抛；两种情况都调 `authService.disable()`。
- **h5:regenerateToken**：有服务器 → `stop()` + 新实例 + `start()`；无服务器 → 返回默认 `{ running:false, port:0, ... }` 状态。
- **h5:getStatus**：有/无服务器两个出口。
- **h5:getSettings / h5:updateSettings** 透传。
- **h5:setMirrorSession**：projectPath 非空时更新 lastKnownProjectPath 并转发 `setMirrorSession`；projectPath 为 null 时保留旧值。
- **h5:checkBuild**：`existsSync(dist/index.html)` 决定 `{ built, path }`。
- **直接导出**：`setH5Server(server/null)` 的 applyProjectRoot 行为、`getH5Server()`、`getH5AuthService()`。

## 测试规范遵循

- 新测试放 `electron/<dir>/__tests__/`（vitest `include` 三条 pattern 均覆盖）；主进程测试首行声明 `// @vitest-environment node`。
- 沿用仓库既有 mocking 惯例（`vi.hoisted` probe + `vi.mock` 工厂，参考 `coreIpcHandlers.test.ts`）。
- 测试文件直接 import 被测模块本身（`editorLauncher` / `registerH5AccessIPCHandlers`），不手抄实现 —— 符合 ADR-0011。

## 验证

1. 开发期定向跑：`npx vitest run electron/ipc/__tests__/editorLauncher.test.ts electron/ipc/__tests__/h5IpcHandlers.test.ts`
2. `npm run test:changed`（两个新文件在改动集内会连带 ipc 相关测试）
3. 用户要求全量：`npm run test` 全部通过
4. 可选（不阻塞）：跑一次 `npm run test:coverage` 确认 `electron/ipc` 两个文件脱离 0%，但**不修改任何阈值**

## Assumptions / Defaults

- 范围严格限定在这 2 个模块（用户要求 1-2 个）；`imIpcHandlers.ts`/`rtkIpcHandlers.ts` 不纳入本次。
- 以「当前树中无测试 import 即视为 0%」+ 过期报告做基线；不做预热全量 coverage（非本次目标）。
- 不修改 `vitest.config.ts` 阈值（棘轮只允许上调且需同批补测，本次非必需）。
- 生产代码零改动；仅新增测试文件。
