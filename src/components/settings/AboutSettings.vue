<template>
  <div class="settings-section">
    <!-- Masthead -->
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">{{ $t('settings.title') }}</div>
      <h1 class="s-masthead-title">{{ $t('aboutSettings.title') }}</h1>
      <p class="s-masthead-desc">{{ $t('aboutSettings.desc') }}</p>
    </div>

    <!-- Hero: App Identity -->
    <div class="about-hero">
      <img class="about-hero-icon" :src="appIcon" alt="SpaceCode" />
      <div class="about-hero-name">SpaceCode</div>
      <div class="about-hero-version">v{{ appVersion }}</div>
    </div>

    <!-- Panel: Updates -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon update">
            <Download :size="14" />
          </div>
          <span class="s-panel-title">{{ $t('aboutSettings.updates') }}</span>
        </div>
        <span
          v-if="updateStatus === 'up-to-date'"
          class="s-panel-badge active"
        >{{ $t('aboutSettings.upToDate') }}</span>
        <span
          v-else-if="updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'downloaded'"
          class="s-panel-badge warning"
        >{{ updateInfo?.version }}</span>
      </div>
      <div class="s-panel-body">
        <!-- Up-to-date -->
        <div v-if="updateStatus === 'up-to-date'" class="update-status">
          <div class="update-status-icon up-to-date">
            <Check :size="20" />
          </div>
          <div class="update-status-info">
            <div class="update-status-title">{{ $t('aboutSettings.upToDate') }}</div>
            <div class="update-status-sub">{{ $t('aboutSettings.upToDateDesc', { version: appVersion }) }}</div>
          </div>
        </div>

        <!-- Checking -->
        <div v-else-if="updateStatus === 'checking'" class="update-status">
          <div class="update-status-icon checking">
            <span class="s-spinner"></span>
          </div>
          <div class="update-status-info">
            <div class="update-status-title">{{ $t('aboutSettings.checking') }}</div>
          </div>
        </div>

        <!-- New version available -->
        <div v-else-if="updateStatus === 'available'" class="update-status">
          <div class="update-status-icon has-update">
            <Download :size="20" />
          </div>
          <div class="update-status-info">
            <div class="update-status-title">{{ $t('aboutSettings.newVersionAvailable', { version: updateInfo?.version || '' }) }}</div>
          </div>
          <button class="s-btn s-btn-primary s-btn-sm" @click="downloadUpdate">
            <Download :size="14" />
            {{ $t('aboutSettings.download') }}
          </button>
        </div>

        <!-- Downloading -->
        <div v-else-if="updateStatus === 'downloading'" class="update-status">
          <div class="update-status-icon checking">
            <span class="s-spinner"></span>
          </div>
          <div class="update-status-info">
            <div class="update-status-title">{{ $t('update.downloading', { version: updateInfo?.version || '' }) }}</div>
            <div v-if="downloadProgress" class="update-status-sub">
              {{ Math.round(downloadProgress.percent) }}%
            </div>
          </div>
        </div>

        <!-- Downloaded / Ready to install -->
        <div v-else-if="updateStatus === 'downloaded'" class="update-status">
          <div class="update-status-icon has-update">
            <Check :size="20" />
          </div>
          <div class="update-status-info">
            <div class="update-status-title">{{ $t('update.readyToInstall', { version: updateInfo?.version || '' }) }}</div>
            <div class="update-status-sub">{{ $t('update.restartToInstall') }}</div>
          </div>
          <button class="s-btn s-btn-primary s-btn-sm" @click="installAndRestart">
            <RotateCw :size="14" />
            {{ $t('update.restartInstall') }}
          </button>
        </div>

        <!-- Error -->
        <div v-else-if="updateStatus === 'error'" class="update-status">
          <div class="update-status-icon error">
            <AlertCircle :size="20" />
          </div>
          <div class="update-status-info">
            <div class="update-status-title">{{ $t('update.checkFailed') }}</div>
            <div v-if="errorMessage" class="update-status-sub">{{ errorMessage }}</div>
          </div>
        </div>

        <!-- Idle: show check button -->
        <div v-else class="update-actions">
          <button class="s-btn s-btn-primary" @click="checkForUpdates">
            <RefreshCw :size="14" />
            {{ $t('aboutSettings.checkForUpdates') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Panel: Changelog -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon changelog">
            <FileText :size="14" />
          </div>
          <span class="s-panel-title">{{ $t('aboutSettings.changelog') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <!-- Loading -->
        <div v-if="changelogLoading" class="changelog-state">
          <span class="s-spinner"></span>
          <span>{{ $t('changelog.loading') }}</span>
        </div>

        <!-- Error -->
        <div v-else-if="changelogError" class="changelog-state changelog-state-error">
          <AlertCircle :size="16" />
          <span>{{ $t('changelog.loadFailed') }}</span>
        </div>

        <!-- Content -->
        <div v-else-if="changelogContent" class="changelog-content markdown-body" v-html="renderedChangelog"></div>

        <!-- Empty -->
        <div v-else class="changelog-state">
          <FileText :size="16" />
          <span>{{ $t('changelog.noContent') }}</span>
        </div>

        <div class="changelog-footer-link">
          <a class="changelog-link" @click="openGitHubReleases">
            {{ $t('aboutSettings.viewFullChangelog') }}
          </a>
        </div>
      </div>
    </div>

    <!-- Panel: Information -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon info">
            <Info :size="14" />
          </div>
          <span class="s-panel-title">{{ $t('aboutSettings.information') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="info-grid">
          <div class="info-card">
            <div class="info-card-title">{{ $t('aboutSettings.license') }}</div>
            <div class="info-card-value">{{ $t('aboutSettings.mitLicense') }}</div>
          </div>
          <div class="info-card">
            <div class="info-card-title">{{ $t('aboutSettings.repository') }}</div>
            <div class="info-card-value">
              <a class="info-link" @click="openGitHub">{{ repoUrl }}</a>
            </div>
          </div>
          <div class="info-card">
            <div class="info-card-title">{{ $t('aboutSettings.developer') }}</div>
            <div class="info-card-value">Jiadong He</div>
          </div>
          <div class="info-card">
            <div class="info-card-title">{{ $t('aboutSettings.techStack') }}</div>
            <div class="info-card-value">{{ $t('aboutSettings.techStackValue') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Download, RefreshCw, FileText, Info, Check, AlertCircle, RotateCw,
} from 'lucide-vue-next'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '@/services/electronAPI'
import { useAutoUpdate } from '@/composables/useAutoUpdate'
import appIcon from '@/assets/app-icon.svg'

const { t } = useI18n()

const {
  status: updateStatus,
  updateInfo,
  downloadProgress,
  errorMessage,
  appVersion,
  checkForUpdates,
  downloadUpdate,
  installAndRestart,
} = useAutoUpdate()

const repoUrl = 'github.com/hjdspace/SpaceCode'

// Changelog
const changelogContent = ref<string | null>(null)
const changelogLoading = ref(true)
const changelogError = ref(false)

const renderedChangelog = computed(() => {
  if (!changelogContent.value) return ''
  try {
    const raw = marked(changelogContent.value)
    return DOMPurify.sanitize(raw as string)
  } catch {
    return changelogContent.value
  }
})

// appVersion 由 useAutoUpdate 异步获取，等就绪后再加载 changelog
watch(appVersion, async (version) => {
  if (version) {
    await loadChangelog()
  }
}, { immediate: true })

async function loadChangelog() {
  changelogLoading.value = true
  changelogError.value = false
  changelogContent.value = null

  try {
    const result = await api.changelog.getReleaseNotes(appVersion.value)
    if (result) {
      changelogContent.value = result.content
    }
  } catch {
    changelogError.value = true
  } finally {
    changelogLoading.value = false
  }
}

function openGitHub() {
  api.shell.openExternal('https://github.com/hjdspace/SpaceCode')
}

function openGitHubReleases() {
  api.shell.openExternal('https://github.com/hjdspace/SpaceCode/releases')
}
</script>

<style lang="scss" scoped>
.settings-section {
  max-width: 780px;
}

/* ── Hero ── */
.about-hero {
  text-align: center;
  padding: 32px 20px 28px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  margin-bottom: 28px;
}

.about-hero-icon {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  margin: 0 auto 16px;
  display: block;
  object-fit: contain;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.about-hero-name {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.about-hero-version {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--accent-primary);
  background: var(--accent-primary-glow);
  display: inline-block;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  margin-top: 8px;
}

/* ── Panel icon variants ── */
.s-panel-icon {
  &.update {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }
  &.changelog {
    background: var(--accent-secondary-glow);
    color: var(--accent-secondary);
  }
  &.info {
    background: linear-gradient(135deg, var(--accent-secondary), #7c3aed);
    color: #fff;
  }
}

/* ── Update Status ── */
.update-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface-soft);
  border-radius: var(--radius-md);
}

.update-status-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.up-to-date {
    background: var(--success-glow);
    color: var(--success);
  }
  &.has-update {
    background: var(--warning-glow);
    color: var(--warning);
  }
  &.checking {
    background: var(--bg-tertiary);
    color: var(--text-muted);
  }
  &.error {
    background: var(--error-glow);
    color: var(--error);
  }
}

.update-status-info {
  flex: 1;
  min-width: 0;
}

.update-status-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
}

.update-status-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 1px;
}

.update-actions {
  display: flex;
  gap: 8px;
}

/* ── Buttons ── */
.s-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-body);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
  white-space: nowrap;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.s-btn-primary {
  background: var(--accent-primary);
  color: white;

  &:hover:not(:disabled) {
    background: var(--accent-primary-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
}

.s-btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

/* ── Changelog ── */
.changelog-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--text-muted);
  font-size: 13px;

  &.changelog-state-error {
    color: var(--error);
  }
}

.changelog-content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);

  :deep(h2) {
    font-size: calc(var(--font-size-base) + 1px);
    font-weight: 600;
    margin: 20px 0 8px;
    color: var(--text-primary);

    &:first-child {
      margin-top: 0;
    }
  }

  :deep(h3) {
    font-size: var(--font-size-base);
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
    background: var(--border-subtle);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
    font-family: var(--font-mono);
  }
}

.changelog-footer-link {
  text-align: center;
  padding: 12px 0 4px;
  border-top: 1px solid var(--border-subtle);
  margin-top: 12px;
}

.changelog-link {
  font-size: 13px;
  color: var(--accent-primary);
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

/* ── Info Grid ── */
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.info-card {
  padding: 14px 16px;
  background: var(--surface-soft);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.info-card-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.info-card-value {
  font-size: 13.5px;
  color: var(--text-primary);
  font-weight: 500;
}

.info-link {
  color: var(--accent-primary);
  text-decoration: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

/* ── Spinner ── */
.s-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .info-grid {
    grid-template-columns: 1fr;
  }
}
</style>
