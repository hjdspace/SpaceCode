<template>
  <div class="engine-list">
    <button
      type="button"
      class="ob-opt"
      :class="{ 'is-active': settingsStore.engineType === 'claude-code' }"
      @click="selectEngine('claude-code')"
    >
      <span class="ob-opt-icon icon-claude"><Bot :size="15" :stroke-width="2" /></span>
      <span class="ob-opt-text">
        <span class="ob-opt-title">{{ t('onboarding.engine.claudeCode') }}</span>
        <span class="ob-opt-desc">{{ t('onboarding.engine.claudeCodeDesc') }}</span>
      </span>
      <span class="ob-opt-tag">{{ sourceLabel }}</span>
    </button>

    <button
      type="button"
      class="ob-opt"
      :class="{ 'is-active': settingsStore.engineType === 'pi' }"
      :disabled="piBlocked"
      @click="selectEngine('pi')"
    >
      <span class="ob-opt-icon icon-pi"><Cpu :size="15" :stroke-width="2" /></span>
      <span class="ob-opt-text">
        <span class="ob-opt-title">{{ t('onboarding.engine.pi') }}</span>
        <span class="ob-opt-desc">{{ t('onboarding.engine.piDesc') }}</span>
      </span>
      <span class="ob-opt-tag" :class="{ 'is-warn': piBlocked }">{{ piStateLabel }}</span>
    </button>
  </div>

  <button v-if="piInstallable" type="button" class="ob-btn ob-btn--ghost ob-btn--sm install" @click="installPiSdk">
    <Loader2 v-if="piInstalling" :size="12" class="spin" />
    <Download v-else :size="12" />
    {{ piInstalling ? t('onboarding.engine.piInstalling') : t('onboarding.engine.installPi') }}
  </button>

  <template v-if="settingsStore.engineType === 'claude-code'">
    <div class="ob-group-title">{{ t('engineSource.title') }}</div>
    <div class="ob-row">
      <button
        v-for="option in SOURCE_OPTIONS"
        :key="option"
        type="button"
        class="ob-chip"
        :class="{ 'is-active': settingsStore.engineSource === option }"
        @click="selectSource(option)"
      >
        <span class="ob-chip-dot" :style="{ background: 'var(--accent-primary)', opacity: settingsStore.engineSource === option ? 1 : 0.3 }" />
        {{ option === 'bundled' ? t('engineSource.bundled') : t('engineSource.installed') }}
      </button>
    </div>
    <p class="ob-hint">{{ t('onboarding.engine.installedCliHint') }}</p>

    <div v-if="settingsStore.engineSource === 'installed'" class="ob-env">
      <div v-for="item in envRows" :key="item.name" class="ob-env-row">
        <span>{{ item.name }}</span>
        <span class="ob-env-path">{{ item.path }}</span>
        <span class="ob-env-state" :style="{ color: item.ok ? 'var(--success)' : 'var(--error)' }">
          {{ item.state }}
        </span>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, Cpu, Download, Loader2 } from 'lucide-vue-next'
import { useSettingsStore, type EngineSource, type EngineType } from '@/stores/settings'
import type { EngineAvailability } from '@/shared/channels/claudeCode'
import { api, type CliDetectionResult, type EnvironmentCheckResult } from '@/services/electronAPI'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const SOURCE_OPTIONS: EngineSource[] = ['bundled', 'installed']

/** 主进程回不了话时按「不可用、也别引导安装」收口，不给界面留猜的余地 (#52) */
const UNAVAILABLE: EngineAvailability = { available: false, reason: 'not-found', version: null, installable: false }

const piAvailability = ref<EngineAvailability | null>(null)
const piChecking = ref(true)
const piInstalling = ref(false)
const piInstallError = ref<string | null>(null)

const cli = ref<CliDetectionResult | null>(null)
const env = ref<EnvironmentCheckResult | null>(null)

const piBlocked = computed(() => !piChecking.value && piAvailability.value?.available !== true)
const piInstallable = computed(() => !piChecking.value && !piInstalling.value && piAvailability.value?.installable === true)

const sourceLabel = computed(() =>
  settingsStore.engineSource === 'installed' ? t('engineSource.installed') : t('engineSource.bundled')
)

const piStateLabel = computed(() => {
  if (piChecking.value) return t('onboarding.engine.piChecking')
  if (piInstalling.value) return t('onboarding.engine.piInstalling')
  if (piInstallError.value) return piInstallError.value
  const info = piAvailability.value
  if (!info) return t('onboarding.engine.piMissing')
  if (!info.available) {
    if (info.reason === 'version-too-old') return t('onboarding.engine.piVersionTooOld', { version: info.version ?? '?' })
    if (info.reason === 'version-unknown') return t('onboarding.engine.piVersionUnknown')
    return t('onboarding.engine.piMissing')
  }
  return info.version ? t('onboarding.engine.piInstalledVersion', { version: info.version }) : t('onboarding.engine.piInstalled')
})

const envRows = computed(() => {
  const rows = [
    { name: 'Claude Code CLI', available: cli.value?.available === true, version: cli.value?.version ?? null, path: cli.value?.path ?? null },
    { name: 'Node.js', available: env.value?.node.available === true, version: env.value?.node.version ?? null, path: env.value?.node.path ?? null },
    { name: 'npm', available: env.value?.npm.available === true, version: env.value?.npm.version ?? null, path: env.value?.npm.path ?? null },
    { name: 'Git', available: env.value?.git.available === true, version: env.value?.git.version ?? null, path: env.value?.git.path ?? null },
  ]
  return rows.map(row => ({
    name: row.name,
    ok: row.available,
    path: row.path ?? 'not found',
    state: row.available ? (row.version ?? '—') : t('engineSource.notInstalled')
  }))
})

async function checkPiAvailability() {
  const claudeCode = window.electronAPI?.claudeCode
  if (!claudeCode?.isEngineAvailable) {
    piAvailability.value = UNAVAILABLE
    return
  }
  try {
    piAvailability.value = await claudeCode.isEngineAvailable('pi')
  } catch {
    piAvailability.value = UNAVAILABLE
  }
}

async function installPiSdk() {
  piInstalling.value = true
  piInstallError.value = null
  try {
    const result = await window.electronAPI?.claudeCode?.installPiSdk()
    if (result?.success) {
      await checkPiAvailability()
      if (piAvailability.value?.available) selectEngine('pi')
    } else {
      piInstallError.value = t('onboarding.engine.piInstallFailed', { error: result?.error ?? 'unknown' })
    }
  } catch (err) {
    piInstallError.value = t('onboarding.engine.piInstallFailed', { error: String(err) })
  } finally {
    piInstalling.value = false
  }
}

async function loadInstalledCliContext() {
  const [detection, environment] = await Promise.all([api.detectInstalledCli(), api.checkEnvironment()])
  cli.value = detection
  env.value = environment
}

function stopActiveSessions() {
  const claudeCode = window.electronAPI?.claudeCode
  if (!claudeCode?.getActiveSessions || !claudeCode?.stop) return
  claudeCode.getActiveSessions()
    .then(list => {
      for (const session of list ?? []) {
        if (session?.sessionId) claudeCode.stop(session.sessionId).catch(() => {})
      }
    })
    .catch(() => {})
}

function selectEngine(next: EngineType) {
  if (next === 'pi' && (piBlocked.value || piInstalling.value)) return
  if (settingsStore.engineType === next) return
  settingsStore.engineType = next
  void settingsStore.saveSettings()
  stopActiveSessions()
}

function selectSource(next: EngineSource) {
  if (settingsStore.engineSource === next) return
  settingsStore.setEngineSource(next)
  stopActiveSessions()
  if (next === 'installed') void loadInstalledCliContext()
}

onMounted(async () => {
  await checkPiAvailability()
  // SDK 被移除过的老用户不该把引擎停在选不了的状态里，跟通用设置页同一口径。
  if (piAvailability.value && !piAvailability.value.available && settingsStore.engineType === 'pi') {
    settingsStore.engineType = 'claude-code'
    void settingsStore.saveSettings()
  }
  piChecking.value = false
  if (settingsStore.engineSource === 'installed') void loadInstalledCliContext()
})
</script>

<style lang="scss" scoped>
.engine-list {
  display: grid;
  gap: 9px;
}

.icon-claude {
  background: linear-gradient(140deg, var(--warning), color-mix(in srgb, var(--warning) 60%, #fff));
}

.icon-pi {
  background: linear-gradient(140deg, var(--accent-secondary), var(--accent-primary));
}

.ob-opt-tag.is-warn {
  color: var(--warning);
}

.install {
  margin-top: 10px;
}

.spin {
  animation: ob-rotate 1s linear infinite;
}

@keyframes ob-rotate {
  to { transform: rotate(360deg); }
}
</style>
