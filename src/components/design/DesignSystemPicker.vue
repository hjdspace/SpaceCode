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
      <ChevronDown :size="11" />
    </button>

    <Teleport to="body">
    <div
      v-if="open"
      ref="menuRef"
      class="ds-picker-menu"
      data-testid="ds-picker-menu"
      :style="menuStyle"
    >
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
              <button
                ref="frameWrapRef"
                type="button"
                class="ds-preview-frame-wrap"
                data-testid="ds-preview-frame-wrap"
                :aria-label="t('design.designSystemPicker.openPreview')"
                @click="openPreviewModal"
              >
                <div v-if="previewLoading" class="ds-preview-frame-empty">{{ t('common.loading') }}</div>
                <iframe
                  v-else-if="previewHtml"
                  class="ds-preview-frame"
                  :srcdoc="previewHtml"
                  sandbox="allow-scripts"
                  scrolling="no"
                  tabindex="-1"
                  aria-hidden="true"
                  :style="frameStyle"
                  data-testid="ds-preview-frame"
                />
                <div v-else class="ds-preview-frame-empty">{{ t('design.preview.noPreview') }}</div>
              </button>
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
    </Teleport>

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
import { useAnchoredMenu } from '@/composables/useAnchoredMenu'
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

// 缩略图按真实桌面视口排版再等比缩放：showcase 页的 .container 是 1180px 且带
// 220px 固定侧栏，浮层右列只有 ~275px，1:1 渲染必然横竖都出滚动条。
const DESIGN_VIEWPORT = { width: 1280, height: 720 }
const frameWrapRef = ref<HTMLButtonElement | null>(null)
const previewScale = ref(1)
let frameResizeObserver: ResizeObserver | null = null

const frameStyle = computed(() => ({
  width: `${DESIGN_VIEWPORT.width}px`,
  height: `${DESIGN_VIEWPORT.height}px`,
  transform: `scale(${previewScale.value})`,
}))

function measurePreviewScale() {
  const width = frameWrapRef.value?.clientWidth || 0
  if (width) previewScale.value = width / DESIGN_VIEWPORT.width
}

function teardownPreviewResizeObserver() {
  frameResizeObserver?.disconnect()
  frameResizeObserver = null
}

// 浮层是 v-if 渲染的，且未选中设计系统时整块缩略图不存在，
// 所以跟着模板 ref 的挂载/卸载走，而不是只在 open 时测一次。
watch(frameWrapRef, (el) => {
  teardownPreviewResizeObserver()
  if (!el || typeof ResizeObserver === 'undefined') return
  frameResizeObserver = new ResizeObserver(measurePreviewScale)
  frameResizeObserver.observe(el)
  measurePreviewScale()
})

// 菜单 Teleport 到 body 后按视口定位，避免被右侧设计产物面板裁掉/压住
const { menuRef, menuStyle } = useAnchoredMenu(wrapRef, open, { width: 560, gap: 14, maxHeight: 400 })

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
    const html = await api.design.getSystemShowcase(system.id)
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
  const target = event.target as Node
  // 菜单在 body 下，不在 wrapRef 子树内，需单独放过
  if (wrapRef.value?.contains(target) || menuRef.value?.contains(target)) return
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
  teardownPreviewResizeObserver()
})
</script>

<style scoped lang="scss">
.ds-picker { position: relative; display: inline-flex; align-items: center; min-width: 0; }

/* Trigger：与 ChatContextToolbar 的 .ctx-trigger 保持一致 */
.ds-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  border-radius: 5px;
  padding: 3px 8px 3px 7px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  color: var(--text-muted, #888);
  transition: all 0.12s ease;
  white-space: nowrap;
  max-width: 220px;
  line-height: 1.4;
}

.ds-picker-trigger:hover,
.ds-picker.is-open .ds-picker-trigger {
  background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-primary, #333);
}

.ds-picker.is-open .ds-picker-trigger {
  background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-primary, #333);
}

.ds-picker-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--text-secondary, #555);
}

.ds-picker-menu {
  /* 视口坐标 (left / bottom / width / max-height) 由 useAnchoredMenu 算好后内联 */
  position: fixed;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: 14px;
  box-shadow: var(--shadow-xl);
  z-index: 1000;
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
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--surface-border);
  color: var(--text-muted);
  flex: 0 0 auto;
}

.ds-picker-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0 4px;
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
}

.ds-picker-search input::placeholder { color: var(--text-disabled); }

.ds-picker-action {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
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
  background: var(--surface-hover);
  border-color: var(--surface-border-strong);
  color: var(--text-primary);
}

.ds-picker-action--primary {
  color: var(--accent-primary);
  border-color: color-mix(in srgb, var(--accent-primary) 36%, transparent);
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
}

.ds-picker-action:disabled { opacity: 0.55; cursor: not-allowed; }

.ds-picker-body {
  display: grid;
  grid-template-columns: minmax(190px, 0.9fr) minmax(260px, 1.1fr);
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.ds-picker-list {
  overflow-y: auto;
  @include scrollbar-overlay;
  padding: 10px;
  border-right: 1px solid var(--surface-border);
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
  min-height: 34px;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0 10px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.ds-picker-option:hover {
  background: var(--surface-hover);
}

.ds-picker-option.active {
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
}

.ds-picker-option-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
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
  background: transparent;
}

.ds-preview-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  @include scrollbar-overlay;
  padding: 16px 16px 12px;
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
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.ds-preview-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.ds-preview-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 10px 0 12px;
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
  border: 1px solid var(--surface-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.44);
}

/* 整块缩略图即「打开预览」入口，故用 button；iframe 自身 pointer-events:none 让点击落在这里 */
.ds-preview-frame-wrap {
  display: block;
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: 0;
  appearance: none;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.ds-preview-frame {
  /* width / height / transform 由 frameStyle 内联：按桌面视口排版后等比缩进本框 */
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  border: 0;
  background: white;
  pointer-events: none;
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
  margin: 12px 0 14px;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-lg);
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.ds-preview-open:hover {
  background: var(--surface-hover);
  border-color: var(--surface-border-strong);
}

@keyframes scaleIn {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 760px) {
  .ds-picker-body {
    grid-template-columns: 1fr;
  }
  .ds-picker-list {
    max-height: 200px;
    border-right: 0;
    border-bottom: 1px solid var(--surface-border);
  }
}
</style>
