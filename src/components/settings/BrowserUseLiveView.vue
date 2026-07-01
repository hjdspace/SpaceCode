<template>
  <div class="browser-use-live">
    <!-- Toolbar -->
    <div class="bu-toolbar">
      <div class="bu-toolbar-left">
        <span class="bu-status-dot" :class="statusClass"></span>
        <span class="bu-status-text">{{ statusText }}</span>
      </div>
      <div class="bu-toolbar-center">
        <button class="bu-btn-icon" :disabled="!store.liveSnapshot" @click="goBack">
          <ChevronLeft :size="16" />
        </button>
        <button class="bu-btn-icon" :disabled="!store.liveSnapshot" @click="goForward">
          <ChevronRight :size="16" />
        </button>
        <button class="bu-btn-icon" :disabled="!store.liveSnapshot" @click="refreshView">
          <RefreshCw :size="14" :class="{ spinning: refreshing }" />
        </button>
        <input
          v-model="navUrl"
          class="bu-nav-input"
          type="text"
          :placeholder="t('browserUse.urlPlaceholder')"
          @keydown.enter="navigateToUrl"
        />
        <button class="bu-btn-icon bu-btn-go" @click="navigateToUrl">
          <ArrowRight :size="14" />
        </button>
      </div>
      <div class="bu-toolbar-right">
        <select v-model="zoomLevel" class="bu-zoom-select">
          <option value="1">100%</option>
          <option value="0.75">75%</option>
          <option value="0.5">50%</option>
        </select>
        <button v-if="store.isAgentRunning" class="bu-btn-icon bu-btn-stop" @click="stopAgent">
          <Square :size="14" />
        </button>
      </div>
    </div>

    <!-- URL Bar -->
    <div v-if="store.liveSnapshot" class="bu-url-bar">
      <Lock v-if="store.liveSnapshot.url.startsWith('https')" :size="12" class="bu-lock-icon" />
      <Globe v-else :size="12" class="bu-globe-icon" />
      <span class="bu-url-text">{{ store.liveSnapshot.url }}</span>
      <span v-if="store.liveSnapshot.title" class="bu-title-text">{{ store.liveSnapshot.title }}</span>
      <span v-if="store.isAgentRunning" class="bu-step-indicator">
        Step {{ store.liveSnapshot.currentStep }}/{{ store.liveSnapshot.totalSteps }}
      </span>
    </div>

    <!-- Browser Viewport -->
    <div class="bu-viewport" :style="{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }">
      <div v-if="store.liveSnapshot?.screenshot" class="bu-screenshot">
        <img :src="'data:image/png;base64,' + store.liveSnapshot.screenshot" alt="Browser screenshot" />
      </div>
      <div v-else class="bu-empty-viewport">
        <Monitor :size="48" class="bu-empty-icon" />
        <p v-if="!store.isInstalled">{{ t('browserUse.notInstalledHint') }}</p>
        <p v-else-if="!store.isAgentRunning">{{ t('browserUse.waitingForTask') }}</p>
        <p v-else>{{ t('browserUse.loadingPage') }}</p>
      </div>
    </div>

    <!-- Last Action -->
    <div v-if="store.liveSnapshot?.lastAction" class="bu-action-bar">
      <span class="bu-action-label">{{ t('browserUse.lastAction') }}:</span>
      <span class="bu-action-text">{{ store.liveSnapshot.lastAction }}</span>
    </div>

    <!-- Empty state (not installed) -->
    <div v-if="!store.isInstalled" class="bu-not-installed">
      <Monitor :size="32" class="bu-empty-icon" />
      <h3>{{ t('browserUse.setupRequired') }}</h3>
      <p>{{ t('browserUse.setupDescription') }}</p>
      <button class="s-btn s-btn-primary" @click="goToSettings">
        <Settings :size="14" />
        {{ t('browserUse.goToSettings') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronLeft, ChevronRight, RefreshCw, ArrowRight, Square,
  Lock, Globe, Monitor, Settings,
} from 'lucide-vue-next'
import { useBrowserUseStore } from '@/stores/browserUse'

const { t } = useI18n()
const store = useBrowserUseStore()

const navUrl = ref('')
const zoomLevel = ref('1')
const refreshing = ref(false)
const isLiveViewActive = ref(false)

const statusClass = computed(() => ({
  idle: 'bu-status-idle',
  running: 'bu-status-running',
  waiting_input: 'bu-status-waiting',
  error: 'bu-status-error',
})[store.liveSnapshot?.agentStatus || 'idle'])

const statusText = computed(() => {
  const status = store.liveSnapshot?.agentStatus || 'idle'
  const map: Record<string, string> = {
    idle: t('browserUse.statusIdle'),
    running: t('browserUse.statusRunning'),
    waiting_input: t('browserUse.statusWaiting'),
    error: t('browserUse.statusError'),
  }
  return map[status] || status
})

onMounted(() => {
  navUrl.value = store.liveSnapshot?.url || ''
  startLiveView()
})

onUnmounted(() => {
  stopLiveView()
})

function startLiveView() {
  isLiveViewActive.value = true
  store.startLiveView()
}

function stopLiveView() {
  isLiveViewActive.value = false
  store.stopLiveView()
}

async function goBack() {
  await store.callTool('navigate', { direction: 'back' })
  await store.refreshLiveSnapshot()
}

async function goForward() {
  await store.callTool('navigate', { direction: 'forward' })
  await store.refreshLiveSnapshot()
}

async function refreshView() {
  refreshing.value = true
  await store.refreshLiveSnapshot()
  refreshing.value = false
}

async function navigateToUrl() {
  if (!navUrl.value.trim()) return
  let url = navUrl.value.trim()
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
  }
  await store.callTool('navigate', { url })
  await store.refreshLiveSnapshot()
}

async function stopAgent() {
  await store.callTool('close_browser', {})
  store.liveSnapshot = null
}
</script>

<style scoped>
.browser-use-live {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary, #0e0e0e);
  border: 1px solid var(--border-color, #2a2a2a);
  border-radius: 8px;
  overflow: hidden;
}

/* Toolbar */
.bu-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-secondary, #141414);
  border-bottom: 1px solid var(--border-color, #2a2a2a);
  flex-wrap: wrap;
}

.bu-toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.bu-toolbar-center {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 200px;
}

.bu-toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.bu-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.bu-status-idle { background: #888; }
.bu-status-running { background: #4ade80; animation: pulse 1.5s infinite; }
.bu-status-waiting { background: #facc15; }
.bu-status-error { background: #f87171; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.bu-status-text {
  font-size: 12px;
  color: var(--text-muted, #aaa);
  white-space: nowrap;
}

.bu-btn-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  background: var(--bg-secondary, #1a1a1a);
  color: var(--text-muted, #aaa);
  cursor: pointer;
  transition: all .15s;
  flex-shrink: 0;
}

.bu-btn-icon:hover:not(:disabled) {
  background: var(--bg-hover, #252525);
  color: var(--text-primary, #e0e0e0);
}

.bu-btn-icon:disabled {
  opacity: .3;
  cursor: not-allowed;
}

.bu-btn-stop:hover { border-color: #f87171; color: #f87171; }
.bu-btn-go { border-color: var(--accent, #3b82f6); color: var(--accent, #3b82f6); }

.bu-nav-input {
  flex: 1;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #333);
  background: var(--bg-input, #111);
  color: var(--text-primary, #e0e0e0);
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  outline: none;
  min-width: 100px;
  height: 28px;
}

.bu-nav-input:focus {
  border-color: var(--accent, #3b82f6);
}

.bu-zoom-select {
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #333);
  background: var(--bg-secondary, #1a1a1a);
  color: var(--text-muted, #aaa);
  font-size: 11px;
  cursor: pointer;
  outline: none;
  height: 28px;
}

/* URL bar */
.bu-url-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--bg-tertiary, #111);
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-muted, #888);
  border-bottom: 1px solid var(--border-color, #1a1a1a);
  flex-wrap: wrap;
}

.bu-lock-icon { color: #4ade80; flex-shrink: 0; }
.bu-globe-icon { color: #60a5fa; flex-shrink: 0; }
.bu-url-text { color: var(--text-primary, #ccc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bu-title-text { color: var(--text-muted, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bu-step-indicator { margin-left: auto; color: var(--accent, #3b82f6); white-space: nowrap; }

/* Viewport */
.bu-viewport {
  flex: 1;
  min-height: 300px;
  background: var(--bg-tertiary, #111);
  overflow: auto;
  position: relative;
}

.bu-screenshot img {
  width: 100%;
  display: block;
}

.bu-empty-viewport {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  color: var(--text-muted, #555);
  gap: 10px;
}

.bu-empty-icon { opacity: .3; }

.bu-empty-viewport p {
  font-size: 14px;
  color: var(--text-muted, #666);
}

/* Action bar */
.bu-action-bar {
  padding: 6px 10px;
  background: var(--bg-secondary, #141414);
  border-top: 1px solid var(--border-color, #1a1a1a);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.bu-action-label { color: var(--text-muted, #888); white-space: nowrap; }
.bu-action-text { color: var(--text-primary, #ccc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Not installed */
.bu-not-installed {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 8px;
  color: var(--text-muted, #888);
}

.bu-not-installed h3 {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary, #e0e0e0);
}

.bu-not-installed p {
  font-size: 13px;
  margin-bottom: 12px;
}

.bu-not-installed .s-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  background: var(--accent, #3b82f6);
  color: #fff;
  transition: background .15s;
}
.bu-not-installed .s-btn:hover { background: #2563eb; }
</style>