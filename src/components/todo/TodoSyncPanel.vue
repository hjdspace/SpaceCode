<template>
  <Teleport to="body">
    <Transition name="sync-modal">
      <div v-if="visible" class="sync-overlay" @click.self="close">
        <div class="sync-modal" role="dialog" :aria-label="t('todo.sync.title')">
          <header class="sync-head">
            <span class="sync-icon"><RefreshCw :size="17" :class="{ spin: state.syncing }" /></span>
            <div class="sync-heads">
              <div class="sync-title">{{ t('todo.sync.title') }}</div>
              <div class="sync-subtitle">{{ t('todo.sync.subtitle') }}</div>
            </div>
            <button
              type="button"
              class="sync-close"
              :title="t('todo.sync.close')"
              :aria-label="t('todo.sync.close')"
              @click="close"
            >
              <X :size="17" />
            </button>
          </header>

          <div class="sync-body">
            <div v-if="!state.supported" class="unsupported">
              <span class="unsupported-icon"><MonitorSmartphone :size="22" /></span>
              <div class="unsupported-title">{{ t('todo.sync.unsupported') }}</div>
              <p class="unsupported-hint">{{ t('todo.sync.unsupportedHint') }}</p>
            </div>

            <template v-else>
              <section class="sync-field">
                <div class="field-head">
                  <span class="field-label">{{ t('todo.sync.permission') }}</span>
                  <span class="perm-badge" :class="`is-${state.permission}`">{{ permissionLabel }}</span>
                </div>
                <button
                  type="button"
                  class="sync-btn"
                  :disabled="requesting || state.permission === 'granted'"
                  @click="requestAccess"
                >
                  <ShieldCheck :size="13" />
                  {{ requesting ? t('todo.sync.requesting') : t('todo.sync.requestAccess') }}
                </button>
                <p class="field-hint">{{ t('todo.sync.permissionHint') }}</p>
              </section>

              <section class="sync-field">
                <span class="field-label">{{ t('todo.sync.list') }}</span>
                <select
                  class="sync-select"
                  :value="state.config.listId ?? ''"
                  :disabled="state.lists.length === 0"
                  :aria-label="t('todo.sync.list')"
                  @change="onList"
                >
                  <option value="" disabled>{{ t('todo.sync.listPlaceholder') }}</option>
                  <option v-for="list in state.lists" :key="list.id" :value="list.id">
                    {{ list.title }}{{ list.writable ? '' : ` · ${t('todo.sync.readOnlyList')}` }}
                  </option>
                </select>
                <p v-if="state.lists.length === 0" class="field-hint">{{ t('todo.sync.noLists') }}</p>
              </section>

              <section class="sync-field">
                <label class="toggle-row">
                  <span class="toggle-text">
                    <span class="field-label">{{ t('todo.sync.enable') }}</span>
                    <span class="field-hint">{{ t('todo.sync.enableHint') }}</span>
                  </span>
                  <input
                    type="checkbox"
                    class="toggle-input"
                    :checked="state.config.enabled"
                    :disabled="!state.config.listId"
                    @change="onToggle"
                  />
                  <span class="toggle-track" aria-hidden="true"><span class="toggle-knob" /></span>
                </label>
                <div class="sync-run">
                  <button
                    type="button"
                    class="sync-btn is-primary"
                    :disabled="state.syncing || !state.config.listId"
                    @click="todoStore.syncNow()"
                  >
                    <RefreshCw :size="13" :class="{ spin: state.syncing }" />
                    {{ state.syncing ? t('todo.sync.syncing') : t('todo.sync.syncNow') }}
                  </button>
                  <span class="last-sync">
                    {{ state.lastSyncAt ? t('todo.sync.lastSync', { time: relative(state.lastSyncAt) }) : t('todo.sync.never') }}
                  </span>
                </div>
              </section>

              <div v-if="state.lastError" class="sync-error">
                <AlertTriangle :size="13" />
                {{ t(`todo.sync.errors.${state.lastError}`) }}
              </div>

              <section v-if="state.conflicts.length > 0" class="sync-field">
                <div class="field-head">
                  <span class="field-label">{{ t('todo.sync.conflicts') }}</span>
                  <span class="conflict-count">{{ state.conflicts.length }}</span>
                </div>
                <p class="field-hint">{{ t('todo.sync.conflictsHint') }}</p>
                <div class="conflict-list">
                  <article v-for="conflict in state.conflicts" :key="conflict.id" class="conflict-card">
                    <div class="conflict-head">
                      <span class="conflict-kind" :class="`is-${conflict.kind}`">
                        {{ conflict.kind === 'deleted' ? t('todo.sync.conflictDeleted') : t('todo.sync.conflictChanged') }}
                      </span>
                      <span class="conflict-time">{{ t('todo.sync.detectedAt', { time: relative(conflict.detectedAt) }) }}</span>
                    </div>
                    <div class="conflict-versions">
                      <span class="version is-local">{{ t('todo.sync.localVersion', { title: conflict.todoTitle }) }}</span>
                      <span class="version is-native">{{ t('todo.sync.nativeVersion', { title: conflict.nativeTitle }) }}</span>
                    </div>
                    <div class="conflict-actions">
                      <button type="button" class="sync-btn" @click="todoStore.resolveSyncConflict(conflict.id, 'local')">
                        <Laptop :size="12" />
                        {{ t('todo.sync.keepLocal') }}
                      </button>
                      <button type="button" class="sync-btn" @click="todoStore.resolveSyncConflict(conflict.id, 'native')">
                        <Apple :size="12" />
                        {{ t('todo.sync.keepNative') }}
                      </button>
                    </div>
                  </article>
                </div>
              </section>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Apple, Laptop, MonitorSmartphone, RefreshCw, ShieldCheck, X } from 'lucide-vue-next'
import { useTodoStore } from '@/stores/todo'
import { formatRelativeFromNow } from '@/utils/todoTime'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const { t, locale } = useI18n()
const todoStore = useTodoStore()
const requesting = ref(false)

const state = computed(() => todoStore.syncState)

const permissionLabel = computed(() => {
  switch (state.value.permission) {
    case 'granted':
      return t('todo.sync.permissionGranted')
    case 'denied':
      return t('todo.sync.permissionDenied')
    case 'unsupported':
      return t('todo.sync.permissionUnsupported')
    default:
      return t('todo.sync.permissionUnknown')
  }
})

function relative(ms: number): string {
  return formatRelativeFromNow(ms, Date.now(), locale.value)
}

function close(): void {
  emit('update:visible', false)
}

async function requestAccess(): Promise<void> {
  requesting.value = true
  await todoStore.requestSyncAccess()
  requesting.value = false
}

function onList(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void todoStore.setSyncConfig({ listId: value || null })
}

function onToggle(event: Event): void {
  const input = event.target as HTMLInputElement
  void todoStore.setSyncConfig({ enabled: input.checked }).then(() => {
    // 保存失败时 config.enabled 没变，Vue 不会重新 patch checked，开关会停在「已开」的假象上。
    input.checked = state.value.config.enabled
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

watch(
  () => props.visible,
  open => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
  { immediate: true },
)

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style lang="scss" scoped>
.sync-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay-scrim);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.sync-modal {
  width: 520px;
  max-width: 100%;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.sync-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--todo-hue-cyan) 14%, transparent),
    color-mix(in srgb, var(--todo-hue-blue) 10%, transparent)
  );
}

.sync-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--todo-hue-cyan) 20%, transparent);
  color: var(--todo-hue-cyan);
}

.sync-heads {
  min-width: 0;
}

.sync-title {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.sync-subtitle {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.sync-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.spin {
  animation: todo-sync-spin 1.1s linear infinite;
}

@keyframes todo-sync-spin {
  to {
    transform: rotate(360deg);
  }
}

.sync-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;

  @include scrollbar-thin;
}

.unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 22px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  text-align: center;
}

.unsupported-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: var(--radius-full);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--todo-hue-cyan) 22%, transparent),
    color-mix(in srgb, var(--todo-hue-violet) 22%, transparent)
  );
  color: var(--todo-hue-cyan);
}

.unsupported-title {
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.unsupported-hint {
  margin: 0;
  max-width: 400px;
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
  color: var(--text-muted);
}

.sync-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-label {
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.field-hint {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-disabled);
}

.perm-badge {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-muted);
  background: var(--surface-glass-hover);

  &.is-granted {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }

  &.is-denied {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 14%, transparent);
  }
}

.sync-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  align-self: flex-start;
  padding: 7px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-md);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &.is-primary {
    border-color: transparent;
    background: var(--accent-primary);
    color: #fff;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
      color: #fff;
    }
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.sync-select {
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-md);
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  position: relative;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--surface-strong);
  transition: background var(--transition-fast);
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-fast);
}

.toggle-input:checked + .toggle-track {
  background: var(--accent-primary);

  .toggle-knob {
    transform: translateX(16px);
  }
}

.toggle-input:disabled + .toggle-track {
  opacity: 0.45;
}

.toggle-input:focus-visible + .toggle-track {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.sync-run {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.last-sync {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.sync-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 9px 11px;
  border: 1px solid color-mix(in srgb, var(--error) 32%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--error) 10%, transparent);
  color: var(--error);
  font-size: var(--text-md);
  line-height: var(--leading-normal);

  svg {
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.conflict-count {
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--warning) 28%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--warning) 7%, transparent);
}

.conflict-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conflict-kind {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--warning);

  &.is-deleted {
    color: var(--error);
  }
}

.conflict-time {
  margin-left: auto;
  font-size: var(--text-2xs);
  color: var(--text-disabled);
}

.conflict-versions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.version {
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  border-left: 2px solid var(--todo-hue-teal);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.is-native {
    border-left-color: var(--todo-hue-cyan);
  }
}

.conflict-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sync-modal-enter-active,
.sync-modal-leave-active {
  transition: opacity var(--transition-normal);

  .sync-modal {
    transition: transform var(--transition-normal), opacity var(--transition-normal);
  }
}

.sync-modal-enter-from,
.sync-modal-leave-to {
  opacity: 0;

  .sync-modal {
    transform: translateY(10px) scale(0.98);
    opacity: 0;
  }
}
</style>