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
        <button type="button" class="ds-picker-action" @click="clearQuery">
          {{ t('common.clear') }}
        </button>
        <button
          type="button"
          class="ds-picker-action ds-picker-action--primary"
          disabled
          :title="t('design.designSystemPicker.createDisabled')"
        >
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
            <div
              v-for="system in filtered"
              :key="system.id"
              class="ds-picker-option-wrap"
            >
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
            <div class="ds-preview-head">
              <div class="ds-preview-title">{{ previewSystem.name }}</div>
              <div class="ds-preview-meta">{{ previewSystem.category }}</div>
            </div>
            <p class="ds-preview-desc">{{ previewSystem.description || t('design.designSystemPicker.noDesc') }}</p>
            <div v-if="previewSystem.swatches?.length" class="ds-preview-swatches">
              <span
                v-for="swatch in previewSystem.swatches.slice(0, 6)"
                :key="swatch.name"
                class="ds-preview-swatch"
                :style="{ background: swatch.value }"
                :title="`${swatch.name}: ${swatch.value}`"
              />
            </div>
            <div class="ds-preview-frame-wrap">
              <iframe
                v-if="previewHtml"
                class="ds-preview-frame"
                :srcdoc="previewHtml"
                sandbox="allow-scripts"
                data-testid="ds-preview-frame"
              />
              <div v-else class="ds-preview-frame-empty">{{ t('common.loading') }}</div>
            </div>
            <button
              type="button"
              class="ds-preview-open"
              data-testid="ds-preview-open"
              @click="openPreviewModal"
            >
              <Eye :size="13" stroke-width="1.9" />
              <span>{{ t('design.designSystemPicker.openPreview') }}</span>
            </button>
          </template>
          <template v-else>
            <div class="ds-preview-head">
              <div class="ds-preview-title">{{ t('design.designSystemPicker.none') }}</div>
            </div>
            <p class="ds-preview-desc">{{ t('design.designSystemPicker.noneDesc') }}</p>
          </template>
        </div>
      </div>
    </div>

    <DesignSystemPreviewModal
      v-if="previewModalSystem"
      :system="previewModalSystem"
      :on-close="closePreviewModal"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Palette, ChevronDown, Search, Plus, Check, Eye } from 'lucide-vue-next'
import type { DesignSystemSummary } from '@/services/electronAPI'
import { api } from '@/services/electronAPI'
import DesignSystemPreviewModal from './DesignSystemPreviewModal.vue'

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
const previewModalSystem = ref<DesignSystemSummary | null>(null)

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
    return
  }
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
}

function pick(id: string | null) {
  emit('update:modelValue', id)
  open.value = false
}

function clearQuery() {
  query.value = ''
  inputRef.value?.focus()
}

function openPreviewModal() {
  const system = previewSystem.value
  if (!system) return
  previewModalSystem.value = system
}

function closePreviewModal() {
  previewModalSystem.value = null
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

.ds-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.ds-picker-trigger:hover {
  background: var(--bg-hover);
  border-color: var(--surface-border-strong);
}

.ds-picker-value { font-weight: 500; }

.ds-picker-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 620px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  padding: 12px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  animation: scaleIn 120ms ease-out;
  transform-origin: bottom left;
}

.ds-picker-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.ds-picker-search input {
  flex: 1;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  background: var(--bg-primary);
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
}

.ds-picker-search input::placeholder { color: var(--text-disabled); }

.ds-picker-action {
  font-size: 11px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--transition-fast);
}

.ds-picker-action:hover { color: var(--text-primary); }

.ds-picker-action--primary {
  color: var(--accent-primary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ds-picker-action:disabled { opacity: 0.5; cursor: not-allowed; }

.ds-picker-body {
  display: flex;
  gap: 12px;
  min-height: 280px;
  max-height: 380px;
}

.ds-picker-list {
  width: 42%;
  max-height: 360px;
  overflow-y: auto;
  border-right: 1px solid var(--surface-border);
  padding-right: 10px;
}

.ds-picker-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 7px 9px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--transition-fast);
}

.ds-picker-option:hover,
.ds-picker-option.active {
  background: var(--surface-hover);
}

.ds-picker-option-title { font-size: 13px; }

.ds-picker-empty {
  font-size: 12px;
  color: var(--text-muted);
  padding: 16px;
  text-align: center;
}

.ds-picker-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 4px;
}

.ds-preview-head { display: flex; flex-direction: column; gap: 2px; }

.ds-preview-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ds-preview-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.ds-preview-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ds-preview-swatches {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.ds-preview-swatch {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-border);
}

.ds-preview-frame-wrap {
  flex: 1;
  min-height: 140px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: white;
  position: relative;
  margin-top: 4px;
}

.ds-preview-frame {
  width: 100%;
  height: 100%;
  border: none;
}

.ds-preview-frame-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
}

.ds-preview-open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: auto;
  padding: 7px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.ds-preview-open:hover {
  background: var(--surface-hover);
  border-color: var(--surface-border-strong);
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@media (max-width: 720px) {
  .ds-picker-menu {
    width: calc(100vw - 32px);
    left: auto;
    right: 0;
  }
  .ds-picker-body {
    flex-direction: column;
    max-height: none;
  }
  .ds-picker-list {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--surface-border);
    padding-right: 0;
    padding-bottom: 10px;
    max-height: 180px;
  }
  .ds-preview-frame-wrap {
    min-height: 120px;
  }
}
</style>
