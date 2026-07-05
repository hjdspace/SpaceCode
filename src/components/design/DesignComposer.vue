<template>
  <div class="design-composer">
    <div class="composer-toolbar-top">
      <button class="plus-btn" @click="toolboxOpen = !toolboxOpen">+</button>
      <span v-if="currentSkill" class="skill-tag">
        {{ currentSkill.name }}
        <button class="skill-x" @click="toolboxOpen = true">×</button>
      </span>
      <button v-if="isGenerating" class="send-btn stop" @click="$emit('stop')">
        <Square :size="12" /> {{ t('common.stop') }}
      </button>
      <button v-else class="send-btn" :disabled="!value.trim()" @click="send">
        <Send :size="12" /> {{ t('common.send') }}
      </button>
    </div>

    <textarea
      v-model="value"
      class="composer-input"
      :placeholder="t('design.emptyChatHint')"
      :style="{ minHeight: 'var(--design-composer-min-height)', maxHeight: 'var(--design-composer-max-height)' }"
      @keydown.enter.exact.prevent="send"
      @keydown.shift.enter="value += '\n'"
    />

    <div class="composer-toolbar-bottom">
      <TemplatePicker v-model="designStore.selectedTemplateId" />
      <DesignSystemPicker
        v-model="designStore.selectedDesignSystemId"
        :systems="designSystems"
        @update:model-value="onDesignSystemChange"
      />
    </div>

    <div v-if="toolboxOpen" class="toolbox-panel">
      <div class="toolbox-section">
        <div class="section-label">{{ t('design.toolbox.skills') }}</div>
        <button v-for="s in designStore.toolboxSkills" :key="s.id" class="skill-option"
          :class="{ active: designStore.selectedToolboxSkillId === s.id }"
          @click="selectSkill(s.id)">
          <span class="skill-name">{{ s.name }}</span>
          <span class="skill-desc">{{ s.description }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Square, Send } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useDesignSession } from '@/composables/useDesignSession'
import { api } from '@/services/electronAPI'
import type { DesignSystemSummary } from '@/services/electronAPI'
import TemplatePicker from './TemplatePicker.vue'
import DesignSystemPicker from './DesignSystemPicker.vue'

const emit = defineEmits<{ (e: 'send', content: string): void; (e: 'stop'): void }>()

const { t } = useI18n()
const designStore = useDesignStore()
const { isGenerating, switchToolboxSkill, switchDesignSystem, buildDesignMessage } = useDesignSession()
const value = ref('')
const toolboxOpen = ref(false)
const designSystems = ref<DesignSystemSummary[]>([])
const currentSkill = computed(() => designStore.currentToolboxSkill)

onMounted(async () => {
  designSystems.value = await api.design.listSystems()
})

function selectSkill(id: string) {
  switchToolboxSkill(id)
  toolboxOpen.value = false
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
.design-composer { border-top: 1px solid var(--surface-border); padding: 8px 12px; background: var(--bg-secondary); position: relative; }
.composer-toolbar-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.composer-toolbar-bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.plus-btn { background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); width: 24px; height: 24px; cursor: pointer; }
.skill-tag { background: var(--accent-primary-glow); color: var(--accent-primary); border-radius: var(--radius-full); padding: 2px 10px; font-size: 11px; display: flex; align-items: center; gap: 4px; }
.skill-x { background: none; border: none; cursor: pointer; color: inherit; }
.send-btn { margin-left: auto; background: var(--accent-primary); color: white; border: none; border-radius: var(--radius-sm); padding: 4px 12px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px; &:disabled { opacity: 0.5; } &.stop { background: #ef4444; } }
.composer-input { width: 100%; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary); padding: 8px; font-size: 13px; resize: none; font-family: inherit; }
.toolbox-panel { position: absolute; bottom: 100%; left: 12px; right: 12px; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); padding: 8px; max-height: 300px; overflow-y: auto; }
.section-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
.skill-option { display: block; width: 100%; text-align: left; background: none; border: none; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; &:hover { background: var(--surface-hover); } &.active { background: var(--accent-primary-glow); } }
.skill-name { display: block; font-size: 12px; font-weight: 500; }
.skill-desc { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
</style>
