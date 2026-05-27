# 中英文切换功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 SpaceCode 桌面应用添加国际化支持，实现中英文切换功能，默认中文。

**架构：** 使用 vue-i18n 作为国际化框架，语言包按模块组织（common、settings、chat、sidebar、auth）。语言设置存储在 Pinia store 中并持久化到 localStorage。

**技术栈：** vue-i18n@9、Pinia、localStorage

---

## 文件清单

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/i18n/locales/zh-CN.ts` | 中文语言包 | 创建 |
| `src/i18n/locales/en-US.ts` | 英文语言包 | 创建 |
| `src/i18n/index.ts` | i18n 初始化配置 | 创建 |
| `src/stores/settings.ts` | 添加 language 状态和持久化 | 修改 |
| `src/components/settings/GeneralSettings.vue` | 添加语言选择器 UI | 修改 |
| `src/main.ts` | 引入 i18n 实例 | 修改 |
| `package.json` | 添加 vue-i18n 依赖 | 修改 |

---

## 任务 1：安装 vue-i18n 依赖

**文件：**
- 修改：`package.json`

- [ ] **步骤 1：安装 vue-i18n**

```bash
cd d:\AI\claude-code-gui
npm install vue-i18n@9
```

- [ ] **步骤 2：验证安装**

```bash
npm list vue-i18n
```

预期：显示 `vue-i18n@9.x.x`

---

## 任务 2：创建中文语言包

**文件：**
- 创建：`src/i18n/locales/zh-CN.ts`

- [ ] **步骤 1：创建目录结构**

```bash
mkdir -p d:\AI\claude-code-gui\src\i18n\locales
```

- [ ] **步骤 2：编写中文语言包**

```typescript
export default {
  // 通用
  common: {
    save: '保存',
    cancel: '取消',
    confirm: '确认',
    delete: '删除',
    edit: '编辑',
    close: '关闭',
    back: '返回',
    loading: '加载中...',
    copy: '复制',
    retry: '重试',
    send: '发送',
  },

  // 设置页面
  settings: {
    title: '设置',
    general: '通用',
    appearance: '外观',
    tools: '工具',
    mcp: 'MCP',
    shortcuts: '快捷键',
    language: '语言',
    languageDesc: '选择界面显示语言',
    loginMethod: '登录方式',
    unsavedChanges: '有未保存的更改',
    saveChanges: '保存更改',
    backToApp: '返回应用',
    theme: '主题',
    font: '字体',
    fontSize: '字体大小',
    fontFamily: '字体',
    codeFontFamily: '代码字体',
    density: '密度',
    editor: '编辑器',
    showLineNumbers: '显示行号',
    showLineNumbersDesc: '在代码编辑器中显示行号',
    wordWrap: '自动换行',
    wordWrapDesc: '长行自动换行以适应视口',
    minimap: '小地图',
    minimapDesc: '在代码编辑器中显示小地图',
  },

  // 聊天界面
  chat: {
    inputPlaceholder: '输入消息...',
    thinking: '思考中...',
    reasoning: '推理过程',
    tools: '工具调用',
    tasks: '任务列表',
    metadata: '元数据',
    copyCode: '复制代码',
    insertCode: '插入代码',
    applyCode: '应用代码',
  },

  // 侧边栏
  sidebar: {
    newChat: '新对话',
    history: '历史记录',
    settings: '设置',
    fileExplorer: '文件浏览器',
    terminal: '终端',
    mcpManager: 'MCP 管理器',
    skillsManager: '技能管理器',
  },

  // 登录方式
  auth: {
    anthropicCompatible: 'Anthropic 兼容',
    openaiCompatible: 'OpenAI 兼容',
    geminiApi: 'Gemini API',
    claudeAi: 'Claude.ai',
    console: '控制台',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    model: '模型',
    testConnection: '测试连接',
    fetchModels: '获取模型列表',
  },

  // 终端
  terminal: {
    title: '终端',
    clear: '清空',
    copyOutput: '复制输出',
  },

  // 文件树
  fileTree: {
    newFile: '新建文件',
    newFolder: '新建文件夹',
    rename: '重命名',
    delete: '删除',
    refresh: '刷新',
  },
}
```

---

## 任务 3：创建英文语言包

**文件：**
- 创建：`src/i18n/locales/en-US.ts`

- [ ] **步骤 1：编写英文语言包**

```typescript
export default {
  // Common
  common: {
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    back: 'Back',
    loading: 'Loading...',
    copy: 'Copy',
    retry: 'Retry',
    send: 'Send',
  },

  // Settings page
  settings: {
    title: 'Settings',
    general: 'General',
    appearance: 'Appearance',
    tools: 'Tools',
    mcp: 'MCP',
    shortcuts: 'Shortcuts',
    language: 'Language',
    languageDesc: 'Select interface language',
    loginMethod: 'Login Method',
    unsavedChanges: 'Unsaved changes',
    saveChanges: 'Save Changes',
    backToApp: 'Back to app',
    theme: 'Theme',
    font: 'Font',
    fontSize: 'Font Size',
    fontFamily: 'Font Family',
    codeFontFamily: 'Code Font Family',
    density: 'Density',
    editor: 'Editor',
    showLineNumbers: 'Show Line Numbers',
    showLineNumbersDesc: 'Display line numbers in code editor',
    wordWrap: 'Word Wrap',
    wordWrapDesc: 'Wrap long lines to fit the viewport',
    minimap: 'Minimap',
    minimapDesc: 'Show minimap in code editor',
  },

  // Chat interface
  chat: {
    inputPlaceholder: 'Type a message...',
    thinking: 'Thinking...',
    reasoning: 'Reasoning',
    tools: 'Tool Calls',
    tasks: 'Task List',
    metadata: 'Metadata',
    copyCode: 'Copy Code',
    insertCode: 'Insert Code',
    applyCode: 'Apply Code',
  },

  // Sidebar
  sidebar: {
    newChat: 'New Chat',
    history: 'History',
    settings: 'Settings',
    fileExplorer: 'File Explorer',
    terminal: 'Terminal',
    mcpManager: 'MCP Manager',
    skillsManager: 'Skills Manager',
  },

  // Auth methods
  auth: {
    anthropicCompatible: 'Anthropic Compatible',
    openaiCompatible: 'OpenAI Compatible',
    geminiApi: 'Gemini API',
    claudeAi: 'Claude.ai',
    console: 'Console',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    model: 'Model',
    testConnection: 'Test Connection',
    fetchModels: 'Fetch Models',
  },

  // Terminal
  terminal: {
    title: 'Terminal',
    clear: 'Clear',
    copyOutput: 'Copy Output',
  },

  // File tree
  fileTree: {
    newFile: 'New File',
    newFolder: 'New Folder',
    rename: 'Rename',
    delete: 'Delete',
    refresh: 'Refresh',
  },
}
```

---

## 任务 4：创建 i18n 初始化配置

**文件：**
- 创建：`src/i18n/index.ts`

- [ ] **步骤 1：编写 i18n 配置**

```typescript
import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

export type Locale = 'zh-CN' | 'en-US'

export const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

export const defaultLocale: Locale = 'zh-CN'

// 检测系统语言
export function detectSystemLanguage(): Locale {
  const lang = navigator.language.toLowerCase()
  if (lang.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en-US'
}

// 创建 i18n 实例
export function createI18nInstance(locale: Locale = defaultLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en-US',
    messages,
    globalInjection: true,
  })
}

// 默认导出 i18n 实例（使用默认语言）
export const i18n = createI18nInstance()

// 切换语言函数
export function setLocale(i18nInstance: ReturnType<typeof createI18n>, locale: Locale) {
  i18nInstance.global.locale.value = locale
}

export default i18n
```

---

## 任务 5：修改 settings store 添加语言状态

**文件：**
- 修改：`src/stores/settings.ts`

- [ ] **步骤 1：导入类型**

在文件顶部添加导入：

```typescript
import { type Locale, detectSystemLanguage } from '@/i18n'
```

- [ ] **步骤 2：在 AuthSettings 接口中添加 language 字段**

找到 `AuthSettings` 接口（约第 20 行），添加：

```typescript
export interface AuthSettings {
  authMethod: AuthMethod
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  oauthAccount: OAuthAccountInfo | null
  projectRoot: string
  thinkingEnabled?: boolean
  effortLevel?: 'low' | 'medium' | 'high' | 'max'
  language?: Locale  // 添加这一行
}
```

- [ ] **步骤 3：在 store 中添加 language ref**

找到 `useSettingsStore` 函数中的 ref 定义（约第 150 行），在 `thinkingEnabled` 之后添加：

```typescript
const language = ref<Locale>(
  (saved as any).language || detectSystemLanguage()
)
```

- [ ] **步骤 4：在 return 对象中添加 language**

找到 store 的 return 语句（约第 200 行），添加：

```typescript
return {
  authMethod,
  anthropicConfig,
  openaiConfig,
  geminiConfig,
  oauthAccount,
  projectRoot,
  effortLevel,
  thinkingEnabled,
  language,  // 添加这一行
  provider,
  // ... 其他已有属性
}
```

- [ ] **步骤 5：在 saveSettings 函数中添加 language 持久化**

找到 `saveSettings` 函数（约第 250 行），在保存逻辑中添加：

```typescript
function saveSettings() {
  const settings = {
    authMethod: authMethod.value,
    anthropicConfig: anthropicConfig.value,
    openaiConfig: openaiConfig.value,
    geminiConfig: geminiConfig.value,
    oauthAccount: oauthAccount.value,
    projectRoot: projectRoot.value,
    effortLevel: effortLevel.value,
    thinkingEnabled: thinkingEnabled.value,
    language: language.value,  // 添加这一行
  }
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}
```

---

## 任务 6：在 main.ts 中引入 i18n

**文件：**
- 修改：`src/main.ts`

- [ ] **步骤 1：读取当前语言设置并创建 i18n 实例**

读取文件内容后，在导入部分添加：

```typescript
import { createI18nInstance, type Locale } from './i18n'

// 从 localStorage 读取语言设置
const SETTINGS_STORAGE_KEY = 'claude_desktop_settings'
function getSavedLanguage(): Locale {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.language) {
        return parsed.language
      }
    }
  } catch (e) {
    console.error('[i18n] Failed to load saved language')
  }
  // 检测系统语言
  const lang = navigator.language.toLowerCase()
  return lang.startsWith('zh') ? 'zh-CN' : 'en-US'
}

const savedLanguage = getSavedLanguage()
const i18n = createI18nInstance(savedLanguage)
```

- [ ] **步骤 2：在 app.use() 中添加 i18n**

找到 `app.use()` 链式调用，添加：

```typescript
app.use(i18n)
```

---

## 任务 7：在 GeneralSettings.vue 中添加语言选择器

**文件：**
- 修改：`src/components/settings/GeneralSettings.vue`

- [ ] **步骤 1：在 template 中添加语言选择器**

在 `<div class="section-content">` 开始后的第一个位置（Login Method 之前）添加：

```vue
      <!-- Language Selection -->
      <div class="form-group">
        <label class="form-label">{{ $t('settings.language') }}</label>
        <div class="language-options">
          <button
            v-for="lang in languages"
            :key="lang.id"
            class="language-card"
            :class="{ active: currentLanguage === lang.id }"
            @click="selectLanguage(lang.id)"
          >
            <span class="language-flag">{{ lang.flag }}</span>
            <span class="language-name">{{ lang.name }}</span>
            <Check v-if="currentLanguage === lang.id" class="language-check" :size="16" />
          </button>
        </div>
        <span class="form-hint">{{ $t('settings.languageDesc') }}</span>
      </div>

      <div class="divider"></div>
```

- [ ] **步骤 2：在 script 中添加语言相关逻辑**

在 `import` 部分确保导入 Check：

```typescript
import { Check } from 'lucide-vue-next'
```

在 `setup` 函数中找到 `authMethod` 定义附近，添加：

```typescript
import { useI18n } from 'vue-i18n'
import type { Locale } from '@/i18n'

const { locale } = useI18n()

// 语言选项
const languages = [
  { id: 'zh-CN' as Locale, name: '简体中文', flag: '🇨🇳' },
  { id: 'en-US' as Locale, name: 'English', flag: '🇺🇸' },
]

// 当前语言
const currentLanguage = computed({
  get: () => locale.value as Locale,
  set: (val: Locale) => {
    locale.value = val
    settingsStore.language = val
    emit('change')
  }
})

// 选择语言
function selectLanguage(langId: Locale) {
  currentLanguage.value = langId
}
```

在 `return` 语句中添加：

```typescript
return {
  // ... 已有属性
  languages,
  currentLanguage,
  selectLanguage,
}
```

---

## 任务 8：添加语言选择器样式

**文件：**
- 修改：`src/components/settings/GeneralSettings.vue`

- [ ] **步骤 1：在 style 部分添加语言选择器样式**

在 `<style scoped>` 部分末尾添加：

```scss
.language-options {
  display: flex;
  gap: 12px;
}

.language-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--bg-tertiary);
  }

  &.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary-bg, rgba(59, 130, 246, 0.1));
  }
}

.language-flag {
  font-size: 20px;
}

.language-name {
  flex: 1;
  font-size: 14px;
  color: var(--text-primary);
}

.language-check {
  color: var(--accent-primary);
}
```

---

## 任务 9：将 SettingsPanel.vue 中的硬编码文本替换为 i18n

**文件：**
- 修改：`src/components/settings/SettingsPanel.vue`

- [ ] **步骤 1：替换标题和按钮文本**

找到以下文本并替换：

```vue
<!-- 替换前 -->
<span>Back to app</span>
<h1 class="settings-title">Settings</h1>

<!-- 替换后 -->
<span>{{ $t('settings.backToApp') }}</span>
<h1 class="settings-title">{{ $t('settings.title') }}</h1>
```

```vue
<!-- 替换前 -->
<span>Unsaved changes</span>
<button class="btn btn-secondary" @click="handleClose">Cancel</button>
{{ saving ? 'Saving...' : 'Save Changes' }}

<!-- 替换后 -->
<span>{{ $t('settings.unsavedChanges') }}</span>
<button class="btn btn-secondary" @click="handleClose">{{ $t('common.cancel') }}</button>
{{ saving ? $t('common.loading') : $t('settings.saveChanges') }}
```

- [ ] **步骤 2：替换导航菜单文本**

找到 `menuItems` 数组定义，替换为：

```typescript
const menuItems = computed(() => [
  { id: 'general', label: t('settings.general'), icon: Settings },
  { id: 'mcp', label: t('settings.mcp'), icon: Boxes },
  { id: 'tools', label: t('settings.tools'), icon: Wrench },
  { id: 'appearance', label: t('settings.appearance'), icon: Palette },
  { id: 'shortcuts', label: t('settings.shortcuts'), icon: Keyboard },
])
```

在 script setup 顶部添加：

```typescript
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
```

---

## 任务 10：运行类型检查验证

**文件：**
- 验证：整个项目

- [ ] **步骤 1：运行类型检查**

```bash
cd d:\AI\claude-code-gui
npm run typecheck
```

预期：无类型错误

- [ ] **步骤 2：修复任何类型错误**

如果出现类型错误，根据错误信息修复。

---

## 自检清单

- [ ] vue-i18n 已安装
- [ ] 中文语言包已创建
- [ ] 英文语言包已创建
- [ ] i18n 配置已创建
- [ ] settings store 已添加 language 状态
- [ ] main.ts 已引入 i18n
- [ ] GeneralSettings.vue 已添加语言选择器
- [ ] 样式已添加
- [ ] SettingsPanel.vue 硬编码文本已替换
- [ ] 类型检查通过

---

## 执行选项

**计划已完成并保存到 `docs/superpowers/plans/2026-05-03-i18n-implementation.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点供审查

**选哪种方式？**
