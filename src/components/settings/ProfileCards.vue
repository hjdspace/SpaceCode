<template>
  <div class="profile-cards">
    <!-- ─── 顶部标题区 ─── -->
    <header class="profile-masthead">
      <div class="profile-titles">
        <span class="profile-eyebrow">{{ $t('profile.title') }}</span>
        <h1 class="profile-title">{{ $t('settings.modelSettings') }}</h1>
        <p class="profile-description">{{ $t('profile.description') }}</p>
      </div>
      <button
        data-testid="add-new-btn"
        class="profile-add-btn"
        type="button"
        @click="onAddNew"
      >
        <Plus :size="14" />
        {{ $t('profile.addNew') }}
      </button>
    </header>

    <!-- ─── Profile 切换条：横向 chip 列表 ─── -->
    <nav v-if="store.profiles.length" class="profile-bar" :aria-label="$t('profile.available')">
      <button
        v-for="p in store.profiles"
        :key="p.id"
        :data-testid="`profile-chip-${p.id}`"
        class="profile-chip"
        :class="{ active: p.id === store.activeProfileId, selected: p.id === expandedProfile?.id }"
        type="button"
        :disabled="Boolean(switchingProfileId)"
        :aria-pressed="p.id === store.activeProfileId"
        :aria-busy="switchingProfileId === p.id"
        :title="p.name"
        @click="onSelectProfile(p.id)"
      >
        <span class="profile-chip-logo" :class="providerLogoClass(p)">
          <Loader2 v-if="switchingProfileId === p.id" :size="13" class="spin" />
          <Check v-else-if="p.id === store.activeProfileId" :size="13" />
          <span v-else class="profile-chip-dot" />
        </span>
        <span class="profile-chip-name">{{ p.name }}</span>
        <span class="profile-chip-meta">{{ modelSummary(p) || providerLabel(p) }}</span>
      </button>
    </nav>

    <!-- ─── 主体：选中 profile 的编辑区 ─── -->
    <section v-if="expandedProfile" class="profile-editor">
      <div class="profile-editor-header">
        <div class="profile-editor-title">
          <div class="profile-editor-kicker">{{ $t('profile.editing') }}</div>
          <div class="profile-expanded-name">
            <input
              v-if="editingName"
              data-testid="profile-name-input"
              v-model="nameDraft"
              class="profile-name-input"
              :placeholder="$t('profile.namePlaceholder')"
              @blur="commitName"
              @keyup.enter="commitName"
              @keyup.esc="cancelName"
              ref="nameInputRef"
            />
            <button
              v-else
              :data-testid="`profile-name-${expandedProfile.id}`"
              class="profile-name-display"
              type="button"
              :title="$t('profile.editName')"
              @click="startEditName"
            >{{ expandedProfile.name }}</button>
          </div>
        </div>
        <div class="profile-editor-actions">
          <span v-if="expandedProfile.id === store.activeProfileId" class="profile-editor-badge">
            <Check :size="13" />
            {{ $t('profile.active') }}
          </span>
          <button class="profile-btn secondary" type="button" @click="onDuplicate">
            <Copy :size="14" />
            {{ $t('profile.duplicate') }}
          </button>
          <button
            data-testid="delete-btn"
            class="profile-btn danger"
            type="button"
            :disabled="store.profiles.length <= 1"
            :title="store.profiles.length <= 1 ? $t('profile.cannotDeleteLast') : ''"
            @click="onDelete"
          >
            <Trash2 :size="14" />
            {{ $t('profile.delete') }}
          </button>
        </div>
      </div>

      <p class="profile-editor-hint">{{ $t('profile.editorHint') }}</p>

      <ModelSettings
        v-if="expandedSettingsModel"
        :modelValue="expandedSettingsModel"
        @update:modelValue="onModelSettingsUpdate"
      />
    </section>

    <!-- ─── 空状态 ─── -->
    <div v-else class="profile-empty">
      <SlidersHorizontal :size="20" />
      <span>{{ $t('profile.empty') }}</span>
      <button class="profile-btn primary" type="button" @click="onAddNew">
        <Plus :size="14" />
        {{ $t('profile.addNew') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Check, Copy, Loader2, Plus, SlidersHorizontal, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import type { AuthMethod, OAuthAccountInfo, ProviderConfig } from '@/stores/settings'
import type { ModelProfile } from '@/types/profile'
import ModelSettings from './ModelSettings.vue'
import { useDialog } from '@/composables/useDialog'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'

const store = useSettingsStore()
const { t } = useI18n()
const { showConfirm } = useDialog()

type ModelSettingsValue = {
  authMethod: AuthMethod
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  oauthAccount: OAuthAccountInfo | null
}

const expandedProfile = computed<ModelProfile | null>(() => {
  const preferredId = store.expandedProfileId ?? store.activeProfileId
  return store.profiles.find(p => p.id === preferredId) ?? store.profiles[0] ?? null
})

const switchingProfileId = ref<string | null>(null)

const expandedSettingsModel = computed<ModelSettingsValue | null>(() => {
  const p = expandedProfile.value
  if (!p) return null
  return {
    authMethod: p.authMethod,
    anthropicConfig: p.anthropicConfig,
    openaiConfig: p.openaiConfig,
    geminiConfig: p.geminiConfig,
    oauthAccount: store.oauthAccount,
  }
})

function onModelSettingsUpdate(val: ModelSettingsValue) {
  if (!expandedProfile.value) return
  store.updateProfile(expandedProfile.value.id, {
    authMethod: val.authMethod,
    anthropicConfig: { ...val.anthropicConfig },
    openaiConfig: { ...val.openaiConfig },
    geminiConfig: { ...val.geminiConfig },
  })
}

function providerLabel(p: ModelProfile): string {
  switch (p.authMethod) {
    case 'openai_compatible': return t('auth.openaiCompatible')
    case 'anthropic_compatible': return t('auth.anthropicCompatible')
    case 'gemini_api': return t('auth.geminiApi')
    case 'claudeai': return t('auth.claudeAi')
    case 'console': return t('auth.console')
    default: return t('profile.unknownProvider')
  }
}

/** 返回 provider 的 logo CSS class（仅用于 chip 圆形 logo 的品牌色） */
function providerLogoClass(p: ModelProfile): string {
  switch (p.authMethod) {
    case 'anthropic_compatible':
    case 'claudeai': return 'logo-anthropic'
    case 'openai_compatible': return 'logo-openai'
    case 'gemini_api': return 'logo-gemini'
    case 'console': return 'logo-console'
    default: return 'logo-default'
  }
}

function modelSummary(p: ModelProfile): string {
  const cfg = p.authMethod === 'openai_compatible' ? p.openaiConfig
    : p.authMethod === 'anthropic_compatible' ? p.anthropicConfig
    : p.authMethod === 'gemini_api' ? p.geminiConfig
    : null
  return cfg?.sonnetModel || ''
}

const editingName = ref(false)
const nameDraft = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)

function startEditName() {
  if (!expandedProfile.value) return
  nameDraft.value = expandedProfile.value.name
  editingName.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function commitName() {
  if (!expandedProfile.value) return
  const trimmed = nameDraft.value.trim()
  store.updateProfile(expandedProfile.value.id, { name: trimmed || t('profile.untitled') })
  editingName.value = false
}

function cancelName() {
  editingName.value = false
  nameDraft.value = ''
}

async function onSelectProfile(id: string) {
  if (switchingProfileId.value) return
  const profile = store.profiles.find(p => p.id === id)
  if (!profile) return
  const previousProfileId = store.activeProfileId
  store.expandedProfileId = id
  if (id === store.activeProfileId) return

  switchingProfileId.value = id
  try {
    await store.applyProfile(id)
    errorHandler.pushToast({
      id: crypto.randomUUID(),
      category: ErrorCategory.UNKNOWN,
      title: t('profile.title'),
      message: t('profile.switchedToast', { name: profile.name }),
      autoDismiss: true,
      dismissAfter: 4000,
      createdAt: Date.now(),
    })
  } catch (error) {
    store.expandedProfileId = previousProfileId
    errorHandler.handleError(error)
  } finally {
    switchingProfileId.value = null
  }
}

async function onDuplicate() {
  if (!expandedProfile.value) return
  await store.duplicateProfile(expandedProfile.value.id)
}

async function onDelete() {
  if (!expandedProfile.value || store.profiles.length <= 1) return
  const confirmed = await showConfirm(t('profile.deleteConfirm'), { variant: 'danger' })
  if (!confirmed) return
  await store.deleteProfile(expandedProfile.value.id)
}

async function onAddNew() {
  await store.createProfile(t('profile.untitled'))
}
</script>

<style lang="scss" scoped>
.profile-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1120px;
}

/* ─── 顶部标题区 ─── */
.profile-masthead {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 4px;
}

.profile-titles { min-width: 0; }

.profile-eyebrow {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-primary);
  margin-bottom: 6px;
}

.profile-title {
  margin: 0 0 6px;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.profile-description {
  max-width: 62ch;
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.profile-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 9px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--accent-primary);
  color: #ffffff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(13, 148, 136, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition: background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
  white-space: nowrap;
  &:hover {
    background: var(--accent-primary-hover);
    box-shadow: 0 4px 12px rgba(13, 148, 136, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    transform: translateY(-1px);
  }
  &:active { transform: translateY(0); box-shadow: 0 1px 2px rgba(13, 148, 136, 0.2); }
}

/* ─── Profile 切换条：横向 chip 列表 ─── */
.profile-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  overflow-x: auto;
  scrollbar-width: thin;
}
.profile-bar::-webkit-scrollbar { height: 4px; }
.profile-bar::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 2px; }

.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast),
              border-color var(--transition-fast), box-shadow var(--transition-fast);
  &:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }
  &:disabled { cursor: wait; opacity: 0.6; }
  &.active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
    border-color: rgba(13, 148, 136, 0.25);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(13, 148, 136, 0.08);
  }
  &.selected:not(.active) {
    border-color: var(--border-strong);
  }
}

.profile-chip-logo {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  box-shadow: 0 0 0 1px var(--border-default);
  color: var(--text-secondary);
  flex-shrink: 0;
  transition: box-shadow var(--transition-fast), color var(--transition-fast);
}

.profile-chip.active .profile-chip-logo {
  box-shadow: 0 0 0 1px rgba(13, 148, 136, 0.35);
  color: var(--accent-primary);
}

/* provider 品牌色（仅 chip logo 内部，不改 design tokens） */
.profile-chip-logo.logo-anthropic { color: #d97757; }
.profile-chip-logo.logo-openai    { color: #10a37f; }
.profile-chip-logo.logo-gemini    { color: #4285f4; }
.profile-chip-logo.logo-console   { color: var(--text-secondary); }
.profile-chip-logo.logo-default   { color: var(--text-muted); }

.profile-chip.active .profile-chip-logo {
  color: var(--accent-primary);
}

.profile-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
}

.profile-chip-name {
  color: inherit;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-chip-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--text-disabled);
  margin-left: 2px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-chip.active .profile-chip-meta {
  color: var(--accent-primary);
  opacity: 0.7;
}

/* ─── 编辑器 ─── */
.profile-editor {
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 18px 20px 20px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
  &:hover { box-shadow: var(--shadow-md); border-color: var(--border-default); }
  /* 允许 BaseUrlPresets 下拉溢出 */
  overflow: visible;
  :deep(.s-panel) { overflow: visible; }
}

.profile-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.profile-editor-title { min-width: 0; }

.profile-editor-kicker {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.profile-name-display {
  display: block;
  max-width: 100%;
  margin-top: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: text;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  &:hover { color: var(--accent-primary); }
}

.profile-name-input {
  width: min(100%, 320px);
  margin-top: 2px;
  padding: 4px 8px;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
}

.profile-editor-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.profile-editor-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 600;
}

.profile-editor-hint {
  margin: 0 0 14px;
  color: var(--text-muted);
  font-size: 11px;
}

.profile-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: background var(--transition-fast), border-color var(--transition-fast);
  &.primary {
    background: var(--accent-primary);
    color: var(--text-primary);
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  &.secondary {
    border-color: var(--border-default);
    background: var(--surface-hover);
    color: var(--text-primary);
    &:hover { background: var(--bg-tertiary); border-color: var(--border-strong); }
  }
  &.danger {
    border-color: var(--error);
    background: var(--error-glow);
    color: var(--error);
    &:disabled { opacity: 0.4; cursor: not-allowed; }
    &:hover:not(:disabled) { background: rgba(220, 38, 38, 0.22); }
  }
}

.profile-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: 13px;
  .profile-btn { margin-left: auto; }
}

.spin { animation: spin 1s linear infinite; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 560px) {
  .profile-masthead { flex-direction: column; align-items: flex-start; }
  .profile-add-btn { align-self: flex-start; }
  .profile-editor { padding: 14px; }
  .profile-editor-header { align-items: flex-start; }
  .profile-editor-actions { width: 100%; }
}
</style>
