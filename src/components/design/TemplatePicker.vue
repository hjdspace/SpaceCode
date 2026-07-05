<template>
  <div ref="wrapRef" class="template-picker" :class="{ 'is-open': open }">
    <button
      type="button"
      class="template-picker-trigger"
      data-testid="template-picker-trigger"
      @click="open = !open"
    >
      <span v-if="active" class="template-picker-thumb">
        <TemplateScenarioArt :template-id="active.id" />
      </span>
      <Grid3x3 v-else :size="13" />
      <span class="template-picker-kicker">{{ t('design.templatePicker.label') }}</span>
      <span class="template-picker-value">{{ active ? t(active.labelKey) : t('common.none') }}</span>
      <ChevronDown :size="12" />
    </button>

    <button
      v-if="active"
      type="button"
      class="template-picker-clear"
      data-testid="template-picker-clear"
      @click.stop="clear"
    >
      <X :size="11" stroke-width="2.2" />
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
          v-for="templ in filtered"
          :key="templ.id"
          type="button"
          class="template-card"
          :class="{ 'is-active': modelValue === templ.id }"
          :data-testid="`template-card-${templ.id}`"
          role="option"
          :aria-selected="modelValue === templ.id"
          :title="t(templ.descriptionKey)"
          @click="pick(templ.id)"
        >
          <span class="template-card-art">
            <TemplateScenarioArt :template-id="templ.id" />
          </span>
          <span class="template-card-copy">
            <span class="template-card-label">{{ t(templ.labelKey) }}</span>
            <span class="template-card-desc">{{ t(templ.descriptionKey) }}</span>
          </span>
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
import TemplateScenarioArt from './TemplateScenarioArt.vue'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', id: string | null): void }>()

const { t } = useI18n()
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

function pick(id: string) {
  emit('update:modelValue', id)
  open.value = false
  query.value = ''
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
.template-picker { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.template-picker-trigger { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 8px; font-size: 12px; cursor: pointer; color: var(--text-primary); }
.template-picker-thumb { display: flex; }
.template-picker-kicker { color: var(--text-muted); }
.template-picker-value { font-weight: 500; }
.template-picker-clear { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: none; border: none; cursor: pointer; color: var(--text-muted); }
.template-picker-menu { position: absolute; bottom: calc(100% + 6px); left: 0; width: 360px; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); padding: 10px; z-index: 100; }
.template-picker-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.template-picker-search { flex: 1; display: flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 8px; }
.template-picker-search input { flex: 1; border: none; background: transparent; outline: none; font-size: 12px; color: var(--text-primary); }
.template-picker-clear-text { font-size: 11px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.template-picker-group-label { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }
.template-picker-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.template-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 10px; cursor: pointer; text-align: left; }
.template-card.is-active { border-color: var(--accent-primary); background: var(--accent-primary-glow); }
.template-card-art { margin-bottom: 4px; }
.template-card-label { display: block; font-size: 12px; font-weight: 500; color: var(--text-primary); }
.template-card-desc { display: block; font-size: 11px; color: var(--text-muted); line-height: 1.3; }
.template-picker-empty { font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center; }
</style>
