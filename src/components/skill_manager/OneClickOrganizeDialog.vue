<script setup lang="ts">
/**
 * Skill Manager V2 — One-Click Organize Dialog
 *
 * Choose an install mode for every scoped adoptable skill.
 * Reference: AgentBro `InstallView.tsx` `OneClickOrganizeDialog`.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import type { OneClickOrganizeMode } from './skillLabels'

const props = defineProps<{
  visible: boolean
  importableCount: number
  conflictCount: number
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [mode: OneClickOrganizeMode]
}>()

const { t } = useI18n()

const mode = ref<OneClickOrganizeMode>('import_link')

const options = computed(() => [
  {
    value: 'import_link' as const,
    title: t('skillManagerV2.agentSync.oneClickLinkTitle'),
    desc: t('skillManagerV2.agentSync.oneClickLinkDesc'),
    badge: t('skillManagerV2.agentSync.badgeRecommended'),
  },
  {
    value: 'import_copy' as const,
    title: t('skillManagerV2.agentSync.oneClickCopyTitle'),
    desc: t('skillManagerV2.agentSync.oneClickCopyDesc'),
    badge: '',
  },
  {
    value: 'import_keep' as const,
    title: t('skillManagerV2.agentSync.oneClickKeepTitle'),
    desc: t('skillManagerV2.agentSync.oneClickKeepDesc'),
    badge: '',
  },
])

watch(
  () => props.visible,
  (visible) => {
    if (visible) mode.value = 'import_link'
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
  <div v-if="visible" class="oco-overlay" @click.self="onClose">
    <section class="oco-dialog" role="dialog" aria-modal="true" :aria-label="t('skillManagerV2.agentSync.oneClickTitle')">
      <header class="oco-header">
        <h2>{{ t('skillManagerV2.agentSync.oneClickTitle') }}</h2>
        <button type="button" :disabled="busy" :title="t('common.close')" @click="onClose">
          <X :size="20" />
        </button>
      </header>

      <div class="oco-body">
        <div class="oco-summary">
          <strong>{{ t('skillManagerV2.agentSync.oneClickSummary', { count: importableCount }) }}</strong>
          <span>{{ t('skillManagerV2.agentSync.oneClickSummaryDesc') }}</span>
          <em v-if="conflictCount > 0">{{
            t('skillManagerV2.agentSync.oneClickConflicts', { count: conflictCount })
          }}</em>
        </div>

        <div class="oco-options" role="radiogroup" :aria-label="t('skillManagerV2.agentSync.oneClickMode')">
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="mode === option.value"
            class="oco-option"
            :class="{ active: mode === option.value }"
            @click="mode = option.value"
          >
            <span class="oco-radio" aria-hidden="true" />
            <span class="oco-option-main">
              <strong>{{ option.title }}</strong>
              <span>{{ option.desc }}</span>
            </span>
            <em v-if="option.badge">{{ option.badge }}</em>
          </button>
        </div>
      </div>

      <footer class="oco-footer">
        <button class="oco-btn" type="button" :disabled="busy" @click="onClose">
          {{ t('common.cancel') }}
        </button>
        <button class="oco-btn oco-btn-primary" type="button" :disabled="busy" @click="onConfirm">
          {{ busy ? t('common.processing') : t('skillManagerV2.agentSync.oneClickStart') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.oco-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(8, 13, 24, 0.62);
  backdrop-filter: blur(5px);
}

.oco-dialog {
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

.oco-header {
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

.oco-body {
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 22px;
}

.oco-summary {
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
    color: var(--warning);
    font-size: 11px;
    font-style: normal;
    line-height: 1.5;
  }
}

.oco-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.oco-option {
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
}

.oco-radio {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-radius: 50%;
  transition: border-color 0.16s, box-shadow 0.16s;

  .oco-option.active & {
    border-color: var(--accent-primary);
    box-shadow: inset 0 0 0 3px var(--bg-elevated);
    background: var(--accent-primary);
  }
}

.oco-option-main {
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

.oco-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-elevated);
}

.oco-btn {
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

.oco-btn-primary {
  border-color: transparent;
  background: var(--accent-primary);
  color: var(--text-on-accent, #fff);
}
</style>
