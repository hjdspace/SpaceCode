<script setup lang="ts">
/**
 * Skill Manager V2 — Apply Pack Dialog
 *
 * Select target agents, preview distribution, then execute.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillPackDetail, InstallMode, DistributionPreview } from '@/types/skillManagerV2'

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

const agents = computed(() => store.agents.filter((a) => a.enabled))

watch(
  () => props.pack,
  () => {
    selected.value = new Set()
    mode.value = (store.settings?.defaultInstallMode ?? 'link') as InstallMode
    preview.value = null
    error.value = null
  }
)

const changesByAction = computed(() => {
  if (!preview.value) return { create: 0, reuse: 0 }
  const g = { create: 0, reuse: 0 }
  for (const c of preview.value.changes) {
    if (c.action === 'create') g.create++
    else if (c.action === 'reuse') g.reuse++
  }
  return g
})

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
  preview.value = null
  error.value = null
}

async function runPreview(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    preview.value = await store.previewApplyPack(
      props.pack.id,
      Array.from(selected.value),
      mode.value
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function execute(): Promise<void> {
  if (!preview.value) return
  busy.value = true
  error.value = null
  try {
    const result = await store.executeApplyPack(
      props.pack.id,
      Array.from(selected.value),
      mode.value
    )
    if (result) {
      emit('done')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function close(): void {
  emit('close')
}
</script>

<template>
  <div class="spp-overlay" @click.self="close">
    <div class="spp-modal spp-modal-lg">
      <div class="spp-modal-header">
        <h3>{{ t('skillManagerV2.pack.applyTitle', { name: pack.name }) }}</h3>
        <button class="spp-close-btn" @click="close">&times;</button>
      </div>
      <div class="spp-modal-body">
        <!-- Selection phase -->
        <template v-if="!preview">
          <div class="spp-apply-form">
            <div class="spp-apply-row">
              <label class="spp-field">
                <span>{{ t('skillManagerV2.settings.defaultInstallMode') }}</span>
                <select v-model="mode">
                  <option value="link">{{ t('skillManagerV2.settings.modeLink') }}</option>
                  <option value="copy">{{ t('skillManagerV2.settings.modeCopy') }}</option>
                </select>
              </label>
              <div class="spp-field">
                <span>{{ t('skillManagerV2.pack.memberCount') }}</span>
                <input :value="pack.members.length + ' ' + t('skillManagerV2.pack.skills')" readonly />
              </div>
            </div>
            <div class="spp-apply-section">
              <div class="spp-apply-label">{{ t('skillManagerV2.pack.targetAgents') }}</div>
              <div class="spp-agent-grid">
                <button
                  v-for="agent in agents"
                  :key="agent.id"
                  class="spp-agent-choice"
                  :class="{ active: selected.has(agent.id) }"
                  @click="toggle(agent.id)"
                >
                  <span class="spp-agent-glyph">{{ agent.displayName.slice(0, 2).toUpperCase() }}</span>
                  <span>{{ agent.displayName }}</span>
                </button>
              </div>
              <div v-if="agents.length === 0" class="spp-section-empty sm">
                {{ t('skillManagerV2.pack.noAgents') }}
              </div>
            </div>
          </div>
        </template>

        <!-- Preview phase -->
        <template v-else>
          <div class="spp-preview-stats">
            <div class="spp-stat">
              <strong>{{ changesByAction.create }}</strong>
              <span>{{ t('skillManagerV2.pack.newTargets') }}</span>
            </div>
            <div class="spp-stat">
              <strong>{{ changesByAction.reuse }}</strong>
              <span>{{ t('skillManagerV2.pack.reuseTargets') }}</span>
            </div>
            <div class="spp-stat" :class="{ warn: preview.blockers.length > 0 }">
              <strong>{{ preview.blockers.length }}</strong>
              <span>{{ t('skillManagerV2.pack.blockers') }}</span>
            </div>
          </div>
          <div v-if="preview.changes.length > 0" class="spp-changes-list">
            <div
              v-for="(change, i) in preview.changes"
              :key="i"
              class="spp-change-item"
              :class="change.action"
            >
              <span class="spp-change-action">{{ change.action }}</span>
              <span>{{ change.skillName }}</span>
              <span class="spp-change-arrow">&rarr;</span>
              <span>{{ change.agentName }}</span>
              <span class="spp-change-mode">({{ change.mode }})</span>
            </div>
          </div>
          <div v-if="preview.blockers.length > 0" class="spp-blockers-list">
            <div
              v-for="(blocker, i) in preview.blockers"
              :key="i"
              class="spp-blocker-item"
            >
              <span class="spp-blocker-icon">&#9888;</span>
              <span>{{ blocker.skillName }}</span>
              <span class="spp-change-arrow">&rarr;</span>
              <span>{{ blocker.agentName }}</span>
              <span class="spp-blocker-reason">{{ blocker.reason }}</span>
            </div>
          </div>
        </template>

        <div v-if="error" class="spp-error">{{ error }}</div>
      </div>
      <div class="spp-modal-footer">
        <button class="spp-btn" :disabled="busy" @click="close">{{ t('skillManagerV2.actions.cancel') }}</button>
        <button
          v-if="!preview"
          class="spp-btn primary"
          :disabled="selected.size === 0 || busy"
          @click="runPreview"
        >
          {{ busy ? t('common.processing') : t('skillManagerV2.pack.previewButton') }}
        </button>
        <button
          v-else
          class="spp-btn primary"
          :disabled="busy || (preview.changes.length === 0 && preview.blockers.length === 0)"
          @click="execute"
        >
          {{ busy ? t('common.processing') : t('skillManagerV2.pack.executeButton') }}
        </button>
      </div>
    </div>
  </div>
</template>
