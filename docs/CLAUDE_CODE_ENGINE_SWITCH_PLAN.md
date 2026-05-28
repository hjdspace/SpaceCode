# Claude Code CLI 引擎切换方案

## 一、背景与目标

### 当前实现
当前前端使用的是内置的 Claude Code 源码版本，通过以下流程启动：
1. `settings.ts` 存储 `engineType` 配置
2. 前端调用 `electronAPI.claudeCode.startSession()`
3. IPC handler 转发到 `EngineFactory`
4. `ClaudeCodeEngine` → `ClaudeCodeProcessPool` → `SessionProcess`
5. `resolveCliCommand()` 解析 CLI 路径并 spawn 进程

### 目标
允许用户在以下两种模式间切换：
1. **内置模式（当前默认）**：使用打包的 engine 源码
2. **官网模式（新功能）**：使用用户本地安装的 Claude Code CLI

## 二、架构分析

### 关键文件及职责

| 文件路径 | 职责 |
|---------|------|
| `src/stores/settings.ts` | 存储引擎类型配置 |
| `electron/claudeCodeIPC.ts` | IPC 通信层 |
| `electron/engines/EngineFactory.ts` | 引擎工厂 |
| `electron/engines/ClaudeCodeEngine.ts` | Claude Code 引擎封装 |
| `electron/claudeCodeProcessPool.ts` | 进程池管理 |
| `electron/sessionProcess.ts` | **核心：进程 spawn 和 CLI 解析** |
| `electron/claudeCodeProcessManager.ts` | CLI 命令解析（备用） |

### 核心逻辑位置
**`electron/sessionProcess.ts` 的 `resolveCliCommand()` 方法**（第 991-1062 行）是关键：

```typescript
private resolveCliCommand(): { command: string; args: string[]; launcherEnv?: Record<string, string> } {
  const isDev = !app.isPackaged

  if (isDev) {
    // 开发模式：使用 engine 源码
  }

  // 生产模式：优先使用构建产物
  const desktopCli = path.join(this.cliRoot, 'dist-desktop/cli.js')
  if (fs.existsSync(desktopCli)) {
    // 使用打包的 CLI
  }

  // 回退到全局 claude 命令
  return { command: 'claude', args: [] }
}
```

## 三、实现方案

### 方案一：添加新的引擎类型（推荐）

#### 1.1 修改类型定义

**修改文件：`electron/engines/types.ts`**

```typescript
export type EngineSource = 'bundled' | 'installed'

export type EngineType = 'claude-code' | 'pi' | 'claude-code-installed'

export interface EngineConfig {
  source: EngineSource
  cliPath?: string  // 当 source='installed' 时，指定 CLI 路径
}
```

**修改文件：`src/stores/settings.ts`**

```typescript
export type EngineType = 'claude-code' | 'pi' | 'claude-code-installed'

export interface AuthSettings {
  // ... 现有字段
  engineType?: EngineType
  engineSource?: EngineSource  // 新增
  installedCliPath?: string     // 新增：缓存已检测到的 CLI 路径
}
```

#### 1.2 添加 CLI 检测和安装逻辑

**新增文件：`electron/cliInstaller.ts`**

```typescript
import { execSync } from 'child_process'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface CliDetectionResult {
  available: boolean
  path: string | null
  version: string | null
}

export interface EnvironmentCheck {
  node: { available: boolean; version: string | null }
  git: { available: boolean; version: string | null }
  npm: { available: boolean; version: string | null }
}

export interface InstallationResult {
  success: boolean
  error?: string
  path?: string
}

/**
 * 检测系统环境（Node.js, Git）
 */
export async function checkEnvironment(): Promise<EnvironmentCheck> {
  const checkCommand = (cmd: string, arg: string = '--version'): { available: boolean; version: string | null } => {
    try {
      const out = execSync(`${cmd} ${arg}`, { encoding: 'utf8', timeout: 5000 })
      const version = out.match(/\d+\.\d+\.\d+/)
      return { available: true, version: version ? version[0] : out.trim() }
    } catch {
      return { available: false, version: null }
    }
  }

  return {
    node: checkCommand('node'),
    git: checkCommand('git'),
    npm: checkCommand('npm'),
  }
}

/**
 * 检测已安装的 Claude Code CLI
 */
export async function detectInstalledCli(): Promise<CliDetectionResult> {
  // 1. 尝试从 PATH 中查找
  const commands = process.platform === 'win32'
    ? ['where claude', 'where claude-code']
    : ['which claude', 'which claude-code']

  for (const cmd of commands) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 })
      const cliPath = out.trim().split('\n')[0]

      if (fs.existsSync(cliPath)) {
        // 获取版本信息
        const versionOut = execSync(`"${cliPath}" --version`, { encoding: 'utf8', timeout: 5000 })
        const versionMatch = versionOut.match(/\d+\.\d+\.\d+/)
        const version = versionMatch ? versionMatch[0] : null

        return {
          available: true,
          path: cliPath,
          version,
        }
      }
    } catch {
      continue
    }
  }

  // 2. 检查常见安装路径
  const commonPaths = getCommonCliPaths()
  for (const cliPath of commonPaths) {
    if (fs.existsSync(cliPath)) {
      try {
        const versionOut = execSync(`"${cliPath}" --version`, { encoding: 'utf8', timeout: 5000 })
        const versionMatch = versionOut.match(/\d+\.\d+\.\d+/)
        return {
          available: true,
          path: cliPath,
          version: versionMatch ? versionMatch[0] : null,
        }
      } catch {
        continue
      }
    }
  }

  return { available: false, path: null, version: null }
}

function getCommonCliPaths(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return [
      path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
      path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
    ]
  } else if (process.platform === 'darwin') {
    return [
      '/usr/local/bin/claude',
      path.join(home, '.claude', 'bin', 'claude'),
      path.join(home, 'npm', 'bin', 'claude'),
    ]
  } else {
    return [
      '/usr/local/bin/claude',
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, '.claude', 'bin', 'claude'),
      path.join(home, 'npm', 'bin', 'claude'),
    ]
  }
}

/**
 * 安装 Claude Code CLI（通过 npm）
 */
export async function installCli(): Promise<InstallationResult> {
  return new Promise((resolve) => {
    const npmPath = process.platform === 'win32' ? 'npm.cmd' : 'npm'

    // 使用 npm 安装 -g 全局安装
    const child = spawn(npmPath, ['install', '-g', '@anthropic-ai/claude-code'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        // 安装成功后重新检测
        detectInstalledCli().then(result => {
          if (result.available) {
            resolve({ success: true, path: result.path! })
          } else {
            resolve({ success: false, error: '安装成功但找不到 CLI' })
          }
        })
      } else {
        resolve({
          success: false,
          error: stderr || `安装失败，退出码: ${code}`,
        })
      }
    })

    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

/**
 * 验证 CLI 是否可以正常运行
 */
export async function validateCli(cliPath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const out = execSync(`"${cliPath}" --version`, { encoding: 'utf8', timeout: 5000 })
    if (out.includes('claude')) {
      return { valid: true }
    }
    return { valid: false, error: 'CLI 版本信息不匹配' }
  } catch (err: any) {
    return { valid: false, error: err.message }
  }
}
```

#### 1.3 修改 CLI 解析逻辑

**修改文件：`electron/sessionProcess.ts`**

```typescript
// 在构造函数或 start() 方法中添加 source 参数
export interface SessionConfig {
  cwd: string
  // ... 现有字段
  engineSource?: 'bundled' | 'installed'  // 新增
  installedCliPath?: string                 // 新增
}

// 修改 resolveCliCommand 方法
private resolveCliCommand(): { command: string; args: string[]; launcherEnv?: Record<string, string> } {
  // 如果使用已安装的 CLI
  if (this.config.engineSource === 'installed') {
    return this.resolveInstalledCliCommand()
  }

  // 否则使用内置版本（原有逻辑）
  return this.resolveBundledCliCommand()
}

private resolveInstalledCliCommand(): { command: string; args: string[] } {
  const cliPath = this.config.installedCliPath || 'claude'

  // 已安装的 CLI 不需要 bun，直接调用
  // 但是需要传递一些参数来确保兼容 SDK 模式
  return {
    command: cliPath,
    args: [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
    ],
  }
}

private resolveBundledCliCommand(): { command: string; args: string[]; launcherEnv?: Record<string, string> } {
  // 保留原有的 resolveCliCommand 逻辑
  // ...
}
```

#### 1.4 添加 IPC handlers

**修改文件：`electron/claudeCodeIPC.ts`**

```typescript
import { ipcMain } from 'electron'
import { detectInstalledCli, checkEnvironment, installCli, validateCli } from './cliInstaller'
import { info, warn, error, debug } from './logger'

// 在 registerClaudeCodeIPC() 函数中添加：

// 检测已安装的 CLI
ipcMain.handle('claude-code:detectInstalledCli', async () => {
  info('ClaudeCodeIPC', '→ detectInstalledCli')
  try {
    const result = await detectInstalledCli()
    info('ClaudeCodeIPC', `← detectInstalledCli | available=${result.available} | path=${result.path} | version=${result.version}`)
    return result
  } catch (err) {
    error('ClaudeCodeIPC', '✗ detectInstalledCli', { error: String(err) })
    return { available: false, path: null, version: null }
  }
})

// 检查环境依赖
ipcMain.handle('claude-code:checkEnvironment', async () => {
  info('ClaudeCodeIPC', '→ checkEnvironment')
  try {
    const result = await checkEnvironment()
    info('ClaudeCodeIPC', `← checkEnvironment | node=${result.node.available} | git=${result.git.available} | npm=${result.npm.available}`)
    return result
  } catch (err) {
    error('ClaudeCodeIPC', '✗ checkEnvironment', { error: String(err) })
    throw err
  }
})

// 安装 CLI
ipcMain.handle('claude-code:installCli', async () => {
  info('ClaudeCodeIPC', '→ installCli')
  const startMs = Date.now()
  try {
    const result = await installCli()
    info('ClaudeCodeIPC', `← installCli | success=${result.success} | elapsed=${Date.now() - startMs}ms`)
    return result
  } catch (err) {
    error('ClaudeCodeIPC', '✗ installCli', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// 验证 CLI
ipcMain.handle('claude-code:validateCli', async (_, cliPath: string) => {
  info('ClaudeCodeIPC', `→ validateCli | path=${cliPath}`)
  try {
    const result = await validateCli(cliPath)
    return result
  } catch (err) {
    return { valid: false, error: String(err) }
  }
})
```

#### 1.5 更新前端 preload API

**修改文件：`electron/preload.ts`**

```typescript
// 在 claudeCode 对象中添加新方法
claudeCode: {
  // ... 现有方法

  // 新增：CLI 检测和安装
  detectInstalledCli: () =>
    ipcRenderer.invoke('claude-code:detectInstalledCli'),
  checkEnvironment: () =>
    ipcRenderer.invoke('claude-code:checkEnvironment'),
  installCli: () =>
    ipcRenderer.invoke('claude-code:installCli'),
  validateCli: (cliPath: string) =>
    ipcRenderer.invoke('claude-code:validateCli', cliPath),

  // ... 其他现有方法
}
```

#### 1.6 更新前端 API 封装

**修改文件：`src/services/electronAPI.ts`**

```typescript
// 在 claudeCode 对象中添加
claudeCode: {
  // ... 现有方法

  detectInstalledCli: (): Promise<{
    available: boolean
    path: string | null
    version: string | null
  }> => {
    if (electronAPI?.claudeCode?.detectInstalledCli) {
      return electronAPI.claudeCode.detectInstalledCli()
    }
    return Promise.resolve({ available: false, path: null, version: null })
  },

  checkEnvironment: (): Promise<{
    node: { available: boolean; version: string | null }
    git: { available: boolean; version: string | null }
    npm: { available: boolean; version: string | null }
  }> => {
    if (electronAPI?.claudeCode?.checkEnvironment) {
      return electronAPI.claudeCode.checkEnvironment()
    }
    return Promise.resolve({
      node: { available: false, version: null },
      git: { available: false, version: null },
      npm: { available: false, version: null },
    })
  },

  installCli: (): Promise<{ success: boolean; error?: string; path?: string }> => {
    if (electronAPI?.claudeCode?.installCli) {
      return electronAPI.claudeCode.installCli()
    }
    return Promise.resolve({ success: false, error: 'API not available' })
  },

  validateCli: (cliPath: string): Promise<{ valid: boolean; error?: string }> => {
    if (electronAPI?.claudeCode?.validateCli) {
      return electronAPI.claudeCode.validateCli(cliPath)
    }
    return Promise.resolve({ valid: false, error: 'API not available' })
  },
}
```

#### 1.7 创建前端设置界面组件

**新增文件：`src/components/settings/EngineSettings.vue`**

```vue
<template>
  <div class="engine-settings">
    <div class="setting-group">
      <h3>Claude Code 引擎设置</h3>

      <!-- 引擎类型选择 -->
      <div class="radio-group">
        <label class="radio-option">
          <input
            type="radio"
            v-model="engineSource"
            value="bundled"
            @change="onEngineSourceChange"
          />
          <div class="radio-content">
            <span class="radio-title">内置引擎（推荐）</span>
            <span class="radio-desc">使用应用内置的 Claude Code 源码版本</span>
          </div>
        </label>

        <label class="radio-option">
          <input
            type="radio"
            v-model="engineSource"
            value="installed"
            @change="onEngineSourceChange"
          />
          <div class="radio-content">
            <span class="radio-title">已安装版本</span>
            <span class="radio-desc">使用本地安装的 Claude Code CLI</span>
          </div>
        </label>
      </div>

      <!-- 已安装版本检测 -->
      <div v-if="engineSource === 'installed'" class="installed-section">
        <div class="detection-status">
          <div v-if="isDetecting" class="status-detecting">
            <span class="spinner"></span>
            正在检测...
          </div>

          <div v-else-if="!detectionResult.available" class="status-not-found">
            <div class="warning-message">
              <span class="icon">⚠️</span>
              未检测到 Claude Code CLI
            </div>

            <!-- 环境检测 -->
            <div class="env-check">
              <div class="env-item" :class="{ ok: envCheck.node.available }">
                Node.js: {{ envCheck.node.version || '未安装' }}
              </div>
              <div class="env-item" :class="{ ok: envCheck.git.available }">
                Git: {{ envCheck.git.version || '未安装' }}
              </div>
              <div class="env-item" :class="{ ok: envCheck.npm.available }">
                npm: {{ envCheck.npm.version || '未安装' }}
              </div>
            </div>

            <!-- 安装按钮 -->
            <div v-if="canInstall" class="install-section">
              <button
                @click="installCli"
                :disabled="isInstalling"
                class="btn-primary"
              >
                {{ isInstalling ? '正在安装...' : '一键安装 Claude Code CLI' }}
              </button>
              <div v-if="installError" class="error-message">
                安装失败: {{ installError }}
              </div>
            </div>

            <div v-else class="missing-deps">
              请先安装所需的依赖（Node.js, Git, npm）
            </div>
          </div>

          <div v-else class="status-found">
            <span class="icon">✅</span>
            <span>
              已检测到 Claude Code CLI
              <span class="version">{{ detectionResult.version }}</span>
            </span>
            <span class="path">{{ detectionResult.path }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'

const settingsStore = useSettingsStore()

const engineSource = ref(settingsStore.engineSource || 'bundled')
const isDetecting = ref(false)
const detectionResult = ref({ available: false, path: null as string | null, version: null as string | null })
const envCheck = ref({
  node: { available: false, version: null as string | null },
  git: { available: false, version: null as string | null },
  npm: { available: false, version: null as string | null },
})
const isInstalling = ref(false)
const installError = ref<string | null>(null)

const canInstall = computed(() => {
  return envCheck.value.node.available &&
         envCheck.value.git.available &&
         envCheck.value.npm.available
})

onMounted(async () => {
  if (engineSource.value === 'installed') {
    await detectInstalled()
  }
})

async function detectInstalled() {
  isDetecting.value = true
  try {
    const [detection, env] = await Promise.all([
      api.claudeCode.detectInstalledCli(),
      api.claudeCode.checkEnvironment(),
    ])
    detectionResult.value = detection
    envCheck.value = env
  } finally {
    isDetecting.value = false
  }
}

async function installCli() {
  isInstalling.value = true
  installError.value = null
  try {
    const result = await api.claudeCode.installCli()
    if (result.success) {
      await detectInstalled()
    } else {
      installError.value = result.error || '未知错误'
    }
  } finally {
    isInstalling.value = false
  }
}

function onEngineSourceChange() {
  settingsStore.setEngineSource(engineSource.value as 'bundled' | 'installed')
  if (engineSource.value === 'installed') {
    detectInstalled()
  }
}
</script>

<style scoped>
.engine-settings {
  padding: 16px;
}

.setting-group h3 {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 600;
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.radio-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.radio-option:hover {
  border-color: var(--primary-color);
}

.radio-option input {
  margin-top: 4px;
}

.radio-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.radio-title {
  font-weight: 500;
}

.radio-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.installed-section {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.status-found {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-found .path {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}

.warning-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #fff3cd;
  border-radius: 4px;
  margin-bottom: 12px;
}

.env-check {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.env-item {
  padding: 4px 8px;
  background: #f8d7da;
  border-radius: 4px;
  font-size: 12px;
}

.env-item.ok {
  background: #d4edda;
}

.install-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-primary {
  padding: 8px 16px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  color: var(--error-color);
  font-size: 12px;
}
</style>
```

#### 1.8 更新 settings store

**修改文件：`src/stores/settings.ts`**

```typescript
export type EngineSource = 'bundled' | 'installed'

export interface AuthSettings {
  // ... 现有字段
  engineSource?: EngineSource  // 新增
  installedCliPath?: string     // 新增
}

// 添加新方法
function setEngineSource(source: EngineSource) {
  engineSource.value = source
  saveSettings()
}

// 在 computed 配置中添加
const config = computed(() => ({
  // ... 现有配置
  engineSource: engineSource.value,
  installedCliPath: installedCliPath.value,
}))
```

## 四、UI/UX 设计

### 入口位置
在现有的「设置」页面中添加新的 Tab 或 Section：
- 路径：`设置` → `引擎` 或 `Engine`
- 位置：在 API 配置之后

### 交互流程

```
┌─────────────────────────────────────┐
│  Claude Code 引擎                   │
├─────────────────────────────────────┤
│  ○ 内置引擎（推荐）                  │
│    使用应用内置的 Claude Code 源码版本│
│                                     │
│  ● 已安装版本                       │
│    使用本地安装的 Claude Code CLI   │
│                                     │
│  ┌─────────────────────────────┐  │
│  │ ✅ 已检测到 Claude Code CLI   │  │
│  │    v3.5.0                    │  │
│  │    /usr/local/bin/claude      │  │
│  └─────────────────────────────┘  │
│                                     │
│  或者：                              │
│  ┌─────────────────────────────┐  │
│  │ ⚠️ 未检测到 Claude Code CLI   │  │
│  │                              │  │
│  │ 环境检测：                    │  │
│  │ ✓ Node.js v20.0.0           │  │
│  │ ✓ Git v2.40.0               │  │
│  │ ✓ npm v10.0.0               │  │
│  │                              │  │
│  │ [一键安装 Claude Code CLI]   │  │
│  └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 状态说明

| 状态 | 显示内容 | 操作 |
|------|---------|------|
| 未检测 | 环境检查结果 | 如满足条件，显示安装按钮 |
| 检测中 | 加载动画 | 等待检测完成 |
| 已安装 | 版本号 + 路径 | 无需操作 |
| 安装中 | 进度提示 | 禁用按钮 |
| 安装失败 | 错误信息 | 显示重试按钮 |

## 五、兼容性与注意事项

### 1. 参数差异
官网 Claude Code CLI 与内置版本的命令行参数可能略有不同：
- 需要验证 `--print`, `--output-format stream-json`, `--input-format stream-json` 是否兼容
- 可能需要调整环境变量传递方式

### 2. 会话管理
- 官网版本使用自己的会话存储（`~/.claude`）
- 内置版本可能使用不同的配置目录
- 需要确保会话历史可以正确加载

### 3. 权限模式
- 确认官网版本的 `--permission-mode` 参数行为一致

### 4. 工具和 Agent
- 验证内置 Agents 是否在官网版本中可用

### 5. MCP 支持
- 检查 MCP 工具在两种模式下的行为

## 六、测试计划

### 单元测试
- CLI 检测逻辑
- 环境检查逻辑
- 安装脚本验证

### 集成测试
1. 切换到「已安装版本」模式，验证启动成功
2. 验证消息发送和接收正常
3. 验证工具调用正常
4. 验证会话历史正常
5. 在没有安装 CLI 时，验证安装流程

### 兼容性测试
- 不同操作系统（Windows, macOS, Linux）
- 不同安装路径
- 不同 Node.js/Git 版本

## 七、风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 官网 CLI 参数不兼容 | 中 | 在测试阶段充分验证，准备回退机制 |
| 安装失败 | 中 | 提供详细的错误信息，指导用户手动安装 |
| 版本差异导致行为不一致 | 低 | 记录版本差异，必要时调整 UI |
| 配置文件冲突 | 低 | 明确区分两种模式使用的配置目录 |

## 八、实施步骤

### Phase 1: 基础设施（1-2 天）
1. 创建 `cliInstaller.ts` 模块
2. 实现 CLI 检测逻辑
3. 实现环境检查逻辑
4. 实现安装逻辑

### Phase 2: 核心集成（2-3 天）
1. 修改 `sessionProcess.ts` 支持切换
2. 添加 IPC handlers
3. 更新 preload API
4. 更新前端 API 封装

### Phase 3: UI/UX（1-2 天）
1. 创建设置组件
2. 实现交互逻辑
3. 样式和动画

### Phase 4: 测试与修复（2-3 天）
1. 单元测试
2. 集成测试
3. 兼容性测试
4. Bug 修复

### 总工期：约 8-12 个工作日
