# 桌面宠物系统设计规格

> 状态：待实现确认
> 关联调研：后端 engine `/buddy` 系统（`engine/src/buddy/`）、前端 system-reminder 处理现状

## 1. 目标与背景

SpaceCode 后端 engine 已实现 `/buddy` 虚拟宠物系统（通过 `system-reminder` 注入提示、`buddy_react` API 生成反应），但前端完全没有渲染逻辑。本次任务在前端独立实现一套完整的桌面宠物系统：

- **宠物设置页面**：浏览内置宠物、创作自定义宠物、配置行为参数
- **可移动悬浮组件**：支持应用内嵌入模式与桌面独立窗口模式双模切换
- **双模式反应系统**：预设语料 + AI 生成可切换

### 1.1 关键约束（来自后端调研）

后端 `/buddy` 系统的关键特征决定了前端必须独立管理：

- engine 不通过 IPC 暴露任何 buddy API，仅与 `~/.claude.json` 的 `companion`/`companionMuted` 字段交互
- `buddy_react` API 由 engine 内部调用 Anthropic，前端无法复用
- 后端不支持自定义宠物，仅 18 种内置物种
- bones（rarity/species/eye/hat/shiny/stats）不持久化，每次从 seed 重新 roll（防篡改设计）
- system-reminder 仅注入一次 `companion_intro`，告知 AI 宠物存在

**决策**：前端完全独立管理宠物数据，不依赖 engine 的 `/buddy` 命令。前端宠物配置存储在独立文件 `~/.claude/buddy-pets.json`，与 engine 的 `~/.claude.json` 互不干扰。

## 2. 范围

### 2.1 本次实现范围

| 模块 | 内容 |
|---|---|
| 数据层 | 类型定义、配置文件读写、内置宠物库（18 种） |
| Electron 主进程 | `petFileService`、`petWindowManager`、`petLLMProxy`、IPC handlers、独立窗口 preload |
| 渲染进程 | `petStore`、`usePetReaction`、`usePetDrag` composables |
| 组件层 | `PetEmbeddedWidget`、`PetSprite`、18 个 species sprite、`PetReactionBubble`、`PetDragHandle` |
| 独立窗口 | `pet-window.html` 入口、`PetWindowApp` 根组件、精简 i18n |
| 设置页面 | `PetSettings` 容器、`PetPreviewHeader`、`PetGallery`、`PetCard`、`PetCreator`、`PetBehaviorConfig` |
| AI 反应 | LLM system prompt、速率限制、去重、错误处理 |
| i18n | `petSettings` 翻译键（中英双语） |
| 构建配置 | Vite 独立窗口入口 |

### 2.2 不在本次范围内

- 不修改 engine `/buddy` 系统任何代码
- 不解析或处理 engine 注入的 `companion_intro` system-reminder（前端独立运作）
- 不与 engine 的 `~/.claude.json` companion 字段同步
- Emoji 快速创作模式（`PetVisualSource` 中的 `emoji` 类型预留但不实现）

## 3. 架构总览

采用**渲染进程主导**架构（方案 A），与 SpaceCode 现有 chat/settings/MCP 等模块的模式一致。

```
[主应用渲染进程]                [主进程]                  [独立窗口渲染进程]
   petStore (Pinia)               │                            │
     │ 状态唯一源                 │                            │
     ↓                            │                            │
  IPC ←───pet:*───→ PetFileService (文件 IO)                   │
  IPC ←───pet:*───→ PetWindowManager (窗口生命周期 + 事件中继) ──IPC──→ PetWindowApp
  IPC ←───pet:*───→ PetLLMProxy (LLM 代理，避免 API key 暴露)  │
                                 │                            │
  <PetEmbeddedWidget>            │                            <PetSprite>
  <PetSprite> (共用)             │                            <PetReactionBubble> (共用)
  <PetReactionBubble> (共用)     │
```

**职责划分**：
- **渲染进程**：业务状态（当前宠物/模式/位置）、设置页面 UI、应用内浮层渲染、独立窗口的 Vue 视图
- **主进程**：`petFileService.ts`（读写配置）、`petWindowManager.ts`（窗口生命周期 + 事件中继）、`petLLMProxy.ts`（LLM 代理转发）
- **共享**：`<PetSprite>`、`<PetReactionBubble>`、species sprite 组件在两种模式下共用

## 4. 数据存储与配置

### 4.1 配置文件位置

`~/.claude/buddy-pets.json`（独立文件，不污染 `~/.claude.json`，与 SpaceCode 现有 `gui-settings.json` 同目录）

自定义宠物素材独立目录：`~/.claude/buddy-pets-assets/`，文件名用 petId 命名避免冲突。

### 4.2 配置文件结构

```json
{
  "version": 1,
  "activePetId": "builtin-duck",
  "mode": "embedded",
  "embeddedPosition": { "x": 0.85, "y": 0.78 },
  "desktopWindow": { "x": 1200, "y": 700, "width": 120, "height": 120 },
  "settings": {
    "reactionMode": "preset",
    "aiModel": "gpt-4o-mini",
    "reactionIntervalMs": 60000,
    "muted": false,
    "scale": 1.0,
    "alwaysOnTopDesktop": true,
    "clickThrough": false
  },
  "customPets": [
    {
      "id": "custom-1715000000-abc",
      "name": "小桃",
      "personality": "贪吃的橘猫，看到 bug 就想吃",
      "visual": { "type": "image", "path": "buddy-pets-assets/custom-1715000000-abc.png" },
      "palette": { "primary": "#FFA94D", "accent": "#FF6B35" },
      "createdAt": 1715000000000,
      "presetReactions": {
        "idle": ["喵~ 又来 bug 啦？", "这个变量名看着就好吃！"],
        "typing": ["你在写什么好吃的？", "加油加油~"],
        "error": ["呜哇，bug 出现了！", "别急，慢慢来"],
        "success": ["太棒了！夸夸~", "完成啦，奖励自己一下吧"],
        "petted": ["喵呜~好舒服", "喜欢被摸摸头"]
      }
    }
  ]
}
```

### 4.3 关键设计点

1. **坐标双轨**：应用内嵌模式用比例坐标（`x`/`y` 为 0-1 浮点，自适应窗口大小）；桌面模式用绝对像素（屏幕分辨率固定，精确控制）。
2. **version 字段**：预留未来 schema 变更的迁移入口。
3. **activePetId 可指向内置或自定义**：UI 通过 `id` 前缀（`builtin-` / `custom-`）区分。
4. **reactionMode 取值**：`'preset'`（预设语料）| `'ai'`（LLM 生成）。
5. **muted 字段**：与后端 `companionMuted` 独立，前端独立管理。

### 4.4 主进程接口（深模块）

新增 `electron/petFileService.ts`：

```ts
interface PetFileAPI {
  read(): Promise<PetConfig | null>
  write(config: PetConfig): Promise<void>
  saveAsset(srcPath: string, petId: string): Promise<string>  // 返回相对路径
  deleteAsset(relativePath: string): Promise<void>
}
```

**读写策略**：
- 读：主进程读文件 → JSON.parse → 校验 schema → 返回给渲染进程
- 写：渲染进程提交完整 config → 主进程原子写入（先写 `.tmp` 再 rename）
- 资源保存：用户上传的图片复制到 `buddy-pets-assets/` 目录，重命名为 `petId.ext`

### 4.5 加载时机

1. App.vue 启动时 `petStore.init()` → 通过 IPC 读取配置 → 应用状态
2. 用户在设置页修改后 → `petStore.persist()` → 通过 IPC 写入
3. 主进程持有 config 副本，独立窗口启动时直接从主进程读取（避免重复 IO）

## 5. 宠物数据模型与内置库

### 5.1 类型定义（`src/types/pet.ts`）

```ts
// ===== 视觉素材 =====
type PetVisualSource =
  | { type: 'builtin-svg'; species: BuiltinSpecies }
  | { type: 'image'; path: string; frameCount?: 1 | 2 }
  | { type: 'emoji'; glyph: string }  // 预留，本期不实现

type BuiltinSpecies =
  | 'duck' | 'goose' | 'blob' | 'cat' | 'dragon' | 'octopus'
  | 'owl' | 'penguin' | 'turtle' | 'snail' | 'ghost' | 'axolotl'
  | 'capybara' | 'cactus' | 'robot' | 'rabbit' | 'mushroom' | 'chonk'

// ===== 调色板（仅影响内置 SVG 着色，自定义图片不应用） =====
interface PetPalette {
  primary: string
  accent: string
  background?: string
}

// ===== 预设反应语料 =====
interface PresetReactions {
  idle: string[]
  typing: string[]
  error: string[]
  success: string[]
  petted: string[]
}

type PetReactionTrigger = 'idle' | 'typing' | 'error' | 'success' | 'petted'

// ===== 完整宠物定义 =====
interface Pet {
  id: string                  // builtin-<species> | custom-<timestamp>-<rand>
  name: string
  personality: string
  visual: PetVisualSource
  palette?: PetPalette
  presetReactions: PresetReactions
  rarity?: 'common' | 'rare' | 'epic' | 'legendary'
  createdAt?: number
}

// ===== 运行时状态（不持久化） =====
interface PetRuntimeState {
  currentReaction: string | null
  reactionAt: number | null
  isPetted: boolean
  animationFrame: number
  isDragging: boolean
}

// ===== 持久化配置 =====
interface PetConfig {
  version: number
  activePetId: string
  mode: 'embedded' | 'desktop'
  embeddedPosition: { x: number; y: number }
  desktopWindow: { x: number; y: number; width: number; height: number }
  settings: PetSettings
  customPets: Pet[]
}

interface PetSettings {
  reactionMode: 'preset' | 'ai'
  aiModel: string
  reactionIntervalMs: number
  muted: boolean
  scale: number
  alwaysOnTopDesktop: boolean
  clickThrough: boolean
}

// ===== IPC 同步载荷 =====
interface PetSyncPayload {
  pet: Pet
  runtimeState: PetRuntimeState
  settings: PetSettings
  locale: 'zh-CN' | 'en-US'
}

// ===== 独立窗口事件 =====
type PetWindowEvent =
  | { type: 'drag'; deltaX: number; deltaY: number }
  | { type: 'drag-end' }
  | { type: 'click' }
  | { type: 'double-click' }
  | { type: 'right-click' }

// ===== LLM 反应请求 =====
interface PetReactionRequest {
  petName: string
  personality: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  trigger: PetReactionTrigger
}
```

### 5.2 内置宠物库（`src/lib/builtinPets.ts`）

18 种宠物，与后端 species 对齐，但视觉/语料完全由前端重做：

```ts
export const BUILTIN_PETS: Pet[] = [
  {
    id: 'builtin-duck',
    name: 'Waddles',
    personality: '古怪又容易开心，喜欢到处留调试小贴士',
    visual: { type: 'builtin-svg', species: 'duck' },
    palette: { primary: '#FFD93D', accent: '#FF6B35' },
    rarity: 'common',
    presetReactions: {
      idle: ['嘎~', '今天代码写得不错呢', '呱呱，有点无聊...'],
      typing: ['你在打字吗？我也想帮忙！', '加油加油~'],
      error: ['哎呀，这个 bug 我闻到了', '别急，慢慢来'],
      success: ['太棒了！夸夸~', '完成啦，奖励自己一下吧'],
      petted: ['嘎嘎~好舒服', '喜欢被摸摸头']
    }
  },
  // ... 其余 17 种（goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk）
]
```

**内置宠物与后端的对应关系**：每个 species 的视觉风格参考后端 ASCII 精灵图的主题色（duck 黄色、cat 灰白、dragon 紫色等），但前端用 SVG 重新设计。

**注意**：前端不复制后端的 `CompanionBones`/`Rarity` 权重/PRNG 等——这些是后端"防篡改随机生成"机制，前端独立管理，每个内置宠物固定稀有度展示即可。

### 5.3 通用默认语料

自定义宠物未填写预设反应时使用 `src/lib/defaultReactions.ts`：

```ts
export const DEFAULT_PRESET_REACTIONS: PresetReactions = {
  idle: ['咕...', '在发呆吗？', '今天天气不错呢', '需要我帮忙吗？'],
  typing: ['加油~', '写得不错！', '继续继续', '看起来很专注呢'],
  error: ['哎呀出错了', '别急，慢慢调', '我闻到 bug 的味道了', '休息一下？'],
  success: ['太棒了！', '完成啦！', '夸夸~', '奖励自己一下吧'],
  petted: ['好舒服~', '喜欢被摸摸', '再摸摸我吧', '嘿嘿~']
}
```

### 5.4 自定义宠物创作约束

- `id`：`custom-<Date.now()>-<rand4>` 自动生成
- `name`：1-20 字符
- `personality`：1-200 字符（用于 AI 反应人设 prompt）
- `visual`：仅支持 `image` 类型，接受 PNG/JPG/GIF/SVG，≤ 2MB
- `palette`：可选（不影响图片显示）
- `presetReactions`：每个场景至少 1 条，最多 10 条（用户可偷懒不填，使用默认通用语料）

## 6. Electron 主进程改造

### 6.1 新增模块

在 `electron/` 下新增 3 个深模块，遵循 ADR-0004 的"深模块"原则（单职责、窄接口）：

#### 6.1.1 `electron/petFileService.ts`

```ts
class PetFileService {
  async init(): Promise<void>           // 启动时读取并缓存配置
  async read(): Promise<PetConfig | null>
  async write(config: PetConfig): Promise<void>
  async saveAsset(srcPath: string, petId: string): Promise<string>
  async deleteAsset(relativePath: string): Promise<void>
}
```

#### 6.1.2 `electron/petWindowManager.ts`（窗口生命周期 + 事件中继）

```ts
class PetWindowManager {
  async create(config: PetConfig): Promise<void>
  async destroy(): Promise<void>
  async updateBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>
  syncPetState(state: PetSyncPayload): void
  onWindowEvent(handler: (e: PetWindowEvent) => void): void
  setIgnoreMouseEvents(ignore: boolean): void
  setAlwaysOnTop(onTop: boolean): void
}
```

**窗口创建参数**：

```ts
new BrowserWindow({
  width: 120, height: 120,
  frame: false,
  transparent: true,
  resizable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  focusable: false,
  webPreferences: {
    preload: path.join(__dirname, 'petPreload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  }
})
```

**关键细节**：
- 独立窗口加载独立的 HTML 入口 `pet-window.html`（不加载主应用，避免重复初始化 Pinia/Router）
- 独立 preload `electron/petPreload.ts` 仅暴露 `petWindowAPI` 命名空间（最小权限）
- `setIgnoreMouseEvents(config.settings.clickThrough)` 控制点击穿透

#### 6.1.3 `electron/petLLMProxy.ts`（LLM 代理转发）

```ts
class PetLLMProxy {
  async generateReaction(req: PetReactionRequest): Promise<string | null>
}
```

**为什么主进程代理而非渲染进程直接调用**：
- 独立窗口是独立渲染进程，无法访问主应用的 `window.electronAPI` 全部 API
- API key 不能暴露给独立窗口的 webPreferences（即使 contextIsolation）
- 主进程统一出口便于未来加日志/限流/缓存

### 6.2 IPC 通道设计

遵循 ADR-0007 的"按域拆分 electronAPI"模式，新增 `pet` 命名空间。

#### 6.2.1 主应用 preload.ts 新增

```ts
pet: {
  // 文件配置
  readConfig: () => ipcRenderer.invoke('pet:readConfig'),
  writeConfig: (config: PetConfig) => ipcRenderer.invoke('pet:writeConfig', config),
  saveAsset: (srcPath: string, petId: string) => ipcRenderer.invoke('pet:saveAsset', srcPath, petId),
  deleteAsset: (relativePath: string) => ipcRenderer.invoke('pet:deleteAsset', relativePath),

  // 独立窗口控制
  createDesktopWindow: () => ipcRenderer.invoke('pet:createDesktopWindow'),
  destroyDesktopWindow: () => ipcRenderer.invoke('pet:destroyDesktopWindow'),
  updateWindowBounds: (bounds) => ipcRenderer.invoke('pet:updateWindowBounds', bounds),
  syncPetState: (state: PetSyncPayload) => ipcRenderer.send('pet:syncPetState', state),

  // 独立窗口事件（主进程 → 渲染进程）
  onWindowEvent: (handler: (e: PetWindowEvent) => void) =>
    ipcRenderer.on('pet:windowEvent', (_e, payload) => handler(payload)),

  // LLM 代理
  generateReaction: (req: PetReactionRequest) => ipcRenderer.invoke('pet:generateReaction', req),
}
```

#### 6.2.2 独立窗口 preload（`electron/petPreload.ts`）

```ts
contextBridge.exposeInMainWorld('petWindowAPI', {
  getInitialState: () => ipcRenderer.invoke('petWindow:getInitialState'),
  onStateUpdate: (handler: (state: PetSyncPayload) => void) =>
    ipcRenderer.on('petWindow:stateUpdate', (_e, state) => handler(state)),
  emitWindowEvent: (e: PetWindowEvent) => ipcRenderer.send('petWindow:event', e),
  requestReaction: (req: PetReactionRequest) => ipcRenderer.invoke('petWindow:requestReaction', req),
  getLocale: () => ipcRenderer.invoke('petWindow:getLocale'),
})
```

### 6.3 事件中继流程

```
[主应用渲染进程]                [主进程]                  [独立窗口渲染进程]
       |                          |                            |
  petStore.setState ──IPC──→ PetWindowManager.syncPetState ──IPC──→ petWindowAPI.onStateUpdate
       |                          |                            |
       |                          |  ←──IPC── emitWindowEvent（拖拽/点击）
       |                          |                            |
  pet:windowEvent ←──IPC──── PetWindowManager.onWindowEvent     |
       |                          |                            |
       ↓                          |                            |
  petStore 处理事件               |                            |
```

### 6.4 IPC handlers 注册

新增 `electron/petIpcHandlers.ts`（遵循 ADR-0007 模式）：

```ts
export function registerPetIpcHandlers(deps: {
  petFileService: PetFileService
  petWindowManager: PetWindowManager
  petLLMProxy: PetLLMProxy
}) {
  ipcMain.handle('pet:readConfig', () => deps.petFileService.read())
  ipcMain.handle('pet:writeConfig', (_e, config) => deps.petFileService.write(config))
  ipcMain.handle('pet:saveAsset', (_e, src, petId) => deps.petFileService.saveAsset(src, petId))
  ipcMain.handle('pet:deleteAsset', (_e, path) => deps.petFileService.deleteAsset(path))
  ipcMain.handle('pet:createDesktopWindow', () => deps.petWindowManager.create(...))
  ipcMain.handle('pet:destroyDesktopWindow', () => deps.petWindowManager.destroy())
  ipcMain.handle('pet:updateWindowBounds', (_e, bounds) => deps.petWindowManager.updateBounds(bounds))
  ipcMain.on('pet:syncPetState', (_e, state) => deps.petWindowManager.syncPetState(state))
  ipcMain.handle('pet:generateReaction', (_e, req) => deps.petLLMProxy.generateReaction(req))

  // 独立窗口 → 主进程
  ipcMain.handle('petWindow:getInitialState', () => deps.petWindowManager.getInitialState())
  ipcMain.on('petWindow:event', (_e, event) => deps.petWindowManager.handleWindowEvent(event))
  ipcMain.handle('petWindow:requestReaction', (_e, req) => deps.petLLMProxy.generateReaction(req))
  ipcMain.handle('petWindow:getLocale', () => getStoredLocale())
}
```

### 6.5 main.ts 改造

```ts
const petFileService = new PetFileService()
const petWindowManager = new PetWindowManager()
const petLLMProxy = new PetLLMProxy()

app.whenReady().then(async () => {
  // ... 现有 createWindow 逻辑 ...
  await petFileService.init()
  registerPetIpcHandlers({ petFileService, petWindowManager, petLLMProxy })
})

app.on('window-all-closed', () => {
  petWindowManager.destroy()
  app.quit()
})
```

### 6.6 Vite 构建配置

`vite.config.mts` 新增独立窗口入口：
- `pet-window.html` 作为独立入口
- 构建产物 `dist-electron/pet-window.js` + `dist/pet-window.html`
- Electron 加载路径：`loadFile(path.join(__dirname, '../dist/pet-window.html'))`

## 7. 渲染进程架构

### 7.1 Store 设计（`src/stores/pet.ts`）

遵循 ADR-0009 的窄写接口原则：

```ts
export const usePetStore = defineStore('pet', () => {
  // ===== 状态 =====
  const config = ref<PetConfig | null>(null)
  const activePet = ref<Pet | null>(null)
  const runtimeState = ref<PetRuntimeState>({...})
  const isInitialized = ref(false)

  // ===== 派生 =====
  const allPets = computed<Pet[]>(() => [...BUILTIN_PETS, ...(config.value?.customPets ?? [])])
  const mode = computed(() => config.value?.mode ?? 'embedded')
  const isMuted = computed(() => config.value?.settings.muted ?? false)

  // ===== 写接口（窄） =====
  async function init(): Promise<void>
  async function setActivePet(petId: string): Promise<void>
  async function setMode(mode: 'embedded' | 'desktop'): Promise<void>
  async function updateSettings(patch: Partial<PetSettings>): Promise<void>
  async function addCustomPet(pet: Pet, assetSrcPath?: string): Promise<void>
  async function removeCustomPet(petId: string): Promise<void>
  async function updatePosition(pos: { x: number; y: number }): Promise<void>

  // ===== 运行时控制（不持久化） =====
  function triggerReaction(text: string): void
  function triggerPetted(): void
  function clearReaction(): void

  // ===== 内部 =====
  async function persist(): Promise<void>
  function syncToDesktopWindow(): void

  return { config, activePet, runtimeState, isInitialized, allPets, mode, isMuted,
           init, setActivePet, setMode, updateSettings, addCustomPet, removeCustomPet,
           updatePosition, triggerReaction, triggerPetted, clearReaction }
})
```

**关键设计点**：
1. `activePet` 是 `computed` 从 `allPets` 中查找 `config.activePetId`，避免状态冗余
2. 所有写操作通过 `persist()` 统一持久化 + 同步独立窗口
3. 运行时控制（`triggerReaction`/`triggerPetted`）不持久化，但通过 `syncToDesktopWindow()` 推送给独立窗口

### 7.2 Composable 设计

#### `src/composables/usePetReaction.ts`

```ts
export function usePetReaction() {
  const petStore = usePetStore()
  let lastReactionAt = 0

  function onUserTyping(): void
  function onTaskError(): void
  function onTaskSuccess(): void
  function onUserPetted(): void
  function onIdleInterval(): void

  async function generateReaction(trigger: PetReactionTrigger): Promise<string | null> {
    if (petStore.isMuted) return null
    const intervalOk = Date.now() - lastReactionAt >= petStore.config!.settings.reactionIntervalMs
    if (!intervalOk && trigger !== 'petted') return null

    const text = petStore.config!.settings.reactionMode === 'ai'
      ? await generateAIReaction(trigger)
      : pickPresetReaction(trigger)

    if (text) {
      petStore.triggerReaction(text)
      lastReactionAt = Date.now()
    }
    return text
  }

  function pickPresetReaction(trigger: PetReactionTrigger): string
  async function generateAIReaction(trigger: PetReactionTrigger): Promise<string | null>

  return { onUserTyping, onTaskError, onTaskSuccess, onUserPetted, onIdleInterval, generateReaction }
}
```

#### `src/composables/usePetDrag.ts`

```ts
export function usePetDrag(options: {
  mode: 'embedded' | 'desktop'
  onDragEnd: (pos: { x: number; y: number }) => void
}) {
  const isDragging = ref(false)
  // embedded 模式：直接操作 DOM style，结束时计算比例坐标
  // desktop 模式：通过 IPC emitWindowEvent 移动窗口
  return { isDragging, onPointerDown }
}
```

**拖拽逻辑差异**：
- **embedded 模式**：`position: fixed`，拖拽时直接更新 DOM `left`/`top`，结束时计算比例坐标 `(x / window.innerWidth, y / window.innerHeight)` 持久化
- **desktop 模式**：拖拽时通过 `petWindowAPI.emitWindowEvent({ type: 'drag', deltaX, deltaY })` 通知主进程移动窗口，结束时 `drag-end` 持久化绝对坐标

### 7.3 上下文事件接入

宠物反应需要监听 SpaceCode 的实际事件。接入点（不修改 store 内部，仅在组件中调用 `usePetReaction()` 的钩子）：

| 事件 | 接入位置 | 触发条件 |
|---|---|---|
| 用户打字 | `src/components/chat/ChatInput.vue` 的 input 事件 | debounce 500ms |
| 任务错误 | `src/stores/turn/eventHandlers.ts` 的 `handleToolResult` | `result.is_error === true` |
| 任务成功 | turn store 的 turn 完成事件 | 无 tool_error |
| 闲时 | `usePetReaction` 内部 `setInterval` | `reactionIntervalMs` 间隔 |
| 撸宠物 | `<PetSprite>` 的 click 事件 | 直接点击 |

**接入方式**：在 `eventHandlers.ts` 末尾新增一行 `petReaction.onTaskError()` 调用（直接调用钩子，不修改 turn store 内部逻辑）。

### 7.4 应用内嵌入模式挂载

在 `App.vue` 中新增条件渲染：

```vue
<template>
  <div class="app-container">
    <SplitContainer>...</SplitContainer>
    <PetEmbeddedWidget v-if="shouldShowEmbeddedPet" />
  </div>
</template>

<script setup>
const petStore = usePetStore()
const shouldShowEmbeddedPet = computed(() =>
  petStore.isInitialized &&
  petStore.activePet &&
  petStore.mode === 'embedded' &&
  !petStore.isMuted
)
</script>
```

**位置策略**：`PetEmbeddedWidget` 采用 `position: fixed`，基于 `config.embeddedPosition`（比例坐标）计算实际位置。容器是整个 App 根，比例自适应窗口大小变化。

### 7.5 独立窗口渲染进程

独立窗口加载 `pet-window.html`，对应 `src/pet-window/main.ts`（精简入口）：

```ts
import { createApp } from 'vue'
import { initPetWindowI18n } from './i18n'
import PetWindowApp from './PetWindowApp.vue'

const app = createApp(PetWindowApp)
const locale = await window.petWindowAPI.getLocale()
app.use(await initPetWindowI18n(locale))
app.mount('#pet-window-root')
```

**独立窗口不需要 Pinia**：状态极简（只有当前宠物 + 反应文本 + 动画帧），用 `reactive` + `onStateUpdate` 监听即可。

```ts
// src/pet-window/PetWindowApp.vue
const state = reactive<{ pet: Pet | null; reaction: string | null; isPetted: boolean; scale: number }>({
  pet: null, reaction: null, isPetted: false, scale: 1
})
window.petWindowAPI.onStateUpdate((payload) => {
  state.pet = payload.pet
  state.reaction = payload.runtimeState.currentReaction
  state.isPetted = payload.runtimeState.isPetted
  state.scale = payload.settings.scale
})
```

### 7.6 文件组织结构

```
src/
├─ types/
│  └─ pet.ts                          ← 类型定义
├─ lib/
│  ├─ builtinPets.ts                  ← 内置宠物库
│  └─ defaultReactions.ts             ← 通用默认语料
├─ stores/
│  └─ pet.ts                          ← Pinia store（窄写接口）
├─ composables/
│  ├─ usePetReaction.ts               ← 反应触发逻辑
│  └─ usePetDrag.ts                   ← 拖拽逻辑
├─ components/
│  ├─ pets/
│  │  ├─ PetEmbeddedWidget.vue        ← 应用内嵌入组件
│  │  ├─ PetSprite.vue                ← 精灵图渲染（分发到具体 species 组件）
│  │  ├─ PetImageSprite.vue           ← 自定义图片渲染
│  │  ├─ PetReactionBubble.vue        ← 反应气泡
│  │  ├─ PetDragHandle.vue            ← 拖拽手柄
│  │  └─ sprites/
│  │     ├─ DuckSprite.vue
│  │     ├─ CatSprite.vue
│  │     └─ ...（18 个）
│  └─ settings/
│     └─ pet/
│        ├─ PetSettings.vue
│        ├─ PetPreviewHeader.vue
│        ├─ PetGallery.vue
│        ├─ PetCard.vue
│        ├─ PetCreator.vue
│        └─ PetBehaviorConfig.vue
└─ pet-window/                        ← 独立窗口渲染进程
   ├─ main.ts
   ├─ PetWindowApp.vue
   ├─ i18n.ts
   └─ index.html
```

## 8. PetWidget 组件与双模式渲染

### 8.1 组件层级

```
主应用                                独立窗口
  ↓                                      ↓
<PetEmbeddedWidget>                  <PetWindowApp>
  ├─ <PetSprite>                      └─ <PetSprite>      ← 共用
  │    └─ <DuckSprite/CatSprite/...>      └─ <DuckSprite/...>  ← 共用
  ├─ <PetReactionBubble>              └─ <PetReactionBubble>  ← 共用
  └─ <PetDragHandle>                  └─ <PetDragHandle>      ← 共用（实现不同）
```

**核心策略**：`<PetSprite>`、`<PetReactionBubble>`、具体 species sprite 组件是模式无关的，两种模式共用。差异仅在容器层（embedded vs desktop window）和拖拽逻辑。

### 8.2 PetSprite.vue（精灵图分发器）

```vue
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { Pet } from '@/types/pet'

const props = defineProps<{
  pet: Pet
  isPetted: boolean
  scale?: number
}>()

const frame = ref(0)
let rafId: number | null = null
let lastFrameAt = 0
const FRAME_INTERVAL = 500 // 每帧 500ms

function tick(t: number) {
  if (t - lastFrameAt >= FRAME_INTERVAL) {
    frame.value = (frame.value + 1) % 3
    lastFrameAt = t
  }
  rafId = requestAnimationFrame(tick)
}

onMounted(() => { rafId = requestAnimationFrame(tick) })
onUnmounted(() => { if (rafId) cancelAnimationFrame(rafId) })

const spriteComponent = computed(() => {
  if (props.pet.visual.type === 'builtin-svg') {
    return SPRITE_MAP[props.pet.visual.species]
  }
  return null
})
</script>

<template>
  <div class="pet-sprite" :style="{ transform: `scale(${scale ?? 1})` }">
    <component
      v-if="pet.visual.type === 'builtin-svg'"
      :is="spriteComponent"
      :palette="pet.palette!"
      :frame="frame"
      :is-petted="isPetted"
    />
    <PetImageSprite
      v-else
      :src="resolveAssetPath(pet.visual.path)"
      :frame-count="pet.visual.frameCount ?? 1"
      :frame="frame"
      :is-petted="isPetted"
    />
  </div>
</template>
```

### 8.3 Species Sprite 组件约定

所有 18 个 species sprite 组件（如 `DuckSprite.vue`、`CatSprite.vue` 等）遵循统一约定：

- **viewBox**：统一 `0 0 100 60`，默认 width 80 height 48
- **props**：统一 `{ palette: PetPalette; frame: 0 | 1 | 2; isPetted: boolean }`
- **3 帧动画**：静止 / 眨眼 / 跳跃（撸时使用）
- **撸时显示爱心**：统一位置 `x=60, y=10`，颜色 `#FF6B9D`
- **调色板**：从 `pet.palette` 读取，不硬编码颜色

```vue
<!-- DuckSprite.vue 示例 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

const PATHS = [
  'M 30 10 Q 50 5 70 10 L 75 35 Q 50 40 25 35 Z',
  'M 30 10 Q 50 5 70 10 L 75 35 Q 50 40 25 35 Z',
  'M 30 5 Q 50 0 70 5 L 75 30 Q 50 35 25 30 Z'
]

const currentPath = computed(() => props.isPetted ? PATHS[2] : PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
    <ellipse cx="50" cy="20" rx="8" ry="4" :fill="palette.accent"/>
    <circle cx="42" cy="18" r="2" :fill="palette.accent" :opacity="eyeOpacity"/>
    <circle cx="58" cy="18" r="2" :fill="palette.accent" :opacity="eyeOpacity"/>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
```

### 8.4 PetReactionBubble.vue（反应气泡）

```vue
<template>
  <Transition name="bubble">
    <div v-if="visible" class="pet-bubble" @click="emit('dismiss')">
      <span class="bubble-text">{{ text }}</span>
      <div class="bubble-tail" />
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.pet-bubble {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  padding: 6px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-md);
  max-width: 200px;
  cursor: pointer;
  white-space: nowrap;
}
.bubble-text {
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.4;
}
.bubble-tail {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid var(--glass-border);
}
.bubble-enter-active, .bubble-leave-active {
  transition: all 0.3s var(--transition-spring);
}
.bubble-enter-from, .bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
```

### 8.5 PetEmbeddedWidget.vue（应用内嵌入容器）

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { usePetStore } from '@/stores/pet'
import { usePetDrag } from '@/composables/usePetDrag'
import { usePetReaction } from '@/composables/usePetReaction'
import { useI18n } from 'vue-i18n'

const petStore = usePetStore()
const { locale } = useI18n()
const reaction = usePetReaction()

const position = computed(() => petStore.config?.embeddedPosition ?? { x: 0.85, y: 0.78 })

const { isDragging, onPointerDown } = usePetDrag({
  mode: 'embedded',
  onDragEnd: (pos) => petStore.updatePosition(pos)
})

function onSpriteClick() {
  reaction.onUserPetted()
  petStore.triggerPetted()
}
</script>

<template>
  <div
    v-if="petStore.activePet"
    class="pet-embedded-widget"
    :style="{
      left: `${position.x * 100}%`,
      top: `${position.y * 100}%`,
      transform: 'translate(-50%, -50%)'
    }"
  >
    <PetReactionBubble
      :text="petStore.runtimeState.currentReaction"
      :locale="locale"
      @dismiss="petStore.clearReaction()"
    />
    <div
      class="pet-sprite-wrapper"
      :class="{ dragging: isDragging }"
      @pointerdown="onPointerDown"
      @click="onSpriteClick"
    >
      <PetSprite
        :pet="petStore.activePet"
        :is-petted="petStore.runtimeState.isPetted"
        :scale="petStore.config?.settings.scale ?? 1"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.pet-embedded-widget {
  position: fixed;
  z-index: 999;
  pointer-events: auto;
  user-select: none;
}
.pet-sprite-wrapper {
  cursor: grab;
  &.dragging { cursor: grabbing; }
  &:hover { filter: brightness(1.05); }
}
</style>
```

### 8.6 PetWindowApp.vue（独立窗口根组件）

```vue
<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { initPetWindowI18n } from './i18n'
import PetSprite from '@/components/pets/PetSprite.vue'
import PetReactionBubble from '@/components/pets/PetReactionBubble.vue'
import { usePetDrag } from '@/composables/usePetDrag'

const state = reactive<{
  pet: Pet | null
  reaction: string | null
  isPetted: boolean
  scale: number
  locale: 'zh-CN' | 'en-US'
}>({
  pet: null, reaction: null, isPetted: false, scale: 1, locale: 'zh-CN'
})

const { isDragging, onPointerDown } = usePetDrag({
  mode: 'desktop',
  onDragEnd: () => {}
})

onMounted(async () => {
  state.locale = await window.petWindowAPI.getLocale()
  await initPetWindowI18n(state.locale)

  const initial = await window.petWindowAPI.getInitialState()
  Object.assign(state, initial)

  window.petWindowAPI.onStateUpdate((payload) => {
    state.pet = payload.pet
    state.reaction = payload.runtimeState.currentReaction
    state.isPetted = payload.runtimeState.isPetted
    state.scale = payload.settings.scale
    state.locale = payload.locale
  })
})

function onSpriteClick() {
  window.petWindowAPI.emitWindowEvent({ type: 'click' })
}
</script>

<template>
  <div class="pet-window-root" @pointerdown="onPointerDown">
    <PetReactionBubble v-if="state.pet" :text="state.reaction" :locale="state.locale" />
    <PetSprite
      v-if="state.pet"
      :pet="state.pet"
      :is-petted="state.isPetted"
      :scale="state.scale"
    />
  </div>
</template>

<style>
html, body, #pet-window-root {
  margin: 0; padding: 0;
  background: transparent;
  overflow: hidden;
  user-select: none;
}
</style>
```

### 8.7 拖拽逻辑（usePetDrag）

```ts
export function usePetDrag(options: {
  mode: 'embedded' | 'desktop'
  onDragEnd: (pos: { x: number; y: number }) => void
}) {
  const isDragging = ref(false)
  let startX = 0, startY = 0
  let originX = 0, originY = 0

  function onPointerDown(e: PointerEvent) {
    isDragging.value = true
    startX = e.screenX
    startY = e.screenY

    if (options.mode === 'embedded') {
      const el = e.currentTarget as HTMLElement
      const rect = el.getBoundingClientRect()
      originX = rect.left
      originY = rect.top
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging.value) return
    const dx = e.screenX - startX
    const dy = e.screenY - startY

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement
      el.style.left = `${originX + dx}px`
      el.style.top = `${originY + dy}px`
    } else {
      window.petWindowAPI.emitWindowEvent({
        type: 'drag',
        deltaX: dx, deltaY: dy
      })
    }
  }

  function onPointerUp() {
    isDragging.value = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement
      const rect = el.getBoundingClientRect()
      options.onDragEnd({
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight
      })
    } else {
      window.petWindowAPI.emitWindowEvent({ type: 'drag-end' })
    }
  }

  return { isDragging, onPointerDown }
}
```

### 8.8 desktop 模式拖拽主进程处理

```ts
// electron/petWindowManager.ts
ipcMain.on('petWindow:event', (_e, event: PetWindowEvent) => {
  if (event.type === 'drag') {
    const [x, y] = petWindow.getPosition()
    petWindow.setPosition(x + event.deltaX, y + event.deltaY)
  } else if (event.type === 'drag-end') {
    const [x, y] = petWindow.getPosition()
    config.desktopWindow.x = x
    config.desktopWindow.y = y
    petFileService.write(config)
  } else if (event.type === 'click') {
    mainWindow?.webContents.send('pet:windowEvent', { type: 'click' })
  }
})
```

### 8.9 动画与性能

- **精灵图帧切换**：500ms 间隔，用 `requestAnimationFrame` 节流
- **气泡过渡**：CSS transition + vue Transition，0.3s spring
- **拖拽性能**：embedded 模式直接操作 DOM style；desktop 模式通过 IPC 批量移动窗口
- **独立窗口 CPU 占用**：预期 < 1% CPU

## 9. 设置页面与宠物创作

### 9.1 设置面板接入

在 `src/components/settings/SettingsPanel.vue` 的 `personalMenuItems`（个性化组）中新增 "宠物" tab：

```ts
const personalMenuItems = [
  { key: 'appearance', label: t('settings.appearance'), ... },
  { key: 'shortcuts', label: t('settings.shortcuts'), ... },
  { key: 'hooks', label: t('settings.hooks'), ... },
  { key: 'tokenUsage', label: t('settings.tokenUsage'), ... },
  { key: 'pet', label: t('petSettings.title'), icon: '🐾', component: 'PetSettings' },
  { key: 'about', label: t('settings.about'), ... },
]
```

### 9.2 PetSettings.vue（容器）

```vue
<template>
  <div class="pet-settings">
    <PetPreviewHeader :pet="activePet" :mode="mode" @toggle-mode="toggleMode" />

    <div class="pet-tabs">
      <button :class="{ active: tab === 'gallery' }" @click="tab = 'gallery'">
        {{ t('petSettings.gallery') }}
      </button>
      <button :class="{ active: tab === 'creator' }" @click="tab = 'creator'">
        {{ t('petSettings.creator') }}
      </button>
      <button :class="{ active: tab === 'behavior' }" @click="tab = 'behavior'">
        {{ t('petSettings.behavior') }}
      </button>
    </div>

    <KeepAlive>
      <PetGallery v-if="tab === 'gallery'" @select="onSelectPet" />
      <PetCreator v-else-if="tab === 'creator'" @created="onPetCreated" />
      <PetBehaviorConfig v-else />
    </KeepAlive>
  </div>
</template>
```

### 9.3 PetPreviewHeader.vue（顶部预览）

显示当前激活宠物的大尺寸预览 + 名称 + 性格 + 模式切换按钮。

### 9.4 PetGallery.vue（宠物浏览）

```vue
<template>
  <div class="pet-gallery">
    <section class="gallery-section">
      <h3>{{ t('petSettings.builtinPets') }}</h3>
      <div class="pet-grid">
        <PetCard
          v-for="pet in BUILTIN_PETS"
          :key="pet.id"
          :pet="pet"
          :active="pet.id === petStore.config?.activePetId"
          @click="selectPet(pet.id)"
        />
      </div>
    </section>

    <section class="gallery-section">
      <h3>
        {{ t('petSettings.customPets') }}
        <button class="create-btn" @click="$emit('create')">{{ t('petSettings.create') }}</button>
      </h3>
      <div v-if="customPets.length" class="pet-grid">
        <PetCard
          v-for="pet in customPets"
          :key="pet.id"
          :pet="pet"
          :active="pet.id === petStore.config?.activePetId"
          @delete="onDeleteCustom(pet.id)"
          @click="selectPet(pet.id)"
        />
      </div>
      <div v-else class="empty-state">
        {{ t('petSettings.noCustomPets') }}
      </div>
    </section>
  </div>
</template>
```

### 9.5 PetCreator.vue（自定义宠物创作）

左侧表单 + 右侧实时预览布局：

**表单字段**：
- `name`：1-20 字符
- `personality`：1-200 字符（textarea）
- `assetFile`：文件上传，PNG/JPG/GIF/SVG，≤ 2MB
- 实时校验 + 错误提示

**实时预览**：右侧显示 `<PetSprite :scale="2">`，随表单输入即时更新名称和性格描述。

**提交流程**：
1. 前端校验通过
2. 调用 `petStore.addCustomPet(pet, assetSrcPath)`
3. store 内部调用 `pet.saveAsset` 上传图片
4. 写入配置 + 切换到新创建的宠物 + toast 提示

### 9.6 PetBehaviorConfig.vue（行为配置）

配置项：
- **反应模式**：preset / ai 单选
- **AI 模型选择**（仅 AI 模式）：下拉选择 gpt-4o-mini / gpt-4o / claude-3-5-haiku
- **反应间隔**：range slider，30-300s，步长 10
- **缩放**：range slider，0.5-2.0x，步长 0.1
- **静音**：checkbox
- **桌面模式专属**（仅 desktop 模式显示）：
  - 始终置顶：checkbox
  - 点击穿透：checkbox

### 9.7 文件组织

```
src/components/settings/pet/
├─ PetSettings.vue
├─ PetPreviewHeader.vue
├─ PetGallery.vue
├─ PetCard.vue
├─ PetCreator.vue
└─ PetBehaviorConfig.vue
```

## 10. AI 反应流程

### 10.1 完整流程

```
[触发事件]
    │
    ↓
[usePetReaction.generateReaction(trigger)]
    │
    ├─ 检查 muted → 返回 null
    ├─ 检查速率限制（除 petted 外） → 返回 null
    │
    ├─ reactionMode === 'preset'?
    │   └─ 是：从 activePet.presetReactions[trigger] 随机选 1 条
    │
    └─ reactionMode === 'ai'?
        ├─ 构造 PetReactionRequest
        │   ├─ petName, personality
        │   ├─ recentMessages: 从 chatSession store 取最近 6 条
        │   └─ trigger
        │
        ├─ 调用 window.electronAPI.pet.generateReaction(req)
        │   └─ 主进程 petLLMProxy.generateReaction(req)
        │       ├─ 读取 LLM 配置（从 ~/.claude/gui-settings.json）
        │       ├─ 构造 system prompt
        │       ├─ 调用 LLM API
        │       └─ 返回 reaction 文本（截断 100 字符）
        │
        ├─ petStore.triggerReaction(text)
        │   ├─ 设置 runtimeState.currentReaction
        │   ├─ 设置 runtimeState.reactionAt
        │   └─ 10s 后自动清除（setTimeout）
        │
        └─ syncToDesktopWindow()（如果 desktop 模式）
```

### 10.2 LLM System Prompt

```ts
function buildSystemPrompt(req: PetReactionRequest): string {
  return `你是 ${req.petName}，一只陪伴程序员写代码的桌面宠物。

你的人设：${req.personality}

请用一句话（不超过 30 字）回应当前的编程场景。要求：
- 符合你的人设和性格
- 简短、自然、有趣
- 不要解释你在做什么，直接说话
- 可以用 emoji，但不要过度

当前场景触发：${TRIGGER_DESCRIPTION[req.trigger]}

最近对话上下文：
${req.recentMessages.map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n')}

请直接输出 ${req.petName} 会说的一句话，不要加引号、不要加角色名前缀。`
}

const TRIGGER_DESCRIPTION: Record<PetReactionTrigger, string> = {
  idle: '用户有一会儿没操作了',
  typing: '用户正在输入代码',
  error: '刚刚发生了错误（工具调用失败或编译错误）',
  success: '刚刚完成了一个任务',
  petted: '用户点击了你（撸宠物）'
}
```

### 10.3 速率限制与去重

```ts
const recentReactions: string[] = []  // 最近 8 条
const MAX_RECENT = 8

async function generateReaction(req: PetReactionRequest): Promise<string | null> {
  const reaction = await callLLM(systemPrompt)

  // 去重：如果与最近 8 条相似度过高，重试一次
  if (recentReactions.some(r => isSimilar(r, reaction, 0.7))) {
    const retry = await callLLM(systemPrompt + '\n\n（请与之前不同）')
    if (retry) return truncate(retry, 100)
  }

  recentReactions.push(reaction)
  if (recentReactions.length > MAX_RECENT) recentReactions.shift()

  return truncate(reaction, 100)
}

function isSimilar(a: string, b: string, threshold: number): boolean {
  // Jaccard 相似度 on bigrams
  const bigramsA = new Set(getBigrams(a))
  const bigramsB = new Set(getBigrams(b))
  const intersection = [...bigramsA].filter(x => bigramsB.has(x)).length
  const union = new Set([...bigramsA, ...bigramsB]).size
  return intersection / union >= threshold
}
```

### 10.4 主进程 LLM 配置读取

`petLLMProxy.ts` 从 `~/.claude/gui-settings.json` 读取 API 配置：

```ts
async function loadLLMConfig(): Promise<LLMConfig> {
  const settings = await readGuiSettings()
  return {
    baseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.petAiModel ?? 'gpt-4o-mini',
  }
}
```

### 10.5 错误处理

- **LLM 调用失败**：静默失败（`return null`），不显示气泡，不影响用户体验
- **配置文件损坏**：`petFileService.read()` 失败时返回 null，petStore 初始化为默认状态
- **资源文件丢失**：`PetSprite` 检测图片加载失败时显示占位符（灰色方块 + "图片丢失" 文字）
- **独立窗口创建失败**：回退到 embedded 模式 + toast 提示

## 11. i18n 国际化

### 11.1 新增翻译键

在 `src/i18n/locales/zh-CN.ts` 和 `en-US.ts` 中新增 `petSettings` 顶级键：

```ts
petSettings: {
  title: '桌面宠物',
  gallery: '宠物图鉴',
  creator: '创作宠物',
  behavior: '行为配置',

  switchToDesktop: '切换到桌面模式',
  switchToEmbedded: '切换到嵌入模式',
  builtin: '内置',
  custom: '自定义',

  builtinPets: '内置宠物',
  customPets: '自定义宠物',
  create: '创建新宠物',
  noCustomPets: '还没有自定义宠物，点击上方按钮创建一只吧~',
  active: '当前使用',

  name: '宠物名称',
  personality: '性格描述',
  uploadImage: '上传图片',
  imageHint: '支持 PNG/JPG/GIF/SVG，大小不超过 2MB',
  preview: '预览',
  untitled: '未命名',
  noPersonality: '暂无性格描述',
  nameLength: '名称长度需在 1-20 字符之间',
  personalityLength: '性格描述长度需在 1-200 字符之间',
  fileTooLarge: '文件大小不能超过 2MB',
  unsupportedFormat: '仅支持 PNG/JPG/GIF/SVG 格式',
  requireAsset: '请上传一张图片',

  reactionMode: '反应模式',
  presetMode: '预设语料',
  aiMode: 'AI 生成',
  aiModeHint: '使用 LLM 根据上下文生成动态反应，会消耗 token',
  aiModel: 'AI 模型',
  reactionInterval: '反应间隔',
  scale: '缩放比例',
  muted: '静音（不显示反应）',
  alwaysOnTop: '桌面模式始终置顶',
  clickThrough: '点击穿透',

  rarity: {
    common: '普通',
    rare: '稀有',
    epic: '史诗',
    legendary: '传说'
  },

  petCreated: '宠物创建成功',
  petDeleted: '宠物已删除',
  petSwitched: '已切换到 {name}',
  modeSwitched: '已切换到{mode}模式',
  modeDesktop: '桌面',
  modeEmbedded: '嵌入'
}
```

### 11.2 独立窗口 i18n

独立窗口是独立渲染进程，无法共享主应用的 vue-i18n 实例。新增 `src/pet-window/i18n.ts`：

```ts
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

export function initPetWindowI18n(locale: 'zh-CN' | 'en-US') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: { 'zh-CN': zhCN, 'en-US': enUS },
  })
}
```

复用主应用的翻译文件。

## 12. 错误处理与边界情况

### 12.1 配置文件相关

| 场景 | 处理 |
|---|---|
| 配置文件不存在 | `petFileService.read()` 返回 null，petStore 使用默认配置（无激活宠物） |
| 配置文件 JSON 损坏 | 返回 null + 记录错误日志，petStore 使用默认配置 |
| activePetId 指向不存在的宠物 | `activePet` computed 返回 null，UI 提示选择宠物 |
| 自定义宠物资源文件丢失 | `PetSprite` 显示占位符（灰色方块 + "图片丢失"） |

### 12.2 独立窗口相关

| 场景 | 处理 |
|---|---|
| 窗口创建失败 | 回退到 embedded 模式 + toast 提示 |
| 窗口崩溃/意外关闭 | `petWindowManager` 监听 `closed` 事件，自动切换到 embedded 模式 |
| 主应用关闭时独立窗口未关闭 | `app.on('window-all-closed')` 中强制销毁 |

### 12.3 LLM 调用相关

| 场景 | 处理 |
|---|---|
| API key 未配置 | AI 模式自动回退到 preset 模式 + toast 提示 |
| 网络超时（10s） | 静默失败，不显示气泡 |
| 返回空内容 | 静默失败 |
| 返回内容过长 | 截断到 100 字符 |

## 13. 测试策略

### 13.1 单元测试（vitest）

| 模块 | 测试重点 |
|---|---|
| `src/lib/builtinPets.ts` | 18 种宠物数据完整性、id 唯一性 |
| `src/lib/defaultReactions.ts` | 默认语料非空 |
| `src/stores/pet.ts` | 窄写接口行为、状态派生、持久化调用 |
| `src/composables/usePetReaction.ts` | 速率限制、模式切换、preset 选取 |
| `src/composables/usePetDrag.ts` | 坐标计算、模式差异 |

### 13.2 Electron 主进程测试（node --test）

| 模块 | 测试重点 |
|---|---|
| `electron/petFileService.ts` | 读写、原子写入、资源保存/删除 |
| `electron/petLLMProxy.ts` | system prompt 构造、去重、截断 |
| `electron/petIpcHandlers.ts` | IPC handler 注册、参数透传 |

### 13.3 构建验证

- `npm run typecheck` 通过
- `npm run build` 通过
- `npm run electron:build` 产出包含 `pet-window.html` 和 `petPreload.js`

## 14. 实现优先级

建议分 4 个阶段实现（每个阶段独立可验证）：

1. **阶段 1（数据层 + 内置库）**：类型定义、`builtinPets.ts`、`defaultReactions.ts`、`petFileService.ts` + IPC
2. **阶段 2（应用内嵌入模式）**：`petStore`、`usePetReaction`、`PetSprite` + 18 个 species sprite、`PetEmbeddedWidget`、`PetReactionBubble`
3. **阶段 3（设置页面）**：`PetSettings` 容器、`PetGallery`、`PetCreator`、`PetBehaviorConfig`、i18n
4. **阶段 4（桌面独立窗口）**：`petWindowManager`、`petPreload`、`PetWindowApp`、`usePetDrag` desktop 模式、AI 反应代理

## 15. 不在本次设计范围内

- 后端 `/buddy` 系统的修改或扩展
- 宠物之间的互动（多宠物系统）
- 宠物成长/升级机制
- 宠物音效
- 移动端适配（桌面专属功能）
- Emoji 创作模式（类型预留但不实现）
