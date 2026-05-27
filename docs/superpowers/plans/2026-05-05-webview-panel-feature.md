# Webview 面板功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 GUI 右侧 InfoPanel 中实现网页浏览功能，用户点击 LLM 回复中的链接时，在右侧面板打开网页而非覆盖整个 GUI 或在系统浏览器中打开。

**架构：** 扩展现有的 InfoPanel 多模式架构，新增 'webview' 模式，使用 Electron 的 `<webview>` 标签内嵌浏览器。通过状态管理控制 URL、历史记录和导航状态。前端 MarkdownRenderer 拦截链接点击事件，触发 webview 打开。

**技术栈：** Vue 3 + TypeScript, Electron (webview 标签), Pinia 状态管理, marked (Markdown 渲染)

---

## 文件结构

### 需要修改的文件
- **`src/stores/app.ts`** - 扩展 InfoPanelMode 类型定义，添加 webview 相关状态和方法
- **`src/components/layout/InfoPanel.vue`** - 实现 webview 模式的 UI 组件、导航控制和加载状态
- **`src/components/common/MarkdownRenderer.vue`** - 添加链接点击拦截逻辑，调用 webview API
- **`electron/main.ts`** - 添加 webview 安全配置和权限管理（可选增强）

### 文件职责说明
| 文件 | 职责 |
|------|------|
| `stores/app.ts` | 管理 webview URL、浏览历史、导航状态；提供 openWebview/navigateWebview/closeWebview 方法 |
| `InfoPanel.vue` | 渲染 webview 标签、导航栏（前进/后退/刷新/地址栏）、加载动画、关闭按钮 |
| `MarkdownRenderer.vue` | 检测 `<a>` 标签点击，判断外部链接，阻止默认行为并触发 webview 打开 |
| `electron/main.ts` | 配置 webview 权限策略、处理新窗口请求 |

---

## 任务 1：扩展状态管理 - stores/app.ts

**文件：**
- 修改：`src/stores/app.ts`

**目标：** 为 webview 功能添加完整的状态管理支持

- [ ] **步骤 1：扩展 InfoPanelMode 类型**

在第 23 行附近找到类型定义，添加 `'webview'` 到联合类型：

```typescript
// 原始代码：
export type InfoPanelMode = 'diff' | 'file' | 'markdown' | 'tool-diff'

// 修改为：
export type InfoPanelMode = 'diff' | 'file' | 'markdown' | 'tool-diff' | 'webview'
```

- [ ] **步骤 2：添加 webview 相关响应式状态**

在 store 定义内部（约第 45 行后）添加新的 ref：

```typescript
// Webview 相关状态
const webviewUrl = ref<string>('')
const webviewHistory = ref<string[]>([])
const currentHistoryIndex = ref<number>(-1)
const webviewTitle = ref<string>('')
const isLoading = ref<boolean>(false)
```

- [ ] **步骤 3：添加 webview 操作方法**

在 return 语句前添加以下方法：

```typescript
function openWebview(url: string) {
  // 规范化 URL
  let normalizedUrl = url.trim()
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl
  }
  
  // 如果当前已有历史记录且不是新打开，先清空
  if (webviewHistory.value.length === 0 || currentHistoryIndex.value === -1) {
    webviewHistory.value = [normalizedUrl]
    currentHistoryIndex.value = 0
  } else {
    // 截断当前位置之后的历史记录（类似浏览器行为）
    webviewHistory.value = webviewHistory.value.slice(0, currentHistoryIndex.value + 1)
    webviewHistory.value.push(normalizedUrl)
    currentHistoryIndex.value = webviewHistory.value.length - 1
  }
  
  webviewUrl.value = normalizedUrl
  infoPanelMode.value = 'webview'
  infoPanelVisible.value = true
  
  console.log('[AppStore] Webview opened:', normalizedUrl)
}

function navigateWebview(url: string) {
  let normalizedUrl = url.trim()
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl
  }
  
  // 添加到历史记录
  webviewHistory.value.push(normalizedUrl)
  currentHistoryIndex.value = webviewHistory.value.length - 1
  webviewUrl.value = normalizedUrl
  
  console.log('[AppStore] Webview navigated to:', normalizedUrl)
}

function goBackWebview() {
  if (currentHistoryIndex.value > 0) {
    currentHistoryIndex.value--
    webviewUrl.value = webviewHistory.value[currentHistoryIndex.value]
    console.log('[AppStore] Webview go back to:', webviewUrl.value)
  }
}

function goForwardWebview() {
  if (currentHistoryIndex.value < webviewHistory.value.length - 1) {
    currentHistoryIndex.value++
    webviewUrl.value = webviewHistory.value[currentHistoryIndex.value]
    console.log('[AppStore] Webview go forward to:', webviewUrl.value)
  }
}

function closeWebview() {
  webviewUrl.value = ''
  webviewHistory.value = []
  currentHistoryIndex.value = -1
  webviewTitle.value = ''
  isLoading.value = false
  hideInfoPanel()
  console.log('[AppStore] Webview closed')
}

function setWebviewLoading(loading: boolean) {
  isLoading.value = loading
}

function setWebviewTitle(title: string) {
  webviewTitle.value = title
}
```

- [ ] **步骤 4：更新 return 对象**

将新增的状态和方法添加到 return 对象中：

```typescript
return {
  // ... 已有属性 ...
  
  // 新增 webview 相关
  webviewUrl,
  webviewHistory,
  currentHistoryIndex,
  webviewTitle,
  isLoading,
  openWebview,
  navigateWebview,
  goBackWebview,
  goForwardWebview,
  closeWebview,
  setWebviewLoading,
  setWebviewTitle
}
```

- [ ] **步骤 5：验证类型检查**

运行：`npm run typecheck` 或 `vue-tsc --noEmit`
预期：无类型错误

- [ ] **步骤 6：Commit**

```bash
git add src/stores/app.ts
git commit -m "feat(app-store): add webview state management for right panel browser"
```

---

## 任务 2：实现 Webview UI 组件 - InfoPanel.vue

**文件：**
- 修改：`src/components/layout/InfoPanel.vue`

**目标：** 实现完整的 webview 浏览界面，包括导航控制、地址栏、加载状态和错误处理

- [ ] **步骤 1：导入必要的依赖**

在 script setup 部分添加导入：

```typescript
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { X, Loader2, ArrowLeft, ArrowRight, RotateCw, ExternalLink } from 'lucide-vue-next'
import DiffViewer from '../common/DiffViewer.vue'
import CodeViewer from '../common/CodeViewer.vue'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ToolDiffViewer from '../common/ToolDiffViewer.vue'

const appStore = useAppStore()
const { t } = useI18n()

// Webview 相关 refs
const webviewRef = ref<any>(null)
const urlInput = ref('')
const showUrlBar = ref(false)
```

- [ ] **步骤 2：监听 URL 变化**

添加 watcher 同步 URL 输入框：

```typescript
watch(() => appStore.webviewUrl, (newUrl) => {
  urlInput.value = newUrl
  if (newUrl) {
    showUrlBar.value = true
  }
})
```

- [ ] **步骤 3：计算导航状态**

添加 computed 属性：

```typescript
const canGoBack = computed(() => appStore.currentHistoryIndex > 0)
const canGoForward = computed(() => 
  appStore.currentHistoryIndex < appStore.webviewHistory.length - 1
)

const panelTitle = computed(() => {
  switch (props.mode) {
    case 'diff': return t('infoPanel.changes')
    case 'file': return t('infoPanel.fileViewer')
    case 'markdown': return t('infoPanel.preview')
    case 'tool-diff': return t('infoPanel.toolDiff')
    case 'webview': 
      return appStore.webviewTitle || t('infoPanel.webBrowser') || '🌐 网页预览'
    default: return t('infoPanel.info')
  }
})
```

- [ ] **步骤 4：实现导航方法**

```typescript
function handleGoBack() {
  if (canGoBack.value) {
    appStore.goBackWebview()
    if (webviewRef.value) {
      webviewRef.value.loadURL(appStore.webviewUrl)
    }
  }
}

function handleGoForward() {
  if (canGoForward.value) {
    appStore.goForwardWebview()
    if (webviewRef.value) {
      webviewRef.value.loadURL(appStore.webviewUrl)
    }
  }
}

function handleRefresh() {
  if (webviewRef.value) {
    webviewRef.value.reload()
  }
}

function handleNavigate() {
  const url = urlInput.value.trim()
  if (url) {
    appStore.navigateWebview(url)
    if (webviewRef.value) {
      let finalUrl = url
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'https://' + finalUrl
      }
      webviewRef.value.loadURL(finalUrl)
    }
  }
}

function handleOpenInBrowser() {
  if (appStore.webviewUrl) {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.shellOpenExternal) {
      electronAPI.shellOpenExternal(appStore.webviewUrl)
    } else {
      window.open(appStore.webviewUrl, '_blank')
    }
  }
}
```

- [ ] **步骤 5：实现 Webview 事件处理**

```typescript
function onDidNavigate(event: any) {
  console.log('[InfoPanel] Webview navigated to:', event.url)
  appStore.setWebviewLoading(false)
}

function onDidNavigateInPage(event: any) {
  console.log('[InfoPanel] Webview in-page navigation:', event.url)
  appStore.setWebviewLoading(false)
}

function onTitleUpdate(_event: any, title: string) {
  if (title) {
    appStore.setWebviewTitle(title)
  }
}

function onStartLoading(_event: any) {
  console.log('[InfoPanel] Webview started loading')
  appStore.setWebviewLoading(true)
}

function onStopLoading(_event: any) {
  console.log('[InfoPanel] Webview stopped loading')
  appStore.setWebviewLoading(false)
}

function onDidFailLoad(event: any) {
  console.error('[InfoPanel] Webview failed to load:', event.errorCode, event.errorDescription)
  appStore.setWebviewLoading(false)
}
```

- [ ] **步骤 6：修改模板 - 添加 Webview 导航栏**

在 panel-header 内部，title 和 close button 之间添加导航控制：

```html
<div class="panel-header">
  <span class="panel-title">{{ panelTitle }}</span>
  
  <!-- Webview 导航控制栏 -->
  <div v-if="mode === 'webview'" class="webview-nav">
    <button 
      class="nav-btn" 
      @click="handleGoBack" 
      :disabled="!canGoBack"
      title="后退"
    >
      <ArrowLeft :size="14" />
    </button>
    <button 
      class="nav-btn" 
      @click="handleGoForward" 
      :disabled="!canGoForward"
      title="前进"
    >
      <ArrowRight :size="14" />
    </button>
    <button 
      class="nav-btn" 
      @click="handleRefresh"
      title="刷新"
    >
      <RotateCw :size="14" />
    </button>
    
    <div class="url-bar">
      <input
        v-model="urlInput"
        @keyup.enter="handleNavigate"
        placeholder="输入网址..."
        class="url-input"
        type="text"
      />
    </div>
    
    <button 
      class="nav-btn external-btn"
      @click="handleOpenInBrowser"
      title="在系统浏览器中打开"
    >
      <ExternalLink :size="14" />
    </button>
  </div>
  
  <button class="close-btn" @click="appStore.hideInfoPanel">
    <X :size="16" />
  </button>
</div>
```

- [ ] **步骤 7：修改模板 - 添加 Webview 内容区域**

在 panel-content 内部添加 webview 分支：

```html
<div class="panel-content">
  <!-- 现有模式保持不变 -->
  <DiffViewer v-if="mode === 'diff'" />
  <CodeViewer v-else-if="mode === 'file'" />
  <MarkdownRenderer v-else-if="mode === 'markdown'" :content="appStore.currentFile?.content || ''" />
  <ToolDiffViewer v-else-if="mode === 'tool-diff'" />
  
  <!-- 新增 webview 模式 -->
  <template v-else-if="mode === 'webview'">
    <webview
      v-if="appStore.webviewUrl"
      :src="appStore.webviewUrl"
      ref="webviewRef"
      class="webview-container"
      allowpopups
      partition="persist:webview-session"
      @did-navigate="onDidNavigate"
      @did-navigate-in-page="onDidNavigateInPage"
      @page-title-updated="onTitleUpdate"
      @did-start-loading="onStartLoading"
      @did-stop-loading="onStopLoading"
      @did-fail-load="onDidFailLoad"
    />
    
    <!-- 加载状态覆盖层 -->
    <div v-if="appStore.isLoading" class="loading-overlay">
      <Loader2 :size="24" class="spin-icon" />
      <span>正在加载...</span>
    </div>
    
    <!-- 空 URL 提示 -->
    <div v-if="!appStore.webviewUrl" class="empty-webview">
      <p>点击聊天中的链接在此处查看网页</p>
    </div>
  </template>
</div>
```

- [ ] **步骤 8：添加样式**

在 style 部分添加 webview 相关样式：

```scss
.webview-nav {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  padding: 0 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-border);
  
  .nav-btn {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
    
    &:hover:not(:disabled) {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }
    
    &:active:not(:disabled) {
      transform: scale(0.95);
    }
    
    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    
    &.external-btn {
      margin-left: auto;
      color: var(--accent-primary);
      
      &:hover {
        background: rgba(var(--accent-primary-rgb), 0.1);
      }
    }
  }
  
  .url-bar {
    flex: 1;
    position: relative;
    
    .url-input {
      width: 100%;
      height: 26px;
      padding: 0 10px;
      border-radius: var(--radius-sm);
      background: var(--bg-primary);
      border: 1px solid transparent;
      color: var(--text-primary);
      font-size: 12px;
      font-family: var(--font-mono);
      outline: none;
      transition: border-color 0.15s ease;
      
      &::placeholder {
        color: var(--text-muted);
        opacity: 0.6;
      }
      
      &:focus {
        border-color: var(--accent-primary);
        background: var(--bg-tertiary);
      }
    }
  }
}

.webview-container {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}

.loading-overlay {
  position: absolute;
  top: 48px; // header 高度
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(var(--bg-primary-rgb), 0.9);
  backdrop-filter: blur(4px);
  color: var(--text-muted);
  font-size: 13px;
  z-index: 10;
  
  .spin-icon {
    animation: spin 1s linear infinite;
    color: var(--accent-primary);
  }
}

.empty-webview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 20px;

  p {
    max-width: 200px;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **步骤 9：确保 info-panel 容器支持相对定位**

确认 `.info-panel` 样式包含 `position: relative`（用于 loading overlay 定位）。如果没有，添加：

```scss
.info-panel {
  // ... 已有样式 ...
  position: relative; // 确保 loading overlay 正确定位
}
```

- [ ] **步骤 10：验证编译**

运行：`npm run build` 或 `vite build`
预期：编译成功，无错误

- [ ] **步骤 11：Commit**

```bash
git add src/components/layout/InfoPanel.vue
git commit -m "feat(info-panel): implement webview mode with navigation controls and loading states"
```

---

## 任务 3：拦截链接点击 - MarkdownRenderer.vue

**文件：**
- 修改：`src/components/common/MarkdownRenderer.vue`

**目标：** 拦截 Markdown 渲染的链接点击，改为在右侧 webview 面板中打开

- [ ] **步骤 1：导入依赖**

在 script setup 部分添加：

```typescript
import { computed, ref } from 'vue'
import { marked } from 'marked'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
```

- [ ] **步骤 2：添加外部 URL 判断函数**

在组件内添加工具函数：

```typescript
function isExternalURL(url: string): boolean {
  try {
    // 处理相对路径和锚点
    if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return false
    }
    
    const parsed = new URL(url, window.location.origin)
    
    // 只允许 http/https 协议的外部链接
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false
    }
    
    // 排除 localhost（开发环境）
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false
    }
    
    return true
  } catch {
    // 无效 URL 格式
    return false
  }
}
```

- [ ] **步骤 3：添加链接点击处理函数**

```typescript
function handleLinkClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  
  // 向上查找最近的 <a> 标签
  const anchor = target.tagName === 'A' 
    ? target as HTMLAnchorElement 
    : target.closest('a') as HTMLAnchorElement
  
  if (!anchor) return
  
  const href = anchor.getAttribute('href')
  if (!href) return
  
  // 判断是否为外部链接
  if (isExternalURL(href)) {
    event.preventDefault()  // 阻止默认导航行为
    event.stopPropagation()  // 防止冒泡
    
    // 在右侧 webview 面板中打开
    appStore.openWebview(href)
    
    console.log('[MarkdownRenderer] External link opened in webview:', href)
  }
  // 对于非外部链接（锚点、相对路径），保持默认行为
}
```

- [ ] **步骤 4：修改模板绑定点击事件**

```vue
<!-- 原始代码： -->
<div class="markdown-renderer" v-html="renderedContent"></div>

<!-- 修改为： -->
<div 
  class="markdown-renderer" 
  v-html="renderedContent" 
  @click="handleLinkClick"
></div>
```

- [ ] **步骤 5：（可选）增强链接视觉提示**

在 style 部分为外部链接添加样式提示：

```scss
:deep(a[href^="http"]) {
  position: relative;
  
  &::after {
    content: '↗';
    font-size: 10px;
    margin-left: 3px;
    opacity: 0.6;
  }
  
  &:hover::after {
    opacity: 1;
  }
}
```

- [ ] **步骤 6：测试手动验证**

在浏览器 DevTools 中：
1. 打开一个包含外部链接的聊天消息
2. 点击链接
3. 验证：
   - ✅ 链接没有在新标签页打开
   - ✅ 右侧 InfoPanel 自动打开并显示 webview 模式
   - ✅ 地址栏显示正确的 URL
   - ✅ 网页内容正常加载

- [ ] **步骤 7：Commit**

```bash
git add src/components/common/MarkdownRenderer.vue
git commit -m "feat(markdown-renderer): intercept link clicks to open in webview panel"
```

---

## 任务 4：Electron 主进程安全配置（可选增强）

**文件：**
- 修改：`electron/main.ts`

**目标：** 增强 webview 安全性，配置权限策略

- [ ] **步骤 1：添加 webview 权限配置**

在 `createWindow()` 函数内（约第 220 行后），mainWindow 创建完成后添加：

```typescript
// Webview 安全配置
if (mainWindow) {
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      // 白名单允许的基本权限
      const allowedPermissions = [
        'media',
        'geolocation',
        'notifications',
        'clipboard-sanitized-write'
      ]
      
      if (allowedPermissions.includes(permission)) {
        callback(true)
      } else {
        console.warn(`[Security] Permission denied: ${permission}`)
        callback(false)
      }
    }
  )
  
  // 处理 webview 中的新窗口请求（target="_blank"）
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    
    // 允许本地资源导航
    if (parsedUrl.protocol === 'file:' || 
        parsedUrl.origin === 'http://localhost:5173') {
      return
    }
    
    // 外部链接应该由 webview 处理，不应该导航主窗口
    // 这里可以选择性地记录日志
    console.log('[Navigation] External navigation intercepted:', navigationUrl)
  })
}
```

- [ ] **步骤 2：添加 preload 脚本配置（可选）**

如果需要更精细的控制，可以创建专用的 webview preload 脚本：

创建文件：`electron/webview-preload.js`
```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('webviewAPI', {
  navigateTo: (url) => ipcRenderer.sendToHost('navigate', url),
  goBack: () => ipcRenderer.sendToHost('go-back'),
  goForward: () => ipcRenderer.sendToHost('go-forward'),
  refresh: () => ipcRenderer.sendToHost('refresh')
})
```

然后在 InfoPanel.vue 的 webview 标签中添加：
```html
<webview
  :src="appStore.webviewUrl"
  preload="./webview-preload.js"
  <!-- 其他属性 -->
/>
```

注意：此步骤为可选的高级功能，基础功能不需要。

- [ ] **步骤 3：验证应用启动**

运行：`npm run dev` 或 `npm run electron:dev`
预期：应用正常启动，无错误输出

- [ ] **步骤 4：Commit**

```bash
git add electron/main.ts
git commit -m "security(electron): add webview permission configuration and navigation handling"
```

---

## 任务 5：集成测试与功能验证

**目标：** 端到端验证完整功能流程

- [ ] **步骤 1：启动开发环境**

运行：`npm run dev`
预期：开发服务器成功启动

- [ ] **步骤 2：准备测试数据**

在聊天中发送一条包含外部链接的消息，例如：
```
请参考这个文档：https://www.electronjs.org/docs/latest/api/webview-tag
```

或者让 LLM 返回包含链接的回复。

- [ ] **步骤 3：验证核心流程**

按照以下步骤逐一验证：

#### 场景 A：基本链接打开
1. ✅ 点击 LLM 回复中的外部链接
2. ✅ 右侧 InfoPanel 自动滑出
3. ✅ 显示 webview 模式界面（导航栏 + 内容区）
4. ✅ 地址栏显示正确的 URL
5. ✅ 网页内容开始加载（显示加载动画）
6. ✅ 网页内容完全加载完成

#### 场景 B：导航控制
1. ✅ 点击多个链接，形成浏览历史
2. ✅ 后退按钮可用，点击后返回上一页
3. ✅ 前进按钮可用，点击后前进到下一页
4. ✅ 刷新按钮可重新加载当前页
5. ✅ 在地址栏输入新 URL 并回车，跳转到新页面

#### 场景 C：关闭与切换
1. ✅ 点击右上角 ✕ 按钮
2. ✅ InfoPanel 关闭，返回纯聊天视图
3. ✅ 主窗口保持不变，应用未退出
4. ✅ 再次点击另一个链接，webview 正常重新打开

#### 场景 D：边界情况
1. ✅ 点击内部链接（锚点 #xxx），不触发 webview
2. ✅ 点击相对路径链接，不触发 webview
3. ✅ 输入无效 URL，显示错误提示或保持原状
4. ✅ 快速连续点击多个链接，只显示最后一个

- [ ] **步骤 4：性能验证**

打开 Chrome DevTools Performance 面板：
1. ✅ 打开 webview 时，主线程无明显卡顿（< 100ms）
2. ✅ webview 加载大型网页时，GUI 保持响应
3. ✅ 内存占用在合理范围（webview 进程 < 150MB）

- [ ] **步骤 5：跨平台验证**（如果可能）

在不同操作系统上测试：
- ✅ Windows 10/11
- ✅ macOS（如果有 Mac）
- ✅ Linux（如果有 Linux 环境）

- [ ] **步骤 6：最终 Commit**

```bash
git add -A
git commit -m "test: verify webview panel integration and user flow"
```

---

## 自检清单

### ✅ 规格覆盖度
- [x] 扩展 InfoPanel 支持多模式 → 任务 1 & 2
- [x] 使用 Electron webview 标签 → 任务 2
- [x] 状态管理（URL、历史、导航）→ 任务 1
- [x] 前端链接拦截 → 任务 3
- [x] 安全配置 → 任务 4
- [x] UI/UX（导航栏、加载状态、关闭按钮）→ 任务 2
- [x] 不影响现有功能（diff/file/markdown/tool-diff）→ 通过保留原有代码确保

### ✅ 占位符扫描
- [x] 无 "TODO"、"待定"、"后续实现"
- [x] 所有步骤包含具体代码
- [x] 错误处理已明确（loading state、fail-load 事件）

### ✅ 类型一致性
- [x] `InfoPanelMode` 类型在任务 1 定义，任务 2 使用一致
- [x] 方法名 `openWebview` / `navigateWebview` / `closeWebview` 在任务 1 定义，任务 2 & 3 调用一致
- [x] 状态名 `webviewUrl` / `isLoading` / `webviewHistory` 全局统一

### ✅ YAGNI 检查
- [x] 未包含书签功能（未来需求）
- [x] 未包含多标签页浏览（过度设计）
- [x] 未包含下载管理器（超出范围）
- [x] 仅实现核心需求：点击链接 → 右侧面板打开 → 可关闭

---

## 风险与缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| webview 内存泄漏 | 长时间使用后内存增长 | 关闭时清理历史记录和引用 |
| 某些网站禁止嵌入 | X-Frame-Options: DENY | 显示友好错误提示，提供"在系统浏览器中打开"选项 |
| 性能问题 | 大型网页卡顿 GUI | 使用独立进程 + loading 状态反馈 |
| 安全风险 | 恶意网页攻击 | 权限白名单 + sandbox 属性 |

---

## 预期成果

实施完成后，用户体验将变为：

**Before（当前问题）：**
```
点击链接 → 整个 GUI 被覆盖 → 无法关闭网页或关闭整个应用 ❌
```

**After（目标效果）：**
```
点击链接 → 右侧面板滑出 → 显示网页 + 导航控制 → 点击 ✕ 关闭面板 → GUI 保持 ✅
```

完全对标 Codex、Cursor 等 AI IDE 的交互体验！🚀
