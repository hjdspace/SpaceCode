<script setup lang="ts">
/**
 * Skill Manager V2 — Batch Conflict Dialog
 *
 * Choose one resolution mode for every visible/scope conflict item.
 * Reference: AgentBro `InstallView.tsx` `BatchConflictDialog`.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import type { BatchConflictMode } from './skillLabels'

const props = defineProps<{
  visible: boolean
  conflictCount: number
  /** true = only conflicts matching the current search/filters; false = whole agent scope */
  visibleOnly: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [mode: BatchConflictMode]
}>()

const { t } = useI18n()

const mode = ref<BatchConflictMode>('center_over_agent')

const options = computed(() => [
  {
    value: 'center_over_agent' as const,
    title: t('skillManagerV2.agentSync.batchCenterTitle'),
    desc: t('skillManagerV2.agentSync.batchCenterDesc'),
    badge: t('skillManagerV2.agentSync.badgeRecommended'),
    destructive: true,
  },
  {
    value: 'rename' as const,
    title: t('skillManagerV2.agentSync.batchRenameTitle'),
    desc: t('skillManagerV2.agentSync.batchRenameDesc'),
    badge: t('skillManagerV2.agentSync.badgeAdd'),
    destructive: false,
  },
  {
    value: 'overwrite_center' as const,
    title: t('skillManagerV2.agentSync.batchOverwriteTitle'),
    desc: t('skillManagerV2.agentSync.batchOverwriteDesc'),
    badge: t('skillManagerV2.agentSync.badgeOverwrite'),
    destructive: true,
  },
  {
    value: 'skip' as const,
    title: t('skillManagerV2.agentSync.batchSkipTitle'),
    desc: t('skillManagerV2.agentSync.batchSkipDesc'),
    badge: t('skillManagerV2.agentSync.badgeSkip'),
    destructive: false,
  },
])

const selected = computed(() => options.value.find((option) => option.value === mode.value))

watch(
  () => props.visible,
  (visible) => {
    if (visible) mode.value = 'center_over_agent'
  }
)

function onConfirm(): void {
  if (!props.busy) emit('confirm', mode.value)
}

function onClose(): void {
  if (!props.busy) emit('close')
}
</script>

<template>
  <div v-if="visible" class="bcd-overlay" @click.self="onClose">
    <section class="bcd-dialog" role="dialog" aria-modal="true" :aria-label="t('skillManagerV2.agentSync.batchTitle')">
      <header class="bcd-header">
        <h2>{{ t('skillManagerV2.agentSync.batchTitle') }}</h2>
        <button type="button" :disabled="busy" :title="t('common.close')" @click="onClose">
          <X :size="20" />
        </button>
      </header>

      <div class="bcd-body">
        <div class="bcd-summary" :class="{ conflict: selected?.destructive }">
          <strong>{{ t('skillManagerV2.agentSync.batchSummary', { count: conflictCount }) }}</strong>
          <span>{{
            visibleOnly
              ? t('skillManagerV2.agentSync.batchScopeVisible')
              : t('skillManagerV2.agentSync.batchScopeScoped')
          }}</span>
          <em>{{ t('skillManagerV2.agentSync.batchHint') }}</em>
        </div>

        <div class="bcd-options" role="radiogroup" :aria-label="t('skillManagerV2.agentSync.batchTitle')">
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="mode === option.value"
            class="bcd-option"
            :class="{ active: mode === option.value, destructive: option.destructive }"
            @click="mode = option.value"
          >
            <span class="bcd-radio" aria-hidden="true" />
            <span class="bcd-option-main">
              <strong>{{ option.title }}</strong>
              <span>{{ option.desc }}</span>
            </span>
            <em>{{ option.badge }}</em>
          </button>
        </div>
      </div>

      <footer class="bcd-footer">
        <button class="bcd-btn" type="button" :disabled="busy" @click="onClose">
          {{ t('common.cancel') }}
        </button>
        <button
          class="bcd-btn bcd-btn-primary"
          :class="{ danger: selected?.destructive && mode !== 'skip' }"
          type="button"
          :disabled="busy"
          @click="onConfirm"
        >
          {{ mode === 'rename'
            ? t('skillManagerV2.agentSync.batchRenameAction')
            : t('skillManagerV2.agentSync.batchStart') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.bcd-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(8, 13, 24, 0.62);
  backdrop-filter: blur(5px);
}

.bcd-dialog {
  width: min(640px, 100%);
  max-height: min(88vh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: 16px;
  background: var(--bg-primary);
  box-shadow: 0 30px 80px rgba(5, 10, 20, 0.36);
}

.bcd-header {
  min-height: 64px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 22px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-elevated);

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
  }

  button {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.bcd-body {
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 22px;
}

.bcd-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--success) 25%, var(--border-default));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--success) 6%, var(--bg-elevated));

  strong {
    font-size: 14px;
    color: var(--success);
  }
  span {
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
  }
  em {
    color: var(--text-muted);
    font-size: 11px;
    font-style: normal;
    line-height: 1.5;
  }

  &.conflict {
    border-color: color-mix(in srgb, var(--error) 28%, var(--border-default));
    background: color-mix(in srgb, var(--error) 6%, var(--bg-elevated));

    strong {
      color: var(--error);
    }
  }
}

.bcd-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.bcd-option {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.16s, background 0.16s;

  &:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary-glow);
  }

  &.destructive.active {
    border-color: rgba(220, 38, 38, 0.4);
    background: rgba(220, 38, 38, 0.06);
  }

  em {
    padding: 2px 7px;
    border-radius: var(--radius-full);
    background: var(--surface-card);
    color: var(--text-secondary);
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    white-space: nowrap;
  }

  &.active em {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  &.destructive.active em {
    background: var(--error);
    color: #fff;
  }
}

.bcd-radio {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-radius: 50%;
  transition: border-color 0.16s, box-shadow 0.16s;

  .bcd-option.active & {
    border-color: var(--accent-primary);
    box-shadow: inset 0 0 0 3px var(--bg-elevated);
    background: var(--accent-primary);
  }

  .bcd-option.destructive.active & {
    border-color: var(--error);
    background: var(--error);
  }
}

.bcd-option-main {
  min-width: 0;

  strong {
    display: block;
    font-size: 12px;
    font-weight: 700;
  }

  span {
    display: block;
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
}

.bcd-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-elevated);
}

.bcd-btn {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
}

.bcd-btn-primary {
  border-color: transparent;
  background: var(--accent-primary);
  color: var(--text-on-accent, #fff);

  &.danger {
    background: var(--error);
  }
}
</style>
