# 更新日志功能 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 SpaceCode 桌面应用添加更新日志弹窗功能，新版本首次启动时自动弹出，关闭后可通过 TitleBar 版本号再次查看。

**架构：** 主进程新增 `changelog:getReleaseNotes` IPC handler，优先读取本地 `release-notes/` 目录的 md 文件，fallback 到 GitHub API。渲染进程通过 settings store 的 `lastViewedChangelogVersion` 字段判断是否需要弹窗，ChangelogModal 组件使用 marked 渲染 Markdown。

**技术栈：** Electron IPC、Vue 3、Pinia、marked（已有依赖）、lucide-vue-next

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `electron/autoUpdaterService.ts` | 新增 `changelog:getReleaseNotes` IPC handler |
| `electron/preload.ts` | 新增 `changelog` 命名空间暴露给渲染进程 |
| `src/services/electronAPI.ts` | 新增 `changelog` API 封装（判空 + fallback） |
| `src/stores/settings.ts` | 新增 `lastViewedChangelogVersion` 字段 |
| `src/components/common/ChangelogModal.vue` | 新建：更新日志弹窗组件 |
| `src/App.vue` | 挂载 ChangelogModal + onMounted 版本检测逻辑 |
| `src/components/layout/TitleBar.vue` | 版本号 badge 点击打开 ChangelogModal |
| `package.json` | extraResources 新增 release-notes 目录 |

---

### 任务 1：主进程 — 新增 changelog:getReleaseNotes IPC handler

**文件：**
- 修改：`electron/autoUpdaterService.ts:144-148`（在 `registerAutoUpdaterIPC` 函数末尾追加）

- [ ] **步骤 1：在 `registerAutoUpdaterIPC` 函数末尾添加 `changelog:getReleaseNotes` handler**

在 `electron/autoUpdaterService.ts` 的 `registerAutoUpdaterIPC()` 函数中，在 `app:getVersion` handler 之后添加：

```ts
  // 获取指定版本的更新日志
  ipcMain.handle('changelog:getReleaseNotes', async (_event, version: string) => {
    try {
      // 1. 尝试读取本地 release-notes/v{version}.md
      const fs = await import('fs/promises')
      const path = await import('path')
      const notesPath = app.isPackaged
        ? path.join(process.resourcesPath, 'release-notes', `v${version}.md`)
        : path.join(__dirname, '../release-notes', `v${version}.md`)

      try {
        const content = await fs.readFile(notesPath, 'utf-8')
        return { content, source: 'local' as const }
      } catch {
        // 本地文件不存在，尝试远程获取
      }

      // 2. Fallback: 从 GitHub Releases API 获取
      const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
      }
      if (GH_TOKEN) {
        headers['Authorization'] = `Bearer ${GH_TOKEN}`
      }

      const { net } = await import('electron')
      const request = net.request({
        url: `https://api.github.com/repos/hjdspace/SpaceCode/releases/tags/v${version}`,
        headers,
      })

      const body = await new Promise<string>((resolve, reject) => {
        let data = ''
        request.on('response', (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`GitHub API returned ${response.statusCode}`))
            return
          }
          response.on('data', (chunk) => { data += chunk.toString() })
          response.on('end', () => resolve(data))
        })
        request.on('error', reject)
        request.end()
      })

      const release = JSON.parse(body)
      if (release.body) {
        return { content: release.body, source: 'remote' as const }
      }

      return null
    } catch (err) {
      warn('Changelog', 'Failed to get release notes', err)
      return null
    }
  })
```

- [ ] **步骤 2：Commit**

```bash
git add electron/autoUpdaterService.ts
git commit -m "feat: add changelog:getReleaseNotes IPC handler"
```

---

### 任务 2：Preload — 新增 changelog 命名空间

**文件：**
- 修改：`electron/preload.ts:549-577`（在 `update` 命名空间之后、`getAppVersion` 之前添加）

- [ ] **步骤 1：在 preload.ts 中添加 changelog 命名空间**

在 `electron/preload.ts` 中，在 `update` 对象之后（约第 549 行 `},` 之后），`getAppVersion` 之前，添加：

```ts
  // Changelog API
  changelog: {
    getReleaseNotes: (version: string): Promise<{ content: string; source: 'local' | 'remote' } | null> =>
      ipcRenderer.invoke('changelog:getReleaseNotes', version),
  },
```

- [ ] **步骤 2：Commit**

```bash
git add electron/preload.ts
git commit -m "feat: expose changelog namespace in preload"
```

---

### 任务 3：渲染进程 — 新增 changelog API 封装

**文件：**
- 修改：`src/services/electronAPI.ts:567-575`（在 `update` 对象之后、`getAppVersion` 之前添加）

- [ ] **步骤 1：在 electronAPI.ts 中添加 changelog API 封装**

在 `src/services/electronAPI.ts` 中，在 `update` 对象的闭合 `},` 之后（约第 567 行），`getAppVersion` 之前，添加：

```ts
  // Changelog API
  changelog: {
    getReleaseNotes: (version: string): Promise<{ content: string; source: 'local' | 'remote' } | null> => {
      if (electronAPI?.changelog?.getReleaseNotes) {
        return electronAPI.changelog.getReleaseNotes(version)
      }
      return Promise.resolve(null)
    },
  },
```

- [ ] **步骤 2：Commit**

```bash
git add src/services/electronAPI.ts
git commit -m "feat: add changelog API wrapper in electronAPI"
```

---

### 任务 4：Settings Store — 新增 lastViewedChangelogVersion 字段

**文件：**
- 修改：`src/stores/settings.ts`

- [ ] **步骤 1：在 AuthSettings 接口中添加 lastViewedChangelogVersion**

在 `src/stores/settings.ts` 的 `AuthSettings` 接口中（约第 57 行 `installedCliPath?: string` 之后），添加：

```ts
  lastViewedChangelogVersion?: string
```

- [ ] **步骤 2：在 store 中添加 ref 和初始化**

在 `useSettingsStore` 函数中，在 `installedCliPath` ref 声明之后（约第 267 行），添加：

```ts
  const lastViewedChangelogVersion = ref<string | null>((saved as any).lastViewedChangelogVersion || null)
```

- [ ] **步骤 3：在 saveSettings 函数中持久化该字段**

在 `saveSettings()` 函数的 `data` 对象中（约第 429 行 `installedCliPath: installedCliPath.value ?? undefined` 之后），添加：

```ts
      lastViewedChangelogVersion: lastViewedChangelogVersion.value ?? undefined
```

- [ ] **步骤 4：在 applySettings 函数中处理该字段**

在 `applySettings()` 函数中（约第 474 行 `if (settings.installedCliPath !== undefined)` 之后），添加：

```ts
    if ((settings as any).lastViewedChangelogVersion !== undefined) lastViewedChangelogVersion.value = (settings as any).lastViewedChangelogVersion
```

- [ ] **步骤 5：在 return 中导出**

在 store 的 return 对象中，在 `setInstalledCliPath` 之后添加：

```ts
    lastViewedChangelogVersion,
```

- [ ] **步骤 6：Commit**

```bash
git add src/stores/settings.ts
git commit -m "feat: add lastViewedChangelogVersion to settings store"
```

---

### 任务 5：新建 ChangelogModal 组件

**文件：**
- 创建：`src/components/common/ChangelogModal.vue`

- [ ] **步骤 1：创建 ChangelogModal.vue**

```vue
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="changelog-overlay" @click.self="handleClose">
        <div class="changelog-modal">
          <div class="changelog-header">
            <h2 class="changelog-title">SpaceCode v{{ version }}</h2>
            <button class="changelog-close" @click="handleClose" :title="t('common.close')">
              <X :size="18" />
            </button>
          </div>
          <div class="changelog-body">
            <div v-if="loading" class="changelog-loading">
              <RefreshCw :size="24" class="spin-icon" />
              <span>{{ t('changelog.loading') }}</span>
            </div>
            <div v-else-if="error" class="changelog-error">
              <p>{{ t('changelog.loadFailed') }}</p>
              <p class="error-detail">{{ error }}</p>
            </div>
            <div v-else-if="content" class="changelog-content markdown-body" v-html="renderedContent"></div>
            <div v-else class="changelog-empty">
              <p>{{ t('changelog.noContent') }}</p>
            </div>
          </div>
          <div class="changelog-footer">
            <button class="changelog-btn" @click="handleClose">{{ t('common.close') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, RefreshCw } from 'lucide-vue-next'
import { marked } from 'marked'
import { api } from '@/services/electronAPI'

const props = defineProps<{
  visible: boolean
  version: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'close': []
}>()

const { t } = useI18n()
const content = ref<string | null>(null)
const source = ref<'local' | 'remote' | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const renderedContent = computed(() => {
  if (!content.value) return ''
  try {
    return marked(content.value)
  } catch {
    return content.value
  }
})

watch(() => props.visible, async (newVal) => {
  if (newVal && props.version) {
    await loadReleaseNotes()
  }
})

async function loadReleaseNotes() {
  loading.value = true
  error.value = null
  content.value = null

  try {
    const result = await api.changelog.getReleaseNotes(props.version)
    if (result) {
      content.value = result.content
      source.value = result.source
    } else {
      content.value = null
      source.value = null
    }
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

function handleClose() {
  emit('update:visible', false)
  emit('close')
}
</script>

<style lang="scss" scoped>
.changelog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.changelog-modal {
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: slideUp 0.2s ease;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.changelog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);

  .changelog-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .changelog-close {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    background: transparent;
    border: none;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }
}

.changelog-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-height: 120px;
}

.changelog-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 13px;

  .spin-icon {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.changelog-error {
  padding: 20px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;

  .error-detail {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.7;
  }
}

.changelog-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.changelog-content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);

  :deep(h2) {
    font-size: 15px;
    font-weight: 600;
    margin: 20px 0 8px;
    color: var(--text-primary);

    &:first-child {
      margin-top: 0;
    }
  }

  :deep(h3) {
    font-size: 14px;
    font-weight: 600;
    margin: 16px 0 6px;
    color: var(--text-primary);
  }

  :deep(p) {
    margin: 6px 0;
    color: var(--text-secondary);
  }

  :deep(ul) {
    margin: 6px 0;
    padding-left: 20px;
  }

  :deep(li) {
    margin: 4px 0;
    color: var(--text-secondary);
  }

  :deep(strong) {
    color: var(--text-primary);
    font-weight: 600;
  }

  :deep(a) {
    color: var(--accent-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(code) {
    background: var(--surface-border);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
    font-family: var(--font-mono);
  }
}

.changelog-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--surface-border);

  .changelog-btn {
    padding: 6px 16px;
    border-radius: var(--radius-md);
    background: var(--surface-border);
    border: none;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--transition-fast);

    &:hover {
      background: var(--surface-hover);
    }
  }
}

// Transition
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/common/ChangelogModal.vue
git commit -m "feat: create ChangelogModal component"
```

---

### 任务 6：App.vue — 挂载 ChangelogModal + 版本检测逻辑

**文件：**
- 修改：`src/App.vue`

- [ ] **步骤 1：导入 ChangelogModal 组件**

在 `src/App.vue` 的 `<script setup>` 中，在 `import ConnectMobileDialog` 之后（约第 67 行），添加：

```ts
import ChangelogModal from './components/common/ChangelogModal.vue'
```

- [ ] **步骤 2：添加 changelog 响应式状态**

在 `src/App.vue` 的 `<script setup>` 中，在 `useAutoUpdate()` 解构之后（约第 90 行），添加：

```ts
// Changelog
const showChangelog = ref(false)
const changelogVersion = ref('')
```

- [ ] **步骤 3：在 onMounted 中添加版本检测逻辑**

在 `src/App.vue` 的 `onMounted` 回调中，在 `window.addEventListener('open-mcp-manager', handleOpenMcpManager)` 之后（约第 232 行），添加：

```ts
  // 检测版本变化，自动弹出更新日志
  try {
    const currentVersion = await api.getAppVersion()
    if (currentVersion && currentVersion !== '0.0.0') {
      const lastViewed = settingsStore.lastViewedChangelogVersion
      if (lastViewed !== currentVersion) {
        changelogVersion.value = currentVersion
        showChangelog.value = true
      }
    }
  } catch {
    // 静默失败，不影响启动
  }
```

- [ ] **步骤 4：添加 ChangelogModal 关闭回调**

在 `onMounted` 之后添加 `handleChangelogClose` 函数：

```ts
function handleChangelogClose() {
  if (changelogVersion.value) {
    settingsStore.lastViewedChangelogVersion = changelogVersion.value
    settingsStore.saveSettings()
  }
}
```

- [ ] **步骤 5：在模板中挂载 ChangelogModal**

在 `src/App.vue` 的 `<template>` 中，在 `<ConnectMobileDialog>` 之后（约第 48 行），添加：

```html
    <ChangelogModal
      v-model:visible="showChangelog"
      :version="changelogVersion"
      @close="handleChangelogClose"
    />
```

- [ ] **步骤 6：Commit**

```bash
git add src/App.vue
git commit -m "feat: mount ChangelogModal with version detection in App.vue"
```

---

### 任务 7：TitleBar — 版本号 badge 点击打开 ChangelogModal

**文件：**
- 修改：`src/components/layout/TitleBar.vue`

- [ ] **步骤 1：修改 handleVersionClick 函数**

在 `src/components/layout/TitleBar.vue` 的 `<script setup>` 中，将 `handleVersionClick` 函数（约第 153-157 行）替换为：

```ts
function handleVersionClick() {
  if (hasUpdate.value) {
    downloadUpdate()
  } else {
    // 无更新时，点击版本号打开更新日志
    emit('openChangelog')
  }
}
```

- [ ] **步骤 2：添加 emit 定义**

在 `TitleBar.vue` 的 `<script setup>` 中，在 `const { t } = useI18n()` 之后添加：

```ts
const emit = defineEmits<{
  'openChangelog': []
}>()
```

- [ ] **步骤 3：修改版本号 badge 的 cursor 样式**

在 `TitleBar.vue` 的 `<style>` 中，找到 `.version-badge` 的样式（约第 471 行），将 `cursor: default` 改为：

```scss
    cursor: pointer;
```

并添加 hover 效果：

```scss
    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
```

- [ ] **步骤 4：在 App.vue 中监听 TitleBar 的 openChangelog 事件**

在 `src/App.vue` 的模板中，将 `<TitleBar />` 修改为：

```html
    <TitleBar @open-changelog="handleOpenChangelog" />
```

在 `src/App.vue` 的 `<script setup>` 中，在 `handleChangelogClose` 函数之后添加：

```ts
async function handleOpenChangelog() {
  const currentVersion = await api.getAppVersion()
  if (currentVersion && currentVersion !== '0.0.0') {
    changelogVersion.value = currentVersion
    showChangelog.value = true
  }
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/components/layout/TitleBar.vue src/App.vue
git commit -m "feat: open changelog from TitleBar version badge"
```

---

### 任务 8：package.json — extraResources 新增 release-notes

**文件：**
- 修改：`package.json:107-133`（extraResources 数组）

- [ ] **步骤 1：在 extraResources 数组末尾添加 release-notes 配置**

在 `package.json` 的 `build.extraResources` 数组中，在最后一个对象（`agents-lib`）之后添加：

```json
      ,
      {
        "from": "release-notes",
        "to": "release-notes"
      }
```

- [ ] **步骤 2：Commit**

```bash
git add package.json
git commit -m "feat: include release-notes in electron-builder extraResources"
```

---

### 任务 9：国际化 — 添加 changelog 相关翻译

**文件：**
- 修改：`src/i18n/locales/zh-CN.json`
- 修改：`src/i18n/locales/en-US.json`

- [ ] **步骤 1：在 zh-CN.json 中添加 changelog 翻译**

在 `zh-CN.json` 中找到合适位置添加：

```json
  "changelog": {
    "loading": "正在加载更新日志...",
    "loadFailed": "加载更新日志失败",
    "noContent": "暂无更新日志内容"
  }
```

- [ ] **步骤 2：在 en-US.json 中添加 changelog 翻译**

在 `en-US.json` 中找到合适位置添加：

```json
  "changelog": {
    "loading": "Loading changelog...",
    "loadFailed": "Failed to load changelog",
    "noContent": "No changelog content available"
  }
```

- [ ] **步骤 3：Commit**

```bash
git add src/i18n/locales/zh-CN.json src/i18n/locales/en-US.json
git commit -m "feat: add changelog i18n translations"
```
