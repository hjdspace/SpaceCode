<script setup lang="ts">
/**
 * Skill Manager V2 — Apply Pack Dialog
 *
 * Select target agents, preview distribution, then execute.
 * Reference: AgentBro `src/components/skills-v2/SkillPackPage.tsx` (ApplyPackDialog)
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Check, Copy, Link2, X } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillPackDetail, InstallMode, DistributionPreview, AgentBadge } from '@/types/skillManagerV2'
import AgentIconBadge from './AgentIconBadge.vue'

const props = defineProps<{
  pack: SkillPackDetail
}>()

const emit = defineEmits<{
  close: []
  done: []
}>()

const { t } = useI18n()
const store = useSkillManagerStore()

const selected = ref<Set<string>>(new Set())
const mode = ref<InstallMode>('link')
const preview = ref<DistributionPreview | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

/** Shared `.agents` skills dir is not a distribution target (same as AgentBro). */
const SHARED_SKILLS_AGENT_ID = 'agents'

const agents = computed(() => store.agents.filter((a) => a.enabled && a.id !== SHARED_SKILLS_AGENT_ID))

const changesByAction = computed(() => {
  if (!preview.value) return { create: 0, reuse: 0 }
  const g = { create: 0, reuse: 0 }
  for (const c of preview.value.changes) {
    if (c.action === 'create') g.create++
    else if (c.action === 'reuse') g.reuse++
  }
  return g
})

watch(
  () => props.pack,
  () => {
    selected.value = new Set()
    mode.value = (store.settings?.defaultInstallMode ?? 'link') as InstallMode
    preview.value = null
    error.value = null
  }
)

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
  preview.value = null
  error.value = null
}

function badgeFor(agentId: string, agentName: string): AgentBadge {
  return { agentId, agentName, mode: mode.value, status: 'ok' }
}

function actionLabel(action: 'create' | 'reuse' | 'blocked'): string {
  if (action === 'create') return t('skillManagerV2.pack.actionCreate')
  if (action === 'reuse') return t('skillManagerV2.pack.actionReuse')
  return t('skillManagerV2.pack.actionBlocked')
}

async function runPreview(): Promise<void> {
  if (selected.value.size === 0) return
  busy.value = true
  error.value = null
  try {
    const result = await store.previewApplyPack(props.pack.id, Array.from(selected.value), mode.value)
    if (result) {
      preview.value = result
    } else {
      error.value = store.error ?? t('skillManagerV2.pack.previewFailed')
    }
  } finally {
    busy.value = false
  }
}

async function execute(): Promise<void> {
  if (!preview.value) return
  busy.value = true
  error.value = null
  try {
    const result = await store.executeApplyPack(props.pack.id, Array.from(selected.value), mode.value)
    if (!result) {
      error.value = store.error ?? t('skillManagerV2.pack.executeFailed')
      return
    }
    if (result.failed > 0 && result.errors.length > 0) {
      error.value = result.errors.join('；')
      return
    }
    emit('done')
  } finally {
    busy.value = false
  }
}

function close(): void {
  if (!busy.value) emit('close')
}
</script>

<template>
  <div class="ap-overlay" @click.self="close">
    <section class="ap-dialog" role="dialog" aria-modal="true">
      <header class="ap-header">
        <h2>{{ preview ? t('skillManagerV2.pack.confirmTitle') : t('skillManagerV2.pack.applyTitle', { name: pack.name }) }}</h2>
        <button type="button" :disabled="busy" :title="t('common.close')" @click="close"><X :size="20" /></button>
      </header>

      <div class="ap-body">
        <div class="ap-summary">
          <div class="ap-flow"><span>{{ pack.members.length }}</span><b>→</b><span>AG</span></div>
          <div>
            <strong>{{ pack.name }}</strong>
            <p>{{ t('skillManagerV2.pack.applySummary') }}</p>
          </div>
          <span class="ap-count">{{ selected.size }}/{{ agents.length }}</span>
        </div>

        <!-- Selection phase -->
        <template v-if="!preview">
          <section class="ap-section">
            <div class="ap-section-head">
              <strong>{{ t('skillManagerV2.distributeDialog.modeTitle') }}</strong>
              <span>{{ mode === 'link' ? t('skillManagerV2.distributeDialog.linkEffect') : t('skillManagerV2.distributeDialog.copyEffect') }}</span>
            </div>
            <div class="ap-mode-grid">
              <label :class="{ active: mode === 'link' }">
                <input v-model="mode" type="radio" value="link" />
                <span class="ap-mode-icon"><Link2 :size="20" /></span>
                <span>
                  <strong>{{ t('skillManagerV2.settings.modeLink') }} <em>{{ t('skillManagerV2.distributeDialog.recommended') }}</em></strong>
                  <small>{{ t('skillManagerV2.distributeDialog.linkHint') }}</small>
                </span>
              </label>
              <label :class="{ active: mode === 'copy' }">
                <input v-model="mode" type="radio" value="copy" />
                <span class="ap-mode-icon"><Copy :size="20" /></span>
                <span>
                  <strong>{{ t('skillManagerV2.settings.modeCopy') }}</strong>
                  <small>{{ t('skillManagerV2.distributeDialog.copyHint') }}</small>
                </span>
              </label>
            </div>
          </section>

          <section class="ap-section">
            <div class="ap-section-head">
              <strong>{{ t('skillManagerV2.pack.targetAgents') }}</strong>
              <span>{{ t('skillManagerV2.distributeDialog.available', { count: agents.length }) }}</span>
            </div>
            <div v-if="agents.length === 0" class="ap-empty">{{ t('skillManagerV2.pack.noAgents') }}</div>
            <div v-else class="ap-agent-list">
              <label
                v-for="agent in agents"
                :key="agent.id"
                :class="{ active: selected.has(agent.id) }"
              >
                <input
                  type="checkbox"
                  :checked="selected.has(agent.id)"
                  @change="toggle(agent.id)"
                />
                <span class="ap-checkbox"><Check v-if="selected.has(agent.id)" :size="15" /></span>
                <AgentIconBadge :badge="badgeFor(agent.id, agent.displayName)" :size="32" />
                <span class="ap-agent-copy">
                  <strong>{{ agent.displayName }}</strong>
                  <small>{{ agent.skillsDir ?? t('skillManagerV2.distributeDialog.pathUnavailable') }}</small>
                </span>
              </label>
            </div>
          </section>
        </template>

        <!-- Preview phase -->
        <template v-else>
          <section class="ap-section">
            <div class="ap-stats">
              <div class="ap-stat">
                <strong>{{ changesByAction.create }}</strong>
                <span>{{ t('skillManagerV2.pack.newTargets') }}</span>
              </div>
              <div class="ap-stat">
                <strong>{{ changesByAction.reuse }}</strong>
                <span>{{ t('skillManagerV2.pack.reuseTargets') }}</span>
              </div>
              <div class="ap-stat" :class="{ warn: preview.blockers.length > 0 }">
                <strong>{{ preview.blockers.length }}</strong>
                <span>{{ t('skillManagerV2.pack.blockers') }}</span>
              </div>
            </div>

            <div class="ap-preview-list">
              <article v-for="change in preview.changes" :key="`${change.skillId}-${change.agentId}`" class="ok">
                <span>{{ actionLabel(change.action) }}</span>
                <div>
                  <strong>{{ change.skillName }} → {{ change.agentName }}</strong>
                  <small>
                    {{ change.mode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }}
                    <template v-if="change.reason"> · {{ change.reason }}</template>
                  </small>
                </div>
              </article>
              <article v-for="blocker in preview.blockers" :key="`${blocker.skillId}-${blocker.agentId}`" class="blocked">
                <span>{{ actionLabel('blocked') }}</span>
                <div>
                  <strong>{{ blocker.skillName }} → {{ blocker.agentName }}</strong>
                  <small>{{ blocker.reason }}</small>
                </div>
              </article>
              <div v-if="preview.changes.length === 0 && preview.blockers.length === 0" class="ap-empty">
                {{ t('skillManagerV2.distributeDialog.noChanges') }}
              </div>
            </div>
          </section>
        </template>

        <div v-if="error" class="ap-error">{{ error }}</div>
      </div>

      <footer class="ap-footer">
        <button v-if="preview" class="ap-btn" type="button" :disabled="busy" @click="preview = null; error = null">
          <ArrowLeft :size="16" />{{ t('skillManagerV2.actions.back') }}
        </button>
        <span />
        <button class="ap-btn" type="button" :disabled="busy" @click="close">{{ t('skillManagerV2.actions.cancel') }}</button>
        <button
          v-if="!preview"
          class="ap-btn ap-btn-primary"
          type="button"
          :disabled="selected.size === 0 || busy"
          @click="runPreview"
        >
          {{ busy ? t('common.processing') : t('skillManagerV2.pack.previewButton') }}
        </button>
        <button
          v-else
          class="ap-btn ap-btn-primary"
          type="button"
          :disabled="busy || (preview.changes.length === 0 && preview.blockers.length === 0)"
          @click="execute"
        >
          {{ busy ? t('common.processing') : t('skillManagerV2.pack.executeButton') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.ap-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(8, 13, 24, 0.62);
  backdrop-filter: blur(5px);
}

.ap-dialog {
  width: min(720px, 100%);
  max-height: min(88vh, 820px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: 16px;
  background: var(--bg-primary);
  box-shadow: 0 30px 80px rgba(5, 10, 20, 0.36);
}

.ap-header {
  min-height: 72px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-elevated);

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 21px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

.ap-body {
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 26px;
}

.ap-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-elevated) 92%, var(--accent-primary) 8%);
}

.ap-flow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px;
  border-radius: 12px;
  background: var(--text-primary);
  color: var(--bg-primary);

  span {
    min-width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-primary) 16%, transparent);
    font-weight: 800;
  }
}

.ap-summary strong {
  font-size: 15px;
}

.ap-summary p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 11px;
}

.ap-count {
  min-width: 70px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 14px;
  font-weight: 800;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.ap-section {
  padding: 18px;
  margin-top: 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.ap-section-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;

  strong { font-size: 13px; }
  span { color: var(--text-muted); font-size: 11px; }
}

.ap-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  label {
    min-height: 100px;
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 14px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.18s, background 0.18s;

    &.active {
      border-color: var(--accent-primary);
      background: var(--accent-primary-glow);
    }
  }

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
}

.ap-mode-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--surface-soft);
  color: var(--text-secondary);
}

.ap-mode-grid label.active .ap-mode-icon {
  background: var(--accent-primary);
  color: var(--text-on-accent, #fff);
}

.ap-mode-grid strong,
.ap-mode-grid small {
  display: block;
}

.ap-mode-grid strong { font-size: 13px; }

.ap-mode-grid small {
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.ap-mode-grid em {
  padding: 2px 5px;
  margin-left: 4px;
  border-radius: 5px;
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 9px;
  font-style: normal;
}

.ap-agent-list {
  max-height: 300px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 4px;

  label {
    display: grid;
    grid-template-columns: 24px 36px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 11px 12px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.18s, background 0.18s;

    &.active {
      border-color: var(--accent-primary);
      background: var(--accent-primary-glow);
    }
  }

  input {
    position: absolute;
    opacity: 0;
  }
}

.ap-checkbox {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text-on-accent, #fff);
}

.ap-agent-list label.active .ap-checkbox {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
}

.ap-agent-copy {
  min-width: 0;

  strong,
  small { display: block; }
  strong { font-size: 12px; }
  small {
    margin-top: 3px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.ap-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.ap-stat {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);

  strong {
    display: block;
    font-size: 20px;
    font-weight: 800;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  span {
    display: block;
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
  }

  &.warn strong { color: var(--warning); }
}

.ap-preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;

  article {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 11px;
    border-radius: var(--radius-md);
    background: var(--surface-soft);

    > span {
      min-width: 40px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 800;
    }

    &.ok > span {
      background: color-mix(in srgb, var(--success) 14%, transparent);
      color: var(--success);
    }

    &.blocked > span {
      background: color-mix(in srgb, var(--warning) 14%, transparent);
      color: var(--warning);
    }
  }

  strong,
  small { display: block; }
  strong { font-size: 11px; }
  small {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 10px;
  }
}

.ap-error {
  padding: 10px 12px;
  margin-top: 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--error) 12%, transparent);
  color: var(--error);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.ap-empty {
  padding: 28px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
}

.ap-footer {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 14px 24px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-elevated);
}

.ap-btn {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 15px;
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

.ap-btn-primary {
  border-color: transparent;
  background: var(--accent-primary);
  color: var(--text-on-accent, #fff);
}

@media (max-width: 620px) {
  .ap-overlay { padding: 0; }
  .ap-dialog {
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
  .ap-body { padding: 16px; }
  .ap-mode-grid { grid-template-columns: 1fr; }
  .ap-summary { grid-template-columns: auto minmax(0, 1fr); }
  .ap-count { grid-column: 1 / -1; }
  .ap-stats { grid-template-columns: 1fr; }
  .ap-footer {
    grid-template-columns: 1fr 1fr;

    > span { display: none; }
    .ap-btn { width: 100%; }
  }
}
</style>
