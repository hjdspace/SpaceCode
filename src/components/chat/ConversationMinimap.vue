<template>
  <nav
    v-if="shouldRender"
    ref="railRef"
    class="minimap-rail"
    :aria-label="t('chat.minimap')"
    :style="{
      '--minimap-marker-count': String(markers.length + (hasEarlier ? 1 : 0)),
    }"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
    <!-- Earlier history marker -->
    <button
      v-if="hasEarlier"
      ref="earlierBtnRef"
      type="button"
      class="minimap-marker history"
      :class="{ loading: loadingEarlier }"
      :aria-label="earlierLabel"
      :title="earlierLabel"
      :aria-busy="loadingEarlier || undefined"
      :disabled="loadingEarlier || !onRevealEarlier"
      @click="handleRevealEarlier"
    />
    <!-- Conversation markers -->
    <button
      v-for="marker in markers"
      :key="marker.id"
      :ref="(el) => setMarkerRef(marker.id, el as HTMLButtonElement | null)"
      type="button"
      class="minimap-marker"
      :class="[marker.role, { active: marker.id === activeId }]"
      :aria-label="roleLabel(marker.role)"
      :aria-current="marker.id === activeId ? 'true' : undefined"
      @focus="(e) => handleMarkerFocus(e, marker)"
      @blur="hovered = null"
      @click="jumpTo(marker.id)"
    />
    <!-- Hover popover -->
    <div
      v-if="hovered && hovered.marker.preview"
      class="minimap-popover"
      role="tooltip"
      :style="{ top: hovered.top + 'px' }"
    >
      <div class="minimap-popover-role">
        {{ roleLabel(hovered.marker.role) }}
      </div>
      <div class="minimap-popover-text">{{ hovered.marker.preview }}</div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Message } from '@/types'
import {
  buildConversationMinimapMarkers,
  shouldRenderConversationMinimap,
  type ConversationMinimapMarker,
} from '@/utils/conversation-minimap'

const props = withDefaults(
  defineProps<{
    scrollRef: HTMLElement | null
    messages: Message[]
    hasEarlier?: boolean
    loadingEarlier?: boolean
    onRevealEarlier?: () => void
  }>(),
  {
    hasEarlier: false,
    loadingEarlier: false,
    onRevealEarlier: undefined,
  },
)

const { t } = useI18n()

// ── State ──
const activeId = ref<string | null>(null)
const hovered = ref<{ marker: ConversationMinimapMarker; top: number } | null>(null)
const overflows = ref(false)
const railRef = ref<HTMLElement | null>(null)

// ── Refs for imperative DOM access ──
const markerEls = ref(new Map<string, HTMLButtonElement>())
let moveRaf = 0

// ── Cached offsets to avoid O(n) DOM queries on every scroll frame ──
let cachedOffsets: { id: string; offset: number }[] = []
let activeIdCache: string | null = null
let overflowsCache = false

// ── Cached magnify centers ──
let magnifyCenters: { id: string; center: number }[] = []

// ── Markers ──
const markers = computed(() => buildConversationMinimapMarkers(props.messages))

const markerIdentity = computed(() =>
  [
    ...(props.hasEarlier ? ['__earlier-history__'] : []),
    ...markers.value.map((m) => m.id),
  ].join('\u0000'),
)

const shouldRender = computed(() =>
  shouldRenderConversationMinimap({
    markerCount: markers.value.length,
    overflows: overflows.value,
    hasEarlier: props.hasEarlier,
  }),
)

// ── Labels ──
function roleLabel(role: ConversationMinimapMarker['role']): string {
  return role === 'user' ? t('chat.you') : t('chat.claude')
}
const earlierLabel = computed(() =>
  props.loadingEarlier
    ? t('chat.loadingEarlierMessages')
    : t('chat.showEarlierMessages'),
)

// ── Marker ref management ──
function setMarkerRef(id: string, el: HTMLButtonElement | null) {
  if (el) markerEls.value.set(id, el)
  else markerEls.value.delete(id)
}

// ── Offset computation ──
function recomputeOffsets() {
  const el = props.scrollRef
  if (!el) {
    cachedOffsets = []
    return
  }
  const baseTop = el.getBoundingClientRect().top
  const markerIds = new Set(markers.value.map((m) => m.id))
  const out: { id: string; offset: number }[] = []
  el.querySelectorAll<HTMLElement>('[data-minimap-id]').forEach((node) => {
    const id = node.dataset.minimapId || ''
    if (!markerIds.has(id)) return
    out.push({
      id,
      offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
    })
  })
  cachedOffsets = out
}

function getOffsets(): { id: string; offset: number }[] {
  const el = props.scrollRef
  if (!el) return []
  const baseTop = el.getBoundingClientRect().top
  const markerIds = new Set(markers.value.map((m) => m.id))
  const out: { id: string; offset: number }[] = []
  el.querySelectorAll<HTMLElement>('[data-minimap-id]').forEach((node) => {
    const id = node.dataset.minimapId || ''
    if (!markerIds.has(id)) return
    out.push({
      id,
      offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
    })
  })
  return out
}

// ── Magnify center measurement (read-only pass, no style writes) ──
function measureMagnifyCenters() {
  const centers: { id: string; center: number }[] = []
  for (const [id, btn] of markerEls.value) {
    centers.push({ id, center: btn.offsetTop + btn.offsetHeight / 2 })
  }
  centers.sort((a, b) => a.center - b.center)
  magnifyCenters = centers
}

// ── Active marker tracking via binary search on cached offsets ──
function updateActive() {
  const el = props.scrollRef
  if (!el) return
  if (cachedOffsets.length === 0) {
    if (activeIdCache !== null) {
      activeIdCache = null
      activeId.value = null
    }
    return
  }
  const anchor = el.scrollTop + el.clientHeight * 0.3
  let lo = 0
  let hi = cachedOffsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (cachedOffsets[mid].offset <= anchor) lo = mid
    else hi = mid - 1
  }
  const id = cachedOffsets[lo].id
  if (id !== activeIdCache) {
    activeIdCache = id
    activeId.value = id
  }
}

// ── Overflow detection ──
function updateOverflow() {
  const el = props.scrollRef
  if (!el) {
    if (overflowsCache) {
      overflowsCache = false
      overflows.value = false
    }
    return
  }
  const nowOverflows = el.scrollHeight - el.clientHeight > 1
  if (nowOverflows !== overflowsCache) {
    overflowsCache = nowOverflows
    overflows.value = nowOverflows
  }
}

// ── Jump to a marker ──
function jumpTo(id: string) {
  const el = props.scrollRef
  if (!el) return
  const target = getOffsets().find((entry) => entry.id === id)
  if (!target) return
  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  el.scrollTo({
    top: Math.max(0, target.offset - 24),
    behavior: reduceMotion ? 'auto' : 'smooth',
  })
}

// ── Dock magnification constants ──
const MAGNIFY_RADIUS = 46
const MAGNIFY_BOOST = 1.3
const POPOVER_SNAP = 24
const POPOVER_HEIGHT = 132

// ── Apply magnification imperatively (no re-render on mousemove) ──
function applyMagnify(cursorY: number | null) {
  if (magnifyCenters.length === 0) {
    measureMagnifyCenters()
  }
  let nearest: { id: string; dist: number; center: number } | null = null
  for (const { id, center } of magnifyCenters) {
    const btn = markerEls.value.get(id)
    if (!btn) continue
    let scale = 1
    if (cursorY != null) {
      const dist = Math.abs(center - cursorY)
      if (dist < MAGNIFY_RADIUS) {
        scale = 1 + MAGNIFY_BOOST * Math.cos((dist / MAGNIFY_RADIUS) * (Math.PI / 2))
      }
      if (dist <= POPOVER_SNAP && (!nearest || dist < nearest.dist)) {
        nearest = { id, dist, center }
      }
    }
    btn.style.setProperty('--magnify', scale.toFixed(3))
  }
  if (nearest) {
    const marker = markers.value.find((m) => m.id === nearest!.id)
    const rail = railRef.value
    if (marker && rail) {
      const top = Math.min(
        Math.max(nearest.center - 36, 0),
        Math.max(rail.clientHeight - POPOVER_HEIGHT, 0),
      )
      const prev = hovered.value
      if (!prev || prev.marker.id !== marker.id || prev.top !== top) {
        hovered.value = { marker, top }
      }
      return
    }
  }
  hovered.value = null
}

// ── Mouse handlers ──
function handleMouseMove(event: MouseEvent) {
  const rail = railRef.value
  if (!rail) return
  const y = event.clientY - rail.getBoundingClientRect().top
  cancelAnimationFrame(moveRaf)
  moveRaf = requestAnimationFrame(() => applyMagnify(y))
}

function handleMouseLeave() {
  cancelAnimationFrame(moveRaf)
  applyMagnify(null)
}

function handleMarkerFocus(
  event: FocusEvent,
  marker: ConversationMinimapMarker,
) {
  const target = event.currentTarget as HTMLButtonElement
  hovered.value = {
    marker,
    top: Math.max(0, target.offsetTop - 36),
  }
}
function handleRevealEarlier() {
  props.onRevealEarlier?.()
}

// ── ResizeObserver for rail (catches composer height changes) ──
let railResizeObserver: ResizeObserver | null = null

// ── Lifecycle: recompute on marker identity change ──
watch(markerIdentity, () => {
  nextTick(() => {
    recomputeOffsets()
    updateOverflow()
    measureMagnifyCenters()
    updateActive()
  })
})

watch(shouldRender, (visible) => {
  if (visible) {
    nextTick(() => {
      recomputeOffsets()
      updateOverflow()
      measureMagnifyCenters()
      updateActive()
      setupRailResizeObserver()
    })
  } else {
    teardownRailResizeObserver()
  }
})

// ── Rail ResizeObserver ──
function setupRailResizeObserver() {
  const rail = railRef.value
  if (!rail || typeof ResizeObserver === 'undefined') return
  teardownRailResizeObserver()
  let frame = 0
  railResizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measureMagnifyCenters)
  })
  railResizeObserver.observe(rail)
}

function teardownRailResizeObserver() {
  railResizeObserver?.disconnect()
  railResizeObserver = null
}

// ── Scroll & resize listeners on the scroll container ──
let scrollRaf = 0
let resizeRaf = 0

function scheduleScroll() {
  cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    updateActive()
    updateOverflow()
  })
}

function scheduleResize() {
  cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    recomputeOffsets()
    updateActive()
    updateOverflow()
    measureMagnifyCenters()
  })
}

let contentResizeObserver: ResizeObserver | null = null

onMounted(() => {
  const el = props.scrollRef
  if (!el) return

  recomputeOffsets()
  updateOverflow()
  measureMagnifyCenters()
  updateActive()

  el.addEventListener('scroll', scheduleScroll, { passive: true })

  const content = el.firstElementChild as HTMLElement | null
  if (content && typeof ResizeObserver !== 'undefined') {
    contentResizeObserver = new ResizeObserver(scheduleResize)
    contentResizeObserver.observe(content)
  }

  window.addEventListener('resize', scheduleResize)
  setupRailResizeObserver()
})

onUnmounted(() => {
  const el = props.scrollRef
  if (el) {
    el.removeEventListener('scroll', scheduleScroll)
  }
  contentResizeObserver?.disconnect()
  teardownRailResizeObserver()
  window.removeEventListener('resize', scheduleResize)
  cancelAnimationFrame(scrollRaf)
  cancelAnimationFrame(resizeRaf)
  cancelAnimationFrame(moveRaf)
})
</script>

<style lang="scss" scoped>
/* Conversation minimap: packed stack of dashes on the thread's left edge,
 * centered inside the safe span between header and composer. Dense
 * stacks reduce their gap and marker pitch instead of escaping that span.
 * Dashes grow horizontally with a Dock-style falloff driven by --magnify
 * (set from JS), so magnification never reflows the stack. */
.minimap-rail {
  position: absolute;
  left: 4px;
  top: 8px;
  bottom: 16px;
  z-index: 6;
  display: flex;
  width: 26px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: clamp(
    0px,
    calc(4px - var(--minimap-marker-count, 0) * 0.05px),
    2px
  );
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.minimap-marker {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  width: 100%;
  height: 8px;
  min-height: 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;

  &::before {
    content: '';
    height: min(2px, 100%);
    width: calc(var(--dash-w, 8px) * var(--magnify, 1));
    border-radius: var(--radius-full, 9999px);
    background: color-mix(in oklab, var(--text-primary, #e0e0e0) 14%, transparent);
    transition:
      width 90ms ease-out,
      background 0.15s ease-out;
  }

  &.user {
    --dash-w: 13px;
  }

  &.assistant {
    --dash-w: 8px;
  }

  &.history {
    --dash-w: 13px;

    &::before {
      background: repeating-linear-gradient(
        90deg,
        color-mix(in oklab, var(--text-primary, #e0e0e0) 14%, transparent) 0 2px,
        transparent 2px 4px
      );
    }
  }

  &:hover::before,
  &:focus-visible::before {
    background: var(--text-secondary, #aaa);
  }

  &.history:hover::before,
  &.history:focus-visible::before {
    background: repeating-linear-gradient(
      90deg,
      var(--text-secondary, #aaa) 0 2px,
      transparent 2px 4px
    );
  }

  &.history:disabled {
    cursor: progress;

    &::before {
      opacity: 0.55;
    }
  }

  &.active::before {
    background: var(--text-primary, #e0e0e0);
  }
}

.minimap-popover {
  position: absolute;
  left: 30px;
  z-index: 7;
  width: 248px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--surface-border, #333);
  background: var(--bg-elevated, var(--bg-secondary, #1e1e1e));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.minimap-popover-role {
  margin-bottom: 4px;
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--text-muted, #888);
}

.minimap-popover-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
  color: var(--text-secondary, #ccc);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
