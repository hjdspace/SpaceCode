<template>
  <div v-if="visible" class="distribute-dialog-overlay" @click.self="onClose">
    <div class="distribute-dialog">
      <div class="dialog-header">
        <h3>{{ t('skillManager.distributeTitle') }}</h3>
        <button class="close-btn" @click="onClose">&times;</button>
      </div>

      <div class="dialog-body">
        <!-- Skill selection summary -->
        <div class="section">
          <div class="section-label">
            {{ t('skillManager.selectedSkills') }}: {{ props.skillIds.length }}
          </div>
        </div>

        <!-- Agent selection -->
        <div class="section">
          <div class="section-label">{{ t('skillManager.selectAgents') }}</div>
          <div class="agent-list">
            <label
              v-for="agent in agents"
              :key="agent.id"
              class="agent-item"
              :class="{ disabled: !agent.enabled }"
            >
              <input
                type="checkbox"
                :checked="selectedAgents.includes(agent.id)"
                :disabled="!agent.enabled"
                @change="toggleAgent(agent.id)"
              />
              <span class="agent-name">{{ agent.displayName }}</span>
              <span v-if="agent.skillsDir" class="agent-path">{{ agent.skillsDir }}</span>
            </label>
          </div>
        </div>

        <!-- Install mode selection -->
        <div class="section">
          <div class="section-label">{{ t('skillManager.installMode') }}</div>
          <div class="mode-options">
            <label class="mode-item">
              <input
                type="radio"
                value="link"
                :checked="selectedMode === 'link'"
                @change="selectedMode = 'link'"
              />
              <span>{{ t('skillManager.modeLink') }}</span>
            </label>
            <label class="mode-item">
              <input
                type="radio"
                value="copy"
                :checked="selectedMode === 'copy'"
                @change="selectedMode = 'copy'"
              />
              <span>{{ t('skillManager.modeCopy') }}</span>
            </label>
          </div>
        </div>

        <!-- Preview results -->
        <div v-if="preview" class="section">
          <div class="section-label">{{ t('skillManager.preview') }}</div>
          <div v-if="preview.changes.length === 0 && preview.blockers.length === 0" class="empty-state">
            {{ t('skillManager.noChanges') }}
          </div>
          <div v-if="preview.changes.length > 0" class="changes-list">
            <div
              v-for="change in preview.changes"
              :key="`${change.skillId}-${change.agentId}`"
              class="change-item"
              :class="change.action"
            >
              <span class="change-action">{{ change.action }}</span>
              <span class="change-skill">{{ change.skillName }}</span>
              <span class="change-arrow">→</span>
              <span class="change-agent">{{ change.agentName }}</span>
              <span class="change-mode">({{ change.mode }})</span>
            </div>
          </div>
          <div v-if="preview.blockers.length > 0" class="blockers-list">
            <div
              v-for="blocker in preview.blockers"
              :key="`${blocker.skillId}-${blocker.agentId}`"
              class="blocker-item"
            >
              <span class="blocker-icon">⚠</span>
              <span class="blocker-skill">{{ blocker.skillName }}</span>
              <span class="change-arrow">→</span>
              <span class="blocker-agent">{{ blocker.agentName }}</span>
              <span class="blocker-reason">{{ blocker.reason }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn-secondary" @click="onClose" :disabled="busy">
          {{ t('common.cancel') }}
        </button>
        <button
          v-if="!preview"
          class="btn-primary"
          @click="onPreview"
          :disabled="selectedAgents.length === 0 || busy"
        >
          {{ t('skillManager.previewButton') }}
        </button>
        <button
          v-else
          class="btn-primary"
          @click="onExecute"
          :disabled="busy || (preview.changes.length === 0 && preview.blockers.length === 0)"
        >
          {{ busy ? t('common.processing') : t('skillManager.executeButton') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { DistributionPreview, InstallMode } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

const props = defineProps<{
  visible: boolean
  skillIds: string[]
}>()

const emit = defineEmits<{
  close: []
  distributed: []
}>()

const selectedAgents = ref<string[]>([])
const selectedMode = ref<InstallMode>('link')
const preview = ref<DistributionPreview | null>(null)
const busy = ref(false)

const agents = computed(() => store.agents)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selectedAgents.value = []
      selectedMode.value = (store.settings?.defaultInstallMode ?? 'link') as InstallMode
      preview.value = null
    }
  }
)

function toggleAgent(agentId: string): void {
  const idx = selectedAgents.value.indexOf(agentId)
  if (idx >= 0) {
    selectedAgents.value.splice(idx, 1)
  } else {
    selectedAgents.value.push(agentId)
  }
  preview.value = null
}

async function onPreview(): Promise<void> {
  busy.value = true
  try {
    preview.value = await store.previewDistribute(
      props.skillIds,
      selectedAgents.value,
      selectedMode.value
    )
  } finally {
    busy.value = false
  }
}

async function onExecute(): Promise<void> {
  if (!preview.value) return
  busy.value = true
  try {
    await store.executeDistribute(preview.value)
    preview.value = null
    emit('distributed')
    emit('close')
  } finally {
    busy.value = false
  }
}

function onClose(): void {
  emit('close')
}
</script>

<style scoped lang="scss">
.distribute-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.distribute-dialog {
  background: var(--bg-primary, #1e1e2e);
  border-radius: 12px;
  width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));

  h3 {
    margin: 0;
    font-size: 16px;
  }
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-secondary, #888);
  padding: 0 4px;

  &:hover {
    color: var(--text-primary, #fff);
  }
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.section {
  margin-bottom: 16px;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-secondary, #aaa);
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.agent-name {
  font-size: 14px;
}

.agent-path {
  font-size: 12px;
  color: var(--text-tertiary, #666);
  margin-left: auto;
}

.mode-options {
  display: flex;
  gap: 16px;
}

.mode-item {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 14px;
}

.changes-list,
.blockers-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.change-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;

  &.create {
    background: rgba(76, 175, 80, 0.1);
  }

  &.reuse {
    background: rgba(33, 150, 243, 0.1);
  }
}

.change-action {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  min-width: 48px;
}

.change-skill,
.blocker-skill {
  font-weight: 500;
}

.change-arrow {
  color: var(--text-tertiary, #666);
}

.change-agent,
.blocker-agent {
  color: var(--text-secondary, #aaa);
}

.change-mode {
  color: var(--text-tertiary, #666);
  font-size: 11px;
}

.blocker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
  background: rgba(255, 152, 0, 0.1);
}

.blocker-icon {
  color: #ff9800;
}

.blocker-reason {
  color: var(--text-tertiary, #666);
  font-size: 11px;
  margin-left: auto;
}

.empty-state {
  font-size: 13px;
  color: var(--text-tertiary, #666);
  text-align: center;
  padding: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 14px;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-primary {
  background: var(--accent-primary, #6c5ce7);
  color: white;

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }
}

.btn-secondary {
  background: var(--bg-secondary, #2a2a3e);
  color: var(--text-primary, #fff);

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }
}
</style>
