<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Check, Copy, Link2, X } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { DistributionPreview, InstallMode } from '@/types/skillManagerV2'
import AgentIconBadge from './AgentIconBadge.vue'

const props = defineProps<{ visible: boolean; skillIds: string[] }>()
const emit = defineEmits<{ close: []; distributed: [] }>()

const { t } = useI18n()
const store = useSkillManagerStore()
const selectedAgents = ref<string[]>([])
const selectedMode = ref<InstallMode>('link')
const preview = ref<DistributionPreview | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const skills = computed(() => store.skills.filter((skill) => props.skillIds.includes(skill.id)))
const agents = computed(() => store.agents.filter((agent) => agent.enabled))
const isBatch = computed(() => props.skillIds.length > 1)
const title = computed(() => isBatch.value
  ? t('skillManagerV2.distributeDialog.batchTitle', { count: props.skillIds.length })
  : t('skillManagerV2.distributeDialog.singleTitle', { name: skills.value[0]?.name ?? '' }))

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    selectedAgents.value = []
    selectedMode.value = store.settings?.defaultInstallMode ?? 'link'
    preview.value = null
    error.value = null
  },
)

function toggleAgent(agentId: string): void {
  selectedAgents.value = selectedAgents.value.includes(agentId)
    ? selectedAgents.value.filter((id) => id !== agentId)
    : [...selectedAgents.value, agentId]
  preview.value = null
}

function badgeFor(agentId: string, agentName: string) {
  return { agentId, agentName, mode: selectedMode.value, status: 'ok' as const }
}

async function handlePreview(): Promise<void> {
  if (selectedAgents.value.length === 0) return
  busy.value = true
  error.value = null
  try {
    preview.value = await store.previewDistribute(props.skillIds, selectedAgents.value, selectedMode.value)
    if (!preview.value) error.value = store.error ?? t('skillManagerV2.distributeDialog.previewFailed')
  } finally {
    busy.value = false
  }
}

async function handleExecute(): Promise<void> {
  if (!preview.value) return
  busy.value = true
  error.value = null
  try {
    const result = await store.executeDistribute(preview.value)
    if (!result) {
      error.value = store.error ?? t('skillManagerV2.distributeDialog.executeFailed')
      return
    }
    emit('distributed')
    emit('close')
  } finally {
    busy.value = false
  }
}

function handleClose(): void {
  if (!busy.value) emit('close')
}
</script>

<template>
  <div v-if="visible" class="dd-overlay" @click.self="handleClose">
    <section class="dd-dialog" role="dialog" aria-modal="true">
      <header class="dd-header">
        <h2>{{ title }}</h2>
        <button type="button" :disabled="busy" :title="t('common.close')" @click="handleClose"><X :size="20" /></button>
      </header>

      <div class="dd-body">
        <div class="dd-summary">
          <div class="dd-flow"><span>{{ props.skillIds.length }}</span><b>→</b><span>AG</span></div>
          <div><strong>{{ t('skillManagerV2.distributeDialog.skillCount', { count: props.skillIds.length }) }}</strong><p>{{ t('skillManagerV2.distributeDialog.summary') }}</p></div>
          <span class="dd-count">{{ selectedAgents.length }}/{{ agents.length }}</span>
        </div>

        <template v-if="!preview">
          <section class="dd-section">
            <div class="dd-section-head"><strong>{{ t('skillManagerV2.distributeDialog.modeTitle') }}</strong><span>{{ selectedMode === 'link' ? t('skillManagerV2.distributeDialog.linkEffect') : t('skillManagerV2.distributeDialog.copyEffect') }}</span></div>
            <div class="dd-mode-grid">
              <label :class="{ active: selectedMode === 'link' }">
                <input v-model="selectedMode" type="radio" value="link" />
                <span class="dd-mode-icon"><Link2 :size="20" /></span>
                <span><strong>{{ t('skillManagerV2.settings.modeLink') }} <em>{{ t('skillManagerV2.distributeDialog.recommended') }}</em></strong><small>{{ t('skillManagerV2.distributeDialog.linkHint') }}</small></span>
              </label>
              <label :class="{ active: selectedMode === 'copy' }">
                <input v-model="selectedMode" type="radio" value="copy" />
                <span class="dd-mode-icon"><Copy :size="20" /></span>
                <span><strong>{{ t('skillManagerV2.settings.modeCopy') }}</strong><small>{{ t('skillManagerV2.distributeDialog.copyHint') }}</small></span>
              </label>
            </div>
          </section>

          <section class="dd-section dd-agent-section">
            <div class="dd-section-head"><strong>{{ t('skillManagerV2.distributeDialog.targetAgents') }}</strong><span>{{ t('skillManagerV2.distributeDialog.available', { count: agents.length }) }}</span></div>
            <div v-if="agents.length === 0" class="dd-empty">{{ t('skillManagerV2.distributeDialog.noAgents') }}</div>
            <div v-else class="dd-agent-list">
              <label v-for="agent in agents" :key="agent.id" :class="{ active: selectedAgents.includes(agent.id) }">
                <input type="checkbox" :checked="selectedAgents.includes(agent.id)" @change="toggleAgent(agent.id)" />
                <span class="dd-checkbox"><Check v-if="selectedAgents.includes(agent.id)" :size="15" /></span>
                <AgentIconBadge :badge="badgeFor(agent.id, agent.displayName)" :size="32" />
                <span class="dd-agent-copy"><strong>{{ agent.displayName }}</strong><small>{{ agent.skillsDir ?? t('skillManagerV2.distributeDialog.pathUnavailable') }}</small></span>
              </label>
            </div>
          </section>
        </template>

        <template v-else>
          <section class="dd-section">
            <div class="dd-section-head"><strong>{{ t('skillManagerV2.distributeDialog.previewTitle') }}</strong><span>{{ preview.changes.length }} / {{ preview.blockers.length }}</span></div>
            <div class="dd-preview-list">
              <article v-for="change in preview.changes" :key="`${change.skillId}-${change.agentId}`" class="ok">
                <span>{{ change.action }}</span><div><strong>{{ change.skillName }} → {{ change.agentName }}</strong><small>{{ change.mode }}<template v-if="change.reason"> · {{ change.reason }}</template></small></div>
              </article>
              <article v-for="blocker in preview.blockers" :key="`${blocker.skillId}-${blocker.agentId}`" class="blocked">
                <span>!</span><div><strong>{{ blocker.skillName }} → {{ blocker.agentName }}</strong><small>{{ blocker.reason }}</small></div>
              </article>
              <div v-if="preview.changes.length === 0 && preview.blockers.length === 0" class="dd-empty">{{ t('skillManagerV2.distributeDialog.noChanges') }}</div>
            </div>
          </section>
        </template>

        <div v-if="error" class="dd-error">{{ error }}</div>
      </div>

      <footer class="dd-footer">
        <button v-if="preview" class="dd-btn" type="button" :disabled="busy" @click="preview = null"><ArrowLeft :size="16" />{{ t('skillManagerV2.actions.back') }}</button>
        <span />
        <button class="dd-btn" type="button" :disabled="busy" @click="handleClose">{{ t('skillManagerV2.actions.cancel') }}</button>
        <button v-if="!preview" class="dd-btn dd-btn-primary" type="button" :disabled="selectedAgents.length === 0 || busy" @click="handlePreview">{{ busy ? t('skillManagerV2.loading') : t('skillManagerV2.distributeDialog.previewAction') }}</button>
        <button v-else class="dd-btn dd-btn-primary" type="button" :disabled="busy || (preview.changes.length === 0 && preview.blockers.length === 0)" @click="handleExecute">{{ busy ? t('skillManagerV2.loading') : t('skillManagerV2.distributeDialog.executeAction') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.dd-overlay { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; padding: 22px; background: rgba(8, 13, 24, .62); backdrop-filter: blur(5px); }
.dd-dialog { width: min(760px, 100%); max-height: min(88vh, 820px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border-default); border-radius: 16px; background: var(--bg-primary); box-shadow: 0 30px 80px rgba(5, 10, 20, .36); }
.dd-header { min-height: 72px; display: flex; justify-content: space-between; align-items: center; padding: 0 24px; border-bottom: 1px solid var(--border-default); background: var(--bg-elevated); }.dd-header h2 { margin: 0; font-family: var(--font-display); font-size: 21px; }.dd-header button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-muted); cursor: pointer; }.dd-header button:hover { background: var(--bg-hover); color: var(--text-primary); }
.dd-body { min-height: 0; overflow-y: auto; padding: 20px 24px 26px; }.dd-summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 16px; margin-bottom: 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: color-mix(in srgb, var(--bg-elevated) 92%, var(--accent-primary) 8%); }.dd-flow { display: flex; align-items: center; gap: 8px; padding: 7px; border-radius: 12px; background: var(--text-primary); color: var(--bg-primary); }.dd-flow span { min-width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: color-mix(in srgb, var(--bg-primary) 16%, transparent); font-weight: 800; }.dd-summary strong { font-size: 15px; }.dd-summary p { margin: 4px 0 0; color: var(--text-muted); font-size: 11px; }.dd-count { min-width: 70px; padding: 8px 12px; border-radius: 999px; background: var(--accent-primary-glow); color: var(--accent-primary); font-size: 14px; font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; }
.dd-section { padding: 18px; margin-top: 14px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }.dd-section-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 14px; }.dd-section-head strong { font-size: 13px; }.dd-section-head span { color: var(--text-muted); font-size: 11px; }
.dd-mode-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.dd-mode-grid label { min-height: 100px; display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; transition: border-color .18s, background .18s; }.dd-mode-grid label.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }.dd-mode-grid input { position: absolute; opacity: 0; pointer-events: none; }.dd-mode-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 12px; background: var(--surface-soft); color: var(--text-secondary); }.dd-mode-grid label.active .dd-mode-icon { background: var(--accent-primary); color: var(--text-on-accent, #fff); }.dd-mode-grid strong, .dd-mode-grid small { display: block; }.dd-mode-grid strong { font-size: 13px; }.dd-mode-grid small { margin-top: 5px; color: var(--text-muted); font-size: 11px; line-height: 1.45; }.dd-mode-grid em { padding: 2px 5px; margin-left: 4px; border-radius: 5px; background: var(--accent-primary-glow); color: var(--accent-primary); font-size: 9px; font-style: normal; }
.dd-agent-list { max-height: 300px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; }.dd-agent-list label { display: grid; grid-template-columns: 24px 36px minmax(0, 1fr); gap: 10px; align-items: center; padding: 11px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; transition: border-color .18s, background .18s; }.dd-agent-list label.active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }.dd-agent-list input { position: absolute; opacity: 0; }.dd-checkbox { width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid var(--border-strong); border-radius: 6px; color: var(--text-on-accent, #fff); }.dd-agent-list label.active .dd-checkbox { border-color: var(--accent-primary); background: var(--accent-primary); }.dd-agent-copy { min-width: 0; }.dd-agent-copy strong, .dd-agent-copy small { display: block; }.dd-agent-copy strong { font-size: 12px; }.dd-agent-copy small { margin-top: 3px; overflow: hidden; color: var(--text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.dd-preview-list { display: flex; flex-direction: column; gap: 8px; }.dd-preview-list article { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; padding: 11px; border-radius: var(--radius-md); background: var(--surface-soft); }.dd-preview-list article > span { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; font-size: 10px; font-weight: 800; }.dd-preview-list article.ok > span { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }.dd-preview-list article.blocked > span { background: color-mix(in srgb, var(--warning) 14%, transparent); color: var(--warning); }.dd-preview-list strong, .dd-preview-list small { display: block; }.dd-preview-list strong { font-size: 11px; }.dd-preview-list small { margin-top: 4px; color: var(--text-muted); font-size: 10px; }
.dd-error { padding: 10px 12px; margin-top: 12px; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--error) 12%, transparent); color: var(--error); font-size: 11px; }.dd-empty { padding: 28px; color: var(--text-muted); font-size: 11px; text-align: center; }
.dd-footer { display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px; align-items: center; padding: 14px 24px; border-top: 1px solid var(--border-default); background: var(--bg-elevated); }.dd-btn { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 15px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-weight: 700; cursor: pointer; }.dd-btn:hover:not(:disabled) { border-color: var(--accent-primary); background: var(--bg-hover); }.dd-btn:disabled { cursor: not-allowed; opacity: .45; }.dd-btn-primary { border-color: transparent; background: var(--accent-primary); color: var(--text-on-accent, #fff); }
@media (max-width: 620px) { .dd-overlay { padding: 0; }.dd-dialog { height: 100%; max-height: none; border-radius: 0; }.dd-body { padding: 16px; }.dd-mode-grid { grid-template-columns: 1fr; }.dd-summary { grid-template-columns: auto minmax(0, 1fr); }.dd-count { grid-column: 1 / -1; }.dd-footer { grid-template-columns: 1fr 1fr; }.dd-footer > span { display: none; }.dd-footer .dd-btn { width: 100%; } }
</style>
