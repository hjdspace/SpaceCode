<template>
  <div ref="wrapRef" class="ds-picker" :class="{ 'is-open': open }">
    <button
      type="button"
      class="ds-picker-trigger"
      data-testid="ds-picker-trigger"
      @click="open = !open"
    >
      <Palette :size="14" />
      <span class="ds-picker-value">{{ selectedName }}</span>
      <ChevronDown :size="12" />
    </button>

    <div v-if="open" class="ds-picker-menu" data-testid="ds-picker-menu">
      <div class="ds-picker-search">
        <Search :size="14" />
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
          <Plus :size="13" stroke-width="2" />
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
            <Check v-if="modelValue == null" :size="14" stroke-width="2" />
          </button>

          <template v-if="filtered.length">
            <div class="ds-picker-group-label">{{ t('design.designSystemPicker.officialPresets') }}</div>
            <button
              v-for="system in filtered"
              :key="system.id"
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
              <Check v-if="modelValue === system.id" :size="14" stroke-width="2" />
            </button>
          </template>
          <div v-else class="ds-picker-empty">{{ t('design.designSystemPicker.noMatches') }}</div>
        </div>

        <div class="ds-picker-preview" data-testid="ds-picker-preview">
          <template v-if="previewSystem">
            <div class="ds-preview-scroll">
              <div class="ds-preview-head">
                <div>
                  <div class="ds-preview-title">{{ previewSystem.name }}</div>
                  <div class="ds-preview-meta">{{ previewSystem.category }}</div>
                </div>
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
                <div v-if="previewLoading" class="ds-preview-frame-empty">{{ t('common.loading') }}</div>
                <iframe
                  v-else-if="previewHtml"
                  class="ds-preview-frame"
                  :srcdoc="previewHtml"
                  sandbox="allow-scripts"
                  data-testid="ds-preview-frame"
                />
                <div v-else class="ds-preview-frame-empty">{{ t('design.preview.noPreview') }}</div>
              </div>
            </div>
            <button
              type="button"
              class="ds-preview-open"
              data-testid="ds-preview-open"
              @click="openPreviewModal"
            >
              <Eye :size="14" stroke-width="1.9" />
              <span>{{ t('design.designSystemPicker.openPreview') }}</span>
            </button>
          </template>
          <template v-else>
            <div class="ds-preview-none" data-testid="ds-picker-preview-none">
              <div class="ds-preview-head">
                <div class="ds-preview-title">{{ t('design.designSystemPicker.none') }}</div>
              </div>
              <p class="ds-preview-desc">{{ t('design.designSystemPicker.noneDesc') }}</p>
            </div>
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
const previewLoading = ref(false)
const previewModalSystem = ref<DesignSystemSummary | null>(null)
let previewRequestId = 0

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
  const requestId = ++previewRequestId
  previewLoading.value = true
  previewHtml.value = ''
  try {
    const page = system.previewPages[0]
    const html = page
      ? await api.design.getSystemPreview(system.id, page.path)
      : await api.design.getSystemShowcase(system.id)
    if (requestId === previewRequestId) previewHtml.value = html
  } finally {
    if (requestId === previewRequestId) previewLoading.value = false
  }
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
  previewLoading.value = false
}

function pick(id: string | null) {
  emit('update:modelValue', id)
  open.value = false
}

function clearQuery() {
  query.value = ''
  emit('update:modelValue', null)
  inputRef.value?.focus()
}

function openPreviewModal() {
  const system = previewSystem.value
  if (!system) return
  open.value = false
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
    previewLoading.value = false
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
.ds-picker { position: relative; display: inline-flex; align-items: center; min-width: 0; }

.ds-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 6px 8px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-muted);
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  max-width: 260px;
}

.ds-picker-trigger:hover,
.ds-picker.is-open .ds-picker-trigger {
  background: rgba(24, 25, 31, 0.04);
  border-color: var(--surface-border);
  color: var(--text-primary);
}

.ds-picker-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.ds-picker-menu {
  position: absolute;
  bottom: calc(100% + 14px);
  left: 0;
  width: min(720px, calc(100vw - 36px));
  max-height: min(430px, calc(100vh - 160px));
  background: #fff;
  border: 1px solid #d8e0eb;
  border-radius: 14px;
  box-shadow: 0 22px 56px rgba(24, 25, 31, 0.18);
  z-index: 130;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: scaleIn 140ms cubic-bezier(0.23, 1, 0.32, 1);
  transform-origin: bottom left;
}

.ds-picker-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 12px;
  border-bottom: 1px solid #e4e9f1;
  color: var(--text-muted);
  flex: 0 0 auto;
}

.ds-picker-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0 4px;
  font-size: 15px;
  color: var(--text-primary);
  outline: none;
}

.ds-picker-search input::placeholder { color: var(--text-disabled); }

.ds-picker-action {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  background: #fff;
  border: 1px solid #dbe2eb;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  padding: 0 10px;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.ds-picker-action:hover {
  background: var(--surface-soft);
  border-color: var(--surface-border-strong);
  color: var(--text-primary);
}

.ds-picker-action--primary {
  color: var(--accent-primary);
  border-color: color-mix(in srgb, var(--accent-primary) 36%, #dbe2eb);
  background: color-mix(in srgb, var(--accent-primary) 7%, #fff);
}

.ds-picker-action:disabled { opacity: 0.55; cursor: not-allowed; }

.ds-picker-body {
  display: grid;
  grid-template-columns: minmax(230px, 0.92fr) minmax(330px, 1.08fr);
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.ds-picker-list {
  overflow-y: auto;
  padding: 10px;
  border-right: 1px solid #e4e9f1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ds-picker-group-label {
  padding: 12px 8px 6px;
  color: var(--text-disabled);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

.ds-picker-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0 10px;
  border-radius: 10px;
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.ds-picker-option:hover {
  background: var(--surface-soft);
}

.ds-picker-option.active {
  background: color-mix(in srgb, var(--accent-primary) 10%, #fff);
}

.ds-picker-option-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 17px;
  font-weight: 800;
}

.ds-picker-empty {
  font-size: 13px;
  color: var(--text-muted);
  padding: 18px;
  text-align: center;
}

.ds-picker-preview {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.ds-preview-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 22px 14px;
}

.ds-preview-none {
  padding: 24px;
}

.ds-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ds-preview-title {
  font-size: 17px;
  font-weight: 800;
  color: var(--text-primary);
}

.ds-preview-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.ds-preview-desc {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 12px 0 14px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ds-preview-swatches {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 14px;
}

.ds-preview-swatch {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid #dce3ec;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.44);
}

.ds-preview-frame-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  min-height: 170px;
  border: 1px solid #dce3ec;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

.ds-preview-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}

.ds-preview-frame-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  padding: 16px;
}

.ds-preview-open {
  align-self: center;
  transform: translateY(-18px);
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: var(--radius-full);
  border: 1px solid #dce3ec;
  background: #fff;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 12px 28px rgba(24, 25, 31, 0.14);
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.ds-preview-open:hover {
  background: var(--surface-soft);
  border-color: var(--surface-border-strong);
  transform: translateY(-19px);
}

@keyframes scaleIn {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 760px) {
  .ds-picker-menu {
    width: calc(100vw - 24px);
    left: auto;
    right: 0;
  }
  .ds-picker-body {
    grid-template-columns: 1fr;
  }
  .ds-picker-list {
    max-height: 220px;
    border-right: 0;
    border-bottom: 1px solid #e4e9f1;
  }
}
</style>
