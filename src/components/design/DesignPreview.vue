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
      <!--
        allow-scripts：预览本身就是网页，脚本是产品能力。
        allow-popups：外链新窗口；桥脚本被宿主 CSP 拦掉时，anchor target=_blank
        仍要能打开，去掉它会让既有外链彻底失效。弹窗已无法冒充预览帧 —— 宿主只
        接受来自本 iframe.contentWindow 且带本实例 nonce 的回传。
        不授予 allow-downloads：产物导出条在宿主的 DesignFileWorkspace 里，不依赖
        iframe 内下载；留下它只会让不可信页面往磁盘落文件。
      -->
      <iframe
        v-show="!showSource"
        ref="iframeRef"
        class="preview-iframe"
        sandbox="allow-scripts allow-popups"
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
import {
  PREVIEW_BRIDGE_READY_TIMEOUT_MS,
  PREVIEW_MSG_TRANSPORT,
  createPreviewNonce,
  parsePreviewOutbound,
} from '@/lib/artifacts/previewBridge';
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
/** 本实例的桥密钥；随每次 srcdoc 构建写进 frame 侧脚本，重挂载即换新 */
const bridgeNonce = createPreviewNonce();
/** frame 转移过来的端口；有端口才说明当前文档里的桥真的跑起来了 */
let transportPort: MessagePort | null = null;
/** 还没有通道时暂存的最新内容：ready 后一次补发，避免丢失流式 tick */
let pendingHtml: string | null = null;
/** 超时确认桥起不来（宿主 CSP 会拦内联桥脚本），退回整文档重载 */
let bridgeUnavailable = false;
let readyTimer: ReturnType<typeof setTimeout> | null = null;

// 文件变更监听已移至 DesignFileWorkspace.vue（始终挂载），
// DesignPreview 仅负责 iframe 渲染与沙箱消息桥接。
onMounted(() => {
  window.addEventListener('message', handleIframeMessage);
  // 条件渲染（source/preview 切换）后重挂载时 props 已有值，watch 不会再触发
  renderPreview();
});

onUnmounted(() => {
  window.removeEventListener('message', handleIframeMessage);
  resetBridge();
});

/**
 * frame → 宿主：先证来源（必须是本预览的 contentWindow），再验本实例密钥，
 * 最后按动作白名单分发。弹窗、同窗口其他 iframe（如 GenUI 卡片）与导航后的
 * 外来文档都在第一道闸门被丢掉；未知类型不会落到任何通用 IPC。
 */
function handleIframeMessage(event: MessageEvent) {
  // 预览服务器路径加载的是产物本身，里面没有我们的桥；此时任何回传都不该被处理
  // （也挡住切换模式后旧 srcdoc 文档迟到的 ready 接管端口）
  if (props.previewUrl) return;

  const iframe = iframeRef.value;
  if (!iframe || event.source !== iframe.contentWindow) return;

  const action = parsePreviewOutbound(event.data, bridgeNonce);
  if (!action) return;

  switch (action.type) {
    case 'ready':
      acceptTransport(event.ports[0]);
      break;
    case 'alert':
      api.showNotification({ title: '来自设计的提示', message: action.message });
      break;
    case 'confirm':
      console.log('Sandbox confirm blocked:', action.message);
      break;
    case 'open':
      // 外链只放行 http/https（parsePreviewOutbound 已过滤），用系统浏览器打开
      api.shell.openExternal(action.url);
      break;
    case 'error':
      console.error('Sandbox Script Error:', action.message, 'at', action.filename, ':', action.lineno);
      break;
  }
}

/** ready 带来新端口：接管它，并把等待期间的最新内容补发过去。 */
function acceptTransport(port: MessagePort | undefined) {
  if (!port) return;
  clearReadyTimer();
  bridgeUnavailable = false;
  transportPort?.close();
  transportPort = port;

  const latest = pendingHtml;
  pendingHtml = null;
  if (latest !== null) postTransport(latest);
}

/**
 * 通过端口注入整份文档。`document.write` 会让 frame 文档整体重建，frame 侧桥
 * 随之重跑并重新握手，所以这里立刻交出旧端口，等下一次 ready 再接管新的。
 */
function postTransport(html: string) {
  if (!transportPort) return;
  transportPort.postMessage({ type: PREVIEW_MSG_TRANSPORT, nonce: bridgeNonce, html });
  // 不能 close：刚投递的消息还在队列里，关闭端口会把它一起丢掉
  transportPort = null;
  armReadyTimer();
}

function armReadyTimer() {
  clearReadyTimer();
  if (bridgeUnavailable) return;
  readyTimer = setTimeout(() => {
    readyTimer = null;
    if (transportPort) return;
    // 超时仍没有 ready：桥脚本没跑起来（当前宿主 CSP 就会拦掉它）。
    // 退回整文档重载，宁可闪一下也不能让预览停在旧内容。
    bridgeUnavailable = true;
    const latest = pendingHtml;
    pendingHtml = null;
    if (latest !== null && iframeRef.value) iframeRef.value.srcdoc = latest;
  }, PREVIEW_BRIDGE_READY_TIMEOUT_MS);
}

function clearReadyTimer() {
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
}

function resetBridge() {
  clearReadyTimer();
  transportPort?.close();
  transportPort = null;
  pendingHtml = null;
  bridgeUnavailable = false;
}

/** 回退路径：无预览服务器时把 HTML 灌进 srcdoc，并尽量无闪烁地更新 */
function updateIframeContent(rawHtml: string) {
  const iframe = iframeRef.value;
  if (!iframe) return;

  const srcdocText = buildSrcdoc(rawHtml, {
    nonce: bridgeNonce,
    hostOrigin: window.location.origin,
  });

  if (!iframe.srcdoc) {
    // 首次加载
    iframe.srcdoc = srcdocText;
    armReadyTimer();
    return;
  }
  if (transportPort) {
    // 后续流式渲染：走 frame 转移过来的端口，document.write 局部替换，不重载不闪屏
    pendingHtml = null;
    postTransport(srcdocText);
    return;
  }
  if (bridgeUnavailable) {
    iframe.srcdoc = srcdocText;
    return;
  }
  // 桥还没开口（首次 ready 前 / 上一次注入后的重新握手）：缓存最新一版，ready 后补发
  pendingHtml = srcdocText;
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

  resetBridge();
  iframe.removeAttribute('srcdoc');
  // 同一 URL 重复赋值不会重新导航，先清空属性才强制重载
  iframe.removeAttribute('src');
  iframe.setAttribute('src', `${props.previewUrl}?rev=${props.reloadToken ?? 0}`);
}

watch(
  [() => props.previewUrl, () => props.reloadToken, () => props.html],
  renderPreview
);

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
