<template>
  <div class="profile-cards">
    <div class="profile-grid">
      <div
        v-for="p in store.profiles"
        :key="p.id"
        :data-testid="`profile-card-${p.id}`"
        class="profile-card"
        :class="{ active: p.id === store.activeProfileId, expanded: p.id === store.expandedProfileId }"
        role="button"
        tabindex="0"
        @click="toggleExpand(p.id)"
        @keyup.enter="toggleExpand(p.id)"
      >
        <div class="profile-card-header">
          <span class="profile-active-dot" :class="{ on: p.id === store.activeProfileId }">●</span>
          <span class="profile-name">{{ p.name }}</span>
        </div>
        <div class="profile-card-meta">
          <span class="profile-provider">{{ providerLabel(p) }}</span>
          <span class="profile-model">{{ modelSummary(p) }}</span>
          <span class="profile-context">{{ contextLabel(p) }}</span>
        </div>
      </div>

      <button
        data-testid="add-new-btn"
        class="profile-card profile-card-add"
        @click="onAddNew"
      >
        + {{ $t('profile.addNew') }}
      </button>
    </div>

    <!-- 展开区 -->
    <div v-if="expandedProfile" class="profile-expanded">
      <div class="profile-expanded-header">
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
          <span
            v-else
            :data-testid="`profile-name-${expandedProfile.id}`"
            class="profile-name-display"
            :title="$t('profile.editName')"
            role="button"
            tabindex="0"
            @click="startEditName"
            @keyup.enter="startEditName"
          >{{ expandedProfile.name }}</span>
        </div>
        <button class="profile-collapse-btn" @click="toggleExpand(expandedProfile.id)">
          {{ $t('profile.collapse') }} ▲
        </button>
      </div>

      <ModelSettings
        :modelValue="expandedSettingsModel"
        @update:modelValue="onModelSettingsUpdate"
      />

      <div class="profile-actions">
        <button
          data-testid="apply-btn"
          class="profile-btn primary"
          :disabled="expandedProfile.id === store.activeProfileId"
          @click="onApply"
        >{{ $t('profile.apply') }}</button>
        <button
          class="profile-btn secondary"
          @click="onDuplicate"
        >{{ $t('profile.duplicate') }}</button>
        <button
          data-testid="delete-btn"
          class="profile-btn danger"
          :disabled="store.profiles.length <= 1"
          :title="store.profiles.length <= 1 ? $t('profile.cannotDeleteLast') : ''"
          @click="onDelete"
        >{{ $t('profile.delete') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { AuthMethod, ProviderConfig, OAuthAccountInfo } from '@/stores/settings'
import type { ModelProfile } from '@/types/profile'
import ModelSettings from './ModelSettings.vue'
import { useI18n } from 'vue-i18n'
import { useDialog } from '@/composables/useDialog'

const store = useSettingsStore()
const { t } = useI18n()
const { showConfirm } = useDialog()

// 与 ModelSettings.vue 的 modelValue 结构保持一致
type ModelSettingsValue = {
  authMethod: AuthMethod
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  oauthAccount: OAuthAccountInfo | null
}

const expandedProfile = computed<ModelProfile | null>(() => {
  if (!store.expandedProfileId) return null
  return store.profiles.find(p => p.id === store.expandedProfileId) ?? null
})

function toggleExpand(id: string) {
  store.expandedProfileId = store.expandedProfileId === id ? null : id
}

// ── 把 expandedProfile 映射成 ModelSettings 的 modelValue 结构 ──
// 注意：此 computed 仅在 expandedProfile 非空时被模板访问（外层 v-if 守卫），
// 因此使用非空断言 `!` 让返回类型保持非 null，避免 vue-tsc 报错。
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

// ── ModelSettings 的变更转发回 store.updateProfile ──
function onModelSettingsUpdate(val: ModelSettingsValue) {
  if (!expandedProfile.value) return
  store.updateProfile(expandedProfile.value.id, {
    authMethod: val.authMethod,
    anthropicConfig: { ...val.anthropicConfig },
    openaiConfig: { ...val.openaiConfig },
    geminiConfig: { ...val.geminiConfig },
  })
}

// ── 缩略卡标签计算 ──
function providerLabel(p: ModelProfile): string {
  switch (p.authMethod) {
    case 'openai_compatible': return 'OpenAI'
    case 'anthropic_compatible': return 'Anthropic'
    case 'gemini_api': return 'Gemini'
    case 'claudeai': return 'Claude'
    case 'console': return 'Console'
    default: return '—'
  }
}

function modelSummary(p: ModelProfile): string {
  const cfg = p.authMethod === 'openai_compatible' ? p.openaiConfig
    : p.authMethod === 'anthropic_compatible' ? p.anthropicConfig
    : p.authMethod === 'gemini_api' ? p.geminiConfig
    : null
  if (!cfg) return ''
  return cfg.sonnetModel || ''
}

function contextLabel(p: ModelProfile): string {
  const model = modelSummary(p)
  if (!model) return ''
  const w = p.modelContextWindows[model]
  if (!w) return ''
  return w >= 1000000 ? '1M' : `${Math.round(w / 1000)}K`
}

// ── 名称就地编辑 ──
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

// ── 操作栏 ──
async function onApply() {
  if (!expandedProfile.value) return
  await store.applyProfile(expandedProfile.value.id)
}

async function onDuplicate() {
  if (!expandedProfile.value) return
  await store.duplicateProfile(expandedProfile.value.id)
}

async function onDelete() {
  if (!expandedProfile.value) return
  if (store.profiles.length <= 1) return
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
  gap: 12px;
}
.profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.profile-card {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  cursor: pointer;
  background: var(--surface-card);
  transition: border-color 0.15s;
  &:hover { border-color: var(--accent-primary); }
  &.active { border-color: var(--accent-primary); background: var(--surface-active); }
  &.expanded { border-color: var(--accent-primary); }
}
.profile-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.profile-active-dot {
  color: var(--text-muted);
  font-size: 10px;
  &.on { color: var(--accent-primary); }
}
.profile-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 13px;
}
.profile-card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
}
.profile-card-add {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  color: var(--text-muted);
  font-size: 12px;
}
.profile-expanded {
  border: 1px solid var(--accent-primary);
  border-radius: 6px;
  padding: 16px;
  background: var(--bg-elevated);
}
.profile-expanded-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.profile-name-display {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: text;
}
.profile-name-input {
  font-size: 15px;
  font-weight: 600;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-primary);
  border-radius: 3px;
  padding: 2px 6px;
  color: var(--text-primary);
  outline: none;
}
.profile-collapse-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
}
.profile-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
}
.profile-btn {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  &.primary {
    background: var(--accent-primary);
    color: #fff;
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  &.secondary {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--border-default);
  }
  &.danger {
    background: var(--error-glow);
    color: var(--error);
    border-color: var(--error);
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
}
</style>
