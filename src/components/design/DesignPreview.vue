<template>
  <div class="design-preview-container">
    <div class="preview-toolbar">
      <div class="toolbar-left">
        <Monitor :size="14" class="icon-active" />
        <span class="preview-title">{{ title || '实时设计预览' }}</span>
      </div>
      <div class="toolbar-right">
        <button class="icon-btn" title="强制刷新" @click="handleManualRefresh">
          <RotateCw :size="14" />
        </button>
        <button class="icon-btn" title="查看源码" @click="toggleViewSource">
          <Code2 :size="14" />
        </button>
      </div>
    </div>

    <div class="preview-viewport">
      <!-- 沙箱 Web 预览 iframe -->
      <iframe
        v-show="!showSource"
        ref="iframeRef"
        class="preview-iframe"
        sandbox="allow-scripts allow-popups allow-downloads"
        @load="onIframeLoaded"
      ></iframe>

      <!-- 源码阅读视图 -->
      <div v-if="showSource" class="source-view">
        <pre><code class="language-html">{{ html }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { buildSrcdoc } from '@/lib/artifacts/srcdoc';
import { api } from '@/services/electronAPI';
import { useDesignStore } from '@/stores/design';
import { Monitor, RotateCw, Code2 } from 'lucide-vue-next';

const props = defineProps<{
  html: string;
  title: string;
  sessionId: string;
}>();

const iframeRef = ref<HTMLIFrameElement>();
const showSource = ref(false);
const designStore = useDesignStore();
let iframeReady = false;

// 监听 Electron 主进程推过来的 Chokidar 文件变更通知 (热重载主路径)
onMounted(() => {
  window.addEventListener('message', handleIframeMessage);
  
  api.design.onFileChanged(async ({ sessionId, filepath }) => {
    if (sessionId !== props.sessionId) return;
    
    // 如果是 HTML 变动，拉取最新源码并刷新 iframe
    if (filepath.endsWith('.html')) {
      const code = await api.readFile(filepath);
      designStore.previewHtml = code;
      updateIframeContent(code);
      
      // 更新交付件列表
      const filename = filepath.split('/').pop() || 'index.html';
      const existing = designStore.artifactFiles.find(f => f.path === filepath);
      if (!existing) {
        designStore.artifactFiles.unshift({
          name: filename,
          path: filepath,
          updatedAt: Date.now()
        });
      } else {
        existing.updatedAt = Date.now();
      }
    }
  });
});

onUnmounted(() => {
  window.removeEventListener('message', handleIframeMessage);
});

// 处理 iframe 内 Bridges 回传的安全行为/微交互消息
function handleIframeMessage(event: MessageEvent) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'od:sandbox:ready':
      iframeReady = true;
      break;
    case 'od:sandbox:alert':
      api.showNotification({ title: '来自设计的提示', message: msg.message });
      break;
    case 'od:sandbox:confirm':
      console.log('Sandbox confirm blocked:', msg.message);
      break;
    case 'od:sandbox:open':
      // 拦截外跳，调用 Electron 用系统默认浏览器打开
      api.shell.openExternal(msg.url);
      break;
    case 'od:sandbox:error':
      console.error('Sandbox Script Error:', msg.message, 'at', msg.filename, ':', msg.lineno);
      break;
  }
}

// 无闪烁更新 iframe 内容
function updateIframeContent(rawHtml: string) {
  const iframe = iframeRef.value;
  if (!iframe) return;

  const srcdocText = buildSrcdoc(rawHtml);

  if (!iframe.srcdoc || !iframeReady) {
    // 首次加载
    iframe.srcdoc = srcdocText;
  } else {
    // 后续流式渲染传输：通过 postMessage 发给 iframe 内部的 Transport Activation Bridge，
    // 使用 document.write 动态更新，完全避开页面重载闪烁
    iframe.contentWindow?.postMessage(
      {
        type: 'od:srcdoc-transport-activate',
        html: srcdocText,
      },
      '*'
    );
  }
}

// 监听属性中的直接 HTML 传参 (作为 Fallback)
watch(() => props.html, (newHtml) => {
  if (newHtml) {
    updateIframeContent(newHtml);
  }
});

function onIframeLoaded() {
  iframeReady = true;
}

function handleManualRefresh() {
  if (props.html) {
    updateIframeContent(props.html);
  }
}

function toggleViewSource() {
  showSource.value = !showSource.value;
}
</script>

<style scoped lang="scss">
.design-preview-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  border-radius: var(--radius-md);
  overflow: hidden;
  background-color: var(--bg-primary);
  border: 1px solid var(--surface-border);
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 12px;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--surface-border);

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    
    .icon-active {
      color: var(--accent-primary);
    }

    .preview-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
    }
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }
}

.preview-viewport {
  flex: 1;
  position: relative;
  background-color: #ffffff; /* 强设白底，还原网页渲染真实环境 */
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.source-view {
  width: 100%;
  height: 100%;
  overflow: auto;
  background-color: #1e1e1e;
  color: #d4d4d4;
  padding: 16px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.5;

  pre {
    margin: 0;
  }
}
</style>
