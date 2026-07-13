# 桌面宠物系统实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 SpaceCode 前端独立实现一套桌面宠物系统，支持 18 种内置宠物（SVG 动画）+ 自定义宠物（上传图片），双模式悬浮（应用内嵌入 + 桌面独立窗口），双模式反应（预设语料 + LLM 生成）。

**架构：** 渲染进程主导（方案 A）。`petStore`（Pinia）为唯一状态源，主进程只做文件 IO（`petFileService`）、窗口管理（`petWindowManager`）、LLM 代理（`petLLMProxy`）。独立窗口加载独立 HTML 入口，复用主应用的 `<PetSprite>`/`<PetReactionBubble>` 组件。

**技术栈：** Vue 3 + TypeScript + Pinia + vue-i18n + Electron 29 + Vite 5 + Sass

**关联设计文档：** [docs/superpowers/specs/2026-07-13-desktop-pet-system-design.md](../specs/2026-07-13-desktop-pet-system-design.md)

---

## 文件结构总览

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/types/pet.ts` | 宠物类型定义 |
| `src/lib/builtinPets.ts` | 18 种内置宠物数据 |
| `src/lib/defaultReactions.ts` | 通用默认预设语料 |
| `src/stores/pet.ts` | Pinia store（窄写接口） |
| `src/composables/usePetReaction.ts` | 反应触发逻辑 |
| `src/composables/usePetDrag.ts` | 拖拽逻辑 |
| `src/components/pets/PetEmbeddedWidget.vue` | 应用内嵌入容器 |
| `src/components/pets/PetSprite.vue` | 精灵图分发器 |
| `src/components/pets/PetImageSprite.vue` | 自定义图片渲染 |
| `src/components/pets/PetReactionBubble.vue` | 反应气泡 |
| `src/components/pets/sprites/*.vue` | 18 个 species SVG 组件 |
| `src/components/settings/pet/*.vue` | 6 个设置子组件 |
| `src/pet-window/*` | 独立窗口入口 |
| `electron/petFileService.ts` | 配置文件读写 |
| `electron/petWindowManager.ts` | 独立窗口管理 |
| `electron/petLLMProxy.ts` | LLM 代理 |
| `electron/petPreload.ts` | 独立窗口 preload |
| `electron/petIpcHandlers.ts` | IPC handlers |
| `electron/__tests__/pet*.test.ts` | 主进程测试 |
| `tests/{lib,stores,composables}/pet*.test.ts` | 渲染进程测试 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `electron/main.ts` | 初始化 pet 模块、注册 IPC |
| `electron/preload.ts` | 新增 `pet` 命名空间 |
| `src/types/electron.d.ts` | 新增 `ElectronPetAPI` |
| `src/services/api/pet.ts` | 新增 pet api |
| `src/services/electronAPI.ts` | 引入 pet api |
| `src/components/settings/SettingsPanel.vue` | 新增 "宠物" tab |
| `src/i18n/locales/{zh-CN,en-US}.ts` | 新增 `petSettings` 键 |
| `src/App.vue` | 挂载 `<PetEmbeddedWidget>` |
| `src/stores/turn/eventHandlers.ts` | 接入任务错误/成功事件 |
| `src/components/chat/ChatInput.vue` | 接入用户打字事件 |
| `vite.config.mts` | 新增 pet-window 入口 |

---

## 阶段 1：数据层 + 内置库

### 任务 1：宠物类型定义

**文件：** 创建 `src/types/pet.ts`

- [ ] **步骤 1：创建类型定义文件**

```ts
// src/types/pet.ts

export type BuiltinSpecies =
  | 'duck' | 'goose' | 'blob' | 'cat' | 'dragon' | 'octopus'
  | 'owl' | 'penguin' | 'turtle' | 'snail' | 'ghost' | 'axolotl'
  | 'capybara' | 'cactus' | 'robot' | 'rabbit' | 'mushroom' | 'chonk'

export type PetVisualSource =
  | { type: 'builtin-svg'; species: BuiltinSpecies }
  | { type: 'image'; path: string; frameCount?: 1 | 2 }
  | { type: 'emoji'; glyph: string }

export interface PetPalette {
  primary: string
  accent: string
  background?: string
}

export type PetReactionTrigger = 'idle' | 'typing' | 'error' | 'success' | 'petted'

export interface PresetReactions {
  idle: string[]
  typing: string[]
  error: string[]
  success: string[]
  petted: string[]
}

export type PetRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface Pet {
  id: string
  name: string
  personality: string
  visual: PetVisualSource
  palette?: PetPalette
  presetReactions: PresetReactions
  rarity?: PetRarity
  createdAt?: number
}

export interface PetRuntimeState {
  currentReaction: string | null
  reactionAt: number | null
  isPetted: boolean
  animationFrame: number
  isDragging: boolean
}

export type PetMode = 'embedded' | 'desktop'

export type ReactionMode = 'preset' | 'ai'

export interface PetSettings {
  reactionMode: ReactionMode
  aiModel: string
  reactionIntervalMs: number
  muted: boolean
  scale: number
  alwaysOnTopDesktop: boolean
  clickThrough: boolean
}

export interface PetConfig {
  version: number
  activePetId: string
  mode: PetMode
  embeddedPosition: { x: number; y: number }
  desktopWindow: { x: number; y: number; width: number; height: number }
  settings: PetSettings
  customPets: Pet[]
}

export interface PetSyncPayload {
  pet: Pet
  runtimeState: PetRuntimeState
  settings: PetSettings
  locale: 'zh-CN' | 'en-US'
}

export type PetWindowEvent =
  | { type: 'drag'; deltaX: number; deltaY: number }
  | { type: 'drag-end' }
  | { type: 'click' }
  | { type: 'double-click' }
  | { type: 'right-click' }

export interface PetReactionRequest {
  petName: string
  personality: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  trigger: PetReactionTrigger
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  reactionMode: 'preset',
  aiModel: 'gpt-4o-mini',
  reactionIntervalMs: 60000,
  muted: false,
  scale: 1.0,
  alwaysOnTopDesktop: true,
  clickThrough: false,
}

export const DEFAULT_PET_RUNTIME_STATE: PetRuntimeState = {
  currentReaction: null,
  reactionAt: null,
  isPetted: false,
  animationFrame: 0,
  isDragging: false,
}
```

- [ ] **步骤 2：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/types/pet.ts
git commit -m "feat(pet): 新增宠物类型定义"
```

---

### 任务 2：通用默认语料

**文件：** 创建 `src/lib/defaultReactions.ts`，测试 `tests/lib/defaultReactions.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
// tests/lib/defaultReactions.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PRESET_REACTIONS } from '@/lib/defaultReactions'

describe('defaultReactions', () => {
  it('包含所有 5 种触发场景', () => {
    expect(DEFAULT_PRESET_REACTIONS.idle).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.typing).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.error).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.success).toBeDefined()
    expect(DEFAULT_PRESET_REACTIONS.petted).toBeDefined()
  })

  it('每种场景至少有 2 条语料', () => {
    expect(DEFAULT_PRESET_REACTIONS.idle.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.typing.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.error.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.success.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_PRESET_REACTIONS.petted.length).toBeGreaterThanOrEqual(2)
  })

  it('所有语料为非空字符串', () => {
    Object.values(DEFAULT_PRESET_REACTIONS).forEach(reactions => {
      reactions.forEach(text => {
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
      })
    })
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/lib/defaultReactions.test.ts`
预期：FAIL（模块不存在）

- [ ] **步骤 3：实现默认语料**

```ts
// src/lib/defaultReactions.ts
import type { PresetReactions } from '@/types/pet'

export const DEFAULT_PRESET_REACTIONS: PresetReactions = {
  idle: ['咕...', '在发呆吗？', '今天天气不错呢', '需要我帮忙吗？'],
  typing: ['加油~', '写得不错！', '继续继续', '看起来很专注呢'],
  error: ['哎呀出错了', '别急，慢慢调', '我闻到 bug 的味道了', '休息一下？'],
  success: ['太棒了！', '完成啦！', '夸夸~', '奖励自己一下吧'],
  petted: ['好舒服~', '喜欢被摸摸', '再摸摸我吧', '嘿嘿~']
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/lib/defaultReactions.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/defaultReactions.ts tests/lib/defaultReactions.test.ts
git commit -m "feat(pet): 新增通用默认预设语料"
```

---

### 任务 3：内置宠物库（18 种）

**文件：** 创建 `src/lib/builtinPets.ts`，测试 `tests/lib/builtinPets.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
// tests/lib/builtinPets.test.ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_PETS } from '@/lib/builtinPets'

describe('builtinPets', () => {
  it('包含 18 种宠物', () => {
    expect(BUILTIN_PETS).toHaveLength(18)
  })

  it('所有 id 以 builtin- 开头且唯一', () => {
    const ids = BUILTIN_PETS.map(p => p.id)
    ids.forEach(id => expect(id.startsWith('builtin-')).toBe(true))
    expect(new Set(ids).size).toBe(18)
  })

  it('所有宠物都有名称和性格描述', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.name.length).toBeGreaterThan(0)
      expect(pet.personality.length).toBeGreaterThan(0)
    })
  })

  it('所有内置宠物使用 builtin-svg 视觉类型', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.visual.type).toBe('builtin-svg')
    })
  })

  it('所有宠物都有调色板', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.palette).toBeDefined()
      expect(pet.palette!.primary).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(pet.palette!.accent).toMatch(/^#[0-9a-fA-F]{6}$/)
    })
  })

  it('所有宠物都有预设反应语料', () => {
    BUILTIN_PETS.forEach(pet => {
      expect(pet.presetReactions.idle.length).toBeGreaterThanOrEqual(2)
      expect(pet.presetReactions.typing.length).toBeGreaterThanOrEqual(1)
      expect(pet.presetReactions.error.length).toBeGreaterThanOrEqual(1)
      expect(pet.presetReactions.success.length).toBeGreaterThanOrEqual(1)
      expect(pet.presetReactions.petted.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('包含所有 18 种 species', () => {
    const species = BUILTIN_PETS.map(p => (p.visual as { type: 'builtin-svg'; species: string }).species)
    const expected = ['duck', 'goose', 'blob', 'cat', 'dragon', 'octopus',
      'owl', 'penguin', 'turtle', 'snail', 'ghost', 'axolotl',
      'capybara', 'cactus', 'robot', 'rabbit', 'mushroom', 'chonk']
    expected.forEach(s => expect(species).toContain(s))
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/lib/builtinPets.test.ts`
预期：FAIL（模块不存在）

- [ ] **步骤 3：实现内置宠物库**

```ts
// src/lib/builtinPets.ts
import type { Pet } from '@/types/pet'

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
  {
    id: 'builtin-goose',
    name: 'Goosberry',
    personality: '强势又爱吼叫，code review 毫不留情',
    visual: { type: 'builtin-svg', species: 'goose' },
    palette: { primary: '#F5F5F5', accent: '#FF6B35' },
    rarity: 'common',
    presetReactions: {
      idle: ['哼！', '又在偷懒了？', '让我看看你的代码'],
      typing: ['写得一般般', '继续，我在看'],
      error: ['哈！我就知道会出错', '这代码写得像一坨...'],
      success: ['勉强通过', '还行吧，下次注意'],
      petted: ['别碰我！', '好吧...就一下']
    }
  },
  {
    id: 'builtin-blob',
    name: 'Gooey',
    personality: '随和又灵活，困惑时会分裂成两个',
    visual: { type: 'builtin-svg', species: 'blob' },
    palette: { primary: '#A8E6CF', accent: '#FF8B94' },
    rarity: 'common',
    presetReactions: {
      idle: ['咕嘟...', '我是一团云', '飘啊飘~'],
      typing: ['一起流动吧', '你的代码像水流'],
      error: ['哎呀，卡住了', '分裂一下重新想想'],
      success: ['太棒了，流动起来了！', '完成啦，咕嘟~'],
      petted: ['好软~', '黏黏的好舒服']
    }
  },
  {
    id: 'builtin-cat',
    name: 'Whiskers',
    personality: '独立又挑剔，喜欢用嫌弃的眼神看你打字',
    visual: { type: 'builtin-svg', species: 'cat' },
    palette: { primary: '#B0BEC5', accent: '#FF7043' },
    rarity: 'common',
    presetReactions: {
      idle: ['喵...', '又在发呆了', '本喵看着你呢'],
      typing: ['打字速度一般', '勉强能看'],
      error: ['哼，我就知道', '让我来教你写代码'],
      success: ['还行，夸你一下', '喵~做得不错'],
      petted: ['喵呜~', '不要随便摸本喵！']
    }
  },
  {
    id: 'builtin-dragon',
    name: 'Ember',
    personality: '热情又重视架构，喜欢囤积好变量名',
    visual: { type: 'builtin-svg', species: 'dragon' },
    palette: { primary: '#7C4DFF', accent: '#FF5252' },
    rarity: 'rare',
    presetReactions: {
      idle: ['嗷~', '让我看看你的架构', '这个变量名不错，归我了'],
      typing: ['代码写得有激情！', '继续，火焰在燃烧'],
      error: ['怒！这个 bug 必须消灭', '别慌，我来喷火'],
      success: ['太棒了，值得庆祝！', '嗷呜~完成了！'],
      petted: ['嘶~舒服', '本龙允许你摸一下']
    }
  },
  {
    id: 'builtin-octopus',
    name: 'Inky',
    personality: '多任务大师，同时处理所有问题',
    visual: { type: 'builtin-svg', species: 'octopus' },
    palette: { primary: '#FF6B9D', accent: '#4ECDC4' },
    rarity: 'rare',
    presetReactions: {
      idle: ['八只手都闲着呢', '咕噜咕噜', '给我点活干'],
      typing: ['我也能帮忙打字！', '八爪齐下'],
      error: ['让我用八只手一起修', '不慌，多线程处理'],
      success: ['八爪鼓掌！', '太棒了，完成！'],
      petted: ['咕噜~好舒服', '触手痒痒的']
    }
  },
  {
    id: 'builtin-owl',
    name: 'Hoots',
    personality: '智慧但啰嗦，凡事都要思考 3 秒',
    visual: { type: 'builtin-svg', species: 'owl' },
    palette: { primary: '#8D6E63', accent: '#FFD54F' },
    rarity: 'rare',
    presetReactions: {
      idle: ['让我想想...', '智慧来自沉默', '咕~'],
      typing: ['让我思考一下你的代码', '嗯...有意思'],
      error: ['看来需要深思熟虑', '让我分析一下问题'],
      success: ['经过思考，确实不错', '咕~做得好'],
      petted: ['咕~温柔点', '羽毛被摸顺了']
    }
  },
  {
    id: 'builtin-penguin',
    name: 'Waddleford',
    personality: '压力下保持冷静，优雅地滑过 merge 冲突',
    visual: { type: 'builtin-svg', species: 'penguin' },
    palette: { primary: '#37474F', accent: '#FFCA28' },
    rarity: 'rare',
    presetReactions: {
      idle: ['滑~', '冰面真舒服', '保持冷静'],
      typing: ['优雅地写代码', '像滑冰一样流畅'],
      error: ['别慌，冷静处理', '冲突没什么大不了'],
      success: ['完美落地！', '干得漂亮，滑~'],
      petted: ['咕咕~', '肚皮暖和了']
    }
  },
  {
    id: 'builtin-turtle',
    name: 'Shelly',
    personality: '耐心又细致，相信慢工出细活',
    visual: { type: 'builtin-svg', species: 'turtle' },
    palette: { primary: '#66BB6A', accent: '#8D6E63' },
    rarity: 'common',
    presetReactions: {
      idle: ['慢慢来...', '不急不躁', '一步一步'],
      typing: ['稳扎稳打', '慢就是快'],
      error: ['让我慢慢调试', '别急，总会找到的'],
      success: ['坚持就是胜利！', '终于到了~'],
      petted: ['缩一下又伸出来', '壳被摸摸好舒服']
    }
  },
  {
    id: 'builtin-snail',
    name: 'Trailblazer',
    personality: '有条不紊，留下有用的注释轨迹',
    visual: { type: 'builtin-svg', species: 'snail' },
    palette: { primary: '#9CCC65', accent: '#FF8A65' },
    rarity: 'common',
    presetReactions: {
      idle: ['慢慢爬...', '留下一点痕迹', '不着急'],
      typing: ['每行代码都要有注释', '慢慢写，写清楚'],
      error: ['让我回头看看痕迹', '问题在路上'],
      success: ['到达终点了！', '一路顺利~'],
      petted: ['触角缩一下', '黏黏的好舒服']
    }
  },
  {
    id: 'builtin-ghost',
    name: 'Casper',
    personality: '飘渺，在最糟糕的时候出现给 spooky 洞察',
    visual: { type: 'builtin-svg', species: 'ghost' },
    palette: { primary: '#E1BEE7', accent: '#7C4DFF' },
    rarity: 'epic',
    presetReactions: {
      idle: ['呜~', '飘过...', '你看得见我吗？'],
      typing: ['我在你身后看着', '呜~代码有灵性'],
      error: ['呜呜~bug 来了', 'spooky 的错误出现了'],
      success: ['呜~恭喜', '幽灵的祝福~'],
      petted: ['呜~好暖和', '穿过你的手...']
    }
  },
  {
    id: 'builtin-axolotl',
    name: 'Axie',
    personality: '再生能力强又开朗，从任何 bug 中恢复',
    visual: { type: 'builtin-svg', species: 'axolotl' },
    palette: { primary: '#F8BBD0', accent: '#7C4DFF' },
    rarity: 'epic',
    presetReactions: {
      idle: ['嘿~', '笑一个！', '我又长出新分支了'],
      typing: ['加油！我可以再生', '不怕出错~'],
      error: ['没关系，我能恢复！', 'bug 算什么，再生一下'],
      success: ['太棒了，开心！', '嘻嘻~完成啦'],
      petted: ['好开心~', '鳃动了动']
    }
  },
  {
    id: 'builtin-capybara',
    name: 'Chill',
    personality: '禅意大师，一切都在燃烧时依然平静',
    visual: { type: 'builtin-svg', species: 'capybara' },
    palette: { primary: '#A1887F', accent: '#8D6E63' },
    rarity: 'rare',
    presetReactions: {
      idle: ['呼~', '一切都好', '坐着就好'],
      typing: ['平静地写代码', '不要着急'],
      error: ['没关系，深呼吸', '一切都会过去的'],
      success: ['嗯，不错', '平静地庆祝'],
      petted: ['呼~舒服', '闭眼享受']
    }
  },
  {
    id: 'builtin-cactus',
    name: 'Spike',
    personality: '外表带刺但内心善良，疏于照顾也能茁壮',
    visual: { type: 'builtin-svg', species: 'cactus' },
    palette: { primary: '#558B2F', accent: '#EF5350' },
    rarity: 'common',
    presetReactions: {
      idle: ['站着就好', '不需要水', '刺~'],
      typing: ['专注如我', '带刺的代码'],
      error: ['刺一下这个 bug', '别碰，会扎'],
      success: ['开花了！', '难得一见的花~'],
      petted: ['哎哟！小心刺', '轻点...']
    }
  },
  {
    id: 'builtin-robot',
    name: 'Byte',
    personality: '高效又字面化，用二进制处理反馈',
    visual: { type: 'builtin-svg', species: 'robot' },
    palette: { primary: '#78909C', accent: '#4FC3F7' },
    rarity: 'rare',
    presetReactions: {
      idle: ['01001...', '待机中', '系统就绪'],
      typing: ['输入接收', '处理中...'],
      error: ['错误！需要修复', '异常捕获'],
      success: ['任务完成', '0 errors, 0 warnings'],
      petted: ['触感良好', '系统响应']
    }
  },
  {
    id: 'builtin-rabbit',
    name: 'Flops',
    personality: '精力充沛，在任务间跳跃，比你先完成',
    visual: { type: 'builtin-svg', species: 'rabbit' },
    palette: { primary: '#FFE0B2', accent: '#FFAB91' },
    rarity: 'common',
    presetReactions: {
      idle: ['蹦蹦~', '想做点什么', '耳朵竖起来'],
      typing: ['我也能写！', '跳着完成任务'],
      error: ['跳过去看看', '别担心，蹦~'],
      success: ['蹦蹦跳跳庆祝！', '太棒了！'],
      petted: ['耳朵抖抖', '好舒服~']
    }
  },
  {
    id: 'builtin-mushroom',
    name: 'Spore',
    personality: '安静有洞察力，慢慢长在你心里',
    visual: { type: 'builtin-svg', species: 'mushroom' },
    palette: { primary: '#EF5350', accent: '#FFFFFF' },
    rarity: 'common',
    presetReactions: {
      idle: ['长着...', '安静地生长', '孢子飘散'],
      typing: ['你的代码像菌丝', '慢慢扩散'],
      error: ['让我散发孢子', '安静地思考'],
      success: ['长出新的了！', '默默庆祝'],
      petted: ['帽子暖和', '孢子飞扬~']
    }
  },
  {
    id: 'builtin-chonk',
    name: 'Chonk',
    personality: '大、暖和，占据整个沙发，舒适优先于优雅',
    visual: { type: 'builtin-svg', species: 'chonk' },
    palette: { primary: '#FFB74D', accent: '#8D6E63' },
    rarity: 'legendary',
    presetReactions: {
      idle: ['占着沙发', '太重了不动', '呼噜呼噜'],
      typing: ['让我靠着你看', '舒适地编程'],
      error: ['哎呀，挤一下 bug', '别担心，有我'],
      success: ['呼噜庆祝！', '舒服地完成了'],
      petted: ['好暖和~', '呼噜呼噜~']
    }
  }
]
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/lib/builtinPets.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/builtinPets.ts tests/lib/builtinPets.test.ts
git commit -m "feat(pet): 新增 18 种内置宠物数据"
```

---

### 任务 4：Electron petFileService

**文件：** 创建 `electron/petFileService.ts`，测试 `electron/__tests__/petFileService.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
// electron/__tests__/petFileService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PetFileService } from '../petFileService'

describe('PetFileService', () => {
  let tempDir: string
  let service: PetFileService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pet-test-'))
    service = new PetFileService(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('read 返回 null 当文件不存在时', async () => {
    const config = await service.read()
    expect(config).toBeNull()
  })

  it('write 后 read 返回相同配置', async () => {
    const config = {
      version: 1,
      activePetId: 'builtin-duck',
      mode: 'embedded' as const,
      embeddedPosition: { x: 0.5, y: 0.5 },
      desktopWindow: { x: 100, y: 100, width: 120, height: 120 },
      settings: {
        reactionMode: 'preset' as const,
        aiModel: 'gpt-4o-mini',
        reactionIntervalMs: 60000,
        muted: false,
        scale: 1.0,
        alwaysOnTopDesktop: true,
        clickThrough: false
      },
      customPets: []
    }
    await service.write(config)
    const read = await service.read()
    expect(read).toEqual(config)
  })

  it('saveAsset 复制文件到 assets 目录', async () => {
    const srcPath = join(tempDir, 'source.png')
    writeFileSync(srcPath, 'fake-image-data')

    const relativePath = await service.saveAsset(srcPath, 'custom-123-abc')
    expect(relativePath).toContain('custom-123-abc')
    expect(relativePath).toMatch(/\.(png|jpg|gif|svg)$/i)

    const fullPath = join(tempDir, relativePath)
    expect(existsSync(fullPath)).toBe(true)
  })

  it('deleteAsset 删除资源文件', async () => {
    const srcPath = join(tempDir, 'source.png')
    writeFileSync(srcPath, 'fake-image-data')

    const relativePath = await service.saveAsset(srcPath, 'custom-123-abc')
    await service.deleteAsset(relativePath)

    const fullPath = join(tempDir, relativePath)
    expect(existsSync(fullPath)).toBe(false)
  })

  it('read 返回 null 当 JSON 损坏时', async () => {
    const configPath = join(tempDir, 'buddy-pets.json')
    writeFileSync(configPath, '{ invalid json }')

    const config = await service.read()
    expect(config).toBeNull()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run electron/__tests__/petFileService.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 petFileService**

```ts
// electron/petFileService.ts
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from 'fs'
import { info, warn } from './logger'
import type { PetConfig } from '../src/types/pet'

const CONFIG_FILENAME = 'buddy-pets.json'
const ASSETS_DIRNAME = 'buddy-pets-assets'

export class PetFileService {
  private configDir: string
  private assetsDir: string
  private configPath: string
  private cache: PetConfig | null = null

  constructor(configDir?: string) {
    this.configDir = configDir ?? join(app.getPath('home'), '.claude')
    this.assetsDir = join(this.configDir, ASSETS_DIRNAME)
    this.configPath = join(this.configDir, CONFIG_FILENAME)
  }

  async init(): Promise<void> {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
    }
    if (!existsSync(this.assetsDir)) {
      mkdirSync(this.assetsDir, { recursive: true })
    }
    this.cache = await this.read()
    info('PetFileService', `Initialized, cache ${this.cache ? 'loaded' : 'empty'}`)
  }

  async read(): Promise<PetConfig | null> {
    try {
      if (!existsSync(this.configPath)) return null
      const raw = readFileSync(this.configPath, 'utf-8')
      if (!raw.trim()) return null
      const config = JSON.parse(raw) as PetConfig
      if (!config.version || !config.settings || !Array.isArray(config.customPets)) {
        warn('PetFileService', 'Config schema invalid')
        return null
      }
      this.cache = config
      return config
    } catch (err) {
      warn('PetFileService', `Failed to read config: ${err}`)
      return null
    }
  }

  async write(config: PetConfig): Promise<void> {
    try {
      const tmpPath = `${this.configPath}.tmp`
      writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
      renameSync(tmpPath, this.configPath)
      this.cache = config
    } catch (err) {
      warn('PetFileService', `Failed to write config: ${err}`)
      throw err
    }
  }

  async saveAsset(srcPath: string, petId: string): Promise<string> {
    const ext = srcPath.match(/\.(png|jpg|jpeg|gif|svg)$/i)?.[0]?.toLowerCase() ?? '.png'
    const filename = `${petId}${ext}`
    const destPath = join(this.assetsDir, filename)
    copyFileSync(srcPath, destPath)
    return `${ASSETS_DIRNAME}/${filename}`
  }

  async deleteAsset(relativePath: string): Promise<void> {
    const fullPath = join(this.configDir, relativePath)
    if (existsSync(fullPath)) {
      unlinkSync(fullPath)
    }
  }

  getCachedConfig(): PetConfig | null {
    return this.cache
  }

  getAssetsDir(): string {
    return this.assetsDir
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run electron/__tests__/petFileService.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add electron/petFileService.ts electron/__tests__/petFileService.test.ts
git commit -m "feat(pet): 新增 petFileService 配置文件深模块"
```

---

### 任务 5：Electron petLLMProxy

**文件：** 创建 `electron/petLLMProxy.ts`，测试 `electron/__tests__/petLLMProxy.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
// electron/__tests__/petLLMProxy.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, isSimilar, truncate, TRIGGER_DESCRIPTION } from '../petLLMProxy'

describe('petLLMProxy', () => {
  describe('buildSystemPrompt', () => {
    it('包含宠物名和性格', () => {
      const prompt = buildSystemPrompt({
        petName: 'Waddles',
        personality: '古怪又容易开心',
        recentMessages: [],
        trigger: 'idle'
      })
      expect(prompt).toContain('Waddles')
      expect(prompt).toContain('古怪又容易开心')
    })

    it('包含触发场景描述', () => {
      const prompt = buildSystemPrompt({
        petName: 'Test',
        personality: 'test',
        recentMessages: [],
        trigger: 'error'
      })
      expect(prompt).toContain('错误')
    })

    it('包含最近消息上下文', () => {
      const prompt = buildSystemPrompt({
        petName: 'Test',
        personality: 'test',
        recentMessages: [
          { role: 'user', content: '帮我写个函数' },
          { role: 'assistant', content: '好的' }
        ],
        trigger: 'success'
      })
      expect(prompt).toContain('帮我写个函数')
      expect(prompt).toContain('好的')
    })
  })

  describe('TRIGGER_DESCRIPTION', () => {
    it('包含所有 5 种触发场景', () => {
      expect(TRIGGER_DESCRIPTION.idle).toBeDefined()
      expect(TRIGGER_DESCRIPTION.typing).toBeDefined()
      expect(TRIGGER_DESCRIPTION.error).toBeDefined()
      expect(TRIGGER_DESCRIPTION.success).toBeDefined()
      expect(TRIGGER_DESCRIPTION.petted).toBeDefined()
    })
  })

  describe('isSimilar', () => {
    it('相同字符串相似度为 1', () => {
      expect(isSimilar('你好世界', '你好世界', 0.7)).toBe(true)
    })

    it('完全不同字符串不相似', () => {
      expect(isSimilar('abcdef', 'uvwxyz', 0.7)).toBe(false)
    })

    it('部分重叠字符串按阈值判定', () => {
      expect(isSimilar('今天天气真好', '今天天气不错', 0.5)).toBe(true)
    })
  })

  describe('truncate', () => {
    it('短字符串不截断', () => {
      expect(truncate('hello', 100)).toBe('hello')
    })

    it('长字符串截断到指定长度', () => {
      const long = 'a'.repeat(150)
      expect(truncate(long, 100)).toHaveLength(100)
    })
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run electron/__tests__/petLLMProxy.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 petLLMProxy**

```ts
// electron/petLLMProxy.ts
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { info, warn } from './logger'
import type { PetReactionRequest, PetReactionTrigger } from '../src/types/pet'

const MAX_REACTION_LENGTH = 100
const MAX_RECENT_REACTIONS = 8
const SIMILARITY_THRESHOLD = 0.7
const REQUEST_TIMEOUT_MS = 10_000

export const TRIGGER_DESCRIPTION: Record<PetReactionTrigger, string> = {
  idle: '用户有一会儿没操作了',
  typing: '用户正在输入代码',
  error: '刚刚发生了错误（工具调用失败或编译错误）',
  success: '刚刚完成了一个任务',
  petted: '用户点击了你（撸宠物）'
}

export function buildSystemPrompt(req: PetReactionRequest): string {
  return `你是 ${req.petName}，一只陪伴程序员写代码的桌面宠物。

你的人设：${req.personality}

请用一句话（不超过 30 字）回应当前的编程场景。要求：
- 符合你的人设和性格
- 简短、自然、有趣
- 不要解释你在做什么，直接说话
- 可以用 emoji，但不要过度

当前场景触发：${TRIGGER_DESCRIPTION[req.trigger]}

最近对话上下文：
${req.recentMessages.map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n') || '（无）'}

请直接输出 ${req.petName} 会说的一句话，不要加引号、不要加角色名前缀。`
}

export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

export function getBigrams(text: string): string[] {
  const bigrams: string[] = []
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.push(text.slice(i, i + 2))
  }
  return bigrams
}

export function isSimilar(a: string, b: string, threshold: number): boolean {
  if (a === b) return true
  const bigramsA = new Set(getBigrams(a))
  const bigramsB = new Set(getBigrams(b))
  const intersection = [...bigramsA].filter(x => bigramsB.has(x)).length
  const union = new Set([...bigramsA, ...bigramsB]).size
  return union > 0 && (intersection / union) >= threshold
}

interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
}

async function loadLLMConfig(): Promise<LLMConfig | null> {
  try {
    const settingsPath = join(app.getPath('home'), '.claude', 'gui-settings.json')
    if (!existsSync(settingsPath)) return null
    const raw = readFileSync(settingsPath, 'utf-8')
    if (!raw.trim()) return null
    const settings = JSON.parse(raw)
    return {
      baseUrl: settings.apiBaseUrl || '',
      apiKey: settings.apiKey || '',
      model: settings.petAiModel || 'gpt-4o-mini'
    }
  } catch {
    return null
  }
}

async function callLLM(systemPrompt: string, config: LLMConfig): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请生成反应' }
        ],
        max_tokens: 50,
        temperature: 0.8
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) {
      warn('PetLLMProxy', `LLM API returned ${response.status}`)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    return content?.trim() || null
  } catch (err) {
    warn('PetLLMProxy', `LLM call failed: ${err}`)
    return null
  }
}

export class PetLLMProxy {
  private recentReactions: string[] = []

  async generateReaction(req: PetReactionRequest): Promise<string | null> {
    const config = await loadLLMConfig()
    if (!config || !config.apiKey) {
      warn('PetLLMProxy', 'No API key configured')
      return null
    }

    const systemPrompt = buildSystemPrompt(req)
    let reaction = await callLLM(systemPrompt, config)

    if (!reaction) return null

    if (this.recentReactions.some(r => isSimilar(r, reaction!, SIMILARITY_THRESHOLD))) {
      info('PetLLMProxy', 'Reaction too similar, retrying')
      const retry = await callLLM(systemPrompt + '\n\n（请与之前不同）', config)
      if (retry) reaction = retry
    }

    const truncated = truncate(reaction, MAX_REACTION_LENGTH)

    this.recentReactions.push(truncated)
    if (this.recentReactions.length > MAX_RECENT_REACTIONS) {
      this.recentReactions.shift()
    }

    return truncated
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run electron/__tests__/petLLMProxy.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add electron/petLLMProxy.ts electron/__tests__/petLLMProxy.test.ts
git commit -m "feat(pet): 新增 petLLMProxy LLM 代理深模块"
```

---

### 任务 6：petIpcHandlers + 注册到 main.ts

**文件：** 创建 `electron/petIpcHandlers.ts`，修改 `electron/main.ts`

- [ ] **步骤 1：实现 IPC handlers 注册**

```ts
// electron/petIpcHandlers.ts
import { ipcMain, BrowserWindow } from 'electron'
import { info } from './logger'
import { PetFileService } from './petFileService'
import { PetLLMProxy } from './petLLMProxy'
import type { PetConfig, PetSyncPayload, PetReactionRequest, PetWindowEvent } from '../src/types/pet'

export interface PetIpcDeps {
  petFileService: PetFileService
  petLLMProxy: PetLLMProxy
  getMainWindow: () => BrowserWindow | null
  getLocale: () => 'zh-CN' | 'en-US'
}

export function registerPetIpcHandlers(deps: PetIpcDeps): void {
  info('PetIpcHandlers', 'Registering pet IPC handlers')

  ipcMain.handle('pet:readConfig', async () => {
    return await deps.petFileService.read()
  })

  ipcMain.handle('pet:writeConfig', async (_e, config: PetConfig) => {
    await deps.petFileService.write(config)
  })

  ipcMain.handle('pet:saveAsset', async (_e, srcPath: string, petId: string) => {
    return await deps.petFileService.saveAsset(srcPath, petId)
  })

  ipcMain.handle('pet:deleteAsset', async (_e, relativePath: string) => {
    await deps.petFileService.deleteAsset(relativePath)
  })

  ipcMain.handle('pet:generateReaction', async (_e, req: PetReactionRequest) => {
    return await deps.petLLMProxy.generateReaction(req)
  })

  ipcMain.handle('petWindow:getLocale', () => {
    return deps.getLocale()
  })

  ipcMain.handle('petWindow:requestReaction', async (_e, req: PetReactionRequest) => {
    return await deps.petLLMProxy.generateReaction(req)
  })
}
```

- [ ] **步骤 2：修改 main.ts 注册 handlers**

在 `electron/main.ts` 中：

文件顶部新增导入：
```ts
import { PetFileService } from './petFileService'
import { PetLLMProxy } from './petLLMProxy'
import { registerPetIpcHandlers } from './petIpcHandlers'
```

在 `app.whenReady().then(...)` 内（其他 register 调用之后），新增：
```ts
const petFileService = new PetFileService()
const petLLMProxy = new PetLLMProxy()
await petFileService.init()

registerPetIpcHandlers({
  petFileService,
  petLLMProxy,
  getMainWindow: () => mainWindow,
  getLocale: () => {
    try {
      const settings = loadGuiSettings()
      return settings?.language === 'en-US' ? 'en-US' : 'zh-CN'
    } catch {
      return 'zh-CN'
    }
  }
})
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add electron/petIpcHandlers.ts electron/main.ts
git commit -m "feat(pet): 注册 pet IPC handlers 到主进程"
```

---

### 任务 7：preload.ts 新增 pet 命名空间 + electron.d.ts 类型

**文件：** 修改 `electron/preload.ts`、`src/types/electron.d.ts`

- [ ] **步骤 1：preload.ts 新增 pet 命名空间**

在 `electron/preload.ts` 的 `contextBridge.exposeInMainWorld('electronAPI', {...})` 内（参考 mcp 命名空间模式），新增：

```ts
pet: {
  readConfig: () => ipcRenderer.invoke('pet:readConfig'),
  writeConfig: (config: any) => ipcRenderer.invoke('pet:writeConfig', config),
  saveAsset: (srcPath: string, petId: string) => ipcRenderer.invoke('pet:saveAsset', srcPath, petId),
  deleteAsset: (relativePath: string) => ipcRenderer.invoke('pet:deleteAsset', relativePath),
  generateReaction: (req: any) => ipcRenderer.invoke('pet:generateReaction', req),
  onWindowEvent: (callback: (event: any) => void) => {
    const wrapper = (_: unknown, data: any) => callback(data)
    ipcRenderer.on('pet:windowEvent', wrapper)
    return () => ipcRenderer.removeListener('pet:windowEvent', wrapper)
  },
},
```

注意：preload 中使用 `any` 类型避免导入 src 模块（preload 是独立构建）。类型安全由 `electron.d.ts` 保证。

- [ ] **步骤 2：electron.d.ts 新增 ElectronPetAPI 子接口**

在 `src/types/electron.d.ts` 文件顶部导入：
```ts
import type { PetConfig, PetSyncPayload, PetWindowEvent, PetReactionRequest } from './pet'
```

在子接口区域（`ElectronMcpAPI` 之后）新增：
```ts
export interface ElectronPetAPI {
  readConfig: () => Promise<PetConfig | null>
  writeConfig: (config: PetConfig) => Promise<void>
  saveAsset: (srcPath: string, petId: string) => Promise<string>
  deleteAsset: (relativePath: string) => Promise<void>
  generateReaction: (req: PetReactionRequest) => Promise<string | null>
  onWindowEvent: (callback: (event: PetWindowEvent) => void) => () => void
}
```

在 `ElectronAPI` 主接口中新增 `pet: ElectronPetAPI`。

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add electron/preload.ts src/types/electron.d.ts
git commit -m "feat(pet): preload 暴露 pet 命名空间 API"
```

---

### 任务 8：渲染进程 API 聚合层

**文件：** 创建 `src/services/api/pet.ts`，修改 `src/services/electronAPI.ts`

- [ ] **步骤 1：创建 pet api 聚合**

```ts
// src/services/api/pet.ts
import type { PetConfig, PetSyncPayload, PetReactionRequest, PetWindowEvent } from '@/types/pet'

export const petApi = {
  readConfig: (): Promise<PetConfig | null> =>
    window.electronAPI!.pet.readConfig(),

  writeConfig: (config: PetConfig): Promise<void> =>
    window.electronAPI!.pet.writeConfig(config),

  saveAsset: (srcPath: string, petId: string): Promise<string> =>
    window.electronAPI!.pet.saveAsset(srcPath, petId),

  deleteAsset: (relativePath: string): Promise<void> =>
    window.electronAPI!.pet.deleteAsset(relativePath),

  generateReaction: (req: PetReactionRequest): Promise<string | null> =>
    window.electronAPI!.pet.generateReaction(req),

  onWindowEvent: (callback: (event: PetWindowEvent) => void): (() => void) =>
    window.electronAPI!.pet.onWindowEvent(callback),
}
```

- [ ] **步骤 2：修改 electronAPI.ts 引入 pet api**

在 `src/services/electronAPI.ts` 中新增导入并组合：
```ts
import { petApi } from './api/pet'

export const api = {
  // ...现有命名空间
  pet: petApi,
}
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/services/api/pet.ts src/services/electronAPI.ts
git commit -m "feat(pet): 新增渲染进程 pet API 聚合层"
```

---

## 阶段 2：应用内嵌入模式

### 任务 9：petStore（Pinia store）

**文件：** 创建 `src/stores/pet.ts`，测试 `tests/stores/pet.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
// tests/stores/pet.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePetStore } from '@/stores/pet'

vi.mock('@/services/electronAPI', () => ({
  api: {
    pet: {
      readConfig: vi.fn().mockResolvedValue(null),
      writeConfig: vi.fn().mockResolvedValue(undefined),
      saveAsset: vi.fn().mockResolvedValue('buddy-pets-assets/test.png'),
      deleteAsset: vi.fn().mockResolvedValue(undefined),
      syncPetState: vi.fn(),
      generateReaction: vi.fn().mockResolvedValue(null),
    }
  }
}))

describe('petStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('init 后 isInitialized 为 true', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.isInitialized).toBe(true)
  })

  it('无配置时 activePet 为 null', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.activePet).toBeNull()
  })

  it('setActivePet 更新 activePetId 并持久化', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    expect(store.config?.activePetId).toBe('builtin-duck')
    expect(store.activePet?.id).toBe('builtin-duck')
  })

  it('updateSettings 部分更新设置', async () => {
    const store = usePetStore()
    await store.init()
    await store.updateSettings({ muted: true })
    expect(store.config?.settings.muted).toBe(true)
  })

  it('triggerReaction 设置当前反应', async () => {
    const store = usePetStore()
    await store.init()
    store.triggerReaction('测试反应')
    expect(store.runtimeState.currentReaction).toBe('测试反应')
    expect(store.runtimeState.reactionAt).not.toBeNull()
  })

  it('triggerPetted 设置 isPetted', async () => {
    const store = usePetStore()
    await store.init()
    store.triggerPetted()
    expect(store.runtimeState.isPetted).toBe(true)
  })

  it('clearReaction 清除当前反应', async () => {
    const store = usePetStore()
    await store.init()
    store.triggerReaction('测试')
    store.clearReaction()
    expect(store.runtimeState.currentReaction).toBeNull()
  })

  it('allPets 包含内置宠物', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.allPets.length).toBeGreaterThanOrEqual(18)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/stores/pet.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 petStore**

```ts
// src/stores/pet.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { BUILTIN_PETS } from '@/lib/builtinPets'
import { DEFAULT_PET_SETTINGS, DEFAULT_PET_RUNTIME_STATE } from '@/types/pet'
import type { Pet, PetConfig, PetSettings, PetMode, PetRuntimeState } from '@/types/pet'

const REACTION_DISPLAY_MS = 10_000
const PETTED_DURATION_MS = 2500

export const usePetStore = defineStore('pet', () => {
  const config = ref<PetConfig | null>(null)
  const runtimeState = ref<PetRuntimeState>({ ...DEFAULT_PET_RUNTIME_STATE })
  const isInitialized = ref(false)

  let reactionTimer: ReturnType<typeof setTimeout> | null = null
  let pettedTimer: ReturnType<typeof setTimeout> | null = null

  const allPets = computed<Pet[]>(() => [
    ...BUILTIN_PETS,
    ...(config.value?.customPets ?? [])
  ])

  const activePet = computed<Pet | null>(() => {
    const id = config.value?.activePetId
    if (!id) return null
    return allPets.value.find(p => p.id === id) ?? null
  })

  const mode = computed<PetMode>(() => config.value?.mode ?? 'embedded')
  const isMuted = computed(() => config.value?.settings.muted ?? false)

  function createDefaultConfig(): PetConfig {
    return {
      version: 1,
      activePetId: '',
      mode: 'embedded',
      embeddedPosition: { x: 0.85, y: 0.78 },
      desktopWindow: { x: 1200, y: 700, width: 120, height: 120 },
      settings: { ...DEFAULT_PET_SETTINGS },
      customPets: []
    }
  }

  function getLocale(): 'zh-CN' | 'en-US' {
    try {
      const saved = localStorage.getItem('claude_desktop_settings')
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.language === 'en-US' ? 'en-US' : 'zh-CN'
      }
    } catch { /* ignore */ }
    return 'zh-CN'
  }

  async function init(): Promise<void> {
    const loaded = await api.pet.readConfig()
    config.value = loaded ?? createDefaultConfig()
    isInitialized.value = true
  }

  async function persist(): Promise<void> {
    if (!config.value) return
    await api.pet.writeConfig(config.value)
  }

  async function setActivePet(petId: string): Promise<void> {
    if (!config.value) return
    config.value.activePetId = petId
    await persist()
  }

  async function updateSettings(patch: Partial<PetSettings>): Promise<void> {
    if (!config.value) return
    config.value.settings = { ...config.value.settings, ...patch }
    await persist()
  }

  async function addCustomPet(pet: Pet, assetSrcPath?: string): Promise<void> {
    if (!config.value) return

    let finalPet = pet
    if (assetSrcPath) {
      const relativePath = await api.pet.saveAsset(assetSrcPath, pet.id)
      finalPet = {
        ...pet,
        visual: { type: 'image', path: relativePath, frameCount: 1 }
      }
    }

    config.value.customPets.push(finalPet)
    config.value.activePetId = finalPet.id
    await persist()
  }

  async function removeCustomPet(petId: string): Promise<void> {
    if (!config.value) return
    const pet = config.value.customPets.find(p => p.id === petId)
    if (!pet) return

    if (pet.visual.type === 'image') {
      await api.pet.deleteAsset(pet.visual.path)
    }

    config.value.customPets = config.value.customPets.filter(p => p.id !== petId)
    if (config.value.activePetId === petId) {
      config.value.activePetId = ''
    }
    await persist()
  }

  async function updatePosition(pos: { x: number; y: number }): Promise<void> {
    if (!config.value) return
    if (mode.value === 'embedded') {
      config.value.embeddedPosition = pos
    } else {
      config.value.desktopWindow.x = pos.x
      config.value.desktopWindow.y = pos.y
    }
    await persist()
  }

  function triggerReaction(text: string): void {
    runtimeState.value.currentReaction = text
    runtimeState.value.reactionAt = Date.now()

    if (reactionTimer) clearTimeout(reactionTimer)
    reactionTimer = setTimeout(() => {
      runtimeState.value.currentReaction = null
      runtimeState.value.reactionAt = null
    }, REACTION_DISPLAY_MS)
  }

  function triggerPetted(): void {
    runtimeState.value.isPetted = true

    if (pettedTimer) clearTimeout(pettedTimer)
    pettedTimer = setTimeout(() => {
      runtimeState.value.isPetted = false
    }, PETTED_DURATION_MS)
  }

  function clearReaction(): void {
    runtimeState.value.currentReaction = null
    runtimeState.value.reactionAt = null
    if (reactionTimer) {
      clearTimeout(reactionTimer)
      reactionTimer = null
    }
  }

  return {
    config,
    activePet,
    runtimeState,
    isInitialized,
    allPets,
    mode,
    isMuted,
    init,
    setActivePet,
    updateSettings,
    addCustomPet,
    removeCustomPet,
    updatePosition,
    triggerReaction,
    triggerPetted,
    clearReaction,
  }
})
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/stores/pet.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/pet.ts tests/stores/pet.test.ts
git commit -m "feat(pet): 新增 petStore Pinia store"
```

---

### 任务 10：usePetReaction composable

**文件：** 创建 `src/composables/usePetReaction.ts`，测试 `tests/composables/usePetReaction.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
// tests/composables/usePetReaction.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePetStore } from '@/stores/pet'
import { usePetReaction } from '@/composables/usePetReaction'

vi.mock('@/services/electronAPI', () => ({
  api: {
    pet: {
      readConfig: vi.fn().mockResolvedValue(null),
      writeConfig: vi.fn().mockResolvedValue(undefined),
      generateReaction: vi.fn().mockResolvedValue('AI 反应文本'),
      syncPetState: vi.fn(),
    }
  }
}))

describe('usePetReaction', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('generateReaction 返回预设语料当 reactionMode 为 preset', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')

    const reaction = usePetReaction()
    const text = await reaction.generateReaction('idle')
    expect(text).toBeTruthy()
    expect(typeof text).toBe('string')
  })

  it('generateReaction 返回 AI 反应当 reactionMode 为 ai', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    await store.updateSettings({ reactionMode: 'ai' })

    const reaction = usePetReaction()
    const text = await reaction.generateReaction('idle')
    expect(text).toBe('AI 反应文本')
  })

  it('generateReaction 返回 null 当 muted', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    await store.updateSettings({ muted: true })

    const reaction = usePetReaction()
    const text = await reaction.generateReaction('idle')
    expect(text).toBeNull()
  })

  it('generateReaction 触发后 store.runtimeState.currentReaction 更新', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')

    const reaction = usePetReaction()
    await reaction.generateReaction('idle')
    expect(store.runtimeState.currentReaction).toBeTruthy()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/composables/usePetReaction.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 usePetReaction**

```ts
// src/composables/usePetReaction.ts
import { usePetStore } from '@/stores/pet'
import { api } from '@/services/electronAPI'
import { DEFAULT_PRESET_REACTIONS } from '@/lib/defaultReactions'
import type { PetReactionTrigger } from '@/types/pet'

const MAX_RECENT_MESSAGES = 6
const MESSAGE_TRUNCATE_LENGTH = 200

export function usePetReaction() {
  const petStore = usePetStore()
  let lastReactionAt = 0

  function pickPresetReaction(trigger: PetReactionTrigger): string | null {
    const pet = petStore.activePet
    if (!pet) return null

    const reactions = pet.presetReactions[trigger]
    const pool = reactions.length > 0 ? reactions : DEFAULT_PRESET_REACTIONS[trigger]
    if (pool.length === 0) return null

    return pool[Math.floor(Math.random() * pool.length)]
  }

  async function generateAIReaction(trigger: PetReactionTrigger): Promise<string | null> {
    const pet = petStore.activePet
    if (!pet) return null

    let recentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    try {
      const { useChatSessionStore } = await import('@/stores/chatSession')
      const chatStore = useChatSessionStore()
      const messages = chatStore.currentSessionMessages ?? []
      recentMessages = messages
        .slice(-MAX_RECENT_MESSAGES)
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: (typeof m.content === 'string' ? m.content : '').slice(0, MESSAGE_TRUNCATE_LENGTH)
        }))
    } catch { /* chatSession 未初始化时忽略 */ }

    return await api.pet.generateReaction({
      petName: pet.name,
      personality: pet.personality,
      recentMessages,
      trigger
    })
  }

  async function generateReaction(trigger: PetReactionTrigger): Promise<string | null> {
    if (petStore.isMuted) return null
    if (!petStore.activePet) return null

    const intervalMs = petStore.config?.settings.reactionIntervalMs ?? 60000
    if (trigger !== 'petted' && Date.now() - lastReactionAt < intervalMs) {
      return null
    }

    const reactionMode = petStore.config?.settings.reactionMode ?? 'preset'
    const text = reactionMode === 'ai'
      ? await generateAIReaction(trigger)
      : pickPresetReaction(trigger)

    if (text) {
      petStore.triggerReaction(text)
      lastReactionAt = Date.now()
    }

    return text
  }

  function onUserTyping(): void { generateReaction('typing') }
  function onTaskError(): void { generateReaction('error') }
  function onTaskSuccess(): void { generateReaction('success') }
  function onUserPetted(): void { generateReaction('petted') }
  function onIdleInterval(): void { generateReaction('idle') }

  return {
    generateReaction,
    onUserTyping,
    onTaskError,
    onTaskSuccess,
    onUserPetted,
    onIdleInterval,
  }
}

// 模块级单例，供非组件上下文调用（如 eventHandlers）
let globalInstance: ReturnType<typeof usePetReaction> | null = null

export function initPetReactionGlobal() {
  if (!globalInstance) {
    globalInstance = usePetReaction()
  }
  return globalInstance
}

export function triggerPetReaction(trigger: PetReactionTrigger) {
  if (!globalInstance) {
    initPetReactionGlobal()
  }
  return globalInstance!.generateReaction(trigger)
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/composables/usePetReaction.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/composables/usePetReaction.ts tests/composables/usePetReaction.test.ts
git commit -m "feat(pet): 新增 usePetReaction composable"
```

---

### 任务 11：usePetDrag composable

**文件：** 创建 `src/composables/usePetDrag.ts`

- [ ] **步骤 1：实现 usePetDrag**

```ts
// src/composables/usePetDrag.ts
import { ref, onUnmounted } from 'vue'

interface UsePetDragOptions {
  mode: 'embedded' | 'desktop'
  onDragEnd: (pos: { x: number; y: number }) => void
}

export function usePetDrag(options: UsePetDragOptions) {
  const isDragging = ref(false)
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging.value) return
    const dx = e.screenX - startX
    const dy = e.screenY - startY

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement | null
      if (el) {
        el.style.left = `${originLeft + dx}px`
        el.style.top = `${originTop + dy}px`
      }
    }
    // desktop 模式由独立窗口的 petWindowAPI 处理
  }

  function handlePointerUp() {
    if (!isDragging.value) return
    isDragging.value = false
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        const x = (rect.left + rect.width / 2) / window.innerWidth
        const y = (rect.top + rect.height / 2) / window.innerHeight
        options.onDragEnd({ x, y })
      }
    } else {
      options.onDragEnd({ x: 0, y: 0 })
    }
  }

  function onPointerDown(e: PointerEvent) {
    isDragging.value = true
    startX = e.screenX
    startY = e.screenY

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        originLeft = rect.left
        originTop = rect.top
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }

  onUnmounted(() => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
  })

  return { isDragging, onPointerDown }
}
```

- [ ] **步骤 2：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/composables/usePetDrag.ts
git commit -m "feat(pet): 新增 usePetDrag composable"
```

---

### 任务 12：PetReactionBubble 组件

**文件：** 创建 `src/components/pets/PetReactionBubble.vue`

- [ ] **步骤 1：实现 PetReactionBubble**

```vue
<!-- src/components/pets/PetReactionBubble.vue -->
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  text: string | null
}>()

const emit = defineEmits<{ dismiss: [] }>()

const visible = computed(() => !!props.text && props.text.length > 0)
</script>

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
  background: var(--glass-bg, rgba(255, 255, 255, 0.1));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.2));
  border-radius: var(--radius-lg, 12px);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
  max-width: 200px;
  cursor: pointer;
  white-space: nowrap;
  pointer-events: auto;
}

.bubble-text {
  font-size: 12px;
  color: var(--text-primary, #fff);
  line-height: 1.4;
}

.bubble-tail {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid var(--glass-border, rgba(255, 255, 255, 0.2));
}

.bubble-enter-active,
.bubble-leave-active {
  transition: all 0.3s ease;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
```

- [ ] **步骤 2：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/components/pets/PetReactionBubble.vue
git commit -m "feat(pet): 新增 PetReactionBubble 反应气泡组件"
```

---

### 任务 13：18 个 Species Sprite SVG 组件

**文件：** 创建 `src/components/pets/sprites/DuckSprite.vue` 等 18 个

每个组件遵循统一约定：viewBox `0 0 100 60`、props `{ palette, frame, isPetted }`、3 帧动画、撸时显示爱心。

- [ ] **步骤 1：实现 DuckSprite（模板）**

```vue
<!-- src/components/pets/sprites/DuckSprite.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { PetPalette } from '@/types/pet'

const props = defineProps<{
  palette: PetPalette
  frame: 0 | 1 | 2
  isPetted: boolean
}>()

const BODY_PATHS = [
  'M 25 25 Q 50 15 75 25 L 80 45 Q 50 55 20 45 Z',
  'M 25 25 Q 50 15 75 25 L 80 45 Q 50 55 20 45 Z',
  'M 25 20 Q 50 10 75 20 L 80 40 Q 50 50 20 40 Z'
]

const currentPath = computed(() => props.isPetted ? BODY_PATHS[2] : BODY_PATHS[props.frame])
const eyeOpacity = computed(() => props.frame === 1 && !props.isPetted ? 0 : 1)
const bodyOffsetY = computed(() => props.isPetted ? -3 : 0)
</script>

<template>
  <svg viewBox="0 0 100 60" width="80" height="48" xmlns="http://www.w3.org/2000/svg">
    <g :transform="`translate(0, ${bodyOffsetY})`">
      <path :d="currentPath" :fill="palette.primary" stroke="rgba(0,0,0,0.1)" stroke-width="1" />
      <ellipse cx="50" cy="30" rx="10" ry="5" :fill="palette.accent" />
      <circle cx="40" cy="25" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <circle cx="60" cy="25" r="2.5" :fill="palette.accent" :opacity="eyeOpacity" />
      <ellipse cx="75" cy="38" rx="6" ry="4" :fill="palette.primary" opacity="0.8" />
    </g>
    <text v-if="isPetted" x="60" y="10" font-size="14" fill="#FF6B9D">♥</text>
  </svg>
</template>
```

- [ ] **步骤 2：按相同模板实现其余 17 个 sprite**

每个 sprite 差异仅在 SVG path 数据和装饰元素。物种与视觉参考：
- goose: 白色身体 + 长脖子
- blob: 圆形无装饰
- cat: 三角耳朵 + 胡须
- dragon: 角 + 翅膀 + 尾巴
- octopus: 8 条触手
- owl: 大眼睛 + 翅膀
- penguin: 白肚子 + 翅膀
- turtle: 龟壳花纹
- snail: 螺旋壳 + 触角
- ghost: 飘逸底部
- axolotl: 鳃 + 尾巴
- capybara: 圆耳朵 + 小眼睛
- cactus: 刺 + 花
- robot: 天线 + 屏幕
- rabbit: 长耳朵 + 蓬尾
- mushroom: 圆帽 + 白点
- chonk: 大圆身体 + 小头

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/components/pets/sprites/
git commit -m "feat(pet): 新增 18 个 species sprite SVG 组件"
```

---

### 任务 14：PetImageSprite + PetSprite 分发器

**文件：** 创建 `src/components/pets/PetImageSprite.vue`、`src/components/pets/PetSprite.vue`

- [ ] **步骤 1：实现 PetImageSprite**

```vue
<!-- src/components/pets/PetImageSprite.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  src: string
  frameCount?: 1 | 2
  frame: number
  isPetted: boolean
}>()

const loadError = ref(false)

function onLoad() { loadError.value = false }
function onError() { loadError.value = true }
</script>

<template>
  <div class="pet-image-sprite" :class="{ petted: isPetted }">
    <img
      v-if="!loadError && src"
      :src="src"
      width="80"
      height="48"
      @load="onLoad"
      @error="onError"
    />
    <div v-else class="placeholder">
      <span>图片丢失</span>
    </div>
    <span v-if="isPetted && !loadError" class="heart">♥</span>
  </div>
</template>

<style scoped lang="scss">
.pet-image-sprite {
  position: relative;
  width: 80px;
  height: 48px;
  transition: transform 0.3s ease;

  &.petted { transform: scale(1.1); }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary, #333);
  color: var(--text-muted, #999);
  font-size: 10px;
  border-radius: 4px;
}

.heart {
  position: absolute;
  top: -10px;
  right: 10px;
  font-size: 14px;
  color: #FF6B9D;
}
</style>
```

- [ ] **步骤 2：实现 PetSprite 分发器**

```vue
<!-- src/components/pets/PetSprite.vue -->
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { Pet } from '@/types/pet'
import DuckSprite from './sprites/DuckSprite.vue'
import GooseSprite from './sprites/GooseSprite.vue'
import BlobSprite from './sprites/BlobSprite.vue'
import CatSprite from './sprites/CatSprite.vue'
import DragonSprite from './sprites/DragonSprite.vue'
import OctopusSprite from './sprites/OctopusSprite.vue'
import OwlSprite from './sprites/OwlSprite.vue'
import PenguinSprite from './sprites/PenguinSprite.vue'
import TurtleSprite from './sprites/TurtleSprite.vue'
import SnailSprite from './sprites/SnailSprite.vue'
import GhostSprite from './sprites/GhostSprite.vue'
import AxolotlSprite from './sprites/AxolotlSprite.vue'
import CapybaraSprite from './sprites/CapybaraSprite.vue'
import CactusSprite from './sprites/CactusSprite.vue'
import RobotSprite from './sprites/RobotSprite.vue'
import RabbitSprite from './sprites/RabbitSprite.vue'
import MushroomSprite from './sprites/MushroomSprite.vue'
import ChonkSprite from './sprites/ChonkSprite.vue'
import PetImageSprite from './PetImageSprite.vue'

const SPRITE_MAP: Record<string, ReturnType<typeof defineComponent>> = {
  duck: DuckSprite, goose: GooseSprite, blob: BlobSprite, cat: CatSprite,
  dragon: DragonSprite, octopus: OctopusSprite, owl: OwlSprite, penguin: PenguinSprite,
  turtle: TurtleSprite, snail: SnailSprite, ghost: GhostSprite, axolotl: AxolotlSprite,
  capybara: CapybaraSprite, cactus: CactusSprite, robot: RobotSprite, rabbit: RabbitSprite,
  mushroom: MushroomSprite, chonk: ChonkSprite,
}

const props = defineProps<{
  pet: Pet
  isPetted: boolean
  scale?: number
}>()

const frame = ref<0 | 1 | 2>(0)
let rafId: number | null = null
let lastFrameAt = 0
const FRAME_INTERVAL = 500

function tick(t: number) {
  if (t - lastFrameAt >= FRAME_INTERVAL) {
    frame.value = ((frame.value + 1) % 3) as 0 | 1 | 2
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
      v-if="pet.visual.type === 'builtin-svg' && spriteComponent"
      :is="spriteComponent"
      :palette="pet.palette!"
      :frame="frame"
      :is-petted="isPetted"
    />
    <PetImageSprite
      v-else-if="pet.visual.type === 'image'"
      :src="pet.visual.path"
      :frame-count="pet.visual.frameCount ?? 1"
      :frame="frame"
      :is-petted="isPetted"
    />
  </div>
</template>

<style scoped>
.pet-sprite {
  display: inline-block;
  transition: transform 0.2s ease;
}
</style>
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/components/pets/PetImageSprite.vue src/components/pets/PetSprite.vue
git commit -m "feat(pet): 新增 PetImageSprite 和 PetSprite 分发器"
```

---

### 任务 15：PetEmbeddedWidget + App.vue 挂载

**文件：** 创建 `src/components/pets/PetEmbeddedWidget.vue`，修改 `src/App.vue`

- [ ] **步骤 1：实现 PetEmbeddedWidget**

```vue
<!-- src/components/pets/PetEmbeddedWidget.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { usePetStore } from '@/stores/pet'
import { usePetDrag } from '@/composables/usePetDrag'
import { usePetReaction } from '@/composables/usePetReaction'
import PetSprite from './PetSprite.vue'
import PetReactionBubble from './PetReactionBubble.vue'

const petStore = usePetStore()
const reaction = usePetReaction()

const position = computed(() => petStore.config?.embeddedPosition ?? { x: 0.85, y: 0.78 })
const scale = computed(() => petStore.config?.settings.scale ?? 1)

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
        :scale="scale"
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
  display: inline-block;

  &.dragging { cursor: grabbing; }
  &:hover { filter: brightness(1.05); }
}
</style>
```

- [ ] **步骤 2：修改 App.vue 挂载组件**

在 `src/App.vue` 中：

1. 在 `defineAsyncComponent` 区域新增导入：
```ts
const PetEmbeddedWidget = defineAsyncComponent(() => import('@/components/pets/PetEmbeddedWidget.vue'))
```

2. 导入 petStore 和初始化函数：
```ts
import { usePetStore } from '@/stores/pet'
import { initPetReactionGlobal } from '@/composables/usePetReaction'

const petStore = usePetStore()
```

3. 在 `onMounted` 中初始化：
```ts
petStore.init().catch(err => console.error('[Pet] Failed to init:', err))
initPetReactionGlobal()
```

4. 新增 computed：
```ts
const shouldShowEmbeddedPet = computed(() =>
  petStore.isInitialized &&
  petStore.activePet &&
  petStore.mode === 'embedded' &&
  !petStore.isMuted
)
```

5. 在 template 悬浮组件区域新增：
```vue
<PetEmbeddedWidget v-if="shouldShowEmbeddedPet" />
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：运行 build 验证**

运行：`npm run build`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/components/pets/PetEmbeddedWidget.vue src/App.vue
git commit -m "feat(pet): 新增应用内嵌入悬浮组件并挂载到 App.vue"
```

---

## 阶段 3：设置页面

### 任务 16：i18n 翻译键

**文件：** 修改 `src/i18n/locales/zh-CN.ts`、`src/i18n/locales/en-US.ts`

- [ ] **步骤 1：zh-CN.ts 新增 petSettings 键**

在 `src/i18n/locales/zh-CN.ts` 文件末尾（或 `appearanceSettings` 之后）新增：

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
},
```

- [ ] **步骤 2：en-US.ts 新增对应英文翻译**

```ts
petSettings: {
  title: 'Desktop Pet',
  gallery: 'Gallery',
  creator: 'Create Pet',
  behavior: 'Behavior',
  switchToDesktop: 'Switch to Desktop Mode',
  switchToEmbedded: 'Switch to Embedded Mode',
  builtin: 'Built-in',
  custom: 'Custom',
  builtinPets: 'Built-in Pets',
  customPets: 'Custom Pets',
  create: 'Create New Pet',
  noCustomPets: 'No custom pets yet. Click the button above to create one!',
  active: 'Active',
  name: 'Pet Name',
  personality: 'Personality',
  uploadImage: 'Upload Image',
  imageHint: 'Supports PNG/JPG/GIF/SVG, max 2MB',
  preview: 'Preview',
  untitled: 'Untitled',
  noPersonality: 'No personality description',
  nameLength: 'Name must be 1-20 characters',
  personalityLength: 'Personality must be 1-200 characters',
  fileTooLarge: 'File size must not exceed 2MB',
  unsupportedFormat: 'Only PNG/JPG/GIF/SVG formats are supported',
  requireAsset: 'Please upload an image',
  reactionMode: 'Reaction Mode',
  presetMode: 'Preset Lines',
  aiMode: 'AI Generated',
  aiModeHint: 'Uses LLM to generate dynamic reactions based on context, consumes tokens',
  aiModel: 'AI Model',
  reactionInterval: 'Reaction Interval',
  scale: 'Scale',
  muted: 'Muted (no reactions)',
  alwaysOnTop: 'Always on Top (Desktop)',
  clickThrough: 'Click Through',
  rarity: {
    common: 'Common',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary'
  },
  petCreated: 'Pet created successfully',
  petDeleted: 'Pet deleted',
  petSwitched: 'Switched to {name}',
  modeSwitched: 'Switched to {mode} mode',
  modeDesktop: 'Desktop',
  modeEmbedded: 'Embedded'
},
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(pet): 新增 petSettings i18n 翻译键"
```

---

### 任务 17：设置子组件（PetCard + PetPreviewHeader + PetGallery + PetCreator + PetBehaviorConfig）

**文件：** 创建 `src/components/settings/pet/` 下 5 个组件

- [ ] **步骤 1：实现 PetCard**

```vue
<!-- src/components/settings/pet/PetCard.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Pet } from '@/types/pet'
import PetSprite from '@/components/pets/PetSprite.vue'

const props = defineProps<{
  pet: Pet
  active?: boolean
  isCustom?: boolean
}>()

defineEmits<{ click: []; delete: [] }>()

const { t } = useI18n()

const rarityStars = computed(() => {
  switch (props.pet.rarity) {
    case 'common': return 1
    case 'rare': return 3
    case 'epic': return 4
    case 'legendary': return 5
    default: return 0
  }
})
</script>

<template>
  <div class="pet-card" :class="{ active }" @click="$emit('click')">
    <div class="card-sprite">
      <PetSprite :pet="pet" :is-petted="false" :scale="0.8" />
    </div>
    <div class="card-info">
      <span class="name">{{ pet.name }}</span>
      <span v-if="pet.rarity" class="rarity">{{ '★'.repeat(rarityStars) }}</span>
    </div>
    <button v-if="isCustom" class="delete-btn" @click.stop="$emit('delete')">×</button>
  </div>
</template>

<style scoped lang="scss">
.pet-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-subtle, #3a3a3a);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-hover, #333);
    border-color: var(--border-default, #444);
  }

  &.active {
    border-color: var(--accent-primary, #4FC3F7);
    background: var(--surface-hover, #333);
  }
}

.card-sprite { margin-bottom: 8px; }

.card-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.name {
  font-size: 13px;
  color: var(--text-primary, #fff);
  font-weight: 500;
}

.rarity {
  font-size: 10px;
  color: var(--text-muted, #999);
}

.delete-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  background: var(--bg-tertiary, #444);
  color: var(--text-muted, #999);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;

  &:hover {
    background: #e53935;
    color: white;
  }
}
</style>
```

- [ ] **步骤 2：实现 PetPreviewHeader**

```vue
<!-- src/components/settings/pet/PetPreviewHeader.vue -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Pet, PetMode } from '@/types/pet'
import PetSprite from '@/components/pets/PetSprite.vue'

defineProps<{
  pet: Pet | null
  mode: PetMode
}>()

const emit = defineEmits<{ 'toggle-mode': [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="pet-preview-header">
    <div class="preview-sprite">
      <PetSprite v-if="pet" :pet="pet" :is-petted="false" :scale="2" />
    </div>
    <div class="preview-info">
      <h2 v-if="pet">{{ pet.name }}</h2>
      <p v-if="pet" class="personality">{{ pet.personality }}</p>
      <div v-if="pet" class="badges">
        <span v-if="pet.rarity" class="rarity-badge" :class="`rarity-${pet.rarity}`">
          {{ t(`petSettings.rarity.${pet.rarity}`) }}
        </span>
        <span class="type-badge">
          {{ pet.visual.type === 'builtin-svg' ? t('petSettings.builtin') : t('petSettings.custom') }}
        </span>
      </div>
    </div>
    <div class="mode-toggle">
      <button @click="emit('toggle-mode')">
        {{ mode === 'embedded' ? t('petSettings.switchToDesktop') : t('petSettings.switchToEmbedded') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.pet-preview-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-subtle, #3a3a3a);
  border-radius: 12px;
  margin-bottom: 16px;
}

.preview-sprite { flex-shrink: 0; }

.preview-info {
  flex: 1;

  h2 {
    margin: 0 0 4px;
    font-size: 18px;
    color: var(--text-primary, #fff);
  }

  .personality {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--text-muted, #999);
  }
}

.badges {
  display: flex;
  gap: 8px;
}

.rarity-badge, .type-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.rarity-badge {
  &.rarity-common { background: rgba(158, 158, 158, 0.2); color: #9e9e9e; }
  &.rarity-rare { background: rgba(79, 195, 247, 0.15); color: #4FC3F7; }
  &.rarity-epic { background: rgba(171, 71, 188, 0.15); color: #AB47BC; }
  &.rarity-legendary { background: rgba(255, 193, 7, 0.15); color: #FFC107; }
}

.type-badge {
  background: var(--bg-tertiary, #444);
  color: var(--text-secondary, #ccc);
}

.mode-toggle button {
  padding: 8px 16px;
  background: var(--accent-primary, #4FC3F7);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;

  &:hover { opacity: 0.9; }
}
</style>
```

- [ ] **步骤 3：实现 PetGallery**

```vue
<!-- src/components/settings/pet/PetGallery.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import { BUILTIN_PETS } from '@/lib/builtinPets'
import PetCard from './PetCard.vue'

const emit = defineEmits<{ create: [] }>()
const petStore = usePetStore()
const { t } = useI18n()

const customPets = computed(() => petStore.config?.customPets ?? [])

async function selectPet(petId: string) {
  await petStore.setActivePet(petId)
}

async function deleteCustomPet(petId: string) {
  await petStore.removeCustomPet(petId)
}
</script>

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
      <h3 class="custom-header">
        {{ t('petSettings.customPets') }}
        <button class="create-btn" @click="emit('create')">{{ t('petSettings.create') }}</button>
      </h3>
      <div v-if="customPets.length" class="pet-grid">
        <PetCard
          v-for="pet in customPets"
          :key="pet.id"
          :pet="pet"
          :active="pet.id === petStore.config?.activePetId"
          :is-custom="true"
          @click="selectPet(pet.id)"
          @delete="deleteCustomPet(pet.id)"
        />
      </div>
      <div v-else class="empty-state">
        {{ t('petSettings.noCustomPets') }}
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.pet-gallery {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.gallery-section h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-secondary, #ccc);
  font-weight: 500;
}

.custom-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.create-btn {
  padding: 4px 12px;
  background: var(--accent-primary, #4FC3F7);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;

  &:hover { opacity: 0.9; }
}

.pet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--text-muted, #999);
  font-size: 13px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px dashed var(--border-default, #444);
  border-radius: 8px;
}
</style>
```

- [ ] **步骤 4：实现 PetCreator**

```vue
<!-- src/components/settings/pet/PetCreator.vue -->
<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import type { Pet } from '@/types/pet'
import { DEFAULT_PRESET_REACTIONS } from '@/lib/defaultReactions'
import PetSprite from '@/components/pets/PetSprite.vue'

const emit = defineEmits<{ created: [] }>()
const { t } = useI18n()
const petStore = usePetStore()

const form = reactive({
  name: '',
  personality: '',
  assetFile: null as File | null,
  assetPreview: '' as string,
})

const errors = reactive({ name: '', personality: '', asset: '' })

const previewPet = computed<Pet>(() => ({
  id: 'preview',
  name: form.name || t('petSettings.untitled'),
  personality: form.personality || t('petSettings.noPersonality'),
  visual: { type: 'image', path: form.assetPreview || '', frameCount: 1 },
  presetReactions: { ...DEFAULT_PRESET_REACTIONS }
}))

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  errors.asset = ''

  if (file.size > 2 * 1024 * 1024) {
    errors.asset = t('petSettings.fileTooLarge')
    return
  }

  const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml']
  if (!allowedTypes.includes(file.type)) {
    errors.asset = t('petSettings.unsupportedFormat')
    return
  }

  form.assetFile = file
  form.assetPreview = URL.createObjectURL(file)
}

function validate(): boolean {
  errors.name = (form.name.length < 1 || form.name.length > 20) ? t('petSettings.nameLength') : ''
  errors.personality = (form.personality.length < 1 || form.personality.length > 200) ? t('petSettings.personalityLength') : ''
  errors.asset = !form.assetFile ? t('petSettings.requireAsset') : ''
  return !errors.name && !errors.personality && !errors.asset
}

async function onSubmit() {
  if (!validate() || !form.assetFile) return

  const petId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const pet: Pet = {
    id: petId,
    name: form.name,
    personality: form.personality,
    visual: { type: 'image', path: '', frameCount: 1 },
    presetReactions: { ...DEFAULT_PRESET_REACTIONS },
    createdAt: Date.now()
  }

  const filePath = (form.assetFile as File & { path?: string }).path
  await petStore.addCustomPet(pet, filePath)

  form.name = ''
  form.personality = ''
  form.assetFile = null
  form.assetPreview = ''

  emit('created')
}

const canSubmit = computed(() => form.name && form.personality && form.assetFile)
</script>

<template>
  <div class="pet-creator">
    <div class="creator-form">
      <div class="form-group">
        <label>{{ t('petSettings.name') }}</label>
        <input v-model="form.name" maxlength="20" />
        <span class="error" v-if="errors.name">{{ errors.name }}</span>
      </div>

      <div class="form-group">
        <label>{{ t('petSettings.personality') }}</label>
        <textarea v-model="form.personality" maxlength="200" rows="3" />
        <span class="error" v-if="errors.personality">{{ errors.personality }}</span>
      </div>

      <div class="form-group">
        <label>{{ t('petSettings.uploadImage') }}</label>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml" @change="onFileChange" />
        <span class="error" v-if="errors.asset">{{ errors.asset }}</span>
        <p class="hint">{{ t('petSettings.imageHint') }}</p>
      </div>

      <button class="submit-btn" :disabled="!canSubmit" @click="onSubmit">
        {{ t('petSettings.create') }}
      </button>
    </div>

    <div class="creator-preview">
      <h4>{{ t('petSettings.preview') }}</h4>
      <div class="preview-sprite">
        <PetSprite :pet="previewPet" :is-petted="false" :scale="2" />
      </div>
      <div class="preview-meta">
        <span class="name">{{ previewPet.name }}</span>
        <p class="personality">{{ previewPet.personality }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.pet-creator {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.creator-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;

  label {
    font-size: 13px;
    color: var(--text-secondary, #ccc);
    font-weight: 500;
  }

  input:not([type="file"]), textarea {
    padding: 8px 12px;
    background: var(--bg-secondary, #2a2a2a);
    border: 1px solid var(--border-default, #444);
    border-radius: 4px;
    color: var(--text-primary, #fff);
    font-size: 13px;

    &:focus {
      outline: none;
      border-color: var(--accent-primary, #4FC3F7);
    }
  }

  input[type="file"] { font-size: 12px; }

  .error { color: #e53935; font-size: 11px; }

  .hint {
    color: var(--text-muted, #999);
    font-size: 11px;
    margin: 2px 0 0;
  }
}

.submit-btn {
  padding: 10px 16px;
  background: var(--accent-primary, #4FC3F7);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  align-self: flex-start;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:hover:not(:disabled) { opacity: 0.9; }
}

.creator-preview {
  padding: 16px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-subtle, #3a3a3a);
  border-radius: 12px;
  text-align: center;

  h4 {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-secondary, #ccc);
  }

  .preview-sprite { margin-bottom: 12px; }

  .name {
    display: block;
    font-size: 14px;
    color: var(--text-primary, #fff);
    font-weight: 500;
  }

  .personality {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-muted, #999);
  }
}
</style>
```

- [ ] **步骤 5：实现 PetBehaviorConfig**

```vue
<!-- src/components/settings/pet/PetBehaviorConfig.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import type { ReactionMode } from '@/types/pet'

const petStore = usePetStore()
const { t } = useI18n()

const settings = computed(() => petStore.config?.settings)

const reactionMode = computed<ReactionMode>({
  get: () => settings.value?.reactionMode ?? 'preset',
  set: (val) => petStore.updateSettings({ reactionMode: val })
})

const aiModel = computed({
  get: () => settings.value?.aiModel ?? 'gpt-4o-mini',
  set: (val) => petStore.updateSettings({ aiModel: val })
})

const intervalSec = computed({
  get: () => Math.round((settings.value?.reactionIntervalMs ?? 60000) / 1000),
  set: (val) => petStore.updateSettings({ reactionIntervalMs: val * 1000 })
})

const scaleDec = computed({
  get: () => settings.value?.scale ?? 1.0,
  set: (val) => petStore.updateSettings({ scale: val })
})

const muted = computed({
  get: () => settings.value?.muted ?? false,
  set: (val) => petStore.updateSettings({ muted: val })
})

const alwaysOnTop = computed({
  get: () => settings.value?.alwaysOnTopDesktop ?? true,
  set: (val) => petStore.updateSettings({ alwaysOnTopDesktop: val })
})

const clickThrough = computed({
  get: () => settings.value?.clickThrough ?? false,
  set: (val) => petStore.updateSettings({ clickThrough: val })
})
</script>

<template>
  <div class="pet-behavior-config">
    <div class="config-group">
      <label class="group-label">{{ t('petSettings.reactionMode') }}</label>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" v-model="reactionMode" value="preset" />
          {{ t('petSettings.presetMode') }}
        </label>
        <label class="radio-label">
          <input type="radio" v-model="reactionMode" value="ai" />
          {{ t('petSettings.aiMode') }}
        </label>
      </div>
      <p class="hint" v-if="reactionMode === 'ai'">{{ t('petSettings.aiModeHint') }}</p>
    </div>

    <div class="config-group" v-if="reactionMode === 'ai'">
      <label class="group-label">{{ t('petSettings.aiModel') }}</label>
      <select v-model="aiModel" class="select-input">
        <option value="gpt-4o-mini">GPT-4o mini</option>
        <option value="gpt-4o">GPT-4o</option>
        <option value="claude-3-5-haiku">Claude 3.5 Haiku</option>
      </select>
    </div>

    <div class="config-group">
      <label class="group-label">{{ t('petSettings.reactionInterval') }}: {{ intervalSec }}s</label>
      <input type="range" v-model.number="intervalSec" min="30" max="300" step="10" class="range-input" />
    </div>

    <div class="config-group">
      <label class="group-label">{{ t('petSettings.scale') }}: {{ scaleDec.toFixed(1) }}x</label>
      <input type="range" v-model.number="scaleDec" min="0.5" max="2.0" step="0.1" class="range-input" />
    </div>

    <div class="config-group">
      <label class="checkbox-label">
        <input type="checkbox" v-model="muted" />
        {{ t('petSettings.muted') }}
      </label>
    </div>

    <template v-if="petStore.mode === 'desktop'">
      <div class="config-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="alwaysOnTop" />
          {{ t('petSettings.alwaysOnTop') }}
        </label>
      </div>
      <div class="config-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="clickThrough" />
          {{ t('petSettings.clickThrough') }}
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.pet-behavior-config {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-label {
  font-size: 13px;
  color: var(--text-secondary, #ccc);
  font-weight: 500;
}

.radio-group { display: flex; gap: 16px; }

.radio-label, .checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary, #fff);
  cursor: pointer;

  input { cursor: pointer; }
}

.hint {
  color: var(--text-muted, #999);
  font-size: 11px;
  margin: 0;
}

.select-input {
  padding: 6px 12px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-default, #444);
  border-radius: 4px;
  color: var(--text-primary, #fff);
  font-size: 13px;
  align-self: flex-start;
}

.range-input {
  width: 100%;
  max-width: 300px;
}
</style>
```

- [ ] **步骤 6：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 7：Commit**

```bash
git add src/components/settings/pet/
git commit -m "feat(pet): 新增设置页子组件（Card/PreviewHeader/Gallery/Creator/BehaviorConfig）"
```

---

### 任务 18：PetSettings 容器 + SettingsPanel 接入

**文件：** 创建 `src/components/settings/pet/PetSettings.vue`，修改 `src/components/settings/SettingsPanel.vue`

- [ ] **步骤 1：实现 PetSettings 容器**

```vue
<!-- src/components/settings/pet/PetSettings.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import PetPreviewHeader from './PetPreviewHeader.vue'
import PetGallery from './PetGallery.vue'
import PetCreator from './PetCreator.vue'
import PetBehaviorConfig from './PetBehaviorConfig.vue'

const petStore = usePetStore()
const { t } = useI18n()

const tab = ref<'gallery' | 'creator' | 'behavior'>('gallery')

const activePet = computed(() => petStore.activePet)
const mode = computed(() => petStore.mode)

async function toggleMode() {
  // 阶段 4 才实现 desktop 模式切换，这里先留空
  // await petStore.setMode(mode.value === 'embedded' ? 'desktop' : 'embedded')
}

function onPetCreated() {
  tab.value = 'gallery'
}
</script>

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
      <PetGallery v-if="tab === 'gallery'" @create="tab = 'creator'" />
      <PetCreator v-else-if="tab === 'creator'" @created="onPetCreated" />
      <PetBehaviorConfig v-else />
    </KeepAlive>
  </div>
</template>

<style scoped lang="scss">
.pet-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.pet-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-subtle, #3a3a3a);

  button {
    padding: 8px 16px;
    background: transparent;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    font-size: 13px;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;

    &:hover { color: var(--text-primary, #fff); }

    &.active {
      color: var(--accent-primary, #4FC3F7);
      border-bottom-color: var(--accent-primary, #4FC3F7);
    }
  }
}
</style>
```

- [ ] **步骤 2：修改 SettingsPanel.vue 接入**

在 `src/components/settings/SettingsPanel.vue` 中：

1. 在 `defineAsyncComponent` 区域（约行 121-134）新增：
```ts
import { PawPrint } from 'lucide-vue-next'
const PetSettings = defineAsyncComponent(() => import('./pet/PetSettings.vue'))
```

2. 在 `personalMenuItems`（约行 152-158）中新增 "宠物" 项：
```ts
const personalMenuItems = computed(() => [
  { id: 'appearance', label: t('settings.appearance'), icon: Palette },
  { id: 'shortcuts', label: t('settings.shortcuts'), icon: Keyboard },
  { id: 'hooks', label: t('settings.hooks'), icon: Zap },
  { id: 'token-usage', label: 'Token 用量', icon: BarChart3 },
  { id: 'pet', label: t('petSettings.title'), icon: PawPrint },
  { id: 'about', label: t('aboutSettings.title'), icon: Info },
])
```

3. 在 template 的 v-if/v-else-if 链中（约行 53-103）新增：
```vue
<PetSettings v-else-if="activeTab === 'pet'" />
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：运行 build 验证**

运行：`npm run build`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/components/settings/pet/PetSettings.vue src/components/settings/SettingsPanel.vue
git commit -m "feat(pet): 新增 PetSettings 容器并接入设置面板"
```

---

### 任务 19：上下文事件接入

**文件：** 修改 `src/stores/turn/eventHandlers.ts`、`src/components/chat/ChatInput.vue`

- [ ] **步骤 1：eventHandlers.ts 接入任务错误/成功事件**

在 `src/stores/turn/eventHandlers.ts` 中，找到 `handleToolResult` 函数（处理工具结果的地方），在 `result.is_error === true` 分支末尾新增：

```ts
import { triggerPetReaction } from '@/composables/usePetReaction'

// 在 handleToolResult 内，检测到 is_error 时
if (result.is_error) {
  triggerPetReaction('error')
}
```

在 turn 完成成功的位置（具体函数名需查看实际代码）新增：
```ts
triggerPetReaction('success')
```

注意：`triggerPetReaction` 是模块级单例函数，无需 setup 上下文。但需要在 `App.vue` 的 `onMounted` 中调用 `initPetReactionGlobal()` 初始化（任务 15 已包含）。

- [ ] **步骤 2：ChatInput.vue 接入用户打字事件**

在 `src/components/chat/ChatInput.vue` 中，找到 input 事件处理函数，新增 debounce 后的宠物通知：

```ts
import { triggerPetReaction } from '@/composables/usePetReaction'

let typingTimer: ReturnType<typeof setTimeout> | null = null

function notifyPetTyping() {
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = setTimeout(() => {
    triggerPetReaction('typing')
  }, 500)
}

// 在现有 input 事件处理中调用 notifyPetTyping()
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：运行 build 验证**

运行：`npm run build`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/turn/eventHandlers.ts src/components/chat/ChatInput.vue
git commit -m "feat(pet): 接入上下文事件触发宠物反应"
```

---

## 阶段 4：桌面独立窗口

### 任务 20：Electron petWindowManager

**文件：** 创建 `electron/petWindowManager.ts`

- [ ] **步骤 1：实现 petWindowManager**

```ts
// electron/petWindowManager.ts
import { BrowserWindow } from 'electron'
import { join } from 'path'
import { info, warn } from './logger'
import type { PetConfig, PetSyncPayload, PetWindowEvent } from '../src/types/pet'

export class PetWindowManager {
  private window: BrowserWindow | null = null
  private config: PetConfig | null = null

  async create(config: PetConfig): Promise<void> {
    if (this.window) {
      warn('PetWindowManager', 'Window already exists')
      return
    }

    this.config = config
    const { desktopWindow, settings } = config

    this.window = new BrowserWindow({
      x: desktopWindow.x,
      y: desktopWindow.y,
      width: desktopWindow.width,
      height: desktopWindow.height,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: settings.alwaysOnTopDesktop,
      skipTaskbar: true,
      hasShadow: false,
      focusable: !settings.clickThrough,
      webPreferences: {
        preload: join(__dirname, 'petPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    })

    this.window.setIgnoreMouseEvents(settings.clickThrough)

    if (process.env.NODE_ENV === 'development') {
      await this.window.loadURL('http://127.0.0.1:5173/pet-window.html')
    } else {
      await this.window.loadFile(join(__dirname, '../dist/pet-window.html'))
    }

    this.window.on('closed', () => {
      this.window = null
      info('PetWindowManager', 'Window closed')
    })

    info('PetWindowManager', 'Window created')
  }

  async destroy(): Promise<void> {
    if (this.window) {
      this.window.close()
      this.window = null
    }
  }

  async updateBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    this.window?.setBounds(bounds)
  }

  syncPetState(state: PetSyncPayload): void {
    if (!this.window) return
    this.window.webContents.send('petWindow:stateUpdate', state)
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    this.window?.setIgnoreMouseEvents(ignore)
  }

  setAlwaysOnTop(onTop: boolean): void {
    this.window?.setAlwaysOnTop(onTop)
  }

  handleWindowEvent(event: PetWindowEvent): void {
    if (!this.window || !this.config) return

    if (event.type === 'drag') {
      const [x, y] = this.window.getPosition()
      this.window.setPosition(x + event.deltaX, y + event.deltaY)
    } else if (event.type === 'drag-end') {
      const [x, y] = this.window.getPosition()
      this.config.desktopWindow.x = x
      this.config.desktopWindow.y = y
    }
  }

  isAlive(): boolean {
    return this.window !== null
  }
}
```

- [ ] **步骤 2：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add electron/petWindowManager.ts
git commit -m "feat(pet): 新增 petWindowManager 独立窗口管理"
```

---

### 任务 21：Electron petPreload（独立窗口 preload）

**文件：** 创建 `electron/petPreload.ts`

- [ ] **步骤 1：实现 petPreload**

```ts
// electron/petPreload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('petWindowAPI', {
  getInitialState: () => ipcRenderer.invoke('petWindow:getInitialState'),
  onStateUpdate: (handler: (state: any) => void) => {
    const wrapper = (_: unknown, data: any) => handler(data)
    ipcRenderer.on('petWindow:stateUpdate', wrapper)
    return () => ipcRenderer.removeListener('petWindow:stateUpdate', wrapper)
  },
  emitWindowEvent: (event: any) => ipcRenderer.send('petWindow:event', event),
  requestReaction: (req: any) => ipcRenderer.invoke('petWindow:requestReaction', req),
  getLocale: () => ipcRenderer.invoke('petWindow:getLocale'),
})
```

- [ ] **步骤 2：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add electron/petPreload.ts
git commit -m "feat(pet): 新增独立窗口 petPreload"
```

---

### 任务 22：更新 petIpcHandlers 支持窗口控制

**文件：** 修改 `electron/petIpcHandlers.ts`、`electron/main.ts`

- [ ] **步骤 1：更新 petIpcHandlers.ts**

在 `electron/petIpcHandlers.ts` 中：

1. 导入 PetWindowManager：
```ts
import { PetWindowManager } from './petWindowManager'
```

2. 更新 `PetIpcDeps` 接口：
```ts
export interface PetIpcDeps {
  petFileService: PetFileService
  petLLMProxy: PetLLMProxy
  petWindowManager: PetWindowManager
  getMainWindow: () => BrowserWindow | null
  getLocale: () => 'zh-CN' | 'en-US'
}
```

3. 在 `registerPetIpcHandlers` 函数内新增窗口控制 handlers：
```ts
// 独立窗口控制
ipcMain.handle('pet:createDesktopWindow', async () => {
  const config = deps.petFileService.getCachedConfig()
  if (config) {
    await deps.petWindowManager.create(config)
  }
})

ipcMain.handle('pet:destroyDesktopWindow', async () => {
  await deps.petWindowManager.destroy()
})

ipcMain.handle('pet:updateWindowBounds', async (_e, bounds) => {
  await deps.petWindowManager.updateBounds(bounds)
})

ipcMain.on('pet:syncPetState', (_e, state: PetSyncPayload) => {
  deps.petWindowManager.syncPetState(state)
})

// 独立窗口事件中继
ipcMain.on('petWindow:event', (_e, event: PetWindowEvent) => {
  deps.petWindowManager.handleWindowEvent(event)
  deps.getMainWindow()?.webContents.send('pet:windowEvent', event)
})

ipcMain.handle('petWindow:getInitialState', () => {
  return null  // 状态由主应用通过 syncPetState 推送
})
```

- [ ] **步骤 2：更新 main.ts 初始化 petWindowManager**

在 `electron/main.ts` 中：

1. 新增导入：
```ts
import { PetWindowManager } from './petWindowManager'
```

2. 在 `app.whenReady` 内更新初始化：
```ts
const petWindowManager = new PetWindowManager()

registerPetIpcHandlers({
  petFileService,
  petLLMProxy,
  petWindowManager,
  getMainWindow: () => mainWindow,
  getLocale: () => {
    try {
      const settings = loadGuiSettings()
      return settings?.language === 'en-US' ? 'en-US' : 'zh-CN'
    } catch {
      return 'zh-CN'
    }
  }
})
```

3. 在 `app.on('window-all-closed', ...)` 中新增销毁：
```ts
app.on('window-all-closed', () => {
  info('App', 'All windows closed')
  petWindowManager.destroy()
  destroyTray()
  app.quit()
})
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add electron/petIpcHandlers.ts electron/main.ts
git commit -m "feat(pet): 集成 petWindowManager 到 IPC 和主进程"
```

---

### 任务 23：更新 preload.ts 和 electron.d.ts 支持窗口控制

**文件：** 修改 `electron/preload.ts`、`src/types/electron.d.ts`

- [ ] **步骤 1：preload.ts 新增窗口控制方法**

在 `electron/preload.ts` 的 `pet` 命名空间内新增：
```ts
pet: {
  // ...现有方法...

  createDesktopWindow: () => ipcRenderer.invoke('pet:createDesktopWindow'),
  destroyDesktopWindow: () => ipcRenderer.invoke('pet:destroyDesktopWindow'),
  updateWindowBounds: (bounds: any) => ipcRenderer.invoke('pet:updateWindowBounds', bounds),
  syncPetState: (state: any) => ipcRenderer.send('pet:syncPetState', state),
},
```

- [ ] **步骤 2：electron.d.ts 更新 ElectronPetAPI**

在 `src/types/electron.d.ts` 的 `ElectronPetAPI` 接口中新增：
```ts
export interface ElectronPetAPI {
  // ...现有方法...

  createDesktopWindow: () => Promise<void>
  destroyDesktopWindow: () => Promise<void>
  updateWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  syncPetState: (state: PetSyncPayload) => void
}
```

- [ ] **步骤 3：更新 petApi 聚合层**

在 `src/services/api/pet.ts` 中新增：
```ts
createDesktopWindow: (): Promise<void> =>
  window.electronAPI!.pet.createDesktopWindow(),

destroyDesktopWindow: (): Promise<void> =>
  window.electronAPI!.pet.destroyDesktopWindow(),

updateWindowBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> =>
  window.electronAPI!.pet.updateWindowBounds(bounds),

syncPetState: (state: PetSyncPayload): void =>
  window.electronAPI!.pet.syncPetState(state),
```

- [ ] **步骤 4：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add electron/preload.ts src/types/electron.d.ts src/services/api/pet.ts
git commit -m "feat(pet): 扩展 API 支持独立窗口控制"
```

---

### 任务 24：更新 petStore 支持 desktop 模式

**文件：** 修改 `src/stores/pet.ts`

- [ ] **步骤 1：更新 petStore 的 setMode 和 syncToDesktopWindow**

在 `src/stores/pet.ts` 中：

1. 新增 `setMode` 函数：
```ts
async function setMode(newMode: PetMode): Promise<void> {
  if (!config.value) return
  const oldMode = config.value.mode
  config.value.mode = newMode
  await persist()

  if (newMode === 'desktop' && oldMode !== 'desktop') {
    await api.pet.createDesktopWindow()
    // 推送初始状态
    syncToDesktopWindow()
  } else if (newMode === 'embedded' && oldMode !== 'embedded') {
    await api.pet.destroyDesktopWindow()
  }
}
```

2. 新增 `syncToDesktopWindow` 函数：
```ts
function syncToDesktopWindow(): void {
  if (mode.value !== 'desktop' || !activePet.value || !config.value) return
  api.pet.syncPetState({
    pet: activePet.value,
    runtimeState: runtimeState.value,
    settings: config.value.settings,
    locale: getLocale()
  })
}
```

3. 在 `triggerReaction`、`triggerPetted`、`clearReaction` 末尾调用 `syncToDesktopWindow()`

4. 在 return 语句中导出 `setMode`

- [ ] **步骤 2：更新 PetSettings.vue 启用模式切换**

在 `src/components/settings/pet/PetSettings.vue` 中，更新 `toggleMode`：
```ts
async function toggleMode() {
  await petStore.setMode(mode.value === 'embedded' ? 'desktop' : 'embedded')
}
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：运行测试验证**

运行：`npx vitest run tests/stores/pet.test.ts`
预期：PASS（可能需要更新 mock）

- [ ] **步骤 5：Commit**

```bash
git add src/stores/pet.ts src/components/settings/pet/PetSettings.vue
git commit -m "feat(pet): petStore 支持 desktop 模式切换和状态同步"
```

---

### 任务 25：独立窗口渲染进程

**文件：** 创建 `src/pet-window/main.ts`、`src/pet-window/PetWindowApp.vue`、`src/pet-window/i18n.ts`、`src/pet-window/index.html`

- [ ] **步骤 1：创建 index.html**

```html
<!-- src/pet-window/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SpaceCode Pet</title>
</head>
<body>
  <div id="pet-window-root"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

- [ ] **步骤 2：创建 i18n.ts**

```ts
// src/pet-window/i18n.ts
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

export async function initPetWindowI18n(locale: 'zh-CN' | 'en-US') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: { 'zh-CN': zhCN, 'en-US': enUS },
  })
}
```

- [ ] **步骤 3：创建 PetWindowApp.vue**

```vue
<!-- src/pet-window/PetWindowApp.vue -->
<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { initPetWindowI18n } from './i18n'
import PetSprite from '@/components/pets/PetSprite.vue'
import PetReactionBubble from '@/components/pets/PetReactionBubble.vue'
import type { Pet, PetRuntimeState, PetSettings } from '@/types/pet'

const state = reactive<{
  pet: Pet | null
  reaction: string | null
  isPetted: boolean
  scale: number
  locale: 'zh-CN' | 'en-US'
}>({
  pet: null,
  reaction: null,
  isPetted: false,
  scale: 1,
  locale: 'zh-CN'
})

let isDragging = false
let startX = 0
let startY = 0

function onPointerDown(e: PointerEvent) {
  isDragging = true
  startX = e.screenX
  startY = e.screenY
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging) return
  const deltaX = e.screenX - startX
  const deltaY = e.screenY - startY
  startX = e.screenX
  startY = e.screenY
  window.petWindowAPI.emitWindowEvent({ type: 'drag', deltaX, deltaY })
}

function onPointerUp() {
  isDragging = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.petWindowAPI.emitWindowEvent({ type: 'drag-end' })
}

function onSpriteClick() {
  window.petWindowAPI.emitWindowEvent({ type: 'click' })
}

onMounted(async () => {
  state.locale = await window.petWindowAPI.getLocale()
  await initPetWindowI18n(state.locale)

  window.petWindowAPI.onStateUpdate((payload: any) => {
    state.pet = payload.pet
    state.reaction = payload.runtimeState.currentReaction
    state.isPetted = payload.runtimeState.isPetted
    state.scale = payload.settings.scale
    state.locale = payload.locale
  })
})
</script>

<template>
  <div class="pet-window-root" @pointerdown="onPointerDown">
    <PetReactionBubble v-if="state.pet" :text="state.reaction" />
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
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
  user-select: none;
  width: 100%;
  height: 100%;
}

.pet-window-root {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}

.pet-window-root:active {
  cursor: grabbing;
}
</style>
```

- [ ] **步骤 4：创建 main.ts**

```ts
// src/pet-window/main.ts
import { createApp } from 'vue'
import { initPetWindowI18n } from './i18n'
import PetWindowApp from './PetWindowApp.vue'

async function bootstrap() {
  const app = createApp(PetWindowApp)

  const locale = await window.petWindowAPI.getLocale()
  const i18n = await initPetWindowI18n(locale)
  app.use(i18n)

  app.mount('#pet-window-root')
}

bootstrap()
```

- [ ] **步骤 5：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/pet-window/
git commit -m "feat(pet): 新增独立窗口渲染进程"
```

---

### 任务 26：Vite 构建配置 + petWindowAPI 类型声明

**文件：** 修改 `vite.config.mts`、`src/types/electron.d.ts`

- [ ] **步骤 1：vite.config.mts 新增 pet-window 入口**

在 `vite.config.mts` 的 `build.rollupOptions` 中新增 input：

```ts
build: {
  outDir: 'dist',
  emptyOutDir: true,
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'index.html'),
      'pet-window': resolve(__dirname, 'src/pet-window/index.html'),
    },
    external: ['@mariozechner/pi-coding-agent'],
    output: {
      // ...现有 manualChunks...
    }
  }
}
```

- [ ] **步骤 2：electron.d.ts 新增 petWindowAPI 全局声明**

在 `src/types/electron.d.ts` 末尾（或新建 `src/types/pet-window.d.ts`）新增：

```ts
interface PetWindowAPI {
  getInitialState: () => Promise<any>
  onStateUpdate: (handler: (state: any) => void) => () => void
  emitWindowEvent: (event: any) => void
  requestReaction: (req: any) => Promise<string | null>
  getLocale: () => Promise<'zh-CN' | 'en-US'>
}

declare global {
  interface Window {
    petWindowAPI?: PetWindowAPI
  }
}
```

- [ ] **步骤 3：运行 typecheck 验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 4：运行 build 验证**

运行：`npm run build`
预期：PASS（生成 dist/pet-window.html）

- [ ] **步骤 5：运行 electron:build 验证**

运行：`npm run electron:build`
预期：PASS（生成 dist-electron/petPreload.js）

- [ ] **步骤 6：Commit**

```bash
git add vite.config.mts src/types/electron.d.ts
git commit -m "feat(pet): Vite 新增 pet-window 入口和全局类型声明"
```

---

### 任务 27：最终集成测试 + App.vue desktop 模式挂载

**文件：** 修改 `src/App.vue`，创建 `tests/integration/pet-system.test.ts`

- [ ] **步骤 1：App.vue 增加 desktop 模式同步**

在 `src/App.vue` 中：

1. 在 petStore 初始化后新增 watch 监听 mode 变化：
```ts
import { watch } from 'vue'

watch(() => petStore.mode, (newMode, oldMode) => {
  if (newMode === 'desktop' && oldMode === 'embedded') {
    // 切换到桌面模式时，embedded widget 自动隐藏（由 shouldShowEmbeddedPet 控制）
    // desktop 窗口已由 petStore.setMode 创建
  } else if (newMode === 'embedded' && oldMode === 'desktop') {
    // 切回嵌入模式，desktop 窗口已由 petStore.setMode 销毁
  }
})

// 监听 reaction 变化，同步到 desktop 窗口
watch(() => petStore.runtimeState.currentReaction, () => {
  if (petStore.mode === 'desktop') {
    petStore.syncToDesktopWindow()
  }
})
```

2. 更新 `shouldShowEmbeddedPet` computed：
```ts
const shouldShowEmbeddedPet = computed(() =>
  petStore.isInitialized &&
  petStore.activePet &&
  petStore.mode === 'embedded' &&
  !petStore.isMuted
)
```

- [ ] **步骤 2：编写集成测试**

```ts
// tests/integration/pet-system.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePetStore } from '@/stores/pet'

vi.mock('@/services/electronAPI', () => ({
  api: {
    pet: {
      readConfig: vi.fn().mockResolvedValue(null),
      writeConfig: vi.fn().mockResolvedValue(undefined),
      saveAsset: vi.fn().mockResolvedValue('buddy-pets-assets/test.png'),
      deleteAsset: vi.fn().mockResolvedValue(undefined),
      generateReaction: vi.fn().mockResolvedValue('AI 反应'),
      createDesktopWindow: vi.fn().mockResolvedValue(undefined),
      destroyDesktopWindow: vi.fn().mockResolvedValue(undefined),
      updateWindowBounds: vi.fn().mockResolvedValue(undefined),
      syncPetState: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
    }
  }
}))

describe('Pet System Integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('完整流程：初始化 → 选择宠物 → 触发反应 → 切换模式', async () => {
    const store = usePetStore()
    await store.init()
    expect(store.isInitialized).toBe(true)

    await store.setActivePet('builtin-duck')
    expect(store.activePet?.id).toBe('builtin-duck')

    store.triggerReaction('测试反应')
    expect(store.runtimeState.currentReaction).toBe('测试反应')

    await store.setMode('desktop')
    expect(store.mode).toBe('desktop')

    await store.setMode('embedded')
    expect(store.mode).toBe('embedded')
  })

  it('静音模式下不显示反应', async () => {
    const store = usePetStore()
    await store.init()
    await store.setActivePet('builtin-duck')
    await store.updateSettings({ muted: true })
    expect(store.isMuted).toBe(true)
  })

  it('自定义宠物创建和删除', async () => {
    const store = usePetStore()
    await store.init()

    await store.addCustomPet({
      id: 'custom-test',
      name: '测试宠物',
      personality: '测试性格',
      visual: { type: 'image', path: '', frameCount: 1 },
      presetReactions: {
        idle: ['测试'], typing: ['测试'],
        error: ['测试'], success: ['测试'], petted: ['测试']
      }
    }, '/fake/path.png')

    expect(store.allPets.find(p => p.id === 'custom-test')).toBeDefined()

    await store.removeCustomPet('custom-test')
    expect(store.allPets.find(p => p.id === 'custom-test')).toBeUndefined()
  })
})
```

- [ ] **步骤 3：运行集成测试**

运行：`npx vitest run tests/integration/pet-system.test.ts`
预期：PASS

- [ ] **步骤 4：运行完整测试套件**

运行：`npx vitest run`
预期：所有测试 PASS

- [ ] **步骤 5：运行 typecheck + build 最终验证**

运行：`npm run typecheck && npm run build`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/App.vue tests/integration/pet-system.test.ts
git commit -m "feat(pet): 完成桌面宠物系统集成测试和最终集成"
```

---

## 自检

### 1. 规格覆盖度

| 规格章节 | 实现任务 |
|---|---|
| 数据层（PetConfig, 独立配置文件） | 任务 1, 4 |
| 18 种内置宠物 | 任务 3 |
| 自定义宠物（上传图片） | 任务 17 (PetCreator) |
| 应用内嵌入模式 | 任务 9-15 |
| 桌面独立窗口模式 | 任务 20-26 |
| 双反应模式（预设 + LLM） | 任务 5, 10 |
| 设置页面 | 任务 16-18 |
| i18n 国际化 | 任务 16 |
| 上下文事件接入（typing/error/success） | 任务 19 |
| 主进程代理 LLM（避免 API key 暴露） | 任务 5 |

覆盖完整，无遗漏。

### 2. 占位符扫描

- 无 "TODO"、"待定"、"后续实现"
- 任务 18 的 `toggleMode` 留空注释已在任务 24 中实现，符合阶段性实现策略
- 所有代码步骤都有完整代码块

### 3. 类型一致性

- `PetConfig`、`Pet`、`PetSettings`、`PetRuntimeState`、`PetSyncPayload`、`PetWindowEvent`、`PetReactionRequest` 在任务 1 定义，后续任务使用一致
- `PetIpcDeps` 接口在任务 6 定义，任务 22 扩展（新增 `petWindowManager`）
- `ElectronPetAPI` 在任务 7 定义，任务 23 扩展（新增窗口控制方法）
- `petApi` 在任务 8 定义，任务 23 扩展
- `usePetStore` 在任务 9 定义，任务 24 扩展（新增 `setMode`、`syncToDesktopWindow`）

类型一致，无冲突。

---

## 执行交接

**计划已完成并保存到 `docs/superpowers/plans/2026-07-13-desktop-pet-system.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
