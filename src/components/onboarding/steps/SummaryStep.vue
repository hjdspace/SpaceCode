<template>
  <div class="records">
    <div v-for="row in rows" :key="row.label" class="record">
      <span class="key">{{ row.label }}</span>
      <span class="value">{{ row.value }}</span>
      <span v-if="row.missing" class="missing">
        <AlertTriangle :size="12" />
        {{ t('onboarding.summary.notSet') }}
      </span>
    </div>
  </div>
  <p class="ob-hint">{{ t('onboarding.summary.note') }}</p>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { OAUTH_METHODS } from '@/lib/providerConnection'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const THEME_NAME_KEY: Record<string, string> = {
  system: 'appearanceSettings.themeSystem',
  light: 'appearanceSettings.themeLight',
  dark: 'appearanceSettings.themeDark',
  anthropic: 'appearanceSettings.themeAnthropic',
  'anthropic-dark': 'appearanceSettings.themeAnthropicDark'
}

const AUTH_METHOD_NAME_KEY: Record<string, string> = {
  anthropic_compatible: 'auth.anthropicCompatible',
  openai_compatible: 'auth.openaiCompatible',
  gemini_api: 'auth.geminiApi',
  claudeai: 'auth.claudeAi',
  console: 'auth.console'
}

interface SummaryRow {
  label: string
  value: string
  missing: boolean
}

const rows = computed<SummaryRow[]>(() => {
  const activeConfig = settingsStore.authMethod === 'openai_compatible'
    ? settingsStore.openaiConfig
    : settingsStore.authMethod === 'gemini_api'
      ? settingsStore.geminiConfig
      : settingsStore.anthropicConfig

  const providerName = t(AUTH_METHOD_NAME_KEY[settingsStore.authMethod])
  const isOAuth = OAUTH_METHODS.has(settingsStore.authMethod)
  const model = settingsStore.getSonnetModel()

  return [
    {
      label: t('onboarding.summary.language'),
      value: settingsStore.language === 'zh-CN' ? t('onboarding.language.chinese') : t('onboarding.language.english'),
      missing: false
    },
    {
      label: t('onboarding.summary.theme'),
      value: t(THEME_NAME_KEY[settingsStore.appearance.theme]),
      missing: false
    },
    {
      label: t('onboarding.summary.engine'),
      value: settingsStore.engineType === 'pi'
        ? t('onboarding.engine.pi')
        : `${t('onboarding.engine.claudeCode')} · ${settingsStore.engineSource === 'installed' ? t('engineSource.installed') : t('engineSource.bundled')}`,
      missing: false
    },
    {
      label: t('onboarding.summary.provider'),
      value: isOAuth
        ? (settingsStore.oauthAccount ? t('onboarding.summary.oauthSignedIn', { email: settingsStore.oauthAccount.email }) : providerName)
        : (model ? `${providerName} · ${model}` : providerName),
      missing: !settingsStore.isConfigured
    },
    {
      label: t('onboarding.summary.workspace'),
      value: settingsStore.projectRoot || t('onboarding.summary.defaultFolder'),
      missing: !settingsStore.projectRoot
    }
  ]
})
</script>

<style lang="scss" scoped>
.records {
  display: grid;
}

.record {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-md);

  &:last-child { border-bottom: none; }

  .key {
    color: var(--text-muted);
    width: 78px;
    flex: none;
    font-size: var(--text-sm);
  }

  .value {
    font-family: var(--font-serif);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .missing {
    margin-left: auto;
    flex: none;
    font-size: var(--text-2xs);
    color: var(--warning);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
}
</style>
