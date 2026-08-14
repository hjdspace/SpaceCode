<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArchiveRestore, Copy, Link2, X } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { AdoptOption, AdoptBatchItem } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: []; completed: [] }>()

const mode = ref<AdoptOption>('replace_with_link')
const busy = ref(false)
const error = ref<string | null>(null)

const conflicts = computed(() => store.unmanaged.filter((item) =>
  item.reason.toLowerCase().includes('same-name') || item.reason.toLowerCase().includes('differs')
))
const importable = computed(() => store.unmanaged.filter((item) =>
  Boolean(item.agentId) && !conflicts.value.some((conflict) => conflict.id === item.id)
))

const options = [
  { value: 'replace_with_link' as const, icon: Link2, title: 'syncWizardLinkTitle', desc: 'syncWizardLinkDesc', recommended: true },
  { value: 'replace_with_copy' as const, icon: Copy, title: 'syncWizardCopyTitle', desc: 'syncWizardCopyDesc', recommended: false },
  { value: 'import_to_center' as const, icon: ArchiveRestore, title: 'syncWizardKeepTitle', desc: 'syncWizardKeepDesc', recommended: false },
]

watch(() => props.visible, (visible) => {
  if (!visible) return
  mode.value = 'replace_with_link'
  error.value = null
})

async function execute(): Promise<void> {
  if (importable.value.length === 0) return
  busy.value = true
  error.value = null
  try {
    const items: AdoptBatchItem[] = importable.value.map((item) => ({
      agentId: item.agentId!,
      unmanagedId: item.id,
      option: mode.value,
    }))
    const result = await store.executeAdoptBatch(items)
    if (!result) {
      error.value = store.error ?? t('skillManagerV2.install.syncWizardFailed')
      return
    }
    await store.refresh()
    emit('completed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="visible" class="organize-overlay" @click.self="emit('close')">
    <section class="organize-dialog" role="dialog" aria-modal="true" :aria-label="t('skillManagerV2.install.syncWizardTitle')">
      <header class="organize-header">
        <h2>{{ t('skillManagerV2.install.syncWizardTitle') }}</h2>
        <button class="organize-close" :title="t('common.close')" @click="emit('close')"><X :size="20" /></button>
      </header>

      <div class="organize-body">
        <div class="organize-summary">
          <strong>{{ t('skillManagerV2.install.syncWizardCount', { count: importable.length }) }}</strong>
          <p>{{ t('skillManagerV2.install.syncWizardSummary') }}</p>
          <span v-if="conflicts.length">{{ t('skillManagerV2.install.syncWizardConflicts', { count: conflicts.length }) }}</span>
        </div>

        <div class="organize-options" role="radiogroup">
          <label v-for="option in options" :key="option.value" class="organize-option" :class="{ active: mode === option.value }">
            <input v-model="mode" type="radio" name="organize-mode" :value="option.value" />
            <span class="organize-option-icon"><component :is="option.icon" :size="20" /></span>
            <span class="organize-option-copy">
              <strong>{{ t(`skillManagerV2.install.${option.title}`) }}</strong>
              <small>{{ t(`skillManagerV2.install.${option.desc}`) }}</small>
            </span>
            <em v-if="option.recommended">{{ t('skillManagerV2.install.syncWizardRecommended') }}</em>
          </label>
        </div>

        <div v-if="error" class="organize-error" role="alert">{{ error }}</div>
      </div>

      <footer class="organize-footer">
        <button class="organize-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="organize-btn primary" :disabled="busy || importable.length === 0" @click="execute">
          {{ busy ? t('common.processing') : t('skillManagerV2.install.syncWizardStart') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.organize-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--text-primary) 34%, transparent);
}

.organize-dialog {
  width: min(680px, 100%);
  max-height: min(760px, 92vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}

.organize-header,
.organize-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-default);
}

.organize-header h2 { margin: 0; font: 700 22px/1.2 var(--font-display); }
.organize-close { display: grid; place-items: center; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; }
.organize-body { padding: 22px; overflow-y: auto; }

.organize-summary {
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, var(--border-default));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent-primary) 6%, var(--bg-elevated));
}
.organize-summary strong { font-size: 17px; }
.organize-summary p { margin: 7px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
.organize-summary span { display: block; margin-top: 8px; color: var(--warning); font-size: 12px; font-weight: 600; }

.organize-options { display: grid; gap: 10px; margin-top: 18px; }
.organize-option {
  min-height: 86px;
  display: grid;
  grid-template-columns: 20px 42px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease;
}
.organize-option:hover { background: var(--surface-soft); }
.organize-option.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }
.organize-option-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: var(--radius-sm); background: var(--surface-card); color: var(--accent-primary); }
.organize-option-copy strong, .organize-option-copy small { display: block; }
.organize-option-copy strong { font-size: 14px; }
.organize-option-copy small { margin-top: 5px; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
.organize-option em { padding: 4px 8px; border-radius: 999px; background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success); font-size: 11px; font-style: normal; font-weight: 700; }
.organize-error { margin-top: 14px; color: var(--error); font-size: 12px; }

.organize-footer { justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-default); border-bottom: 0; }
.organize-btn { height: 38px; padding: 0 18px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font-weight: 600; cursor: pointer; }
.organize-btn.primary { border-color: var(--accent-primary); background: var(--accent-primary); color: var(--text-on-accent, white); }
.organize-btn:disabled { opacity: .5; cursor: not-allowed; }

@media (max-width: 620px) {
  .organize-overlay { padding: 10px; }
  .organize-option { grid-template-columns: 20px 36px 1fr; }
  .organize-option em { grid-column: 3; justify-self: start; }
}
</style>
