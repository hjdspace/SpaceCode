<template>
  <div class="form-modal-overlay" @click.self="$emit('close')">
    <div class="form-modal">
      <h3>{{ t('hookSettings.builtin.configureTitle') }}：{{ def?.name }}</h3>
      <p class="config-desc">{{ def?.description }}</p>

      <!-- Provider 选择 -->
      <div class="form-group">
        <label>{{ t('hookSettings.builtin.selectProvider') }} <span class="required">*</span></label>
        <div class="provider-list">
          <button
            v-for="p in def?.providers ?? []"
            :key="p.id"
            class="provider-btn"
            :class="{ active: form.providerId === p.id }"
            @click="selectProvider(p.id)"
          >
            <span class="provider-name">{{ p.label }}</span>
            <span class="provider-desc">{{ p.description }}</span>
          </button>
        </div>
        <div class="form-hint">
          {{ t('hookSettings.builtin.providerHint') }}
          <a v-if="selectedProvider?.docsUrl" :href="selectedProvider.docsUrl" target="_blank" class="external-link">
            {{ t('hookSettings.builtin.viewDocs') }}
          </a>
        </div>
      </div>

      <!-- 配置字段 -->
      <template v-if="selectedProvider">
        <div
          v-for="field in selectedProvider.configFields"
          :key="field.key"
          class="form-group"
        >
          <label>
            {{ field.label }}
            <span v-if="field.required" class="required">*</span>
          </label>
          <input
            v-if="field.type !== 'password'"
            v-model="form.config[field.key]"
            :type="field.type ?? 'text'"
            :placeholder="field.placeholder"
            class="form-input"
          />
          <div v-else class="password-row">
            <input
              :type="showPassword[field.key] ? 'text' : 'password'"
              v-model="form.config[field.key]"
              :placeholder="field.placeholder"
              class="form-input"
            />
            <button class="s-btn btn-ghost" @click="togglePassword(field.key)">
              <Eye v-if="!showPassword[field.key]" :size="14" />
              <EyeOff v-else :size="14" />
            </button>
          </div>
          <div v-if="field.hint" class="form-hint">{{ field.hint }}</div>
        </div>
      </template>

      <!-- Scope -->
      <div class="form-group">
        <label>{{ t('hookSettings.scope') }} <span class="required">*</span></label>
        <div class="scope-options">
          <button
            v-for="s in scopeOptions"
            :key="s.value"
            class="scope-btn-sm"
            :class="{ active: form.scope === s.value }"
            @click="form.scope = s.value"
          >
            {{ s.label }}
          </button>
        </div>
        <div class="form-hint">{{ t('hookSettings.builtin.scopeHint') }}</div>
      </div>

      <div class="form-actions">
        <button class="btn btn-secondary" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" @click="save" :disabled="!isValid">
          <CheckCircle :size="14" />
          {{ t('hookSettings.builtin.confirmAndEnable') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff, CheckCircle } from 'lucide-vue-next'
import { getBuiltinHook, getBuiltinProvider } from '@/types/builtinHooks'
import { SCOPE_LABELS } from '@/types/hooks'
import type { HookScope } from '@/types/hooks'
import type { BuiltinHookDefinition } from '@/types/builtinHooks'

const { t } = useI18n()

const props = defineProps<{
  builtinId: string
  initialProviderId?: string
  initialConfig?: Record<string, string>
  initialScope?: HookScope
}>()

const emit = defineEmits<{
  apply: [builtinId: string, providerId: string, config: Record<string, string>, scope: HookScope]
  close: []
}>()

const def = computed<BuiltinHookDefinition | undefined>(() => getBuiltinHook(props.builtinId))

const form = reactive({
  providerId: props.initialProviderId ?? '',
  config: { ...(props.initialConfig ?? {}) } as Record<string, string>,
  scope: (props.initialScope ?? 'user') as HookScope,
})

const showPassword = reactive<Record<string, boolean>>({})

const selectedProvider = computed(() => {
  if (!form.providerId) return undefined
  return getBuiltinProvider(props.builtinId, form.providerId)
})

const scopeOptions = Object.entries(SCOPE_LABELS).map(([value, info]) => ({
  value: value as HookScope,
  label: info.label,
}))

const isValid = computed(() => {
  if (!form.providerId) return false
  const provider = getBuiltinProvider(props.builtinId, form.providerId)
  if (!provider) return false
  for (const field of provider.configFields) {
    if (field.required && !(form.config[field.key] || '').trim()) {
      return false
    }
  }
  return true
})

function selectProvider(id: string) {
  if (form.providerId !== id) {
    form.providerId = id
    // 切换 provider 时，清空旧配置
    form.config = {}
  }
}

function togglePassword(key: string) {
  showPassword[key] = !showPassword[key]
}

function save() {
  if (!isValid.value) return
  emit('apply', props.builtinId, form.providerId, { ...form.config }, form.scope)
}
</script>

<style lang="scss" scoped>
.form-modal-overlay {
  position: fixed; inset: 0; background: var(--surface-glass-active);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.form-modal {
  width: 500px; max-height: 80vh; overflow-y: auto;
  background: var(--bg-elevated); border-radius: var(--radius-xl); padding: 24px;
  display: flex; flex-direction: column; gap: 14px;
  box-shadow: var(--shadow-xl);
  h3 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
}
.config-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0; }

.form-group { display: flex; flex-direction: column; gap: 6px;
  label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .required { color: var(--error); }
}
.form-input {
  padding: 10px 12px; background: var(--surface-soft); border: 1px solid var(--border-default);
  border-radius: 8px; color: var(--text-primary); font-size: 13px; flex: 1;
  &:focus { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-glow); }
  &::placeholder { color: var(--text-muted); }
}
.form-hint { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

.provider-list { display: flex; flex-direction: column; gap: 6px; }
.provider-btn {
  @include reset-button;
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-default);
  background: var(--surface-soft); cursor: pointer; transition: all 0.15s; text-align: left;
  &:hover { border-color: var(--border-strong); background: var(--bg-hover); }
  &.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }
}
.provider-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.provider-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

.external-link { color: var(--accent-primary); text-decoration: none; margin-left: 4px;
  &:hover { text-decoration: underline; }
}

.password-row { display: flex; gap: 6px; align-items: center;
  .form-input { flex: 1; }
}

.scope-options { display: flex; gap: 6px; }
.scope-btn-sm {
  @include reset-button;
  padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;
  border: 1px solid var(--border-default); background: transparent; color: var(--text-muted);
  cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--border-strong); color: var(--text-primary); }
  &.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); color: var(--accent-primary); }
}

.btn-ghost {
  @include reset-button;
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 6px;
  background: transparent; color: var(--text-muted);
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.btn { @include reset-button;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;
  transition: all 0.2s;
  &.btn-primary { background: var(--accent-primary); color: white; &:hover:not(:disabled) { background: var(--accent-primary-hover); } }
  &.btn-secondary { background: var(--surface-soft); border: 1px solid var(--border-default); color: var(--text-primary); &:hover:not(:disabled) { background: var(--bg-hover); } }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
}
.form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 4px; padding-top: 14px; border-top: 1px solid var(--border-default); }
</style>