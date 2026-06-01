<template>
  <div class="form-modal-overlay" @click.self="$emit('close')">
    <div class="form-modal">
      <h3>{{ isEditing ? t('hookSettings.editHook') : t('hookSettings.addHook') }}</h3>

      <div class="form-group">
        <label>{{ t('hookSettings.hookName') }} <span class="required">*</span></label>
        <input v-model="form.name" :placeholder="t('hookSettings.hookNamePlaceholder')" class="form-input" />
      </div>

      <div class="form-group">
        <label>{{ t('hookSettings.eventType') }} <span class="required">*</span></label>
        <select v-model="form.event" class="form-select" @change="onEventChange">
          <option v-for="evt in eventList" :key="evt.value" :value="evt.value">
            {{ evt.value }} - {{ evt.description }}
          </option>
        </select>
        <div class="form-hint">{{ t('hookSettings.eventTypeHint') }}</div>
      </div>

      <div class="form-group" v-if="currentEventHasMatcher">
        <label>Matcher</label>
        <div class="matcher-input">
          <select v-model="matcherPreset" class="form-select matcher-preset" @change="applyMatcherPreset">
            <option value="">{{ t('hookSettings.customMatcher') }}</option>
            <option v-for="m in toolMatchers" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
          <input v-model="form.matcher" :placeholder="t('hookSettings.matcherPlaceholder')" class="form-input" />
        </div>
        <div class="form-hint">{{ t('hookSettings.matcherHint') }}</div>
      </div>

      <div class="form-group">
        <label>{{ t('hookSettings.hookType') }} <span class="required">*</span></label>
        <div class="type-toggle">
          <button class="type-btn" :class="{ active: form.type === 'command' }" @click="form.type = 'command'">
            &gt;_ Command
          </button>
          <button class="type-btn" :class="{ active: form.type === 'prompt' }" @click="form.type = 'prompt'">
            AI Prompt
          </button>
        </div>
      </div>

      <div class="form-group" v-if="form.type === 'command'">
        <label>{{ t('hookSettings.shellCommand') }} <span class="required">*</span></label>
        <input v-model="form.command" :placeholder="t('hookSettings.commandPlaceholder')" class="form-input" />
        <div class="form-hint">{{ t('hookSettings.commandHint') }}</div>
      </div>

      <div class="form-group" v-else>
        <label>Prompt {{ t('hookSettings.text') }} <span class="required">*</span></label>
        <textarea v-model="form.command" :placeholder="t('hookSettings.promptPlaceholder')" class="form-input form-textarea" rows="3"></textarea>
        <div class="form-hint">{{ t('hookSettings.promptHint') }}</div>
      </div>

      <div class="form-row">
        <div class="form-group form-group-half">
          <label>{{ t('hookSettings.timeoutSec') }}</label>
          <input v-model.number="form.timeout" type="number" min="1" max="300" class="form-input" />
        </div>
        <div class="form-group form-group-half">
          <label>{{ t('hookSettings.scope') }} <span class="required">*</span></label>
          <select v-model="form.scope" class="form-select">
            <option v-for="s in scopeList" :key="s.value" :value="s.value">{{ s.label }} ({{ s.path }})</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="form.enabled" class="accent-checkbox" />
          {{ t('hookSettings.enableOnCreate') }}
        </label>
      </div>

      <div class="form-actions">
        <button class="btn btn-secondary" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" @click="save" :disabled="!isValid">
          {{ isEditing ? t('hookSettings.saveChanges') : t('hookSettings.createHook') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { HOOK_EVENTS, HOOK_TOOL_MATCHERS, SCOPE_LABELS, eventHasMatcher } from '@/types/hooks'
import type { HookEventType, HookType, HookScope, HookFlatItem } from '@/types/hooks'

const { t } = useI18n()

const props = defineProps<{
  hook: HookFlatItem | null
  defaultEvent?: HookEventType
}>()

const emit = defineEmits<{
  save: [data: Omit<HookFlatItem, 'id'>]
  close: []
}>()

const isEditing = computed(() => !!props.hook)

const form = ref({
  name: '',
  event: 'PreToolUse' as HookEventType,
  matcher: '',
  type: 'command' as HookType,
  command: '',
  timeout: 30,
  scope: 'project' as HookScope,
  enabled: true,
})

const matcherPreset = ref('')

const eventList = HOOK_EVENTS
const toolMatchers = HOOK_TOOL_MATCHERS
const scopeList = Object.entries(SCOPE_LABELS).map(([value, info]) => ({
  value: value as HookScope,
  label: info.label,
  path: info.path,
}))

const currentEventHasMatcher = computed(() => eventHasMatcher(form.value.event))

const isValid = computed(() => {
  return form.value.name.trim() && form.value.command.trim()
})

watch(() => props.hook, (hook) => {
  if (hook) {
    form.value = {
      name: hook.name,
      event: hook.event,
      matcher: hook.matcher,
      type: hook.type,
      command: hook.command,
      timeout: hook.timeout,
      scope: hook.scope,
      enabled: !hook.disabled,
    }
  } else {
    form.value = {
      name: '',
      event: props.defaultEvent ?? 'PreToolUse',
      matcher: '',
      type: 'command',
      command: '',
      timeout: 30,
      scope: 'project',
      enabled: true,
    }
  }
}, { immediate: true })

function onEventChange() {
  if (!eventHasMatcher(form.value.event)) {
    form.value.matcher = ''
  }
}

function applyMatcherPreset() {
  if (matcherPreset.value) {
    form.value.matcher = matcherPreset.value
  }
}

function save() {
  emit('save', {
    name: form.value.name.trim(),
    event: form.value.event,
    matcher: form.value.matcher,
    type: form.value.type,
    command: form.value.command.trim(),
    timeout: form.value.timeout,
    scope: form.value.scope,
    disabled: !form.value.enabled,
  })
}
</script>

<style lang="scss" scoped>
.form-modal-overlay {
  position: fixed; inset: 0; background: var(--surface-glass-active);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.form-modal {
  width: 520px; max-height: 80vh; overflow-y: auto;
  background: var(--bg-elevated); border-radius: var(--radius-xl); padding: 24px;
  display: flex; flex-direction: column; gap: 16px;
  box-shadow: var(--shadow-xl);
  h3 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
}
.form-group { display: flex; flex-direction: column; gap: 6px;
  label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .required { color: var(--error); }
}
.form-input {
  padding: 10px 12px; background: var(--surface-soft); border: 1px solid var(--border-default);
  border-radius: 8px; color: var(--text-primary); font-size: 13px;
  &:focus { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-glow); }
  &::placeholder { color: var(--text-muted); }
}
.form-select {
  padding: 10px 12px; background: var(--surface-soft); border: 1px solid var(--border-default);
  border-radius: 8px; color: var(--text-primary); font-size: 13px; outline: none; cursor: pointer;
}
.form-textarea { resize: vertical; min-height: 70px; font-family: var(--font-mono); font-size: 12px; }
.form-hint { font-size: 11px; color: var(--text-muted); }
.form-row { display: flex; gap: 16px; }
.form-group-half { flex: 1; }
.matcher-input { display: flex; gap: 8px; }
.matcher-preset { width: 160px; flex-shrink: 0; }

.type-toggle { display: flex; gap: 6px; }
.type-btn {
  @include reset-button;
  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500;
  border: 1px solid var(--border-default); background: transparent; color: var(--text-muted);
  cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--border-strong); color: var(--text-primary); }
  &.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); color: var(--accent-primary); }
}

.checkbox-label {
  display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;
}
.accent-checkbox { accent-color: var(--accent-primary); }

.btn {
  @include reset-button;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;
  transition: all 0.2s;
  &.btn-primary { background: var(--accent-primary); color: white; &:hover:not(:disabled) { background: var(--accent-primary-hover); } }
  &.btn-secondary { background: var(--surface-soft); border: 1px solid var(--border-default); color: var(--text-primary); &:hover:not(:disabled) { background: var(--bg-hover); } }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
}
.form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border-default); }
</style>
