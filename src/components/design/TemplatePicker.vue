<template>
  <div ref="wrapRef" class="template-picker" :class="{ 'is-open': open, 'has-value': active }">
    <button
      type="button"
      class="template-picker-trigger"
      :class="{ 'is-inline': inline }"
      data-testid="template-picker-trigger"
      @click="open = !open"
    >
      <span v-if="active" class="template-picker-thumb">
        <TemplateScenarioArt :template-id="active.id" />
      </span>
      <Grid3x3 v-else :size="14" />
      <span class="template-picker-kicker">{{ t('design.templatePicker.label') }}</span>
      <span class="template-picker-value">{{ active ? t(active.labelKey) : t('common.none') }}</span>
      <span v-if="active" class="template-picker-trigger-divider" />
      <button
        v-if="active"
        type="button"
        class="template-picker-clear"
        data-testid="template-picker-clear"
        @click.stop="clear"
      >
        <X :size="11" stroke-width="2.5" />
      </button>
      <ChevronDown v-else :size="12" />
    </button>

    <div v-if="open" class="template-picker-menu" data-testid="template-picker-menu" role="listbox">
      <div class="template-picker-head">
        <div class="template-picker-search">
          <Search :size="12" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            :placeholder="t('design.templatePicker.searchPlaceholder')"
            data-testid="template-picker-search"
          />
        </div>
        <button type="button" class="template-picker-clear-text" @click="clearQuery">
          {{ t('common.clear') }}
        </button>
      </div>
      <div class="template-picker-group-label">{{ t('design.templatePicker.projectTypes') }}</div>
      <div v-if="filtered.length === 0" class="template-picker-empty">{{ t('design.templatePicker.noMatches') }}</div>
      <div v-else class="template-picker-grid">
        <button
          v-for="template in filtered"
          :key="template.id"
          type="button"
          class="template-card"
          :class="{ 'is-active': modelValue === template.id }"
          :data-testid="`template-card-${template.id}`"
          role="option"
          :aria-selected="modelValue === template.id"
          :title="t(template.descriptionKey)"
          @click="pick(template.id)"
        >
          <span class="template-card-art">
            <TemplateScenarioArt :template-id="template.id" />
          </span>
          <span class="template-card-label">{{ t(template.labelKey) }}</span>
          <span class="template-card-desc">{{ t(template.descriptionKey) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Grid3x3, ChevronDown, X, Search } from 'lucide-vue-next'
import { DESIGN_TEMPLATES, getTemplateById } from '@/lib/design/templates'
import { useDesignStore } from '@/stores/design'
import { useDesignSession } from '@/composables/useDesignSession'
import TemplateScenarioArt from './TemplateScenarioArt.vue'

const props = defineProps<{
  modelValue: string | null
  inline?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', id: string | null): void }>()

const { t } = useI18n()
const designStore = useDesignStore()
const { switchToolboxSkill } = useDesignSession()
const open = ref(false)
const query = ref('')
const wrapRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const active = computed(() => getTemplateById(props.modelValue))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return DESIGN_TEMPLATES
  return DESIGN_TEMPLATES.filter((tpl) => {
    const text = `${t(tpl.labelKey)} ${t(tpl.descriptionKey)}`.toLowerCase()
    return text.includes(q)
  })
})

async function pick(id: string) {
  emit('update:modelValue', id)
  open.value = false
  query.value = ''

  const template = getTemplateById(id)
  if (!template) return
  const skillIds = new Set(designStore.toolboxSkills.map(s => s.id))
  const targetSkill = skillIds.has(template.defaultSkillId)
    ? template.defaultSkillId
    : 'huashu-design'
  if (targetSkill !== designStore.selectedToolboxSkillId) {
    await switchToolboxSkill(targetSkill)
  }
}

function clear() {
  emit('update:modelValue', null)
  query.value = ''
  inputRef.value?.focus()
}

function clearQuery() {
  query.value = ''
  inputRef.value?.focus()
}

function onPointer(event: MouseEvent) {
  if (wrapRef.value?.contains(event.target as Node)) return
  open.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

watch(open, (val) => {
  if (val) nextTick(() => inputRef.value?.focus())
  else query.value = ''
})

onMounted(() => {
  document.addEventListener('mousedown', onPointer)
  document.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onPointer)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped lang="scss">
.template-picker { position: relative; display: inline-flex; align-items: center; min-width: 0; }

.template-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  padding: 5px 8px 5px 10px;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  min-width: 0;
}
.template-picker-trigger:hover {
  background: var(--bg-hover);
  border-color: var(--surface-border-strong);
}
.template-picker-trigger.is-inline {
  background: transparent;
  border-color: transparent;
  padding-left: 4px;
  padding-right: 4px;
}
.template-picker-trigger.is-inline:hover {
  background: var(--surface-hover);
  border-color: var(--surface-border);
}
.template-picker.has-value .template-picker-trigger {
  padding-right: 5px;
}
.template-picker-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}
.template-picker-thumb :deep(svg) {
  width: 18px;
  height: 14px;
}
.template-picker-kicker { color: var(--text-muted); flex-shrink: 0; }
.template-picker-value {
  font-weight: 500;
  min-width: 0;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.template-picker-trigger-divider {
  width: 1px;
  height: 14px;
  background: var(--surface-border);
  margin: 0 1px;
}
.template-picker-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.template-picker-clear:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.template-picker-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 420px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  padding: 14px;
  z-index: 100;
  animation: scaleIn 120ms ease-out;
  transform-origin: bottom left;
}
.template-picker-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.template-picker-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  padding: 7px 12px;
  color: var(--text-muted);
}
.template-picker-search input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: var(--text-primary);
}
.template-picker-search input::placeholder { color: var(--text-disabled); }
.template-picker-clear-text {
  font-size: 12px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--transition-fast);
}
.template-picker-clear-text:hover { color: var(--text-primary); }
.template-picker-group-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.template-picker-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.template-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 14px 8px;
  cursor: pointer;
  text-align: center;
  transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.template-card:hover {
  background: var(--bg-hover);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-primary-glow);
}
.template-card.is-active {
  border-color: var(--accent-primary);
  background: var(--accent-primary-glow);
  box-shadow: 0 0 0 3px var(--accent-primary-glow);
}
.template-card-art {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 32px;
  margin-bottom: 2px;
}
.template-card-art :deep(svg) {
  width: 40px;
  height: 32px;
}
.template-card-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.template-card-desc {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
}
.template-picker-empty { font-size: 12px; color: var(--text-muted); padding: 16px; text-align: center; }

/* 窄面板下只显示图标，隐藏标签文字 */
@container (max-width: 520px) {
  .template-picker-kicker,
  .template-picker-value,
  .template-picker-trigger-divider {
    display: none;
  }
  .template-picker-trigger {
    padding: 5px 7px;
    gap: 0;
  }
}
</style>
