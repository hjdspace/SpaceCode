<template>
  <div class="profile-cards">
    <div class="profile-grid">
      <div
        v-for="p in store.profiles"
        :key="p.id"
        :data-testid="`profile-card-${p.id}`"
        class="profile-card"
        :class="{ active: p.id === store.activeProfileId, expanded: p.id === store.expandedProfileId }"
        @click="toggleExpand(p.id)"
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
            @click="startEditName"
          >{{ expandedProfile.name }}</span>
        </div>
        <button class="profile-collapse-btn" @click="toggleExpand(expandedProfile.id)">
          {{ $t('profile.collapse') }} ▲
        </button>
      </div>

      <ModelSettings
        :modelValue="expandedSettingsModel"
        @update:modelValue="onModelSettingsUpdate"
        @change="onModelSettingsChange"
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
import type { AuthMethod, ProviderConfig } from '@/stores/settings'
import type { ModelProfile } from '@/types/profile'
import ModelSettings from './ModelSettings.vue'
import { useI18n } from 'vue-i18n'

const store = useSettingsStore()
const { t } = useI18n()

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
function onModelSettingsUpdate(val: any) {
  if (!expandedProfile.value) return
  store.updateProfile(expandedProfile.value.id, {
    authMethod: val.authMethod as AuthMethod,
    anthropicConfig: { ...val.anthropicConfig } as ProviderConfig,
    openaiConfig: { ...val.openaiConfig } as ProviderConfig,
    geminiConfig: { ...val.geminiConfig } as ProviderConfig,
  })
}
function onModelSettingsChange() {
  // change 事件仅作为保存触发器，实际持久化由 update:modelValue 完成
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
  store.updateProfile(expandedProfile.value.id, { name: trimmed || '未命名' })
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
  if (!confirm(t('profile.deleteConfirm'))) return
  await store.deleteProfile(expandedProfile.value.id)
}

async function onAddNew() {
  await store.createProfile('未命名')
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
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  cursor: pointer;
  background: var(--surface, #1a1a1a);
  transition: border-color 0.15s;
  &:hover { border-color: var(--accent, #3b82f6); }
  &.active { border-color: var(--accent, #3b82f6); background: var(--surface-active, #2a3a4a); }
  &.expanded { border-color: var(--accent, #3b82f6); }
}
.profile-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.profile-active-dot {
  color: var(--text-muted, #555);
  font-size: 10px;
  &.on { color: var(--accent, #3b82f6); }
}
.profile-name {
  font-weight: 600;
  color: var(--text-primary, #fff);
  font-size: 13px;
}
.profile-card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted, #888);
}
.profile-card-add {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  color: var(--text-muted, #888);
  font-size: 12px;
}
.profile-expanded {
  border: 1px solid var(--accent, #3b82f6);
  border-radius: 6px;
  padding: 16px;
  background: var(--surface-elevated, #1a2230);
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
  color: var(--text-primary, #fff);
  cursor: text;
}
.profile-name-input {
  font-size: 15px;
  font-weight: 600;
  background: var(--input-bg, #2a2a2a);
  border: 1px solid var(--accent, #3b82f6);
  border-radius: 3px;
  padding: 2px 6px;
  color: var(--text-primary, #fff);
  outline: none;
}
.profile-collapse-btn {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 12px;
}
.profile-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border, #333);
}
.profile-btn {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  &.primary {
    background: var(--accent, #3b82f6);
    color: #fff;
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  &.secondary {
    background: var(--surface-hover, #2a2a2a);
    color: var(--text-primary, #ccc);
    border-color: var(--border, #444);
  }
  &.danger {
    background: var(--danger-bg, #3a1a1a);
    color: var(--danger-text, #f88);
    border-color: var(--danger-border, #644);
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
}
</style>
