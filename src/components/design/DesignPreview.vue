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
        allow-popups：外链新窗口；产物里 anchor target=_blank 仍要能打开，去掉它会让
        既有外链彻底失效。弹窗已无法冒充预览帧 —— 宿主只接受来自本 iframe.contentWindow
        且带本实例 nonce 的回传。
        allow-same-origin：只在预览 URL（spacecode-preview://）路径给。它是跨源专用源，
        拿不到宿主 DOM / 存储；module script、字体与同源 fetch 都需要保住这个 origin。
        协议响应头还会下发同一组 CSP sandbox，脚本即使删掉本属性也摘不掉顶层导航禁令。
        srcdoc 回退路径绝不给：那会与宿主同源。
        不授予 allow-downloads：产物导出条在宿主的 DesignFileWorkspace 里，不依赖
        iframe 内下载；留下它只会让不可信页面往磁盘落文件。
      -->
      <iframe
        v-show="!showSource"
        ref="iframeRef"
        class="preview-iframe"
        :sandbox="iframeSandbox"
      ></iframe>

      <!-- 源码阅读视图 -->
      <div v-if="showSource" class="source-view">
        <pre><code class="language-html">{{ html }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { buildSrcdoc } from '@/lib/artifacts/srcdoc';
import {
  PREVIEW_BRIDGE_READY_TIMEOUT_MS,
  PREVIEW_MSG_TRANSPORT,
  createPreviewNonce,
  parsePreviewOutbound,
} from '@/lib/artifacts/previewBridge';
import { PREVIEW_HOST_ORIGIN_PARAM, PREVIEW_NONCE_PARAM } from '@/shared/previewOrigin';
import { api } from '@/services/electronAPI';
import { Monitor, RotateCw, Code2 } from 'lucide-vue-next';

const props = defineProps<{
  html: string;
  title: string;
  sessionId: string;
  /** 预览专用源 URL（spacecode-preview://…）；为空时回退 srcdoc */
  previewUrl?: string | null;
  /** 递增即强制重新导航：CSS/JS 变更后 HTML 内容没变，只有换 rev 才会重取兄弟资源 */
  reloadToken?: number;
}>();

const iframeRef = ref<HTMLIFrameElement>();
const showSource = ref(false);
/** 本实例的桥密钥；随每次文档构建写进 frame 侧脚本，重挂载即换新 */
const bridgeNonce = createPreviewNonce();
/** frame 转移过来的端口；有端口才说明当前文档里的桥真的跑起来了 */
let transportPort: MessagePort | null = null;
/** 还没有通道时暂存的最新内容：ready 后一次补发，避免丢失流式 tick */
let pendingHtml: string | null = null;
/** 超时确认桥起不来（协议未注册 / 注入失败），退回重新导航 */
let bridgeUnavailable = false;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
/** 预览 URL 的强制重载计数：桥不可用时拼进 rev，保证同一 URL 真的重新取 */
const servedReload = ref(0);
/**
 * 发起当前导航时 props.html 的内容。切 tab 会让 previewUrl 与 html 同批更新，
 * 服务端文档已经是这份内容；ready 后不能再补发一次 document.write，否则首屏白渲染。
 */
let servedNavHtml: string | null = null;

/**
 * 专用源是跨源 origin，allow-same-origin 不会让它碰到宿主；srcdoc 会与宿主同源，
 * 必须继续排除。协议响应头的 CSP sandbox 是这两条路径共同的第二道锁。
 */
const iframeSandbox = computed(() =>
  props.previewUrl ? 'allow-scripts allow-same-origin allow-popups' : 'allow-scripts allow-popups'
);

// 文件变更监听已移至 DesignFileWorkspace.vue（始终挂载），
// DesignPreview 仅负责 iframe 渲染与沙箱消息桥接。
onMounted(() => {
  window.addEventListener('message', handleIframeMessage);
  // 条件渲染（source/preview 切换）后重挂载时 props 已有值，watch 不会再触发
  renderPreview();
});

onUnmounted(() => {
  window.removeEventListener('message', handleIframeMessage);
  closeTransport();
  bridgeUnavailable = false;
});

/**
 * frame → 宿主：先证来源（必须是本预览的 contentWindow），再验本实例密钥，
 * 最后按动作白名单分发。弹窗、同窗口其他 iframe（如 GenUI 卡片）与导航后的
 * 外来文档都在第一道闸门被丢掉；未知类型不会落到任何通用 IPC。
 *
 * 预览 URL 路径的桥由主进程注入（协议处理器读 URL 上的 nonce / host），
 * 与 srcdoc 路径共用同一套消息格式。
 */
function handleIframeMessage(event: MessageEvent) {
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
    // 超时仍没有 ready：桥脚本没跑起来。宁可重载，也不能让预览停在旧内容。
    bridgeUnavailable = true;
    const latest = pendingHtml;
    pendingHtml = null;
    if (props.previewUrl) {
      reloadServedPreview();
      return;
    }
    if (latest !== null && iframeRef.value) iframeRef.value.srcdoc = latest;
  }, PREVIEW_BRIDGE_READY_TIMEOUT_MS);
}

function clearReadyTimer() {
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
}

/** 关掉当前 frame 的通道；不影响 bridgeUnavailable（降级重载需要保留它）。 */
function closeTransport() {
  clearReadyTimer();
  transportPort?.close();
  transportPort = null;
  pendingHtml = null;
}

function bridgeOptions() {
  return { nonce: bridgeNonce, hostOrigin: window.location.origin };
}

function bridgedDocument(rawHtml: string): string {
  return buildSrcdoc(rawHtml, bridgeOptions());
}

/**
 * 预览 URL 额外带上本实例的桥参数：主进程据此给文档注入与宿主一致的 nonce。
 * rev 同时包含父层 reloadToken 与本地降级计数，换任一值都会强制重新导航。
 */
function previewFrameUrl(): string | null {
  if (!props.previewUrl) return null;
  const url = new URL(props.previewUrl);
  url.searchParams.set('rev', `${props.reloadToken ?? 0}.${servedReload.value}`);
  url.searchParams.set(PREVIEW_NONCE_PARAM, bridgeNonce);
  url.searchParams.set(PREVIEW_HOST_ORIGIN_PARAM, window.location.origin);
  return url.toString();
}

/** 首次加载 / 父层要求重新导航（CSS/JS 变更、手动刷新）。 */
function navigateServedPreview() {
  const iframe = iframeRef.value;
  const url = previewFrameUrl();
  if (!iframe || !url) return;

  closeTransport();
  bridgeUnavailable = false;
  servedNavHtml = props.html;
  iframe.removeAttribute('srcdoc');
  // 同一 URL 重复赋值不会重新导航，先清空属性才强制重载
  iframe.removeAttribute('src');
  iframe.setAttribute('src', url);
  armReadyTimer();
}

/** 桥确认不可用后的降级：换 rev 重新导航，至少保证内容继续更新。 */
function reloadServedPreview() {
  servedReload.value++;
  const iframe = iframeRef.value;
  const url = previewFrameUrl();
  if (!iframe || !url) return;

  closeTransport();
  servedNavHtml = props.html;
  iframe.removeAttribute('srcdoc');
  iframe.removeAttribute('src');
  iframe.setAttribute('src', url);
}

/**
 * 预览 URL 路径的内容更新：优先走 frame 转移过来的端口（document.write，
 * 文档 URL 不变，相对资源仍命中产物目录）；桥未开口时只留最新一版。
 */
function updateServedContent(rawHtml: string) {
  if (!rawHtml) return;
  // 导航时服务端文档已经是这份内容，不再补发（切 tab 时两个 prop 同批更新）
  if (!transportPort && !bridgeUnavailable && rawHtml === servedNavHtml) return;
  const nextDocument = bridgedDocument(rawHtml);
  if (transportPort) {
    postTransport(nextDocument);
    return;
  }
  if (bridgeUnavailable) {
    reloadServedPreview();
    return;
  }
  pendingHtml = nextDocument;
}

/** 回退路径：无预览专用源时把 HTML 灌进 srcdoc，并尽量无闪烁地更新 */
function updateIframeContent(rawHtml: string) {
  const iframe = iframeRef.value;
  if (!iframe) return;

  const srcdocText = bridgedDocument(rawHtml);

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
 * 所以桌面端走 `spacecode-preview://` 专用源：相对资源天然同源命中同一工作区，
 * 文档也有自己的策略，不再继承宿主 `script-src 'self'`。
 */
function renderPreview() {
  const iframe = iframeRef.value;
  if (!iframe) return;

  if (props.previewUrl) {
    navigateServedPreview();
    return;
  }

  closeTransport();
  bridgeUnavailable = false;
  iframe.removeAttribute('src');
  if (props.html) updateIframeContent(props.html);
}

watch(
  [() => props.previewUrl, () => props.reloadToken],
  renderPreview
);

watch(
  () => props.html,
  (html) => {
    if (props.previewUrl) updateServedContent(html);
    else updateIframeContent(html);
  }
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
