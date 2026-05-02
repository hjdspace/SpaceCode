# Claude Code GUI Engine 启动参数比对与移植优化建议

> 对比基准：
> - **参考实现**：`D:\AI\compare\claude-desktop-app\electron\bridge-server.cjs` 中的 `spawnPersistentEngine` 函数（约 L4016-L4141）
> - **当前实现**：`d:\AI\claude-code-gui\electron\claudeCodeProcessManager.ts` 中的 `startSession` 及相关方法
> - **分析日期**：2026-05-02

---

## 一、参考实现（bridge-server.cjs）核心启动逻辑拆解

### 1.1 CLI 参数构建

```js
const cliArgs = [
  //'--preload', enginePreload,           // 预加载脚本
  '--env-file=' + engineEnv,            // .env 文件路径
  engineCli,                            // CLI 入口文件
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode', 'bypassPermissions',
  '--permission-prompt-tool', 'stdio',
  '--add-dir', claudeDir,               // ~/.claude 目录
  '--model', modelId,
];

// Thinking 开关
cliArgs.push('--thinking', config.thinkingEnabled ? 'enabled' : 'disabled');

// Session 恢复
if (conv.claude_session_id) {
  cliArgs.push('--resume', conv.claude_session_id);
  if (conv.pendingResumeAt) {
    cliArgs.push('--resume-session-at', conv.pendingResumeAt);
  }
}

// 系统提示追加
if (sysPrompt) cliArgs.push('--append-system-prompt', sysPrompt);
```

### 1.2 环境变量构建

```js
const envVars = Object.assign({}, process.env);

// Windows Git Bash 路径
if (gitBashPath && !envVars.CLAUDE_CODE_GIT_BASH_PATH) {
  envVars.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
}

// Read 工具 token 上限提升
if (!envVars.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS) {
  envVars.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS = '80000';
}

// OpenAI 代理模式
if (apiFormat === 'openai' && proxyPort > 0) {
  proxyTarget = { apiKey, baseUrl, model: modelId, format: 'openai', ... };
  envVars.ANTHROPIC_API_KEY = 'proxy-key';
  envVars.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + proxyPort + '/v1';
} else {
  if (apiKey) envVars.ANTHROPIC_API_KEY = apiKey;
  envVars.ANTHROPIC_BASE_URL = normalizeBaseUrl(baseUrl || engineEnvVars.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
}
```

### 1.3 进程启动选项

```js
const child = spawn(bunExePath, cliArgs, {
  cwd: conv.workspace_path,
  env: envVars,
  stdio: ['pipe', 'pipe', 'pipe']
});
```

### 1.4 引擎生命周期管理（Engine Pool）

参考实现实现了完整的 **持久化引擎池（Persistent Engine Pool）**：

| 特性 | 说明 |
|------|------|
| **池大小限制** | `MAX_ENGINE_POOL_SIZE = 3`，超出时驱逐最旧的空闲引擎 |
| **引擎复用** | 按 `conversationId` 复用引擎，避免频繁启停 |
| **状态追踪** | `idle` / `processing` 状态管理 |
| **就绪检测** | 监听 `system/init` 事件确认引擎就绪 |
| **自动重启** | 配置变更（model/apiKey/baseUrl/thinking）时自动重启 |
| **会话恢复** | 支持 `--resume` 和 `--resume-session-at` 恢复历史会话 |
| **回合超时** | 空闲超时（5分钟）+ 硬超时（30分钟） |
| **优雅关闭** | `stdin.end()` + `kill()` 双重关闭 |
| **心跳保活** | 每 15 秒发送 SSE heartbeat |

### 1.5 消息格式差异

**参考实现发送用户消息时包含 UUID**：
```js
engine.child.stdin.write(JSON.stringify({
  type: 'user',
  message: { role: 'user', content: finalPrompt },
  uuid: userMsgUuid  // <-- 关键：与数据库消息 ID 同步
}) + '\n');
```

**当前实现缺少 UUID**：
```ts
const msg = JSON.stringify({
  type: 'user',
  message: { role: 'user', content }
}) + '\n'
```

---

## 二、当前实现（claudeCodeProcessManager.ts）缺失项清单

### 2.1 CLI 参数缺失

| 缺失参数 | 参考实现 | 当前实现 | 影响 | 优先级 |
|----------|----------|----------|------|--------|
| `--preload` | ✅ `enginePreload` (preload.ts) | ✅ 已实现（批次1） | 开发模式预加载引擎模块 | - |
| `--env-file` | ✅ `engineEnv` (.env) | ✅ 已实现（批次1） | 加载引擎环境配置 | - |
| `--permission-mode` | ✅ `bypassPermissions` | ✅ 已实现（可配置） | - | - |
| `--permission-prompt-tool` | ✅ `stdio` | ✅ 已实现（批次1） | 权限提示工具输出方式 | - |
| `--add-dir` | ✅ `~/.claude` | ✅ 已实现（批次1） | 添加 Claude 配置目录 | - |
| `--thinking` | ✅ `enabled/disabled` | ✅ 已实现（批次1） | thinking 模式开关 | - |
| `--resume` | ✅ `conv.claude_session_id` | ❌ 未实现 | 无法恢复历史会话 | **高** |
| `--resume-session-at` | ✅ `conv.pendingResumeAt` | ❌ 未实现 | 无法按消息 ID 回滚 | **高** |
| `--append-system-prompt` | ✅ `sysPrompt` | ✅ 已实现 | - | - |
| `--model` | ✅ `modelId` | ✅ 已实现 | - | - |

### 2.2 环境变量缺失

| 缺失变量 | 参考实现 | 当前实现 | 影响 | 优先级 |
|----------|----------|----------|------|--------|
| `CLAUDE_CODE_GIT_BASH_PATH` | ✅ 自动检测 | ✅ 已实现（批次1） | Windows Bash 工具链 | - |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | ✅ `80000` | ✅ 已实现（批次1） | 大文件读取上限 | - |
| `ANTHROPIC_API_KEY` | ✅ 统一设置 | ✅ 已实现 | - | - |
| `ANTHROPIC_BASE_URL` | ✅ 统一设置 | ✅ 已实现 | - | - |
| `OPENAI_API_KEY` | ✅ 代理模式 | ✅ 已实现（直接设置） | - | - |
| `LLM_PROVIDER` | ❌ 未使用 | ✅ 已设置 | 当前实现更通用 | - |

### 2.3 架构/生命周期缺失

| 缺失特性 | 参考实现 | 当前实现 | 影响 | 优先级 |
|----------|----------|----------|------|--------|
| **引擎池（Engine Pool）** | ✅ Map 管理多引擎 | ❌ 单进程实例 | 无法并发多会话 | **高** |
| **持久化进程** | ✅ 会话间保持进程 | ❌ 每次 startSession 新建 | 启动慢、状态丢失 | **高** |
| **引擎就绪检测** | ✅ 监听 `system/init` | ❌ 无就绪检测 | 可能向未就绪引擎发消息 | **高** |
| **配置变更自动重启** | ✅ 对比 model/key/url/thinking | ❌ 仅对比 cwd | 切换模型后仍用旧引擎 | **高** |
| **会话恢复机制** | ✅ `--resume` + sessionId | ❌ 无 | 每次新建会话，历史丢失 | **高** |
| **消息 UUID 同步** | ✅ 发送时带 uuid | ❌ 无 uuid | 无法支持消息回滚/重试 | **高** |
| **回合状态管理** | ✅ `idle`/`processing` | ❌ 无状态追踪 | 无法检测引擎是否忙 | **高** |
| **超时管理** | ✅ 空闲+硬超时 | ❌ 无 | 卡死无自动恢复 | 中 |
| **优雅关闭** | ✅ `stdin.end()` + `kill()` | ❌ 仅 `kill()` | 可能导致数据丢失 | 中 |
| **stderr 缓冲分析** | ✅ 退出时输出 stderr | ❌ 仅转发 log 事件 | 故障诊断信息不足 | 低 |
| **OpenAI 代理模式** | ✅ 本地代理转换 | ❌ 直接调用 | OpenAI 格式支持不完整 | 中 |

### 2.4 Bun 路径解析差异

| 特性 | 参考实现 | 当前实现 |
|------|----------|----------|
| 平台特定二进制 | ❌ 仅 `bun.exe`/`bun` | ✅ `bun-windows-x64`/`bun-darwin-arm64` 等 |
| 用户安装路径 | ✅ `~/.bun/bin/bun` | ❌ 未检查 |
| PATH 回退 | ✅ 最后回退 `bun` | ✅ 最后回退 `bun` |
| **结论** | 当前实现更优，保留现有逻辑 | - |

### 2.5 开发模式特性差异

| 特性 | 参考实现 | 当前实现 |
|------|----------|----------|
| `--feature` 标志 | ❌ 未使用 | ✅ 大量功能开关 |
| `MACRO` 定义 | ❌ 未使用 | ✅ 开发模式宏定义 |
| **结论** | 当前实现更优，保留现有逻辑 | - |

---

## 三、移植优化建议（按批次规划）

### 批次 1：核心启动参数补齐（最小可用） ✅ 已完成

**目标**：让引擎能够正确启动并进入就绪状态。

1. **添加 `--preload` 参数** ✅
   - 路径：`path.join(this.cliRoot, 'preload.ts')`
   - 开发模式有效，生产模式（`dist/cli.js`）可忽略
   - 实现：`buildArgs` 中检测 `useSource` 条件后追加

2. **添加 `--env-file` 参数** ✅
   - 路径：`path.join(this.cliRoot, '.env')`
   - 需先判断文件存在性
   - 实现：`buildArgs` 中检测 `useSource` 条件后追加

3. **添加 `--permission-prompt-tool stdio`** ✅
   - 固定值，与 `permissionMode` 配合使用
   - 实现：`buildArgs` 末尾无条件追加

4. **添加 `--add-dir` 参数** ✅
   - 路径：`path.join(os.homedir(), '.claude')`
   - 确保目录存在
   - 实现：`buildArgs` 末尾检测目录存在后追加

5. **添加 `--thinking` 参数** ✅
   - 在 `SessionConfig` 中新增 `thinkingEnabled?: boolean`
   - 映射为 `--thinking enabled/disabled`
   - 实现：`SessionConfig` 接口新增字段，`buildArgs` 末尾追加

6. **环境变量增强** ✅
   - `CLAUDE_CODE_GIT_BASH_PATH`：Windows Git Bash 自动检测
   - `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=80000`：提升 Read 工具 token 上限
   - 实现：`buildEnv` 中追加，`findGitBashPath()` 私有方法移植自参考实现

### 批次 2：会话持久化与恢复（高价值）

**目标**：实现引擎复用和会话恢复，避免频繁启停。

1. **引入 Engine Pool 架构**
   - 将单进程改为 `Map<string, Engine>` 管理
   - 每个 Engine 包含 `child`, `state`, `lastUsed`, `sessionId` 等

2. **实现 `--resume` 参数**
   - 在 `SessionConfig` 中新增 `sessionId?: string`
   - 引擎首次启动后从 `system/init` 事件捕获 `session_id`

3. **实现消息 UUID 同步**
   - `sendMessage` 方法支持传入可选 `uuid`
   - 默认生成 `randomUUID()`

4. **引擎就绪检测**
   - 监听 `system/init` 事件
   - `startSession` 返回 Promise 在就绪后 resolve

### 批次 3：配置动态切换与生命周期增强

**目标**：支持运行时切换模型/密钥，增强稳定性。

1. **配置变更检测**
   - 对比 `modelId`, `apiKey`, `baseUrl`, `thinkingEnabled`
   - 不匹配时自动重启引擎

2. **添加 `--resume-session-at` 支持**
   - 在 `SessionConfig` 中新增 `resumeAt?: string`
   - 用于删除/编辑消息后的上下文回滚

3. **Windows Git Bash 检测**
   - 移植 `findGitBashPath()` 逻辑
   - 设置 `CLAUDE_CODE_GIT_BASH_PATH`

4. **Read 工具 Token 上限**
   - 设置 `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=80000`

### 批次 4：高级功能与稳定性

**目标**：生产环境稳定运行。

1. **回合超时管理**
   - 空闲超时（5分钟）
   - 硬超时（30分钟，可配置）

2. **优雅关闭**
   - `stop()` 方法先 `stdin.end()` 再 `kill()`

3. **OpenAI 代理模式**（可选）
   - 如需完整支持 OpenAI 格式，需引入代理服务器
   - 复杂度较高，可延后

4. **心跳保活**
   - 在应用层实现 SSE heartbeat

---

## 四、关键代码参考片段

### 4.1 参考实现的引擎结构

```js
const engine = {
  child,           // ChildProcess
  convId,          // 会话 ID
  modelId,         // 当前模型
  thinkingEnabled, // thinking 开关
  apiKey,          // API 密钥
  baseUrl,         // API 地址
  apiFormat,       // 'anthropic' | 'openai'
  lastUsed,        // 最后使用时间
  sessionId,       // 引擎会话 ID
  state: 'idle',   // 'idle' | 'processing'
  buf: '',         // stdout 缓冲
  turn: null,      // 当前回合状态
  needsRestart: false,
  ready: false,
  readyPromise,    // 就绪 Promise
  resolveReady,    // 就绪 resolve 函数
};
```

### 4.2 参考实现的引擎就绪检测

```js
if (evt.type === 'system' && evt.subtype === 'init') {
  engine.ready = true;
  if (engine.resolveReady) {
    try { engine.resolveReady(); } catch (_) {}
    engine.resolveReady = null;
  }
  console.log('[EnginePool] Engine init event for', convId);
  return;
}
```

### 4.3 参考实现的配置变更检测

```js
const apiKeyChanged = !!engine && engine.apiKey !== config.apiKey;
const baseUrlChanged = !!engine && engine.baseUrl !== config.baseUrl;
const apiFormatChanged = !!engine && engine.apiFormat !== config.apiFormat;
const thinkingChanged = !!engine && !!engine.thinkingEnabled !== !!config.thinkingEnabled;

if (engine && (!isEngineAlive(engine) ||
    engine.modelId !== config.modelId ||
    thinkingChanged ||
    engine.needsRestart ||
    apiKeyChanged ||
    baseUrlChanged ||
    apiFormatChanged)) {
  killEngine(convId, '...');
  engine = null;
}
```

---

## 五、风险与注意事项

1. **向后兼容**：`SessionConfig` 接口新增字段需为可选，避免破坏现有调用方。
2. **平台差异**：`--preload` 和 `--env-file` 在 Bun 直接运行 `.ts` 文件时有效，使用 `dist/cli.js` 时需验证。
3. **引擎版本**：确保目标引擎版本支持所有新增参数（`--thinking`、`--resume` 等）。
4. **状态机复杂度**：引入 `idle`/`processing` 状态后，需仔细处理边缘情况（引擎崩溃、中途 kill 等）。
5. **内存泄漏**：Engine Pool 需设置上限和驱逐策略，避免长期运行后内存泄漏。

---

## 六、总结

当前实现是一个**简化版**的引擎管理器，能够完成基本的启动、发送消息、接收响应功能，但在**持久化、会话恢复、配置动态切换、生命周期管理**等方面与参考实现存在显著差距。

建议按上述**四个批次**逐步移植，每批次完成后进行充分测试，确保功能正确性。批次 1 和批次 2 为核心功能，建议优先实施。
