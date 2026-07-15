<template>
  <div class="profile-cards">
    <div class="profile-masthead">
      <div>
        <div class="profile-eyebrow">{{ $t('profile.title') }}</div>
        <h1 class="profile-title">{{ $t('settings.modelSettings') }}</h1>
        <p class="profile-description">{{ $t('profile.description') }}</p>
      </div>
      <button
        data-testid="add-new-btn"
        class="profile-add-btn"
        type="button"
        @click="onAddNew"
      >
        <Plus :size="15" />
        {{ $t('profile.addNew') }}
      </button>
    </div>

    <div v-if="store.profiles.length" class="profile-workspace">
      <section class="profile-list" :aria-label="$t('profile.available')">
        <div class="profile-section-heading">
          <div>
            <h2>{{ $t('profile.available') }}</h2>
            <span>{{ store.profiles.length }}</span>
          </div>
          <span class="profile-section-hint">{{ $t('profile.selectHint') }}</span>
        </div>

        <div class="profile-grid">
          <button
            v-for="p in store.profiles"
            :key="p.id"
            :data-testid="`profile-card-${p.id}`"
            class="profile-card"
            :class="{ active: p.id === store.activeProfileId, selected: p.id === expandedProfile?.id }"
            type="button"
            :disabled="Boolean(switchingProfileId)"
            :aria-pressed="p.id === store.activeProfileId"
            :aria-busy="switchingProfileId === p.id"
            @click="onSelectProfile(p.id)"
          >
            <span class="profile-card-topline">
              <span class="profile-status" :class="{ active: p.id === store.activeProfileId }">
                <Loader2 v-if="switchingProfileId === p.id" :size="13" class="spin" />
                <Check v-else-if="p.id === store.activeProfileId" :size="13" />
                <span v-else class="profile-status-dot" />
                {{ p.id === store.activeProfileId ? $t('profile.active') : $t('profile.select') }}
              </span>
              <ChevronRight :size="15" class="profile-card-chevron" />
            </span>
            <strong class="profile-name">{{ p.name }}</strong>
            <span class="profile-provider">{{ providerLabel(p) }}</span>
            <span class="profile-model" :title="modelSummary(p)">{{ modelSummary(p) }}</span>
            <span v-if="contextLabel(p)" class="profile-context">
              {{ $t('profile.contextWindow', { value: contextLabel(p) }) }}
            </span>
          </button>
        </div>
      </section>

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
          <span v-if="expandedProfile.id === store.activeProfileId" class="profile-editor-badge">
            <Check :size="13" />
            {{ $t('profile.active') }}
          </span>
        </div>

        <p class="profile-editor-hint">{{ $t('profile.editorHint') }}</p>

        <ModelSettings
          :modelValue="expandedSettingsModel"
          @update:modelValue="onModelSettingsUpdate"
        />

        <div class="profile-actions">
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
      </section>
    </div>

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
import { Check, ChevronRight, Copy, Loader2, Plus, SlidersHorizontal, Trash2 } from 'lucide-vue-next'
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

const expandedSettingsModel = computed(() => {
  const p = expandedProfile.value!
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

function modelSummary(p: ModelProfile): string {
  const cfg = p.authMethod === 'openai_compatible' ? p.openaiConfig
    : p.authMethod === 'anthropic_compatible' ? p.anthropicConfig
    : p.authMethod === 'gemini_api' ? p.geminiConfig
    : null
  return cfg?.sonnetModel || t('profile.noModel')
}

function contextLabel(p: ModelProfile): string {
  const model = modelSummary(p)
  if (!model || model === t('profile.noModel')) return ''
  const w = p.modelContextWindows[model]
  if (!w) return ''
  return w >= 1000000 ? '1M' : `${Math.round(w / 1000)}K`
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
  gap: 24px;
  max-width: 1120px;
}

.profile-masthead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.profile-eyebrow,
.profile-editor-kicker {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.profile-title {
  margin: 4px 0 6px;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1.2;
}

.profile-description {
  max-width: 62ch;
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.profile-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  background: var(--accent-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background var(--transition-fast), border-color var(--transition-fast);
  &:hover { background: var(--accent-primary-hover); border-color: var(--accent-primary-hover); }
}

.profile-workspace {
  display: grid;
  grid-template-columns: 1fr;
  align-items: start;
  gap: 20px;
}

.profile-section-heading {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
  h2 {
    display: inline;
    margin: 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
  }
  h2 + span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    margin-left: 6px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--bg-tertiary);
    color: var(--text-muted);
    font-size: 11px;
  }
}

.profile-section-hint {
  color: var(--text-muted);
  font-size: 11px;
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.profile-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  width: 100%;
  min-height: 126px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  background: var(--surface-card);
  color: var(--text-primary);
  text-align: left;
  transition: border-color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast);
  &:hover:not(:disabled) { border-color: var(--accent-primary); transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
  &:disabled { cursor: wait; opacity: 0.75; }
  &.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }
  &.selected { box-shadow: 0 0 0 1px var(--accent-primary); }
}

.profile-card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 18px;
}

.profile-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  &.active { color: var(--accent-primary); }
}

.profile-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
}

.profile-card-chevron { color: var(--text-muted); }

.profile-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-provider,
.profile-model,
.profile-context {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 11px;
}

.profile-model { color: var(--text-secondary); font-family: var(--font-mono); }

.profile-editor {
  min-width: 0;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-md);
  padding: 18px;
  background: var(--bg-elevated);
}

.profile-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 6px;
}

.profile-editor-title { min-width: 0; }

.profile-name-display {
  display: block;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: text;
  font-size: 15px;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  &:hover { color: var(--accent-primary); }
}

.profile-name-input {
  width: min(100%, 320px);
  padding: 2px 6px;
  border: 1px solid var(--accent-primary);
  border-radius: 3px;
  outline: none;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.profile-editor-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 4px 8px;
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

.profile-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
}

.profile-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  &.primary {
    background: var(--accent-primary);
    color: var(--text-primary);
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  &.secondary {
    border-color: var(--border-default);
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  &.danger {
    border-color: var(--error);
    background: var(--error-glow);
    color: var(--error);
    &:disabled { opacity: 0.4; cursor: not-allowed; }
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

@media (max-width: 900px) {
  .profile-grid { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
}

@media (max-width: 560px) {
  .profile-masthead { flex-direction: column; }
  .profile-add-btn { align-self: flex-start; }
  .profile-editor { padding: 14px; }
  .profile-editor-header { align-items: flex-start; }
}
</style>
