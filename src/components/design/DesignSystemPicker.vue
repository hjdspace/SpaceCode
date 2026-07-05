<template>
  <div ref="wrapRef" class="ds-picker" :class="{ 'is-open': open }">
    <button
      type="button"
      class="ds-picker-trigger"
      data-testid="ds-picker-trigger"
      @click="open = !open"
    >
      <Palette :size="13" />
      <span class="ds-picker-value">{{ selectedName }}</span>
      <ChevronDown :size="12" />
    </button>

    <div v-if="open" class="ds-picker-menu" data-testid="ds-picker-menu">
      <div class="ds-picker-search">
        <Search :size="12" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          :placeholder="t('design.designSystemPicker.searchPlaceholder')"
          data-testid="ds-picker-search"
        />
        <button type="button" class="ds-picker-action" @click="clear">
          {{ t('common.clear') }}
        </button>
        <button type="button" class="ds-picker-action ds-picker-action--primary" disabled :title="t('design.designSystemPicker.createDisabled')">
          <Plus :size="12" stroke-width="2" />
          <span>{{ t('common.create') }}</span>
        </button>
      </div>
      <div class="ds-picker-body">
        <div class="ds-picker-list" role="listbox">
          <button
            type="button"
            class="ds-picker-option"
            :class="{ active: modelValue == null }"
            role="option"
            :aria-selected="modelValue == null"
            data-testid="ds-option-none"
            @mouseenter="hoverNone"
            @focus="hoverNone"
            @mousedown.prevent="pick(null)"
          >
            <span class="ds-picker-option-title">{{ t('design.designSystemPicker.none') }}</span>
            <Check v-if="modelValue == null" :size="13" stroke-width="2" />
          </button>
          <template v-if="filtered.length">
            <div v-for="system in filtered" :key="system.id">
              <button
                type="button"
                class="ds-picker-option"
                :class="{ active: modelValue === system.id }"
                :data-testid="`ds-option-${system.id}`"
                role="option"
                :aria-selected="modelValue === system.id"
                @mouseenter="hoverSystem(system)"
                @focus="hoverSystem(system)"
                @mousedown.prevent="pick(system.id)"
              >
                <span class="ds-picker-option-title">{{ system.name }}</span>
                <Check v-if="modelValue === system.id" :size="13" stroke-width="2" />
              </button>
            </div>
          </template>
          <div v-else class="ds-picker-empty">{{ t('design.designSystemPicker.noMatches') }}</div>
        </div>
        <div class="ds-picker-preview" data-testid="ds-picker-preview">
          <template v-if="previewSystem">
            <div class="ds-picker-preview-head">{{ previewSystem.name }}</div>
            <div class="ds-picker-preview-meta">{{ previewSystem.category }}</div>
            <p class="ds-picker-preview-desc">{{ previewSystem.description }}</p>
            <div v-if="previewSystem.previewPages.length" class="ds-picker-preview-tabs">
              <button
                v-for="page in previewSystem.previewPages"
                :key="page.path"
                type="button"
                class="ds-preview-tab"
                :class="{ active: activePage === page.path }"
                @click="activePage = page.path"
              >
                {{ page.title }}
              </button>
            </div>
            <iframe
              v-if="previewHtml && activePage"
              class="ds-preview-frame"
              :srcdoc="previewHtml"
              sandbox="allow-scripts"
              data-testid="ds-preview-frame"
            />
          </template>
          <template v-else>
            <div class="ds-picker-preview-head">{{ t('design.designSystemPicker.none') }}</div>
            <p class="ds-picker-preview-desc">{{ t('design.designSystemPicker.noneDesc') }}</p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Palette, ChevronDown, Search, Plus, Check } from 'lucide-vue-next'
import type { DesignSystemSummary } from '@/services/electronAPI'
import { api } from '@/services/electronAPI'

const props = defineProps<{
  systems: DesignSystemSummary[]
  modelValue: string | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', id: string | null): void }>()

const { t } = useI18n()
const open = ref(false)
const query = ref('')
const wrapRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const hovered = ref<DesignSystemSummary | null>(null)
const hoveredNone = ref(false)
const previewHtml = ref('')
const activePage = ref<string | null>(null)

const selected = computed(() => props.systems.find((s) => s.id === props.modelValue) || null)
const selectedName = computed(() => selected.value?.name || t('design.designSystemPicker.none'))

const previewSystem = computed(() => {
  if (hovered.value) return hovered.value
  if (hoveredNone.value) return null
  if (selected.value) return selected.value
  return null
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.systems
  return props.systems.filter((s) =>
    `${s.name} ${s.category} ${s.description || ''}`.toLowerCase().includes(q)
  )
})

async function loadPreview(system: DesignSystemSummary) {
  const page = system.previewPages[0]
  if (!page) {
    previewHtml.value = ''
    activePage.value = null
    return
  }
  activePage.value = page.path
  previewHtml.value = await api.design.getSystemPreview(system.id, page.path)
}

function hoverSystem(system: DesignSystemSummary) {
  hovered.value = system
  hoveredNone.value = false
  loadPreview(system)
}

function hoverNone() {
  hovered.value = null
  hoveredNone.value = true
  previewHtml.value = ''
  activePage.value = null
}

function pick(id: string | null) {
  emit('update:modelValue', id)
  open.value = false
}

function clear() {
  emit('update:modelValue', null)
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

watch(open, async (val) => {
  if (val) {
    nextTick(() => inputRef.value?.focus())
    if (selected.value) await loadPreview(selected.value)
    else hoverNone()
  } else {
    query.value = ''
    hovered.value = null
    hoveredNone.value = false
    previewHtml.value = ''
    activePage.value = null
  }
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
.ds-picker { position: relative; display: inline-flex; align-items: center; }
.ds-picker-trigger { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 4px 8px; font-size: 12px; cursor: pointer; color: var(--text-primary); }
.ds-picker-value { font-weight: 500; }
.ds-picker-menu { position: absolute; bottom: calc(100% + 6px); right: 0; width: 560px; background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); padding: 10px; z-index: 100; display: flex; flex-direction: column; }
.ds-picker-search { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ds-picker-search input { flex: 1; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: var(--bg-primary); padding: 4px 8px; font-size: 12px; color: var(--text-primary); }
.ds-picker-action { font-size: 11px; color: var(--text-muted); background: none; border: none; cursor: pointer; white-space: nowrap; }
.ds-picker-action--primary { color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px; }
.ds-picker-action:disabled { opacity: 0.5; cursor: not-allowed; }
.ds-picker-body { display: flex; gap: 10px; min-height: 240px; }
.ds-picker-list { width: 45%; max-height: 320px; overflow-y: auto; border-right: 1px solid var(--surface-border); padding-right: 8px; }
.ds-picker-option { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; background: none; border: none; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-primary); }
.ds-picker-option:hover, .ds-picker-option.active { background: var(--surface-hover); }
.ds-picker-option-title { font-size: 12px; }
.ds-picker-empty { font-size: 12px; color: var(--text-muted); padding: 12px; }
.ds-picker-preview { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.ds-picker-preview-head { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.ds-picker-preview-meta { font-size: 11px; color: var(--text-muted); }
.ds-picker-preview-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.4; margin: 0; }
.ds-picker-preview-tabs { display: flex; gap: 6px; }
.ds-preview-tab { font-size: 11px; padding: 2px 6px; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-muted); cursor: pointer; }
.ds-preview-tab.active { border-color: var(--accent-primary); color: var(--accent-primary); }
.ds-preview-frame { flex: 1; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); background: white; min-height: 160px; }
</style>
