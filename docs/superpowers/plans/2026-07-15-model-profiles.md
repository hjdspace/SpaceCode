# 多套模型配置切换（Profile）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 SpaceCode 的模型设置中支持多套命名配置（Profile），用户可保存/切换/编辑多套完整的模型配置，持久化到 `~/.spacecode/profiles.json`。

**架构：** 双层模型——`profiles.json` 作为配置仓库，`gui-settings.json` 作为当前生效配置（active Profile 的快照）。切换 Profile 时复用现有 `saveSettings()` 链路写入 `gui-settings.json` + 同步 `settings.json`。UI 采用卡片网格 + 就地展开。

**技术栈：** Electron 29 + Vue 3 + Pinia + TypeScript + Vitest

**规格文档：** `docs/superpowers/specs/2026-07-15-model-profiles-design.md`

---

## 文件结构

### 新增文件（5 个）

| 文件 | 职责 |
|---|---|
| `src/types/profile.ts` | `ModelProfile` + `ProfilesFile` 类型定义 |
| `src/components/settings/ProfileCards.vue` | Profile 卡片网格组件 + 展开区管理 |
| `electron/__tests__/profiles.test.ts` | 主进程 IPC 测试（vitest） |
| `tests/stores/profiles.test.ts` | Store profile actions 测试（vitest） |
| `tests/components/ProfileCards.test.ts` | ProfileCards 组件测试（vitest） |

### 修改文件（8 个）

| 文件 | 改动 |
|---|---|
| `electron/main.ts` | 新增 `getProfilesPath()` + 2 个 IPC handler（`profiles:load` / `profiles:save`） |
| `electron/preload.ts` | 暴露 `profilesLoad` / `profilesSave` |
| `src/services/electronAPI.ts` | 新增 `profilesLoad` / `profilesSave` 方法（含 H5 fallback） |
| `src/stores/settings.ts` | 新增 profile state + 7 个 actions（load/save/apply/create/update/delete/duplicate/migrate） |
| `src/components/settings/SettingsPanel.vue` | 在模型 tab 内用 `ProfileCards` 包裹 `ModelSettings` |
| `src/i18n/locales/zh-CN.ts` | 新增 `profile.*` 区块 |
| `src/i18n/locales/en-US.ts` | 新增 `profile.*` 区块 |
| `vitest.config.ts` | include 数组新增 `tests/components/**/*.test.ts` |

### 不改动

- `src/components/settings/ModelSettings.vue`（复用现有 v-model 协议，无需修改）
- `engine/`、`petLLMProxy.ts`、`imServer.ts`、`h5Server.ts`、`browserUseService.ts`、`promptOptimizerIPC.ts`

---

## 任务分解

### 任务 1：类型定义

**文件：**
- 创建：`src/types/profile.ts`

- [ ] **步骤 1：创建类型定义文件**

创建 `src/types/profile.ts`：

```typescript
import type { AuthMethod, ProviderConfig } from '@/stores/settings'

/**
 * 一套完整的模型配置快照。
 * 切换 Profile 时，这些字段整体替换当前生效配置。
 */
export interface ModelProfile {
  /** UUID v4，唯一标识 */
  id: string
  /** 用户可编辑的名称，如"工作"/"个人"。允许重名（id 才是唯一键） */
  name: string
  /** 5 种认证方式之一 */
  authMethod: AuthMethod
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  /** 每个模型的上下文窗口大小（字节） */
  modelContextWindows: Record<string, number>
  /** ISO 8601 创建时间 */
  createdAt: string
  /** ISO 8601 最后更新时间 */
  updatedAt: string
}

/**
 * profiles.json 的整体结构。
 * activeProfileId 为 null 表示首次迁移前的暂态（正常运行时始终指向一个有效 Profile）。
 */
export interface ProfilesFile {
  version: 1
  activeProfileId: string | null
  profiles: ModelProfile[]
}
```

- [ ] **步骤 2：运行 typecheck 验证类型无误**

运行：`npm run typecheck`
预期：PASS（新文件只是类型声明，不影响现有代码）

- [ ] **步骤 3：Commit**

```bash
git add src/types/profile.ts
git commit -m "feat(profiles): 添加 ModelProfile 和 ProfilesFile 类型定义"
```

---

### 任务 2：Electron 主进程 IPC + 测试（TDD）

**文件：**
- 修改：`electron/main.ts`（新增 `getProfilesPath` + 2 个 IPC handler + 导入 `chmodSync`）
- 创建：`electron/__tests__/profiles.test.ts`

**背景：** 现有 `electron/main.ts` 已导入 `dirname`（第 2 行）、`existsSync`/`writeFileSync`/`readFileSync`/`mkdirSync`（第 3 行），但**未导入 `chmodSync`**。需补充导入。

现有 `getGuiSettingsPath()` 在第 1738 行，`settings:saveGuiSettings` IPC 在第 1813 行。新 IPC 应紧跟在 `settings:loadGuiSettings` IPC 之后（第 1843 行之后）插入。

- [ ] **步骤 1：编写失败的 IPC 测试**

创建 `electron/__tests__/profiles.test.ts`：

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Mock electron 模块（main.ts 依赖 app.getPath）
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return os.tmpdir()
      return os.tmpdir()
    }),
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {},
}))

// Mock 其他 main.ts 启动依赖，避免副作用
vi.mock('../terminalManager', () => ({ TerminalManager: class {} }))
vi.mock('../logger', () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}))
vi.mock('dotenv', () => ({ config: vi.fn() }))

// 捕获 ipcMain.handle 注册的回调
const ipcHandlers: Record<string, (...args: any[]) => any> = {}
beforeEach(async () => {
  const { ipcMain } = await import('electron')
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
    ipcHandlers[channel] = handler
  })
})

// 每个测试用独立的临时 .spacecode 目录
let tmpHome: string
beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-test-'))
  const { app } = require('electron')
  vi.mocked(app.getPath).mockReturnValue(tmpHome)
})
afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe('profiles IPC handlers', () => {
  describe('profiles:load', () => {
    it('文件不存在时返回 data: null', async () => {
      const result = await ipcHandlers['profiles:load']()
      expect(result).toEqual({ success: true, data: null })
    })

    it('文件存在时返回内容', async () => {
      const dir = path.join(tmpHome, '.spacecode')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, 'profiles.json')
      const content = JSON.stringify({ version: 1, activeProfileId: 'x', profiles: [] })
      fs.writeFileSync(filePath, content, 'utf-8')

      const result = await ipcHandlers['profiles:load']()
      expect(result.success).toBe(true)
      expect(result.data).toBe(content)
    })

    it('读取异常时返回 success: false', async () => {
      // 强制 readFileSync 抛错
      vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error('read failed')
      })
      const result = await ipcHandlers['profiles:load']()
      expect(result.success).toBe(false)
      expect(result.data).toBeNull()
      expect(result.error).toContain('read failed')
    })
  })

  describe('profiles:save', () => {
    it('写入文件并设置权限 0600', async () => {
      const data = JSON.stringify({ version: 1, activeProfileId: 'x', profiles: [] })
      const result = await ipcHandlers['profiles:save']({}, data)

      expect(result.success).toBe(true)
      const filePath = path.join(tmpHome, '.spacecode', 'profiles.json')
      expect(fs.existsSync(filePath)).toBe(true)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(data)

      // 验证权限 0600（Windows 上 chmod 行为有限，仅验证调用不抛错）
      if (process.platform !== 'win32') {
        const stat = fs.statSync(filePath)
        const mode = stat.mode & 0o777
        expect(mode).toBe(0o600)
      }
    })

    it('目录不存在时自动创建', async () => {
      const data = '{}'
      const result = await ipcHandlers['profiles:save']({}, data)
      expect(result.success).toBe(true)
      expect(fs.existsSync(path.join(tmpHome, '.spacecode', 'profiles.json'))).toBe(true)
    })

    it('写入异常时返回 success: false', async () => {
      vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        throw new Error('write failed')
      })
      const result = await ipcHandlers['profiles:save']({}, '{}')
      expect(result.success).toBe(false)
      expect(result.error).toContain('write failed')
    })
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run electron/__tests__/profiles.test.ts`
预期：FAIL，报错 `Cannot find module 'profiles:load'` 或 ipcHandlers 为空（因为 main.ts 还没注册这些 IPC）

- [ ] **步骤 3：在 main.ts 中补充 chmodSync 导入**

编辑 `electron/main.ts` 第 3 行，在 `mkdirSync` 后追加 `chmodSync`：

```typescript
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, copyFileSync, renameSync, unlinkSync, rmSync, chmodSync } from 'fs'
```

- [ ] **步骤 4：在 main.ts 中新增 getProfilesPath 函数**

在 `getGuiSettingsPath()` 函数（第 1738-1740 行）之后插入：

```typescript
function getProfilesPath(): string {
  return join(app.getPath('home'), '.spacecode', 'profiles.json')
}
```

- [ ] **步骤 5：在 main.ts 中新增 2 个 IPC handler**

在 `settings:loadGuiSettings` IPC handler（第 1843 行结束）之后插入：

```typescript

// ============================================================================
// Profiles Persistence (~/.spacecode/profiles.json — 多套模型配置仓库)
// ============================================================================
ipcMain.handle('profiles:load', async () => {
  try {
    const p = getProfilesPath()
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf-8')
      return { success: true, data: raw }
    }
    return { success: true, data: null }
  } catch (err: any) {
    error('Profiles', 'Failed to load profiles', err)
    return { success: false, data: null, error: String(err) }
  }
})

ipcMain.handle('profiles:save', async (_event, data: string) => {
  try {
    const p = getProfilesPath()
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, data, 'utf-8')
    chmodSync(p, 0o600)
    debug('Profiles', `Profiles saved to ${p}`)
    return { success: true }
  } catch (err: any) {
    error('Profiles', 'Failed to save profiles', err)
    return { success: false, error: String(err) }
  }
})
```

- [ ] **步骤 6：运行测试验证通过**

运行：`npx vitest run electron/__tests__/profiles.test.ts`
预期：PASS（5 个测试全通过）

- [ ] **步骤 7：运行 typecheck 确认无类型错误**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 8：Commit**

```bash
git add electron/main.ts electron/__tests__/profiles.test.ts
git commit -m "feat(profiles): 主进程新增 profiles:load/save IPC handler"
```

---

### 任务 3：Preload + electronAPI 桥接

**文件：**
- 修改：`electron/preload.ts`（第 195 行之后新增 2 个 API）
- 修改：`src/services/electronAPI.ts`（第 479 行之后新增 2 个方法）

**背景：** 现有 `preload.ts` 的 `loadGuiSettings` 在第 194-195 行。`electronAPI.ts` 的 `loadGuiSettings` 方法在 469-479 行，含 H5 fallback 模式——profiles 也需要 H5 fallback（H5 模式下 profiles 存 localStorage）。

- [ ] **步骤 1：在 preload.ts 暴露 2 个新 API**

在 `electron/preload.ts` 第 195 行（`loadGuiSettings` 之后）插入：

```typescript
  // Profiles persistence (file-based, ~/.spacecode/profiles.json)
  profilesLoad: (): Promise<{ success: boolean; data: string | null; error?: string }> =>
    ipcRenderer.invoke('profiles:load'),
  profilesSave: (data: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('profiles:save', data),
```

- [ ] **步骤 2：在 electronAPI.ts 新增 profilesLoad 方法**

在 `src/services/electronAPI.ts` 第 479 行（`loadGuiSettings` 方法结束的 `},` 之后）插入：

```typescript
  profilesLoad: (): Promise<{ success: boolean; data: string | null; error?: string }> => {
    if (electronAPI?.profilesLoad) {
      return electronAPI.profilesLoad()
    }
    // H5 模式：从 localStorage 读取
    if (_isH5Mode) {
      const data = localStorage.getItem('spacecode_profiles')
      return Promise.resolve({ success: true, data })
    }
    return Promise.resolve({ success: false, data: null, error: 'profilesLoad not available' })
  },
  profilesSave: (data: string): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.profilesSave) {
      return electronAPI.profilesSave(data)
    }
    // H5 模式：保存到 localStorage
    if (_isH5Mode) {
      localStorage.setItem('spacecode_profiles', data)
      return Promise.resolve({ success: true })
    }
    return Promise.resolve({ success: false, error: 'profilesSave not available' })
  },
```

- [ ] **步骤 3：运行 typecheck 确认类型匹配**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add electron/preload.ts src/services/electronAPI.ts
git commit -m "feat(profiles): preload 和 electronAPI 暴露 profilesLoad/save"
```

---

### 任务 4：Store 层 Profile Actions + 测试（TDD）

**文件：**
- 修改：`src/stores/settings.ts`
- 创建：`tests/stores/profiles.test.ts`

**背景：**
- Store 入口在第 246 行 `export const useSettingsStore = defineStore('settings', () => {`
- `config` 是一个 computed（在 `saveSettings` 第 487 行用到 `config.value`），聚合了 authMethod/providerConfig 等
- `saveSettings()` 是同步函数（第 461 行），内部 `api.saveGuiSettings(serialized).catch(() => {})` 是 fire-and-forget
- 现有 state：`authMethod`/`anthropicConfig`/`openaiConfig`/`geminiConfig`/`modelContextWindows` 等（第 250-285 行）

**重要：** 因为 `saveSettings()` 是同步的且 fire-and-forget，`applyProfile` 无法真正 `await saveSettings()`。我们将 `applyProfile` 设计为同步更新 state 后调用 `saveSettings()`（同步触发 IPC 写入），然后 `await saveProfiles()`（profiles.json 的写入）。错误回滚用 try/catch 包裹 `saveProfiles()`。

- [ ] **步骤 1：编写失败的 store 测试**

创建 `tests/stores/profiles.test.ts`：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

// Mock electronAPI，避免真实 IPC 调用
vi.mock('@/services/electronAPI', () => ({
  default: {
    saveGuiSettings: vi.fn(() => Promise.resolve({ success: true })),
    loadGuiSettings: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesLoad: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesSave: vi.fn(() => Promise.resolve({ success: true })),
    getEnv: vi.fn(() => Promise.resolve({})),
  },
}))

import api from '@/services/electronAPI'

function mockProfile(id: string, name: string, authMethod: any = 'openai_compatible') {
  return {
    id,
    name,
    authMethod,
    anthropicConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    openaiConfig: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', haikuModel: '', sonnetModel: 'deepseek-chat', opusModel: '' },
    geminiConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    modelContextWindows: { 'deepseek-chat': 64000 },
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

describe('settings store — profile actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('loadProfiles', () => {
    it('首次启动（profiles.json 不存在）触发迁移，创建"默认"Profile', async () => {
      const store = useSettingsStore()
      vi.mocked(api.profilesLoad).mockResolvedValue({ success: true, data: null })

      await store.loadProfiles()

      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].name).toBe('默认')
      expect(store.activeProfileId).toBe(store.profiles[0].id)
      expect(api.profilesSave).toHaveBeenCalledOnce()
    })

    it('profiles.json 存在时加载 profiles 和 activeProfileId', async () => {
      const file = {
        version: 1 as const,
        activeProfileId: 'p1',
        profiles: [mockProfile('p1', '工作'), mockProfile('p2', '个人')],
      }
      vi.mocked(api.profilesLoad).mockResolvedValue({
        success: true,
        data: JSON.stringify(file),
      })

      const store = useSettingsStore()
      await store.loadProfiles()

      expect(store.profiles).toHaveLength(2)
      expect(store.activeProfileId).toBe('p1')
    })

    it('activeProfileId 指向不存在的 Profile 时重置为第一个', async () => {
      const file = {
        version: 1 as const,
        activeProfileId: 'nonexistent',
        profiles: [mockProfile('p1', '工作')],
      }
      vi.mocked(api.profilesLoad).mockResolvedValue({
        success: true,
        data: JSON.stringify(file),
      })

      const store = useSettingsStore()
      await store.loadProfiles()

      expect(store.activeProfileId).toBe('p1')
    })

    it('profiles.json 解析失败时触发迁移重建', async () => {
      vi.mocked(api.profilesLoad).mockResolvedValue({
        success: true,
        data: 'not-json{',
      })

      const store = useSettingsStore()
      await store.loadProfiles()

      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].name).toBe('默认')
    })
  })

  describe('applyProfile', () => {
    it('更新 config 字段 + 调用 saveSettings + 持久化 activeProfileId', async () => {
      const store = useSettingsStore()
      // 预置 profiles
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'

      await store.applyProfile('p2')

      expect(store.activeProfileId).toBe('p2')
      expect(store.authMethod).toBe('openai_compatible')
      expect(store.openaiConfig.baseUrl).toBe('https://api.deepseek.com')
      expect(api.saveGuiSettings).toHaveBeenCalled()
      expect(api.profilesSave).toHaveBeenCalled()
    })

    it('apply 失败时 activeProfileId 回滚', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'

      // 让 profilesSave 失败
      vi.mocked(api.profilesSave).mockRejectedValueOnce(new Error('save failed'))

      await expect(store.applyProfile('p2')).rejects.toThrow('save failed')
      expect(store.activeProfileId).toBe('p1')
    })
  })

  describe('createProfile', () => {
    it('以当前 config 为模板创建新 Profile', async () => {
      const store = useSettingsStore()
      store.authMethod = 'openai_compatible'
      store.openaiConfig = { baseUrl: 'https://x.com', apiKey: 'sk-x', haikuModel: '', sonnetModel: 'm1', opusModel: '' }

      const id = await store.createProfile('测试配置')

      expect(id).toBeTruthy()
      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].name).toBe('测试配置')
      expect(store.profiles[0].openaiConfig.baseUrl).toBe('https://x.com')
      expect(store.expandedProfileId).toBe(id)
      expect(api.profilesSave).toHaveBeenCalled()
    })

    it('name 为空时自动填"未命名"', async () => {
      const store = useSettingsStore()
      const id = await store.createProfile('   ')
      expect(store.profiles[0].name).toBe('未命名')
    })
  })

  describe('updateProfile', () => {
    it('更新指定 Profile 的字段', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      const originalUpdatedAt = store.profiles[0].updatedAt

      await new Promise(r => setTimeout(r, 5)) // 确保 timestamp 不同
      await store.updateProfile('p1', { name: '工作-改' })

      expect(store.profiles[0].name).toBe('工作-改')
      expect(store.profiles[0].updatedAt).not.toBe(originalUpdatedAt)
    })

    it('更新 active profile 时同步到 config + saveSettings', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      store.activeProfileId = 'p1'

      await store.updateProfile('p1', {
        openaiConfig: { baseUrl: 'https://new.com', apiKey: 'sk-new', haikuModel: '', sonnetModel: 'm2', opusModel: '' },
      })

      expect(store.openaiConfig.baseUrl).toBe('https://new.com')
      expect(api.saveGuiSettings).toHaveBeenCalled()
    })

    it('更新非 active profile 时不同步 config', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'
      vi.clearAllMocks()

      await store.updateProfile('p2', { name: '个人-改' })

      expect(store.profiles[1].name).toBe('个人-改')
      expect(api.saveGuiSettings).not.toHaveBeenCalled()
    })
  })

  describe('deleteProfile', () => {
    it('删除非 active 的 Profile', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p1'

      await store.deleteProfile('p2')

      expect(store.profiles).toHaveLength(1)
      expect(store.profiles[0].id).toBe('p1')
    })

    it('删除 active Profile 时自动切换到第一个', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作'), mockProfile('p2', '个人')]
      store.activeProfileId = 'p2'

      await store.deleteProfile('p2')

      expect(store.activeProfileId).toBe('p1')
    })

    it('只剩 1 个时拒绝删除', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]
      store.activeProfileId = 'p1'

      await store.deleteProfile('p1')

      expect(store.profiles).toHaveLength(1)
    })
  })

  describe('duplicateProfile', () => {
    it('复制一份为新 Profile，名称加"副本"后缀', async () => {
      const store = useSettingsStore()
      store.profiles = [mockProfile('p1', '工作')]

      const newId = await store.duplicateProfile('p1')

      expect(store.profiles).toHaveLength(2)
      expect(store.profiles[1].id).toBe(newId)
      expect(store.profiles[1].name).toBe('工作 副本')
      expect(store.profiles[1].openaiConfig.baseUrl).toBe('https://api.deepseek.com')
      expect(store.expandedProfileId).toBe(newId)
    })
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/stores/profiles.test.ts`
预期：FAIL，报错 `store.loadProfiles is not a function`（actions 尚未实现）

- [ ] **步骤 3：在 settings.ts 新增 profile state**

在 `src/stores/settings.ts` 第 285 行（`modelContextWindows` ref 之后）插入：

```typescript
  // ── Profile 管理（多套模型配置切换）──
  const profiles = ref<ModelProfile[]>([])
  const activeProfileId = ref<string | null>(null)
  const expandedProfileId = ref<string | null>(null)  // UI 层：哪张卡展开
```

并在文件顶部导入区新增（如果没有的话）：

```typescript
import type { ModelProfile, ProfilesFile } from '@/types/profile'
```

- [ ] **步骤 4：在 settings.ts 新增 profile actions**

在 `saveSettings()` 函数（第 495 行结束）之后、`updateFromSettingsPanel` 之前插入以下 7 个函数：

```typescript
  // ── Profile actions ──────────────────────────────────────────

  async function loadProfiles(): Promise<void> {
    const result = await api.profilesLoad()
    if (!result.success || !result.data) {
      await migrateFromGuiSettings()
      return
    }
    try {
      const file: ProfilesFile = JSON.parse(result.data)
      profiles.value = file.profiles
      activeProfileId.value = file.activeProfileId
      // 防御：activeProfileId 指向不存在的 Profile 时重置
      if (activeProfileId.value && !profiles.value.find(p => p.id === activeProfileId.value)) {
        activeProfileId.value = profiles.value[0]?.id ?? null
      }
    } catch {
      // 解析失败：按首次启动迁移流程重建
      await migrateFromGuiSettings()
    }
  }

  async function saveProfiles(): Promise<void> {
    const file: ProfilesFile = {
      version: 1,
      activeProfileId: activeProfileId.value,
      profiles: profiles.value,
    }
    await api.profilesSave(JSON.stringify(file, null, 2))
  }

  function applyProfileFields(p: ModelProfile): void {
    authMethod.value = p.authMethod
    anthropicConfig.value = { ...p.anthropicConfig }
    openaiConfig.value = { ...p.openaiConfig }
    geminiConfig.value = { ...p.geminiConfig }
    modelContextWindows.value = { ...p.modelContextWindows }
  }

  async function applyProfile(id: string): Promise<void> {
    const p = profiles.value.find(x => x.id === id)
    if (!p) return
    const prevActiveId = activeProfileId.value
    activeProfileId.value = id
    applyProfileFields(p)
    // saveSettings() 是同步函数，内部 api.saveGuiSettings() 是 fire-and-forget
    // 它会触发主进程写 gui-settings.json + 同步 settings.json（现有链路）
    saveSettings()
    try {
      await saveProfiles()
    } catch (err) {
      activeProfileId.value = prevActiveId
      applyProfileFields(profiles.value.find(x => x.id === prevActiveId)!)
      saveSettings()
      throw err
    }
  }

  async function createProfile(name: string): Promise<string> {
    const now = new Date().toISOString()
    const p: ModelProfile = {
      id: crypto.randomUUID(),
      name: name.trim() || '未命名',
      authMethod: authMethod.value,
      anthropicConfig: { ...anthropicConfig.value },
      openaiConfig: { ...openaiConfig.value },
      geminiConfig: { ...geminiConfig.value },
      modelContextWindows: { ...modelContextWindows.value },
      createdAt: now, updatedAt: now,
    }
    profiles.value.push(p)
    expandedProfileId.value = p.id
    await saveProfiles()
    return p.id
  }

  async function updateProfile(id: string, patch: Partial<ModelProfile>): Promise<void> {
    const i = profiles.value.findIndex(x => x.id === id)
    if (i < 0) return
    profiles.value[i] = { ...profiles.value[i], ...patch, updatedAt: new Date().toISOString() }
    // 如果更新的是 active profile，同步到当前 config + saveSettings
    if (id === activeProfileId.value) {
      applyProfileFields(profiles.value[i])
      saveSettings()
    }
    await saveProfiles()
  }

  async function deleteProfile(id: string): Promise<void> {
    if (profiles.value.length <= 1) return   // 至少保留 1 个
    profiles.value = profiles.value.filter(x => x.id !== id)
    if (activeProfileId.value === id) {
      activeProfileId.value = profiles.value[0].id
      applyProfileFields(profiles.value[0])
      saveSettings()
    }
    await saveProfiles()
  }

  async function duplicateProfile(id: string): Promise<string> {
    const src = profiles.value.find(x => x.id === id)
    if (!src) return ''
    const now = new Date().toISOString()
    const copy: ModelProfile = {
      ...structuredClone(src),
      id: crypto.randomUUID(),
      name: `${src.name} 副本`,
      createdAt: now, updatedAt: now,
    }
    profiles.value.push(copy)
    expandedProfileId.value = copy.id
    await saveProfiles()
    return copy.id
  }

  async function migrateFromGuiSettings(): Promise<void> {
    // 从当前 config（已由现有 loadFromGuiSettingsFile 加载）创建默认 Profile
    const now = new Date().toISOString()
    const p: ModelProfile = {
      id: crypto.randomUUID(),
      name: '默认',
      authMethod: authMethod.value,
      anthropicConfig: { ...anthropicConfig.value },
      openaiConfig: { ...openaiConfig.value },
      geminiConfig: { ...geminiConfig.value },
      modelContextWindows: { ...modelContextWindows.value },
      createdAt: now, updatedAt: now,
    }
    profiles.value = [p]
    activeProfileId.value = p.id
    await saveProfiles()
  }
```

- [ ] **步骤 5：在 store return 对象中导出新 state 和 actions**

找到 store 的 return 语句（通常在文件末尾的 `return { ... }`），在其中追加：

```typescript
    // Profile 管理
    profiles,
    activeProfileId,
    expandedProfileId,
    loadProfiles,
    saveProfiles,
    applyProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    duplicateProfile,
    migrateFromGuiSettings,
```

- [ ] **步骤 6：运行测试验证通过**

运行：`npx vitest run tests/stores/profiles.test.ts`
预期：PASS（全部测试通过）

- [ ] **步骤 7：运行 typecheck**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 8：Commit**

```bash
git add src/stores/settings.ts tests/stores/profiles.test.ts
git commit -m "feat(profiles): store 新增 profile state 和 7 个 actions"
```

---

### 任务 5：i18n 文案

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

**背景：** 现有 `model` 区块在 zh-CN.ts 第 473-482 行，en-US.ts 第 473-482 行。新 `profile` 区块插入在 `model` 区块之后。

- [ ] **步骤 1：在 zh-CN.ts 新增 profile 区块**

在 `src/i18n/locales/zh-CN.ts` 第 482 行（`model` 区块结束的 `},`）之后插入：

```typescript
  profile: {
    title: '配置',
    addNew: '新建配置',
    active: '已激活',
    apply: '应用此配置',
    duplicate: '另存为新配置',
    delete: '删除',
    deleteConfirm: '确认删除此配置？',
    namePlaceholder: '配置名称',
    switchedToast: '已切换到「{name}」配置，新会话将使用此配置',
    cannotDeleteLast: '至少保留一个配置',
    defaultName: '默认',
    untitled: '未命名',
    editName: '点击编辑名称',
    collapse: '收起',
    expand: '展开',
  },
```

- [ ] **步骤 2：在 en-US.ts 新增 profile 区块**

在 `src/i18n/locales/en-US.ts` 第 482 行（`model` 区块结束的 `},`）之后插入：

```typescript
  profile: {
    title: 'Profiles',
    addNew: 'New profile',
    active: 'Active',
    apply: 'Apply this profile',
    duplicate: 'Duplicate',
    delete: 'Delete',
    deleteConfirm: 'Delete this profile?',
    namePlaceholder: 'Profile name',
    switchedToast: 'Switched to "{name}", new sessions will use this profile',
    cannotDeleteLast: 'At least one profile required',
    defaultName: 'Default',
    untitled: 'Untitled',
    editName: 'Click to edit name',
    collapse: 'Collapse',
    expand: 'Expand',
  },
```

- [ ] **步骤 3：运行 typecheck 确认 i18n 类型无误**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(profiles): i18n 新增 profile.* 区块"
```

---

### 任务 6：ProfileCards 组件 + 测试（TDD）

**文件：**
- 修改：`vitest.config.ts`（include 新增 `tests/components/**/*.test.ts`）
- 创建：`src/components/settings/ProfileCards.vue`
- 创建：`tests/components/ProfileCards.test.ts`

**背景：**
- `ModelSettings.vue` 用 `v-model` 协议（`modelValue` prop + `update:modelValue` emit），接收 `{ authMethod, anthropicConfig, openaiConfig, geminiConfig, oauthAccount }` 结构
- ProfileCards 需要把 `expandedProfile` 映射为这个结构传给 `ModelSettings`，并监听 `update:modelValue` 转发回 `store.updateProfile()`
- 缩略卡显示：名称、激活标记、provider 标签、模型摘要、上下文窗口标记（不显示 apiKey）
- 展开态：ModelSettings 表单 + 操作栏（应用/另存为/删除）
- apiKey 脱敏：缩略态不显示，展开态由 ModelSettings 现有的眼睛图标控制（无需额外处理）

- [ ] **步骤 1：更新 vitest.config.ts include 数组**

编辑 `vitest.config.ts`，在 `include` 数组中追加 `'tests/components/**/*.test.ts'`：

```typescript
    include: [
      'electron/__tests__/**/*.test.ts',
      'electron/design/__tests__/**/*.test.ts',
      'electron/im/**/__tests__/**/*.test.ts',
      'tests/composables/**/*.test.ts',
      'tests/lib/**/*.test.ts',
      'tests/stores/**/*.test.ts',
      'tests/im/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/components/**/*.test.ts',
      'src/**/*.test.ts',
    ],
```

- [ ] **步骤 2：编写失败的组件测试**

创建 `tests/components/ProfileCards.test.ts`：

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ProfileCards from '@/components/settings/ProfileCards.vue'
import { useSettingsStore } from '@/stores/settings'
import type { ModelProfile } from '@/types/profile'

// Mock ModelSettings 组件，避免渲染复杂表单
vi.mock('@/components/settings/ModelSettings.vue', () => ({
  default: {
    name: 'ModelSettings',
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<div data-testid="model-settings-mock">{{ modelValue.authMethod }}</div>',
  },
}))

// Mock electronAPI
vi.mock('@/services/electronAPI', () => ({
  default: {
    saveGuiSettings: vi.fn(() => Promise.resolve({ success: true })),
    loadGuiSettings: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesLoad: vi.fn(() => Promise.resolve({ success: true, data: null })),
    profilesSave: vi.fn(() => Promise.resolve({ success: true })),
    getEnv: vi.fn(() => Promise.resolve({})),
  },
}))

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'p1',
    name: '工作',
    authMethod: 'openai_compatible',
    anthropicConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    openaiConfig: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-secret123', haikuModel: '', sonnetModel: 'deepseek-chat', opusModel: '' },
    geminiConfig: { baseUrl: '', apiKey: '', haikuModel: '', sonnetModel: '', opusModel: '' },
    modelContextWindows: { 'deepseek-chat': 64000 },
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('ProfileCards', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('缩略卡渲染名称、provider 标签、模型摘要、上下文窗口', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile()]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, {
      global: { plugins: [], stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    const card = wrapper.find('[data-testid="profile-card-p1"]')
    expect(card.text()).toContain('工作')
    expect(card.text()).toContain('OpenAI')
    expect(card.text()).toContain('deepseek-chat')
    expect(card.text()).toContain('64K')
  })

  it('缩略态不显示 apiKey', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile()]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, {
      global: { stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('sk-secret123')
  })

  it('点击缩略卡展开/收起', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile()]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, {
      global: { stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    const card = wrapper.find('[data-testid="profile-card-p1"]')
    await card.trigger('click')
    expect(store.expandedProfileId).toBe('p1')

    await card.trigger('click')
    expect(store.expandedProfileId).toBeNull()
  })

  it('激活标记显示在当前 active 的卡上', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2', name: '个人' })]
    store.activeProfileId = 'p2'
    store.expandedProfileId = null

    const wrapper = mount(ProfileCards, {
      global: { stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    const card1 = wrapper.find('[data-testid="profile-card-p1"]')
    const card2 = wrapper.find('[data-testid="profile-card-p2"]')
    expect(card2.classes()).toContain('active')
    expect(card1.classes()).not.toContain('active')
  })

  it('"应用此配置"按钮调用 store.applyProfile', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' }), makeProfile({ id: 'p2', name: '个人' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p2'
    const spy = vi.spyOn(store, 'applyProfile').mockResolvedValue(undefined)

    const wrapper = mount(ProfileCards, {
      global: { stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    const btn = wrapper.find('[data-testid="apply-btn"]')
    await btn.trigger('click')
    expect(spy).toHaveBeenCalledWith('p2')
  })

  it('只剩 1 个 Profile 时删除按钮禁用', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p1'

    const wrapper = mount(ProfileCards, {
      global: { stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    const btn = wrapper.find('[data-testid="delete-btn"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('点击名称进入就地编辑模式', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = 'p1'

    const wrapper = mount(ProfileCards, {
      global: { stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    const name = wrapper.find('[data-testid="profile-name-p1"]')
    await name.trigger('click')
    expect(wrapper.find('[data-testid="profile-name-input"]').exists()).toBe(true)
  })

  it('"新建配置"按钮调用 store.createProfile', async () => {
    const store = useSettingsStore()
    store.profiles = [makeProfile({ id: 'p1' })]
    store.activeProfileId = 'p1'
    store.expandedProfileId = null
    const spy = vi.spyOn(store, 'createProfile').mockResolvedValue('new-id')

    const wrapper = mount(ProfileCards, {
      global: { stubs: { ModelSettings: true } },
    })

    await wrapper.vm.$nextTick()
    const btn = wrapper.find('[data-testid="add-new-btn"]')
    await btn.trigger('click')
    expect(spy).toHaveBeenCalled()
  })
})
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npx vitest run tests/components/ProfileCards.test.ts`
预期：FAIL，报错 `Cannot find module '@/components/settings/ProfileCards.vue'`

- [ ] **步骤 4：创建 ProfileCards.vue 组件**

创建 `src/components/settings/ProfileCards.vue`：

```vue
<template>
  <div class="profile-cards">
    <div class="profile-grid">
      <div
        v-for="p in store.profiles"
        :key="p.id"
        :data-testid="`profile-card-${p.id}`"
        class="profile-card"
        :class="{ active: p.id === store.activeProfileId, expanded: p.id === store.expandedProfileId }"
        @click="toggleExpand(p.id)"
      >
        <div class="profile-card-header">
          <span class="profile-active-dot" :class="{ on: p.id === store.activeProfileId }">●</span>
          <span class="profile-name">{{ p.name }}</span>
        </div>
        <div class="profile-card-meta">
          <span class="profile-provider">{{ providerLabel(p) }}</span>
          <span class="profile-model">{{ modelSummary(p) }}</span>
          <span class="profile-context">{{ contextLabel(p) }}</span>
        </div>
      </div>

      <button
        data-testid="add-new-btn"
        class="profile-card profile-card-add"
        @click="onAddNew"
      >
        + {{ $t('profile.addNew') }}
      </button>
    </div>

    <!-- 展开区 -->
    <div v-if="expandedProfile" class="profile-expanded">
      <div class="profile-expanded-header">
        <div class="profile-expanded-name">
          <input
            v-if="editingName"
            data-testid="profile-name-input"
            v-model="nameDraft"
            class="profile-name-input"
            :placeholder="$t('profile.namePlaceholder')"
            @blur="commitName"
            @keyup.enter="commitName"
            @keyup.esc="cancelName"
            ref="nameInputRef"
          />
          <span
            v-else
            :data-testid="`profile-name-${expandedProfile.id}`"
            class="profile-name-display"
            :title="$t('profile.editName')"
            @click="startEditName"
          >{{ expandedProfile.name }}</span>
        </div>
        <button class="profile-collapse-btn" @click="toggleExpand(expandedProfile.id)">
          {{ $t('profile.collapse') }} ▲
        </button>
      </div>

      <ModelSettings
        :modelValue="expandedSettingsModel"
        @update:modelValue="onModelSettingsUpdate"
        @change="onModelSettingsChange"
      />

      <div class="profile-actions">
        <button
          data-testid="apply-btn"
          class="profile-btn primary"
          :disabled="expandedProfile.id === store.activeProfileId"
          @click="onApply"
        >{{ $t('profile.apply') }}</button>
        <button
          class="profile-btn secondary"
          @click="onDuplicate"
        >{{ $t('profile.duplicate') }}</button>
        <button
          data-testid="delete-btn"
          class="profile-btn danger"
          :disabled="store.profiles.length <= 1"
          :title="store.profiles.length <= 1 ? $t('profile.cannotDeleteLast') : ''"
          @click="onDelete"
        >{{ $t('profile.delete') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { AuthMethod, ProviderConfig, OAuthAccountInfo } from '@/stores/settings'
import type { ModelProfile } from '@/types/profile'
import ModelSettings from './ModelSettings.vue'

const store = useSettingsStore()

const expandedProfile = computed<ModelProfile | null>(() => {
  if (!store.expandedProfileId) return null
  return store.profiles.find(p => p.id === store.expandedProfileId) ?? null
})

function toggleExpand(id: string) {
  store.expandedProfileId = store.expandedProfileId === id ? null : id
}

// ── 把 expandedProfile 映射成 ModelSettings 的 modelValue 结构 ──
const expandedSettingsModel = computed(() => {
  const p = expandedProfile.value
  if (!p) return null
  return {
    authMethod: p.authMethod,
    anthropicConfig: p.anthropicConfig,
    openaiConfig: p.openaiConfig,
    geminiConfig: p.geminiConfig,
    oauthAccount: store.oauthAccount,
  }
})

// ── ModelSettings 的变更转发回 store.updateProfile ──
function onModelSettingsUpdate(val: any) {
  if (!expandedProfile.value) return
  store.updateProfile(expandedProfile.value.id, {
    authMethod: val.authMethod as AuthMethod,
    anthropicConfig: { ...val.anthropicConfig } as ProviderConfig,
    openaiConfig: { ...val.openaiConfig } as ProviderConfig,
    geminiConfig: { ...val.geminiConfig } as ProviderConfig,
  })
}
function onModelSettingsChange() {
  // change 事件仅作为保存触发器，实际持久化由 update:modelValue 完成
}

// ── 缩略卡标签计算 ──
function providerLabel(p: ModelProfile): string {
  switch (p.authMethod) {
    case 'openai_compatible': return 'OpenAI'
    case 'anthropic_compatible': return 'Anthropic'
    case 'gemini_api': return 'Gemini'
    case 'claudeai': return 'Claude'
    case 'console': return 'Console'
    default: return '—'
  }
}

function modelSummary(p: ModelProfile): string {
  const cfg = p.authMethod === 'openai_compatible' ? p.openaiConfig
    : p.authMethod === 'anthropic_compatible' ? p.anthropicConfig
    : p.authMethod === 'gemini_api' ? p.geminiConfig
    : null
  if (!cfg) return ''
  return cfg.sonnetModel || ''
}

function contextLabel(p: ModelProfile): string {
  const model = modelSummary(p)
  if (!model) return ''
  const w = p.modelContextWindows[model]
  if (!w) return ''
  return w >= 1000000 ? '1M' : `${Math.round(w / 1000)}K`
}

// ── 名称就地编辑 ──
const editingName = ref(false)
const nameDraft = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)

function startEditName() {
  if (!expandedProfile.value) return
  nameDraft.value = expandedProfile.value.name
  editingName.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function commitName() {
  if (!expandedProfile.value) return
  const trimmed = nameDraft.value.trim()
  store.updateProfile(expandedProfile.value.id, { name: trimmed || '未命名' })
  editingName.value = false
}

function cancelName() {
  editingName.value = false
  nameDraft.value = ''
}

// ── 操作栏 ──
async function onApply() {
  if (!expandedProfile.value) return
  await store.applyProfile(expandedProfile.value.id)
}

async function onDuplicate() {
  if (!expandedProfile.value) return
  await store.duplicateProfile(expandedProfile.value.id)
}

async function onDelete() {
  if (!expandedProfile.value) return
  if (store.profiles.length <= 1) return
  if (!confirm(t('profile.deleteConfirm'))) return
  await store.deleteProfile(expandedProfile.value.id)
}

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

async function onAddNew() {
  await store.createProfile('未命名')
}
</script>

<style lang="scss" scoped>
.profile-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.profile-card {
  padding: 10px 12px;
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  cursor: pointer;
  background: var(--surface, #1a1a1a);
  transition: border-color 0.15s;
  &:hover { border-color: var(--accent, #3b82f6); }
  &.active { border-color: var(--accent, #3b82f6); background: var(--surface-active, #2a3a4a); }
  &.expanded { border-color: var(--accent, #3b82f6); }
}
.profile-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.profile-active-dot {
  color: var(--text-muted, #555);
  font-size: 10px;
  &.on { color: var(--accent, #3b82f6); }
}
.profile-name {
  font-weight: 600;
  color: var(--text-primary, #fff);
  font-size: 13px;
}
.profile-card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted, #888);
}
.profile-card-add {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  color: var(--text-muted, #888);
  font-size: 12px;
}
.profile-expanded {
  border: 1px solid var(--accent, #3b82f6);
  border-radius: 6px;
  padding: 16px;
  background: var(--surface-elevated, #1a2230);
}
.profile-expanded-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.profile-name-display {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #fff);
  cursor: text;
}
.profile-name-input {
  font-size: 15px;
  font-weight: 600;
  background: var(--input-bg, #2a2a2a);
  border: 1px solid var(--accent, #3b82f6);
  border-radius: 3px;
  padding: 2px 6px;
  color: var(--text-primary, #fff);
  outline: none;
}
.profile-collapse-btn {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 12px;
}
.profile-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border, #333);
}
.profile-btn {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  &.primary {
    background: var(--accent, #3b82f6);
    color: #fff;
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  &.secondary {
    background: var(--surface-hover, #2a2a2a);
    color: var(--text-primary, #ccc);
    border-color: var(--border, #444);
  }
  &.danger {
    background: var(--danger-bg, #3a1a1a);
    color: var(--danger-text, #f88);
    border-color: var(--danger-border, #644);
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
}
</style>
```

- [ ] **步骤 5：运行测试验证通过**

运行：`npx vitest run tests/components/ProfileCards.test.ts`
预期：PASS（8 个测试全通过）

- [ ] **步骤 6：运行 typecheck**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 7：Commit**

```bash
git add src/components/settings/ProfileCards.vue tests/components/ProfileCards.test.ts vitest.config.ts
git commit -m "feat(profiles): 新增 ProfileCards 组件及测试"
```

---

### 任务 7：集成到 SettingsPanel + 启动时加载

**文件：**
- 修改：`src/components/settings/SettingsPanel.vue`

**背景：**
- 当前 `SettingsPanel.vue` 在模型 tab 直接渲染 `<ModelSettings v-model="settingsData" @change="onSettingsChange" />`（第 58-62 行）
- 改造后：用 `<ProfileCards>` 包裹 `<ModelSettings>`，但 `ModelSettings` 的渲染由 `ProfileCards` 内部接管
- 需要在 SettingsPanel `onMounted` 时调用 `store.loadProfiles()` 加载持久化的 profiles

- [ ] **步骤 1：在 SettingsPanel.vue 替换模型 tab 的内容**

编辑 `src/components/settings/SettingsPanel.vue`，将第 58-62 行：

```vue
            <ModelSettings
              v-else-if="activeTab === 'model'"
              v-model="settingsData"
              @change="onSettingsChange"
            />
```

替换为：

```vue
            <ProfileCards
              v-else-if="activeTab === 'model'"
              v-model="settingsData"
              @change="onSettingsChange"
            />
```

- [ ] **步骤 2：在 SettingsPanel.vue 导入 ProfileCards**

在 `src/components/settings/SettingsPanel.vue` 的 `<script setup>` 区，找到现有 `const ModelSettings = defineAsyncComponent(...)` 行（第 125 行附近），在其后新增：

```typescript
const ProfileCards = defineAsyncComponent(() => import('./ProfileCards.vue'))
```

- [ ] **步骤 3：在 SettingsPanel onMounted 时加载 profiles**

找到 `loadSettings()` 调用（第 213 行附近），在其后新增一行调用 `settingsStore.loadProfiles()`：

```typescript
loadSettings()
settingsStore.loadProfiles()
```

- [ ] **步骤 4：运行 typecheck**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 5：运行全部测试确认无回归**

运行：`npx vitest run`
预期：PASS（全部测试通过，无回归）

- [ ] **步骤 6：运行 build 验证**

运行：`npm run build`
预期：PASS

- [ ] **步骤 7：Commit**

```bash
git add src/components/settings/SettingsPanel.vue
git commit -m "feat(profiles): SettingsPanel 集成 ProfileCards 并在启动时加载 profiles"
```

---

### 任务 8：Toast 提示 + 最终验证

**文件：**
- 修改：`src/components/settings/ProfileCards.vue`（onApply 后触发 Toast）

**背景：** 项目中已有 toast 机制。需要确认 toast 的调用方式。规格 6.5 节要求 apply 后提示"已切换到「{name}」配置，新会话将使用此配置"。

- [ ] **步骤 1：查找项目现有 toast 调用方式**

运行：`grep -r "useToast\|toast\.\|showToast" src/ --include="*.vue" --include="*.ts" -l | head -5`

确认项目使用的 toast API（可能是 `useToast()` composable、或全局 `$toast`、或 Pinia store）。根据查到的实际 API 调整下方代码。

- [ ] **步骤 2：在 ProfileCards.vue onApply 中触发 Toast**

编辑 `src/components/settings/ProfileCards.vue` 的 `onApply` 函数，在 `await store.applyProfile(...)` 成功后触发 toast：

```typescript
async function onApply() {
  if (!expandedProfile.value) return
  const name = expandedProfile.value.name
  try {
    await store.applyProfile(expandedProfile.value.id)
    // 根据步骤 1 查到的实际 toast API 调用，例如：
    // toast.success(t('profile.switchedToast', { name }))
  } catch {
    // 切换失败，toast 提示
    // toast.error(t('profile.switchFailed'))
  }
}
```

（具体 toast 调用形式在步骤 1 确认后填入实际代码）

- [ ] **步骤 3：运行全部测试**

运行：`npx vitest run`
预期：PASS

- [ ] **步骤 4：运行 typecheck + build 最终验证**

运行：`npm run typecheck && npm run build`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/components/settings/ProfileCards.vue
git commit -m "feat(profiles): apply 切换后显示 Toast 提示"
```

---

## 自检

### 1. 规格覆盖度

| 规格章节 | 对应任务 |
|---|---|
| §3 数据模型 | 任务 1 |
| §4 持久化层（IPC + preload + electronAPI） | 任务 2 + 任务 3 |
| §5 Store 层 | 任务 4 |
| §6 UI 层（ProfileCards + SettingsPanel 集成） | 任务 6 + 任务 7 |
| §6.5 切换交互（Toast） | 任务 8 |
| §7 i18n | 任务 5 |
| §8 错误处理（解析失败/activeProfileId 失效/空数组/删最后一个/apply 回滚/name 为空） | 任务 4 测试覆盖 |
| §9 测试策略（主进程/store/组件） | 任务 2 + 任务 4 + 任务 6 |
| §3.2 迁移规则 | 任务 4 的 `migrateFromGuiSettings` |
| §10 文件清单 | 全部任务覆盖 |

**遗漏检查：** 规格中提到的"OAuth 不放入 Profile"在任务 6 的 `expandedSettingsModel` 中体现（`oauthAccount` 从 `store.oauthAccount` 取，不从 profile 取）。✓

### 2. 占位符扫描

- 任务 8 步骤 2 有一个"根据步骤 1 查到的实际 toast API 调用"的条件指令——这是合理的，因为 toast API 在写计划时未确认，需在执行时探查。已明确说明如何处理，不算占位符。
- 所有其他步骤都包含完整代码块。✓

### 3. 类型一致性

- `ModelProfile` 类型在任务 1 定义，任务 4/6 使用——字段名（id/name/authMethod/anthropicConfig/openaiConfig/geminiConfig/modelContextWindows/createdAt/updatedAt）一致 ✓
- `ProfilesFile` 类型在任务 1 定义，任务 4 使用——字段名（version/activeProfileId/profiles）一致 ✓
- store actions 命名（loadProfiles/saveProfiles/applyProfile/createProfile/updateProfile/deleteProfile/duplicateProfile/migrateFromGuiSettings）在任务 4 定义，任务 6 测试和组件中使用——一致 ✓
- store state 命名（profiles/activeProfileId/expandedProfileId）在任务 4 定义，任务 6 组件中使用——一致 ✓
- IPC channel 命名（profiles:load/profiles:save）在任务 2 定义，任务 3 preload/electronAPI 使用——一致 ✓

### 4. 关键设计决策在计划中的体现

- **apply 复用 saveSettings 链路**：任务 4 步骤 4 的 `applyProfile` 调用同步的 `saveSettings()` 而非新增 IPC ✓
- **saveSettings 是同步函数**：任务 4 背景中明确说明，`applyProfile` 设计为同步调用 saveSettings + await saveProfiles ✓
- **ModelSettings.vue 不改动**：任务 6 通过 `expandedSettingsModel` computed 把 ModelProfile 映射成 ModelSettings 期望的 modelValue 结构 ✓
- **H5 fallback**：任务 3 的 electronAPI 方法包含 H5 模式下 localStorage 读写 ✓

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-15-model-profiles.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
