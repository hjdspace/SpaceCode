<template>
  <div class="design-composer">
    <div class="composer-input-wrap">
      <button
        type="button"
        class="plus-btn"
        data-testid="composer-plus-btn"
        @click="plusMenuOpen = !plusMenuOpen"
      >
        <Plus :size="14" />
      </button>

      <TemplatePicker
        v-model="designStore.selectedTemplateId"
        inline
      />

      <textarea
        v-model="value"
        class="composer-input"
        :placeholder="t('design.emptyChatHint')"
        :style="{ minHeight: 'var(--design-composer-min-height)', maxHeight: 'var(--design-composer-max-height)' }"
        @keydown.enter.exact.prevent="send"
        @keydown.shift.enter="value += '\n'"
      />

      <button
        v-if="isGenerating"
        type="button"
        class="send-btn stop"
        data-testid="composer-send-btn"
        @click="$emit('stop')"
      >
        <Square :size="12" /> {{ t('common.stop') }}
      </button>
      <button
        v-else
        type="button"
        class="send-btn"
        data-testid="composer-send-btn"
        :disabled="!value.trim()"
        @click="send"
      >
        <Send :size="12" /> {{ t('common.send') }}
      </button>

      <div v-if="plusMenuOpen" class="plus-menu" data-testid="composer-plus-menu">
        <div class="plus-menu-section">
          <div class="section-label">{{ t('design.toolbox.skills') }}</div>
          <button
            v-for="s in designStore.toolboxSkills"
            :key="s.id"
            type="button"
            class="skill-option"
            :class="{ active: designStore.selectedToolboxSkillId === s.id }"
            @click="selectSkill(s.id)"
          >
            <span class="skill-name">{{ s.name }}</span>
            <span class="skill-desc">{{ s.description }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="composer-toolbar-bottom">
      <DesignSystemPicker
        v-model="designStore.selectedDesignSystemId"
        :systems="designSystems"
        @update:model-value="onDesignSystemChange"
      />
      <WorkingDirectoryPicker v-model="workingDirectory" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Square, Send } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useChatSessionStore } from '@/stores/chat'
import { useDesignSession } from '@/composables/useDesignSession'
import { api } from '@/services/electronAPI'
import type { DesignSystemSummary } from '@/services/electronAPI'
import TemplatePicker from './TemplatePicker.vue'
import DesignSystemPicker from './DesignSystemPicker.vue'
import WorkingDirectoryPicker from './WorkingDirectoryPicker.vue'

const emit = defineEmits<{ (e: 'send', content: string): void; (e: 'stop'): void }>()

const { t } = useI18n()
const designStore = useDesignStore()
const chatSessionStore = useChatSessionStore()
const { isGenerating, switchToolboxSkill, switchDesignSystem, buildDesignMessage } = useDesignSession()
const value = ref('')
const plusMenuOpen = ref(false)
const designSystems = ref<DesignSystemSummary[]>([])

const workingDirectory = computed({
  get: () => designStore.designWorkspace || chatSessionStore.workingDirectory || '',
  set: (path: string) => {
    designStore.designWorkspace = path
    chatSessionStore.currentProjectRoot = path
  },
})

onMounted(async () => {
  designSystems.value = await api.design.listSystems()
})

function selectSkill(id: string) {
  switchToolboxSkill(id)
  plusMenuOpen.value = false
}

function onDesignSystemChange(systemId: string | null) {
  const system = designSystems.value.find(s => s.id === systemId) || null
  switchDesignSystem(systemId, system?.name || null)
}

async function send() {
  if (!value.value.trim() || isGenerating.value) return
  const content = buildDesignMessage(value.value.trim())
  value.value = ''
  emit('send', content)
}
</script>

<style scoped lang="scss">
.design-composer {
  border-top: 1px solid var(--surface-border);
  padding: 8px 12px;
  background: var(--bg-secondary);
  position: relative;
}

.composer-input-wrap {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-xl);
  background: var(--bg-primary);
  padding: 6px 6px 6px 8px;
  position: relative;
}

.plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.plus-btn:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.composer-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  padding: 6px 4px;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  font-family: inherit;
  outline: none;
}
.composer-input::placeholder { color: var(--text-disabled); }

.send-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-full);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: opacity var(--transition-fast);
}
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.send-btn.stop { background: #ef4444; }

.composer-toolbar-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}

.plus-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 220px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xl);
  padding: 8px;
  z-index: 100;
}

.plus-menu-section .section-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.skill-option {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-primary);
}
.skill-option:hover { background: var(--surface-hover); }
.skill-option.active { background: var(--accent-primary-glow); }

.skill-name { display: block; font-size: 12px; font-weight: 500; }
.skill-desc { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
</style>
