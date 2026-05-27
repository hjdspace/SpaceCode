# Engine 源码运行支持实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 Engine 源码直接运行支持，开发模式优先使用源码，生产模式支持回退到源码，同时添加捆绑 Bun 二进制支持。

**架构：** 修改 `claudeCodeProcessManager.ts`，添加 `resolveBunPath()` 方法优先查找捆绑的 Bun 二进制，调整 `resolveCliCommand()` 方法让开发模式优先使用源码运行。

**技术栈：** TypeScript, Electron, Bun

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `electron/claudeCodeProcessManager.ts` | 修改：添加 Bun 路径解析，调整 CLI 命令解析逻辑 |
| `package.json` | 修改：更新 `extraResources` 配置，包含 engine 源码和 bun 二进制 |

---

## 任务 1：添加 Bun 路径解析方法

**文件：**
- 修改：`electron/claudeCodeProcessManager.ts`

- [ ] **步骤 1：在 `ClaudeCodeProcessManager` 类中添加 `resolveBunPath` 方法**

在类中找到 `constructor` 方法，在其后添加新方法：

```typescript
  /**
   * 解析 Bun 可执行文件路径
   * 优先级：1. 捆绑的 bun 二进制 > 2. 系统 PATH 中的 bun
   */
  private resolveBunPath(): string {
    const platform = process.platform
    const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
    
    // 1. 优先使用捆绑的 bun 二进制
    const bundledBun = path.join(
      this.cliRoot, 'bin', bunName
    )
    
    if (fs.existsSync(bundledBun)) {
      console.log('[Engine] Using bundled bun:', bundledBun)
      return bundledBun
    }
    
    // 2. 检查用户是否通过 npm/yarn 全局安装了 bun
    try {
      const { execSync } = require('child_process')
      const cmd = platform === 'win32' ? 'where bun' : 'which bun'
      const globalBun = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\n')[0]
      if (globalBun && fs.existsSync(globalBun)) {
        console.log('[Engine] Using global bun:', globalBun)
        return globalBun
      }
    } catch {
      // not found, fall through
    }
    
    // 3. 回退到 PATH 中的 bun
    console.log('[Engine] Using bun from PATH')
    return 'bun'
  }
```

- [ ] **步骤 2：Commit**

```bash
git add electron/claudeCodeProcessManager.ts
git commit -m "feat: add resolveBunPath method to find bundled or system bun"
```

---

## 任务 2：修改 CLI 命令解析逻辑

**文件：**
- 修改：`electron/claudeCodeProcessManager.ts:170-190`

- [ ] **步骤 1：替换 `resolveCliCommand` 方法**

找到 `resolveCliCommand` 方法（约第 170 行），替换为以下实现：

```typescript
  private resolveCliCommand(): { command: string; args: string[] } {
    const isDev = !app.isPackaged
    
    // 开发模式：优先使用源码（更快迭代，无需等待构建）
    if (isDev) {
      const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
      if (fs.existsSync(srcCliPath)) {
        console.log('[Engine] Using source code (dev mode):', srcCliPath)
        const defineArgs = this.getMacroDefines()
        const featureArgs = this.getFeatureArgs()
        return {
          command: this.resolveBunPath(),
          args: ['run', ...defineArgs, ...featureArgs, srcCliPath]
        }
      }
    }
    
    // 生产模式：优先使用构建产物（启动更快）
    const distCli = path.join(this.cliRoot, 'dist/cli.js')
    if (fs.existsSync(distCli)) {
      console.log('[Engine] Using built distribution:', distCli)
      return { command: this.resolveBunPath(), args: ['run', distCli] }
    }
    
    // 回退到源码（生产环境但无构建产物时）
    const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
    if (fs.existsSync(srcCliPath)) {
      console.log('[Engine] Using source code (fallback):', srcCliPath)
      const defineArgs = this.getMacroDefines()
      const featureArgs = this.getFeatureArgs()
      return {
        command: this.resolveBunPath(),
        args: ['run', ...defineArgs, ...featureArgs, srcCliPath]
      }
    }

    // 最后回退到全局安装的 claude 命令
    console.warn('[Engine] No local engine found, falling back to global claude command')
    return { command: 'claude', args: [] }
  }
```

- [ ] **步骤 2：Commit**

```bash
git add electron/claudeCodeProcessManager.ts
git commit -m "feat: prioritize source code in dev mode, add fallback chain"
```

---

## 任务 3：更新 package.json 打包配置

**文件：**
- 修改：`package.json`

- [ ] **步骤 1：修改 `build.extraResources` 配置**

找到 `package.json` 中的 `build` 字段，将 `extraResources` 更新为：

```json
    "extraResources": [
      {
        "from": ".env",
        "to": ".env"
      },
      {
        "from": "engine/src",
        "to": "engine/src",
        "filter": [
          "**/*.ts",
          "**/*.tsx",
          "**/*.js",
          "**/*.json",
          "**/*.txt",
          "**/*.md"
        ]
      },
      {
        "from": "engine/package.json",
        "to": "engine/package.json"
      },
      {
        "from": "engine/bunfig.toml",
        "to": "engine/bunfig.toml"
      },
      {
        "from": "engine/node_modules",
        "to": "engine/node_modules"
      },
      {
        "from": "engine/bin",
        "to": "engine/bin"
      },
      {
        "from": "engine/dist",
        "to": "engine/dist"
      }
    ]
```

- [ ] **步骤 2：Commit**

```bash
git add package.json
git commit -m "build: update extraResources to include engine source and bun binary"
```

---

## 任务 4：验证实现

**文件：**
- 验证：`electron/claudeCodeProcessManager.ts`

- [ ] **步骤 1：类型检查**

```bash
npx vue-tsc --noEmit
```

预期：无类型错误

- [ ] **步骤 2：开发模式测试**

```bash
npm run electron:dev
```

预期输出包含：
```
[Engine] Using source code (dev mode): .../engine/src/entrypoints/cli.tsx
[Engine] Using bundled bun: .../engine/bin/bun.exe
```

或（无捆绑 bun 时）：
```
[Engine] Using source code (dev mode): .../engine/src/entrypoints/cli.tsx
[Engine] Using bun from PATH
```

- [ ] **步骤 3：Commit**

```bash
git commit -m "test: verify source code runtime implementation"
```

---

## 自检

- [x] **规格覆盖度：** 所有需求都有对应任务
  - 开发模式优先使用源码 ✓
  - 生产模式支持回退到源码 ✓
  - 捆绑 Bun 二进制支持 ✓
  - 打包配置更新 ✓

- [x] **占位符扫描：** 无 TODO/待定

- [x] **类型一致性：** 方法签名保持一致

---

## 执行选项

**计划已完成。**

**执行方式：**

1. **子代理驱动（推荐）** - 使用 `superpowers:subagent-driven-development` 逐任务执行
2. **内联执行** - 在当前会话中使用 `superpowers:executing-plans` 批量执行

**建议：** 选择内联执行，因为任务数量少且相互依赖。
