# 多套模型配置切换（Profile）设计

- **日期**: 2026-07-15
- **状态**: 已确认，待实现
- **范围**: 模型设置功能优化

## 1. 背景与目标

### 1.1 现状

当前模型设置是"单套配置 + 5 种认证方式切换"架构：

- 所有配置塞在一份 `~/.claude/gui-settings.json`（`AuthSettings` 单实例）
- 通过 `authMethod` 字段（anthropic_compatible / openai_compatible / gemini_api / claudeai / console 5 选 1）决定当前激活哪个 provider
- 3 个 provider 的 `baseUrl`/`apiKey` 同时保存，模型名（haiku/sonnet/opus）3 个 provider 共享
- 保存时通过 `syncApiConfigToSettingsJson()` 同步派生写入 `~/.claude/settings.json`
- **没有任何"多套命名配置 / Profile 切换"的现有逻辑**

### 1.2 目标

把"单套配置"升级为"多套命名配置（Profile）集合 + 快速切换"：

- 用户可保存多套完整的模型配置（含认证方式、provider 凭证、模型名、上下文窗口）
- UI 用卡片缩略 + 点击展开编辑
- 多套配置持久化到 `~/.spacecode/profiles.json`，关闭 GUI 再次打开仍可见
- 切换某套配置时，覆盖写入 `~/.claude/gui-settings.json` + 同步 `~/.claude/settings.json`

### 1.3 非目标

- 不迁移 `gui-settings.json` 到 `~/.spacecode/`（保持现有读取链路不变）
- 不改动 `engine/` 及其他读取 `gui-settings.json` 的模块
- 不实现 apiKey 加密存储（与现状安全级别一致，文件权限 0600）
- 不处理 Profile 导入/导出（YAGNI）
- 不做 Profile 排序拖拽（YAGNI）

## 2. 架构概览

新增"配置仓库 + 当前生效配置"双层模型：

```
~/.spacecode/profiles.json          ← 配置仓库（多套 Profile 集合）
{
  "version": 1,
  "activeProfileId": "uuid-xxx",
  "profiles": [ {Profile}, {Profile}, ... ]
}

~/.claude/gui-settings.json         ← 当前生效配置（active Profile 的快照副本）
~/.claude/settings.json             ← 同步派生（现有 syncApiConfigToSettingsJson 逻辑）
```

### 2.1 职责分离

- `profiles.json` = 多套配置的持久化仓库，`activeProfileId` 指向当前激活的那套
- `gui-settings.json` = 引擎/Cli/各服务的统一读取入口（保持现有 6 个读取方无感）
- 切换 Profile 时，把 active 那份覆盖写入 `gui-settings.json` + 同步 `settings.json`

### 2.2 不放入 Profile 的字段

以下应用级字段不属于模型配置，切换 Profile 时不改动，仍由 `gui-settings.json` 独立持有：

- `oauthAccount`（OAuth 是设备级登录态）
- `engineSource`、`permissionMode`、`appearance`、`language`
- `projectRoot`、`thinkingEnabled`、`rtkEnabled`
- `lastViewedChangelogVersion`、`installedCliPath`、`effortLevel`

## 3. 数据模型

### 3.1 类型定义

新增 `src/types/profile.ts`：

```typescript
import type { AuthMethod, ProviderConfig } from '@/stores/settings'

export interface ModelProfile {
  id: string                    // UUID v4
  name: string                  // 用户可编辑，如"工作"/"个人"
  authMethod: AuthMethod        // 5 选 1
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  modelContextWindows: Record<string, number>
  createdAt: string             // ISO 时间戳
  updatedAt: string             // ISO 时间戳
}

export interface ProfilesFile {
  version: 1
  activeProfileId: string | null   // null = 无激活（首次迁移前的暂态）
  profiles: ModelProfile[]
}
```

### 3.2 迁移规则

首次启动时，如果 `~/.spacecode/profiles.json` 不存在：

1. 读 `~/.claude/gui-settings.json`
2. 提取 `authMethod` + 3 个 `providerConfig` + `modelContextWindows`，包装成名为"默认"的 Profile
3. 写入 `profiles.json`，`activeProfileId` 指向该 Profile
4. 不改动 `gui-settings.json`（它已是这套配置的快照）

### 3.3 存储格式示例

```json
{
  "version": 1,
  "activeProfileId": "a1b2c3d4-...",
  "profiles": [
    {
      "id": "a1b2c3d4-...",
      "name": "工作",
      "authMethod": "openai_compatible",
      "anthropicConfig": { "baseUrl": "", "apiKey": "", "haikuModel": "", "sonnetModel": "", "opusModel": "" },
      "openaiConfig": { "baseUrl": "https://api.deepseek.com", "apiKey": "sk-xxxx", "haikuModel": "", "sonnetModel": "deepseek-chat", "opusModel": "" },
      "geminiConfig": { "baseUrl": "", "apiKey": "", "haikuModel": "", "sonnetModel": "", "opusModel": "" },
      "modelContextWindows": { "deepseek-chat": 64000 },
      "createdAt": "2026-07-15T10:00:00.000Z",
      "updatedAt": "2026-07-15T10:00:00.000Z"
    }
  ]
}
```

## 4. 持久化层（Electron 主进程）

在 `electron/main.ts` 新增 3 个 IPC handler + 1 个路径函数，与现有 `gui-settings` 的 IPC 风格一致。

### 4.1 路径函数

```typescript
function getProfilesPath(): string {
  return join(app.getPath('home'), '.spacecode', 'profiles.json')
}
```

### 4.2 IPC Handlers

新增 2 个 IPC handler（`profiles:load` + `profiles:save`）。**不新增 `profiles:apply` IPC**——切换 Profile 时，渲染进程把 Profile 字段写回 `config` 后调用现有 `saveSettings()`，后者内部已调用 `api.saveGuiSettings()`（触发主进程写 `gui-settings.json` + 调用 `syncApiConfigToSettingsJson`）。复用现有链路避免重复写入逻辑。

```typescript
// 读取仓库
ipcMain.handle('profiles:load', async (): Promise<{ success: boolean; data: string | null; error?: string }> => {
  try {
    const p = getProfilesPath()
    if (existsSync(p)) return { success: true, data: readFileSync(p, 'utf-8') }
    return { success: true, data: null }
  } catch (err: any) {
    return { success: false, data: null, error: String(err) }
  }
})

// 写入仓库（整体覆盖写）
ipcMain.handle('profiles:save', async (_e, data: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const p = getProfilesPath()
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, data, 'utf-8')
    chmodSync(p, 0o600)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: String(err) }
  }
})
```

### 4.3 Preload 暴露

在 `electron/preload.ts` 新增，与现有 `saveGuiSettings`/`loadGuiSettings` 同风格：

```typescript
profilesLoad: (): Promise<{ success: boolean; data: string | null; error?: string }> =>
  ipcRenderer.invoke('profiles:load'),
profilesSave: (data: string): Promise<{ success: boolean; error?: string }> =>
  ipcRenderer.invoke('profiles:save', data),
```

### 4.4 electronAPI.ts（渲染进程侧）

在 `src/services/electronAPI.ts` 新增 2 个方法（`profilesLoad` / `profilesSave`），与现有 `saveGuiSettings`/`loadGuiSettings` 同风格。

## 5. Store 层（Pinia）

在 `src/stores/settings.ts` 中新增 Profile 管理逻辑，**不新建独立 store**（Profile 与现有 AuthSettings 强耦合，拆分反而增加跨 store 协调成本）。

### 5.1 新增 State

```typescript
const profiles = ref<ModelProfile[]>([])
const activeProfileId = ref<string | null>(null)
const expandedProfileId = ref<string | null>(null)  // UI 层：哪张卡展开
```

### 5.2 新增 Actions

```typescript
async function loadProfiles(): Promise<void> {
  const result = await api.profilesLoad()
  if (!result.success || !result.data) {
    // 首次启动：从当前 gui-settings 迁移
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
    // 解析失败：备份 + 迁移重建
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

async function applyProfile(id: string): Promise<void> {
  const p = profiles.value.find(x => x.id === id)
  if (!p) return
  const prevActiveId = activeProfileId.value
  activeProfileId.value = id
  // 把 profile 字段写回当前 config，然后调用现有 saveSettings()
  // saveSettings() 内部会调用 api.saveGuiSettings()，触发主进程：
  //   1. 写入 ~/.claude/gui-settings.json
  //   2. 调用 syncApiConfigToSettingsJson 同步 ~/.claude/settings.json
  // 因此不需要单独的 profiles:apply IPC
  config.value.authMethod = p.authMethod
  config.value.anthropicConfig = { ...p.anthropicConfig }
  config.value.openaiConfig = { ...p.openaiConfig }
  config.value.geminiConfig = { ...p.geminiConfig }
  config.value.modelContextWindows = { ...p.modelContextWindows }
  try {
    await saveSettings()                    // 写 gui-settings.json + 同步 settings.json（现有链路）
    await saveProfiles()                    // 持久化 activeProfileId 到 profiles.json
  } catch (err) {
    activeProfileId.value = prevActiveId    // 回滚
    throw err
  }
}

async function createProfile(name: string): Promise<string> {
  // 以当前 config 为模板，复制一份为新 Profile
  const now = new Date().toISOString()
  const p: ModelProfile = {
    id: crypto.randomUUID(),
    name: name.trim() || '未命名',
    authMethod: config.value.authMethod,
    anthropicConfig: { ...config.value.anthropicConfig },
    openaiConfig: { ...config.value.openaiConfig },
    geminiConfig: { ...config.value.geminiConfig },
    modelContextWindows: { ...config.value.modelContextWindows },
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
    const p = profiles.value[i]
    config.value.authMethod = p.authMethod
    config.value.anthropicConfig = { ...p.anthropicConfig }
    config.value.openaiConfig = { ...p.openaiConfig }
    config.value.geminiConfig = { ...p.geminiConfig }
    config.value.modelContextWindows = { ...p.modelContextWindows }
    await saveSettings()
  }
  await saveProfiles()
}

async function deleteProfile(id: string): Promise<void> {
  if (profiles.value.length <= 1) return   // 至少保留 1 个
  profiles.value = profiles.value.filter(x => x.id !== id)
  if (activeProfileId.value === id) {
    activeProfileId.value = profiles.value[0].id
    await applyProfile(profiles.value[0].id)
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
    authMethod: config.value.authMethod,
    anthropicConfig: { ...config.value.anthropicConfig },
    openaiConfig: { ...config.value.openaiConfig },
    geminiConfig: { ...config.value.geminiConfig },
    modelContextWindows: { ...config.value.modelContextWindows },
    createdAt: now, updatedAt: now,
  }
  profiles.value = [p]
  activeProfileId.value = p.id
  await saveProfiles()
}
```

### 5.3 编辑语义

展开的卡片内，用户修改表单字段时，**实时更新对应 Profile 的字段**（通过 `updateProfile`）。无需单独"保存"按钮——展开态的表单是"所见即所得"，修改即持久化到 `profiles.json`。只有"应用此配置"才会触发写入 `gui-settings.json` + `settings.json`。

## 6. UI 层（Vue 组件）

### 6.1 布局方案

采用方案 C（卡片网格 + 就地展开）+ 方案 2（信息丰富缩略 + 关键操作）。

```
[模型 tab]
  ├── <ProfileCards />                    ← 新增：卡片网格 + 展开管理
  │     ├── 缩略卡网格（3 列响应式）
  │     │     ├── Profile A (● 已激活)
  │     │     ├── Profile B (○)
  │     │     └── + 新建配置
  │     └── 展开区（expandedProfile 对应的卡）
  │           ├── 名称（可点击就地编辑）
  │           ├── <ModelSettings />       ← 复用现有表单
  │           └── 操作栏：应用此配置 / 另存为 / 删除
  └── (Profile 层之外的应用级设置仍直接渲染)
```

### 6.2 新增 `ProfileCards.vue`

路径：`src/components/settings/ProfileCards.vue`

**缩略卡内容**（6 字段信息密度）：
- 名称（可点击就地编辑为 input）
- 激活标记（● 已激活 / ○）
- Provider 图标 + 认证方式标签
- 模型摘要（如 `sonnet-4`）
- 上下文窗口标记（如 `200K` / `1M`）
- **不显示 apiKey**

**展开态**：在卡片网格下方独立区域渲染（不挤压其他卡），把当前 `expandedProfile` 的数据传给 `ModelSettings.vue`。

**操作栏**（3 按钮）：
- `应用此配置`（蓝色主按钮 → `store.applyProfile(id)`）
- `另存为新配置`（次要按钮 → `store.duplicateProfile(id)`）
- `删除`（红色危险按钮，至少保留 1 个时禁用 → `store.deleteProfile(id)`）

### 6.3 改造 `SettingsPanel.vue`

在现有"模型"tab 内，`ModelSettings.vue` 外层包一层 `ProfileCards.vue`。

### 6.4 改造 `ModelSettings.vue`

props 从"绑定 SettingsPanel 的 settingsData"改为"绑定 ProfileCards 的 expandedProfile"。`ModelSettings` 内部逻辑基本不变——它只管"编辑一份 ProviderConfig 集合"，至于这份集合来自哪里（单套还是 Profile）由外层决定。

### 6.5 切换交互（方案 X）

点击"应用此配置"后：
1. 渲染进程 `applyProfile(id)`：把 Profile 字段写回 `config` → 调用现有 `saveSettings()`（内部触发主进程写 `gui-settings.json` + 同步 `settings.json`）→ 调用 `saveProfiles()` 持久化 `activeProfileId`
2. 顶部 Toast 提示"已切换到「{name}」配置，新会话将使用此配置"
3. 卡片激活标记立即移动
4. **不中断当前会话**——新配置从下一个会话/下一条消息生效（环境变量无法热更新到已运行的 Codex CLI 进程）

### 6.6 apiKey 脱敏

- 缩略态：永远不显示 apiKey
- 展开态：默认显示为 `sk-****abcd`，需点击眼睛图标才显示明文

## 7. i18n

`zh-CN.ts` / `en-US.ts` 新增 `profile.*` 区块：

| key | zh-CN | en-US |
|---|---|---|
| `profile.title` | 配置 | Profiles |
| `profile.addNew` | 新建配置 | New profile |
| `profile.active` | 已激活 | Active |
| `profile.apply` | 应用此配置 | Apply this profile |
| `profile.duplicate` | 另存为新配置 | Duplicate |
| `profile.delete` | 删除 | Delete |
| `profile.deleteConfirm` | 确认删除此配置？ | Delete this profile? |
| `profile.namePlaceholder` | 配置名称 | Profile name |
| `profile.switchedToast` | 已切换到「{name}」配置，新会话将使用此配置 | Switched to "{name}", new sessions will use this profile |
| `profile.cannotDeleteLast` | 至少保留一个配置 | At least one profile required |
| `profile.defaultName` | 默认 | Default |
| `profile.untitled` | 未命名 | Untitled |

## 8. 错误处理与边界

- **profiles.json 解析失败**：备份为 `profiles.json.corrupt-{timestamp}`，按首次启动迁移流程重建
- **activeProfileId 指向不存在的 Profile**：重置为 `profiles[0].id`，并 `applyProfile`
- **profiles 为空数组**：不应出现（迁移保证至少 1 个）；防御性处理：触发迁移
- **删除最后一个 Profile**：按钮禁用，tooltip 提示"至少保留一个配置"
- **切换 Profile 时 gui-settings.json 写入失败**：Toast 提示"切换失败"，`activeProfileId` 回滚
- **Profile name 重名**：允许（id 才是唯一键）
- **Profile name 为空**：保存时自动填"未命名"

## 9. 测试策略

遵循 TDD（用户偏好）。

### 9.1 Electron 主进程测试

文件：`electron/__tests__/profiles.test.ts`（Node test runner）

- `profiles:load` 文件不存在返回 null
- `profiles:save` 写入 + 文件权限 0600
- `profiles:save` 目录不存在时自动创建 `~/.spacecode/`

### 9.2 Store 测试

文件：`tests/composables/profiles.test.ts`（vitest）

- `loadProfiles` 首次触发迁移
- `applyProfile` 更新 config + 触发 saveSettings
- `createProfile` / `updateProfile` / `deleteProfile` / `duplicateProfile` 状态变化
- `deleteProfile` 最后一个被阻止
- `updateProfile` 修改 active profile 时同步到 config
- `applyProfile` 失败时 activeProfileId 回滚

### 9.3 组件测试

文件：`tests/components/ProfileCards.test.ts`（vitest）

- 缩略卡渲染正确字段（名称/provider/模型/上下文窗口）
- apiKey 在缩略态不显示
- 点击卡片展开/收起
- "应用此配置"调用 `store.applyProfile`
- 删除最后一个禁用
- 名称就地编辑

## 10. 实现范围与文件清单

### 10.1 新增文件（5 个）

1. `src/types/profile.ts` — 类型定义
2. `src/components/settings/ProfileCards.vue` — 卡片网格组件
3. `electron/__tests__/profiles.test.ts` — 主进程测试
4. `tests/composables/profiles.test.ts` — store 测试
5. `tests/components/ProfileCards.test.ts` — 组件测试

### 10.2 修改文件（7 个）

1. `electron/main.ts` — 新增 2 个 IPC（profiles:load/save）+ 路径函数
2. `electron/preload.ts` — 暴露 2 个新 API（profilesLoad/profilesSave）
3. `src/services/electronAPI.ts` — 新增 2 个方法（profilesLoad/profilesSave）
4. `src/stores/settings.ts` — 新增 profile state + actions（含迁移逻辑）
5. `src/components/settings/SettingsPanel.vue` — 包入 ProfileCards
6. `src/components/settings/ModelSettings.vue` — props 改为接收 Profile 数据
7. `src/i18n/locales/zh-CN.ts` + `en-US.ts` — 新增 profile.* 区块

### 10.3 不改动

- `engine/`（独立子项目）
- `electron/petLLMProxy.ts`、`electron/imServer/imServer.ts`、`electron/h5Server.ts`、`electron/browserUseService.ts`、`electron/promptOptimizerIPC.ts`（读 `gui-settings.json`，链路不变）

## 11. 设计决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 一套配置的粒度 | 完整快照（认证方式+provider凭证+模型名+上下文窗口） | 切换语义最干净，符合"多套配置互相切换" |
| Profile 与 authMethod 关系 | Profile 是外层，authMethod 是 Profile 内部字段 | 现有 ModelSettings 表单可复用 |
| 存储位置 | `~/.spacecode/profiles.json` | 与 `~/.claude/gui-settings.json` 职责分离 |
| gui-settings.json 是否迁移 | 不迁移 | 保持现有 6 个读取方无感，避免大范围改动 |
| 布局方案 | 卡片网格 + 就地展开（方案 C） | 最符合"卡片缩略+点击展开"描述 |
| 缩略卡密度 | 信息丰富（方案 2） | 不展开即可对比关键差异 |
| 切换交互 | 静默切换 + Toast（方案 X） | 不破坏当前会话工作流 |
| Store 拆分 | 不新建独立 store | Profile 与 AuthSettings 强耦合 |
| apply 实现 | 复用现有 saveSettings 链路，不新增 profiles:apply IPC | 避免重复写入逻辑，saveSettings 已包含 gui-settings.json + settings.json 同步 |
| apiKey 存储 | 明文 + 文件权限 0600 | 与现状安全级别一致 |
| oauthAccount | 不放入 Profile | OAuth 是设备级登录态 |
