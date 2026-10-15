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
import { Monitor, RotateCw, Code2 } from 'lucide-vue-next';

const props = defineProps<{
  html: string;
  title: string;
  sessionId: string;
  /** 已登记预览工作区的 HTML 文件 URL（Electron 主进程 preview 服务器）；为空时回退 srcdoc */
  previewUrl?: string | null;
  /** 递增即强制重新导航：CSS/JS 变更后 HTML 内容没变，只有换 rev 才会重取兄弟资源 */
  reloadToken?: number;
}>();

const iframeRef = ref<HTMLIFrameElement>();
const showSource = ref(false);
let iframeReady = false;

// 文件变更监听已移至 DesignFileWorkspace.vue（始终挂载），
// DesignPreview 仅负责 iframe 渲染与沙箱消息桥接。
onMounted(() => {
  window.addEventListener('message', handleIframeMessage);
  // 条件渲染（source/preview 切换）后重挂载时 props 已有值，watch 不会再触发
  renderPreview();
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

/** 回退路径：无预览服务器时把 HTML 灌进 srcdoc，并尽量无闪烁地更新 */
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

/**
 * srcdoc 文档里相对 URL 相对宿主页面解析，多文件设计的 ./style.css 命不中产物目录；
 * 宿主 index.html 的 CSP 还会继承进 srcdoc 文档，`base-uri 'self'` 直接拦掉补 <base> 的路子。
 * 所以预览走本地预览服务器登记的真实 URL：相对资源天然同源命中同一工作区。
 */
function renderPreview() {
  const iframe = iframeRef.value;
  if (!iframe) return;

  if (!props.previewUrl) {
    if (props.html) updateIframeContent(props.html);
    return;
  }

  iframeReady = false;
  iframe.removeAttribute('srcdoc');
  // 同一 URL 重复赋值不会重新导航，先清空属性才强制重载
  iframe.removeAttribute('src');
  iframe.setAttribute('src', `${props.previewUrl}?rev=${props.reloadToken ?? 0}`);
}

watch(
  [() => props.previewUrl, () => props.reloadToken, () => props.html],
  renderPreview
);

function onIframeLoaded() {
  iframeReady = true;
}

function handleManualRefresh() {
  renderPreview();
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
  @include scrollbar-overlay;
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
