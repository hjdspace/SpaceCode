<template>
  <div class="im-settings">
    <!-- Page Header -->
    <div class="im-page-header">
      <h2 class="im-page-title">{{ $t('im.title') }}</h2>
      <p class="im-page-desc">{{ $t('im.description') }}</p>
    </div>

    <!-- Server Status Strip -->
    <div class="server-strip" :class="{ running: serverStatus.running }">
      <span class="server-dot" :class="{ running: serverStatus.running }"></span>
      <div class="server-info">
        <span class="server-label">
          {{ serverStatus.running ? $t('im.serverRunning') : $t('im.serverStopped') }}
        </span>
        <span v-if="serverStatus.running" class="server-meta">
          ws://127.0.0.1:{{ serverStatus.port }}<template v-if="serverStatus.pid"> · PID {{ serverStatus.pid }}</template>
        </span>
        <span v-else class="server-meta">{{ $t('im.serverStoppedHint') }}</span>
      </div>
      <button
        v-if="!serverStatus.running"
        class="im-btn im-btn-primary im-btn-sm"
        @click="startServer"
        :disabled="loading"
      >
        <Play :size="12" />
        {{ $t('im.startServer') }}
      </button>
      <button
        v-else
        class="im-btn im-btn-secondary im-btn-sm"
        @click="stopServer"
        :disabled="loading"
      >
        <Square :size="11" />
        {{ $t('im.stopServer') }}
      </button>
    </div>

    <!-- Platform Pills -->
    <div class="platform-pills">
      <button
        v-for="p in platforms"
        :key="p.id"
        class="platform-pill"
        :class="{ active: activePlatform === p.id }"
        @click="activePlatform = p.id"
      >
        <span
          v-if="adapterStatuses[p.id]?.running"
          class="platform-pill-dot"
        ></span>
        {{ p.label }}
      </button>
    </div>

    <!-- Unified Card: Platform Config -->
    <div class="unified-card">
      <div class="card-section">
        <div class="card-section-header">
          <div class="card-section-title">
            <div class="card-section-title-icon">
              <component :is="currentPlatformIcon" :size="13" />
            </div>
            {{ currentPlatformLabel }}
          </div>
          <span
            class="adapter-status-tag"
            :class="{ stopped: !adapterStatuses[activePlatform]?.running }"
          >
            {{ adapterStatuses[activePlatform]?.running ? $t('im.adapterRunning') : $t('im.adapterStopped') }}
          </span>
        </div>

        <!-- Telegram -->
        <div v-if="activePlatform === 'telegram'" class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('im.telegram.botToken') }}</label>
            <input
              type="password"
              class="form-input mono"
              v-model="config.telegram.botToken"
              :placeholder="$t('im.telegram.botTokenPlaceholder')"
            />
            <span class="form-hint">{{ $t('im.telegram.botTokenHint') }}</span>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('im.telegram.defaultWorkDir') }}</label>
            <input
              type="text"
              class="form-input mono"
              v-model="config.telegram.defaultWorkDir"
              :placeholder="$t('im.telegram.defaultWorkDirPlaceholder')"
            />
          </div>
        </div>

        <!-- Feishu -->
        <div v-if="activePlatform === 'feishu'" class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('im.feishu.appId') }}</label>
            <input type="text" class="form-input mono" v-model="config.feishu.appId" placeholder="cli_xxx" />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('im.feishu.appSecret') }}</label>
            <input type="password" class="form-input mono" v-model="config.feishu.appSecret" />
          </div>
          <div class="form-group full-width">
            <label class="form-label">{{ $t('im.feishu.defaultWorkDir') }}</label>
            <input type="text" class="form-input mono" v-model="config.feishu.defaultWorkDir" />
          </div>
        </div>

        <!-- DingTalk -->
        <div v-if="activePlatform === 'dingtalk'" class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('im.dingtalk.clientId') }}</label>
            <input type="text" class="form-input mono" v-model="config.dingtalk.clientId" />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('im.dingtalk.clientSecret') }}</label>
            <input type="password" class="form-input mono" v-model="config.dingtalk.clientSecret" />
          </div>
          <div class="form-group full-width">
            <label class="form-label">{{ $t('im.dingtalk.defaultWorkDir') }}</label>
            <input type="text" class="form-input mono" v-model="config.dingtalk.defaultWorkDir" />
          </div>
        </div>

        <!-- WeChat -->
        <div v-if="activePlatform === 'wechat'">
          <!-- QR Scanning State -->
          <div v-if="wechatScanning" class="wechat-qr-section">
            <div class="wechat-qr-canvas-wrapper">
              <canvas ref="wechatQrCanvas" class="wechat-qr-canvas"></canvas>
              <div v-if="wechatQrScanStatus === 'expired'" class="wechat-qr-overlay">
                <AlertCircle :size="32" />
                <span>{{ $t('im.wechat.qrExpired') }}</span>
                <button class="im-btn im-btn-primary im-btn-sm" @click="startWechatQrLogin">
                  <RefreshCw :size="12" />
                  {{ $t('im.wechat.refreshQr') }}
                </button>
              </div>
            </div>
            <div class="wechat-qr-status">
              <div v-if="wechatQrScanStatus === 'waiting'" class="wechat-qr-status-text">
                <QrCode :size="16" />
                {{ $t('im.wechat.qrWaiting') }}
              </div>
              <div v-else-if="wechatQrScanStatus === 'scanned'" class="wechat-qr-status-text scanned">
                <CheckCircle2 :size="16" />
                {{ $t('im.wechat.qrScanned') }}
              </div>
              <div v-else-if="wechatQrScanStatus === 'expired'" class="wechat-qr-status-text expired">
                <AlertCircle :size="16" />
                {{ $t('im.wechat.qrExpired') }}
              </div>
              <button class="im-btn im-btn-secondary im-btn-sm" @click="cancelWechatQrLogin">
                <X :size="11" />
                {{ $t('common.cancel') }}
              </button>
            </div>
            <div v-if="wechatQrError" class="wechat-qr-error">{{ wechatQrError }}</div>
          </div>

          <!-- Bound State -->
          <div v-else-if="wechatBound" class="wechat-bound-section">
            <div class="wechat-bound-info">
              <div class="wechat-bound-icon">
                <CheckCircle2 :size="20" />
              </div>
              <div class="wechat-bound-text">
                <div class="wechat-bound-title">{{ $t('im.wechat.boundTitle') }}</div>
                <div class="wechat-bound-id">{{ config.wechat.accountId }}</div>
              </div>
            </div>
            <div class="wechat-bound-actions">
              <button class="im-btn im-btn-secondary im-btn-sm" @click="startWechatQrLogin" :disabled="loading">
                <RefreshCw :size="11" />
                {{ $t('im.wechat.rescan') }}
              </button>
              <button class="im-btn im-btn-danger-outline im-btn-sm" @click="unbindWechat" :disabled="loading">
                <Trash2 :size="11" />
                {{ $t('im.wechat.unbind') }}
              </button>
            </div>
          </div>

          <!-- WeChat Adapter Status (visible when bound) -->
          <div v-if="wechatBound" class="wechat-adapter-status">
            <div v-if="adapterStatuses['wechat']?.running" class="wechat-adapter-running">
              <span class="wechat-adapter-dot running"></span>
              <span>{{ $t('im.wechat.adapterRunning') }}</span>
            </div>
            <div v-else class="wechat-adapter-stopped">
              <span class="wechat-adapter-dot stopped"></span>
              <span>{{ $t('im.wechat.adapterStopped') }}</span>
              <button
                v-if="serverStatus.running"
                class="im-btn im-btn-primary im-btn-sm"
                @click="startAdapter('wechat')"
                :disabled="loading"
              >
                <Play :size="11" />
                {{ $t('im.startAdapter') }}
              </button>
              <span v-else class="wechat-adapter-hint">{{ $t('im.wechat.startServerFirst') }}</span>
            </div>
          </div>

          <!-- Unbound State -->
          <div v-else class="wechat-unbound-section">
            <div class="wechat-unbound-hero">
              <div class="wechat-unbound-icon">
                <QrCode :size="32" />
              </div>
              <div class="wechat-unbound-text">
                <div class="wechat-unbound-title">{{ $t('im.wechat.scanToBind') }}</div>
                <div class="wechat-unbound-desc">{{ $t('im.wechat.scanToBindDesc') }}</div>
              </div>
              <button class="im-btn im-btn-primary" @click="startWechatQrLogin" :disabled="loading">
                <QrCode :size="14" />
                {{ $t('im.wechat.startScan') }}
              </button>
            </div>

            <!-- Manual Config Collapsible -->
            <button class="wechat-manual-toggle" @click="wechatManualExpanded = !wechatManualExpanded">
              <ChevronRight :size="14" class="wechat-manual-chevron" :class="{ expanded: wechatManualExpanded }" />
              <span>{{ $t('im.wechat.manualConfig') }}</span>
            </button>
            <Transition name="guide-collapse">
              <div v-show="wechatManualExpanded" class="wechat-manual-body">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">{{ $t('im.wechat.accountId') }}</label>
                    <input type="text" class="form-input mono" v-model="config.wechat.accountId" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">{{ $t('im.wechat.botToken') }}</label>
                    <input type="password" class="form-input mono" v-model="config.wechat.botToken" />
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Default Work Dir (always visible for wechat) -->
          <div class="form-row" style="margin-top: 14px;">
            <div class="form-group full-width">
              <label class="form-label">{{ $t('im.wechat.defaultWorkDir') }}</label>
              <input type="text" class="form-input mono" v-model="config.wechat.defaultWorkDir" />
            </div>
          </div>
        </div>

        <!-- WhatsApp -->
        <div v-if="activePlatform === 'whatsapp'" class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('im.whatsapp.accountJid') }}</label>
            <input type="text" class="form-input mono" v-model="config.whatsapp.accountJid" placeholder="xxx@s.whatsapp.net" />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('im.whatsapp.defaultWorkDir') }}</label>
            <input type="text" class="form-input mono" v-model="config.whatsapp.defaultWorkDir" />
          </div>
        </div>

        <!-- Form Footer -->
        <div class="form-footer">
          <button
            v-if="adapterStatuses[activePlatform]?.running"
            class="im-btn im-btn-danger-outline im-btn-sm"
            @click="stopAdapter(activePlatform)"
            :disabled="loading"
          >
            <Square :size="11" />
            {{ $t('im.stopAdapter') }}
          </button>
          <button
            v-else
            class="im-btn im-btn-secondary im-btn-sm"
            @click="startAdapter(activePlatform)"
            :disabled="loading || !serverStatus.running || !isCurrentPlatformConfigured"
          >
            <Play :size="11" />
            {{ $t('im.startAdapter') }}
          </button>
          <span v-if="!isCurrentPlatformConfigured" class="form-hint config-warn">
            {{ $t('im.fillRequiredFields') }}
          </span>
          <button
            class="im-btn im-btn-primary im-btn-sm"
            @click="saveConfig"
            :disabled="loading"
          >
            <Save :size="12" />
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Unified Card: Pairing -->
    <div class="unified-card">
      <div class="card-section">
        <div class="card-section-header">
          <div class="card-section-title">
            <div class="card-section-title-icon">
              <KeyRound :size="13" />
            </div>
            {{ $t('im.pairing.title') }}
          </div>
        </div>

        <!-- Pairing Code Display -->
        <div v-if="pairingCode" class="pairing-display">
          <div class="pairing-code-block">
            <div class="pairing-code-text">{{ pairingCode }}</div>
            <div class="pairing-code-label">{{ $t('im.pairing.codeLabel') }}</div>
          </div>
          <div class="pairing-info-block">
            <div v-if="pairingExpiresAt" class="pairing-expiry-row">
              <Clock :size="13" class="pairing-expiry-icon" />
              <span>{{ $t('im.pairing.expiresIn') }}: {{ formatExpiry(pairingExpiresAt) }}</span>
            </div>
            <div class="pairing-actions">
              <button
                class="im-btn im-btn-secondary im-btn-sm"
                @click="generatePairingCode"
                :disabled="loading"
              >
                <KeyRound :size="11" />
                {{ $t('im.pairing.regenerate') }}
              </button>
              <button class="im-btn im-btn-secondary im-btn-sm" @click="clearPairingCode">
                <X :size="11" />
                {{ $t('im.pairing.clear') }}
              </button>
            </div>
          </div>
        </div>

        <!-- No Pairing Code -->
        <div v-else class="pairing-empty">
          <button
            class="im-btn im-btn-primary im-btn-sm"
            @click="generatePairingCode"
            :disabled="loading"
          >
            <KeyRound :size="12" />
            {{ $t('im.pairing.generate') }}
          </button>
        </div>

        <!-- Paired Users -->
        <div v-if="pairedUsers.length > 0" class="paired-list">
          <div class="paired-list-title">{{ $t('im.pairing.pairedUsers') }}</div>
          <div v-for="user in pairedUsers" :key="user.userId" class="paired-row">
            <div class="paired-row-info">
              <div class="paired-avatar">
                {{ (user.displayName || user.userId).charAt(0).toUpperCase() }}
              </div>
              <div>
                <div class="paired-name">{{ user.displayName || user.userId }}</div>
                <div class="paired-id">{{ user.userId }}</div>
              </div>
            </div>
            <div class="paired-row-right">
              <span v-if="user.pairedAt" class="paired-time">{{ formatDate(user.pairedAt) }}</span>
              <button
                class="im-btn-icon danger"
                @click="removePairedUser(user.userId)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Unified Card: Default Dir -->
    <div class="unified-card">
      <div class="card-section">
        <div class="card-section-header">
          <div class="card-section-title">
            <div class="card-section-title-icon">
              <FolderOpen :size="13" />
            </div>
            {{ $t('im.defaultProjectDir') }}
          </div>
        </div>

        <div class="dir-inline">
          <input
            type="text"
            class="dir-inline-input"
            v-model="config.defaultProjectDir"
            :placeholder="$t('im.defaultProjectDirPlaceholder')"
          />
          <button class="im-btn im-btn-secondary im-btn-sm" @click="browseDir">
            <FolderOpen :size="12" />
            {{ $t('im.browse') }}
          </button>
        </div>
        <span class="form-hint dir-hint">{{ $t('im.defaultProjectDirHint') }}</span>
      </div>
    </div>

    <!-- Setup Guide -->
    <div class="unified-card guide-card">
      <button class="guide-toggle" @click="guideExpanded = !guideExpanded">
        <div class="guide-toggle-left">
          <div class="card-section-title-icon">
            <BookOpen :size="13" />
          </div>
          <div class="guide-toggle-text">
            <span class="guide-toggle-title">{{ $t('im.setupGuide') }}</span>
            <span class="guide-toggle-hint">{{ currentPlatformLabel }} · {{ $t('im.setupGuideHint') }}</span>
          </div>
        </div>
        <ChevronDown :size="16" class="guide-chevron" :class="{ expanded: guideExpanded }" />
      </button>
      <Transition name="guide-collapse">
        <div v-show="guideExpanded" class="guide-body">
          <div class="guide-content" v-html="renderedGuide"></div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  Play, Square, Save, KeyRound, X, Trash2, Clock, FolderOpen,
  BookOpen, ChevronDown,
  MessageCircle, Mail, Bell, Smartphone, Phone,
  QrCode, CheckCircle2, AlertCircle, RefreshCw, ChevronRight,
} from 'lucide-vue-next'
import QRCode from 'qrcode'
import { errorHandler } from '@/services/errorHandler'

// Markdown docs imported at build time via Vite ?raw
import telegramDoc from '@/../docs/im/telegram.md?raw'
import feishuDoc from '@/../docs/im/feishu.md?raw'
import dingtalkDoc from '@/../docs/im/dingtalk.md?raw'
import wechatDoc from '@/../docs/im/wechat.md?raw'
import whatsappDoc from '@/../docs/im/whatsapp.md?raw'

const { t } = useI18n()

// ────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────

interface SidecarStatus {
  running: boolean
  pid?: number
  port?: number
  healthy?: boolean
  startedAt?: number
}

interface PairedUser {
  userId: string
  displayName?: string
  pairedAt: number
}

interface AdapterConfig {
  serverUrl: string
  defaultProjectDir: string
  pairing: { code: string | null; expiresAt: number | null; createdAt: number | null }
  telegram: { botToken: string; allowedUsers: string[]; pairedUsers: PairedUser[]; defaultWorkDir: string }
  feishu: { appId: string; appSecret: string; allowedUsers: string[]; pairedUsers: PairedUser[]; defaultWorkDir: string; streamingCard: boolean }
  dingtalk: { clientId: string; clientSecret: string; allowedUsers: string[]; pairedUsers: PairedUser[]; defaultWorkDir: string; endpoint: string; permissionCardTemplateId: string }
  wechat: { accountId: string; botToken: string; allowedUsers: string[]; pairedUsers: PairedUser[]; defaultWorkDir: string; baseUrl: string; userId: string }
  whatsapp: { accountJid: string; allowedUsers: string[]; pairedUsers: PairedUser[]; defaultWorkDir: string; authDir: string }
}

const loading = ref(false)
const activePlatform = ref<string>('telegram')
const serverStatus = ref<SidecarStatus>({ running: false })
const adapterStatuses = ref<Record<string, SidecarStatus>>({})
const config = ref<AdapterConfig>({
  serverUrl: 'ws://127.0.0.1:3456',
  defaultProjectDir: '',
  pairing: { code: null, expiresAt: null, createdAt: null },
  telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
  feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
  dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
  wechat: { accountId: '', botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: '', userId: '' },
  whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
})

const pairingCode = ref<string | null>(null)
const pairingExpiresAt = ref<number | null>(null)

const platforms = computed(() => [
  { id: 'telegram', label: t('im.telegram.title'), icon: MessageCircle },
  { id: 'feishu', label: t('im.feishu.title'), icon: Mail },
  { id: 'dingtalk', label: t('im.dingtalk.title'), icon: Bell },
  { id: 'wechat', label: t('im.wechat.title'), icon: Smartphone },
  { id: 'whatsapp', label: t('im.whatsapp.title'), icon: Phone },
])

const currentPlatformIcon = computed(() => {
  const p = platforms.value.find(item => item.id === activePlatform.value)
  return p?.icon ?? MessageCircle
})

const currentPlatformLabel = computed(() => {
  const p = platforms.value.find(item => item.id === activePlatform.value)
  return p?.label ?? ''
})

const pairedUsers = computed(() => {
  const platform = activePlatform.value as keyof Pick<AdapterConfig, 'telegram' | 'feishu' | 'dingtalk' | 'wechat' | 'whatsapp'>
  return config.value[platform]?.pairedUsers ?? []
})

/** Check if the current platform has all required fields filled. */
const isCurrentPlatformConfigured = computed(() => {
  switch (activePlatform.value) {
    case 'telegram':
      return !!config.value.telegram.botToken
    case 'feishu':
      return !!config.value.feishu.appId && !!config.value.feishu.appSecret
    case 'dingtalk':
      return !!config.value.dingtalk.clientId && !!config.value.dingtalk.clientSecret
    case 'wechat':
      return !!config.value.wechat.accountId && !!config.value.wechat.botToken
    case 'whatsapp':
      return !!config.value.whatsapp.accountJid
    default:
      return false
  }
})

// ────────────────────────────────────────────────────────────────────────
// Setup Guide
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// WeChat QR Login
// ────────────────────────────────────────────────────────────────────────

type WechatQrScanStatus = 'waiting' | 'scanned' | 'expired'

const wechatScanning = ref(false)
const wechatQrUrl = ref('')
const wechatQrId = ref('')
const wechatQrScanStatus = ref<WechatQrScanStatus>('waiting')
const wechatQrError = ref<string | null>(null)
const wechatQrCanvas = ref<HTMLCanvasElement | null>(null)
const wechatManualExpanded = ref(false)
let wechatQrPollTimer: ReturnType<typeof setInterval> | null = null

const wechatBound = computed(() => !!config.value.wechat.accountId)

async function startWechatQrLogin() {
  wechatQrError.value = null
  loading.value = true
  try {
    const result = await window.electronAPI?.im?.wechat?.startQrLogin()
    if (!result) return

    wechatQrUrl.value = result.qrcodeUrl
    wechatQrId.value = result.qrcodeId
    wechatQrScanStatus.value = 'waiting'
    wechatScanning.value = true

    // Render QR code to canvas
    await nextTick()
    if (wechatQrCanvas.value && result.qrcodeUrl) {
      await QRCode.toCanvas(wechatQrCanvas.value, result.qrcodeUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
    }

    // Start polling
    startWechatQrPolling()
  } catch (err) {
    wechatQrError.value = err instanceof Error ? err.message : String(err)
    errorHandler.handleError(err)
  } finally {
    loading.value = false
  }
}

function startWechatQrPolling() {
  stopWechatQrPolling()
  wechatQrPollTimer = setInterval(async () => {
    if (!wechatQrId.value) return
    try {
      const result = await window.electronAPI?.im?.wechat?.checkQrStatus(wechatQrId.value)
      if (!result) return

      if (result.status === 'confirmed') {
        stopWechatQrPolling()
        wechatScanning.value = false
        // Reload config to get updated credentials
        await loadConfig()
        // Auto-start the WeChat adapter so messages can flow immediately
        if (serverStatus.value.running) {
          try {
            await window.electronAPI?.im?.startAdapter('wechat')
            await refreshStatus()
          } catch (err) {
            console.error('[ImSettings] Failed to auto-start WeChat adapter:', err)
            errorHandler.handleError(err)
          }
        }
      } else if (result.status === 'scanned') {
        wechatQrScanStatus.value = 'scanned'
      } else if (result.status === 'expired') {
        wechatQrScanStatus.value = 'expired'
        stopWechatQrPolling()
      }
    } catch (err) {
      console.error('[ImSettings] WeChat QR polling error:', err)
    }
  }, 2000)
}

function stopWechatQrPolling() {
  if (wechatQrPollTimer) {
    clearInterval(wechatQrPollTimer)
    wechatQrPollTimer = null
  }
}

function cancelWechatQrLogin() {
  stopWechatQrPolling()
  wechatScanning.value = false
  wechatQrUrl.value = ''
  wechatQrId.value = ''
  wechatQrScanStatus.value = 'waiting'
  wechatQrError.value = null
}

async function unbindWechat() {
  loading.value = true
  try {
    await window.electronAPI?.im?.wechat?.unbind()
    await loadConfig()
  } catch (err) {
    console.error('[ImSettings] Failed to unbind WeChat:', err)
    errorHandler.handleError(err)
  } finally {
    loading.value = false
  }
}

// Stop polling when switching away from WeChat tab
watch(activePlatform, (newPlatform) => {
  if (newPlatform !== 'wechat') {
    stopWechatQrPolling()
    wechatScanning.value = false
  }
})

const guideExpanded = ref(false)

const platformDocs: Record<string, string> = {
  telegram: telegramDoc,
  feishu: feishuDoc,
  dingtalk: dingtalkDoc,
  wechat: wechatDoc,
  whatsapp: whatsappDoc,
}

/** Strip image markdown and mermaid blocks — they won't resolve in the renderer */
function sanitizeMd(md: string): string {
  return md
    // Remove mermaid code blocks
    .replace(/```mermaid[\s\S]*?```/g, '')
    // Remove markdown image syntax ![alt](path)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Remove any leftover empty blockquote lines that only had image references
    .replace(/^>\s*$/gm, '')
    // Collapse 3+ consecutive newlines into 2
    .replace(/\n{3,}/g, '\n\n')
}

const renderedGuide = computed(() => {
  const raw = platformDocs[activePlatform.value]
  if (!raw) return ''
  try {
    const html = marked(sanitizeMd(raw), { gfm: true })
    return DOMPurify.sanitize(html as string, {
      ADD_ATTR: ['target'],
    })
  } catch {
    return ''
  }
})

// ────────────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const result = await window.electronAPI?.im?.getConfig()
    if (result) {
      config.value = result as AdapterConfig
      pairingCode.value = (result as AdapterConfig).pairing?.code ?? null
      pairingExpiresAt.value = (result as AdapterConfig).pairing?.expiresAt ?? null
    }
  } catch (err) {
    console.error('[ImSettings] Failed to load config:', err)
  }
}

async function saveConfig() {
  loading.value = true
  try {
    await window.electronAPI?.im?.updateConfig(toRaw(config.value))
  } catch (err) {
    console.error('[ImSettings] Failed to save config:', err)
  } finally {
    loading.value = false
  }
}

async function startServer() {
  loading.value = true
  try {
    await window.electronAPI?.im?.startServer()
    await refreshStatus()
  } catch (err) {
    console.error('[ImSettings] Failed to start server:', err)
  } finally {
    loading.value = false
  }
}

async function stopServer() {
  loading.value = true
  try {
    await window.electronAPI?.im?.stopServer()
    await refreshStatus()
  } catch (err) {
    console.error('[ImSettings] Failed to stop server:', err)
  } finally {
    loading.value = false
  }
}

async function startAdapter(platform: string) {
  loading.value = true
  try {
    // Auto-save config before starting adapter to ensure disk has latest values
    await window.electronAPI?.im?.updateConfig(toRaw(config.value))
    await window.electronAPI?.im?.startAdapter(platform)
    await refreshStatus()
  } catch (err) {
    console.error('[ImSettings] Failed to start adapter:', err)
    errorHandler.handleError(err)
  } finally {
    loading.value = false
  }
}

async function stopAdapter(platform: string) {
  loading.value = true
  try {
    await window.electronAPI?.im?.stopAdapter(platform)
    await refreshStatus()
  } catch (err) {
    console.error('[ImSettings] Failed to stop adapter:', err)
  } finally {
    loading.value = false
  }
}

async function generatePairingCode() {
  loading.value = true
  try {
    const result = await window.electronAPI?.im?.generatePairingCode()
    if (result) {
      pairingCode.value = result.code
      pairingExpiresAt.value = result.expiresAt
    }
  } catch (err) {
    console.error('[ImSettings] Failed to generate pairing code:', err)
  } finally {
    loading.value = false
  }
}

async function clearPairingCode() {
  try {
    await window.electronAPI?.im?.clearPairingCode()
    pairingCode.value = null
    pairingExpiresAt.value = null
  } catch (err) {
    console.error('[ImSettings] Failed to clear pairing code:', err)
  }
}

async function removePairedUser(userId: string) {
  const platform = activePlatform.value as keyof Pick<AdapterConfig, 'telegram' | 'feishu' | 'dingtalk' | 'wechat' | 'whatsapp'>
  if (config.value[platform]) {
    config.value[platform].pairedUsers = config.value[platform].pairedUsers.filter((u) => u.userId !== userId)
    await saveConfig()
  }
}

async function refreshStatus() {
  try {
    const [server, adapters] = await Promise.all([
      window.electronAPI?.im?.getServerStatus(),
      window.electronAPI?.im?.getAdapterStatuses(),
    ])
    if (server) serverStatus.value = server
    if (adapters) adapterStatuses.value = adapters
  } catch (err) {
    console.error('[ImSettings] Failed to refresh status:', err)
  }
}

async function browseDir() {
  try {
    const result = await window.electronAPI?.selectFolder()
    if (result && !result.canceled && result.filePaths.length > 0) {
      config.value.defaultProjectDir = result.filePaths[0]
    }
  } catch (err) {
    console.error('[ImSettings] Failed to browse directory:', err)
  }
}

function formatExpiry(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now())
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────

let statusTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await loadConfig()
  await refreshStatus()
  statusTimer = setInterval(refreshStatus, 5000)
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
  stopWechatQrPolling()
})
</script>

<style scoped lang="scss">
.im-settings {
  max-width: 720px;
}

// Page Header
.im-page-header {
  margin-bottom: 28px;
}

.im-page-title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.im-page-desc {
  font-size: 13.5px;
  color: var(--text-muted);
  margin: 0;
}

// ────────────────────────────────────────────────────────────────────────
// Buttons
// ────────────────────────────────────────────────────────────────────────
.im-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;

  &:active {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.im-btn-primary {
  background: var(--accent-primary);
  color: #fff;

  &:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }
}

.im-btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.im-btn-danger-outline {
  background: transparent;
  color: var(--error);
  border: 1px solid var(--error);

  &:hover:not(:disabled) {
    background: var(--error-glow);
  }
}

.im-btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

.im-btn-icon {
  width: 30px;
  height: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.danger:hover {
    background: var(--error-glow);
    color: var(--error);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Server Status Strip
// ────────────────────────────────────────────────────────────────────────
.server-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  margin-bottom: 20px;
  transition: border-color var(--transition-fast);

  &.running {
    border-color: var(--success);
  }
}

.server-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all var(--transition-normal);

  &.running {
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-glow);
    animation: im-pulse-dot 2s ease-in-out infinite;
  }
}

@keyframes im-pulse-dot {
  0%, 100% {
    box-shadow: 0 0 0 3px var(--success-glow);
  }
  50% {
    box-shadow: 0 0 0 6px transparent;
  }
}

.server-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.server-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.server-meta {
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

// ────────────────────────────────────────────────────────────────────────
// Platform Pills
// ────────────────────────────────────────────────────────────────────────
.platform-pills {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.platform-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--border-default);
  background: var(--bg-elevated);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-body);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-primary);
    color: #fff;
    border-color: var(--accent-primary);
  }
}

.platform-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);

  .platform-pill.active & {
    background: #fff;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.6);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Unified Card
// ────────────────────────────────────────────────────────────────────────
.unified-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 16px;
}

.card-section {
  padding: 20px 24px;
}

.card-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.card-section-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-display);
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-section-title-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  flex-shrink: 0;
}

.adapter-status-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: var(--radius-full);
  background: var(--success-glow);
  color: var(--success);

  &::before {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    animation: im-tag-pulse 2s ease-in-out infinite;
  }

  &.stopped {
    background: var(--bg-tertiary);
    color: var(--text-muted);

    &::before {
      animation: none;
    }
  }
}

@keyframes im-tag-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Form
// ────────────────────────────────────────────────────────────────────────
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.form-group {
  margin-bottom: 14px;

  &.full-width {
    grid-column: span 2;
  }

  &:last-child {
    margin-bottom: 0;
  }
}

.form-label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 5px;
}

.form-hint {
  display: block;
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 4px;
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);
  outline: none;
  transition: all var(--transition-fast);

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }

  &.mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
}

.form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.config-warn {
  color: var(--warning);
  font-size: 11.5px;
  margin-left: 8px;
}

// ────────────────────────────────────────────────────────────────────────
// Pairing
// ────────────────────────────────────────────────────────────────────────
.pairing-display {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px 20px;
  background: var(--surface-soft);
  border-radius: var(--radius-md);
  margin-bottom: 14px;
}

.pairing-code-block {
  text-align: center;
  flex-shrink: 0;
  padding-right: 20px;
  border-right: 1px solid var(--border-default);
}

.pairing-code-text {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 6px;
  color: var(--accent-primary);
  line-height: 1;
}

.pairing-code-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  font-family: var(--font-mono);
}

.pairing-info-block {
  flex: 1;
}

.pairing-expiry-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.pairing-expiry-icon {
  color: var(--warning);
  flex-shrink: 0;
}

.pairing-actions {
  display: flex;
  gap: 6px;
}

.pairing-empty {
  padding: 8px 0 4px;
}

// Paired Users
.paired-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.paired-list-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.paired-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-soft);
  }
}

.paired-row-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.paired-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-primary-hover));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.paired-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.paired-id {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.paired-row-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.paired-time {
  font-size: 11px;
  color: var(--text-muted);
}

// ────────────────────────────────────────────────────────────────────────
// Default Dir
// ────────────────────────────────────────────────────────────────────────
.dir-inline {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dir-inline-input {
  flex: 1;
  padding: 9px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);
  outline: none;
  transition: all var(--transition-fast);

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
}

.dir-hint {
  margin-top: 6px;
}

// ──────────────────────────────────────────────────────────────────────────
// Setup Guide
// ──────────────────────────────────────────────────────────────────────────
.guide-card {
  overflow: hidden;
}

.guide-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 16px 24px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
  }
}

.guide-toggle-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.guide-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.guide-toggle-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-display);
}

.guide-toggle-hint {
  font-size: 11.5px;
  color: var(--text-muted);
}

.guide-chevron {
  color: var(--text-muted);
  transition: transform var(--transition-normal);
  flex-shrink: 0;

  &.expanded {
    transform: rotate(180deg);
  }
}

.guide-body {
  border-top: 1px solid var(--border-subtle);
}

.guide-content {
  padding: 4px 24px 20px;
  max-height: 520px;
  overflow-y: auto;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);

  // Markdown element styles
  h1 {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 20px 0 10px;
    line-height: 1.3;
  }

  h2 {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 18px 0 8px;
  }

  h3 {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 14px 0 6px;
  }

  p {
    margin: 6px 0;
  }

  ul, ol {
    margin: 6px 0;
    padding-left: 20px;
  }

  li {
    margin: 3px 0;
  }

  a {
    color: var(--accent-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  code {
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 2px 6px;
    background: var(--surface-soft);
    border-radius: var(--radius-xs);
    color: var(--accent-primary);
  }

  pre {
    margin: 8px 0;
    padding: 12px 16px;
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    overflow-x: auto;

    code {
      padding: 0;
      background: none;
      color: var(--text-primary);
      font-size: 12px;
    }
  }

  blockquote {
    margin: 8px 0;
    padding: 6px 14px;
    border-left: 3px solid var(--accent-primary);
    background: var(--accent-primary-glow);
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    color: var(--text-secondary);

    p {
      margin: 2px 0;
    }
  }

  strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;

    th, td {
      border: 1px solid var(--border-default);
      padding: 6px 10px;
      text-align: left;
    }

    th {
      background: var(--surface-soft);
      font-weight: 600;
    }
  }
}

// Collapse transition
.guide-collapse-enter-active,
.guide-collapse-leave-active {
  transition: opacity var(--transition-fast);
}

.guide-collapse-enter-from,
.guide-collapse-leave-to {
  opacity: 0;
}

// ────────────────────────────────────────────────────────────────────────
// Responsive
// ────────────────────────────────────────────────────────────────────────
.wechat-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
}

.wechat-qr-canvas-wrapper {
  position: relative;
  width: 220px;
  height: 220px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--border-default);
}

.wechat-qr-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.wechat-qr-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}

.wechat-qr-status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.wechat-qr-status-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);

  &.scanned {
    color: var(--success);
  }

  &.expired {
    color: var(--error);
  }
}

.wechat-qr-error {
  font-size: 12px;
  color: var(--error);
  text-align: center;
}

.wechat-bound-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--success-glow);
  border-radius: var(--radius-md);
  border: 1px solid var(--success);
}

.wechat-bound-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.wechat-bound-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--success);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wechat-bound-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wechat-bound-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.wechat-bound-id {
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.wechat-bound-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.wechat-adapter-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin-top: 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  font-weight: 600;
}

.wechat-adapter-running {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--success);
}

.wechat-adapter-stopped {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}

.wechat-adapter-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.running {
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-glow);
  }

  &.stopped {
    background: var(--text-muted);
  }
}

.wechat-adapter-hint {
  font-size: 11.5px;
  color: var(--warning);
  font-weight: 500;
}

.wechat-unbound-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wechat-unbound-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--surface-soft);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-default);
}

.wechat-unbound-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wechat-unbound-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wechat-unbound-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-display);
}

.wechat-unbound-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.wechat-manual-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 4px 0;
  transition: color var(--transition-fast);

  &:hover {
    color: var(--text-primary);
  }
}

.wechat-manual-chevron {
  transition: transform var(--transition-fast);

  &.expanded {
    transform: rotate(90deg);
  }
}

.wechat-manual-body {
  padding-top: 8px;
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }

  .form-group.full-width {
    grid-column: span 1;
  }

  .pairing-display {
    flex-direction: column;
    align-items: stretch;
  }

  .pairing-code-block {
    border-right: none;
    border-bottom: 1px solid var(--border-default);
    padding-right: 0;
    padding-bottom: 12px;
  }

  .server-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
}
</style>
