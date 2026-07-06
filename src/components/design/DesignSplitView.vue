<template>
  <div class="split-view" ref="containerRef">
    <div class="split-pane left" :style="{ flexBasis: leftPct + '%' }">
      <slot name="left" />
    </div>
    <div class="split-handle" @mousedown="startDrag" />
    <div class="split-pane right" :style="{ flexBasis: (100 - leftPct) + '%' }">
      <slot name="right" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
const leftPct = ref(55)
const containerRef = ref<HTMLElement | null>(null)
let dragging = false

function startDrag(e: MouseEvent) {
  dragging = true
  e.preventDefault()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}
function onDrag(e: MouseEvent) {
  if (!dragging || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  leftPct.value = Math.max(30, Math.min(70, pct))
}
function stopDrag() {
  dragging = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}
onUnmounted(stopDrag)
</script>

<style scoped lang="scss">
.split-view { display: flex; height: 100%; overflow: hidden; }
.split-pane { overflow: hidden; }
.split-handle { width: 4px; cursor: col-resize; background: var(--surface-border); &:hover { background: var(--accent-primary); } }
</style>
