<template>
  <template v-for="item in visibleItems" :key="item.node.path">
    <!-- Directory row (collapsible) -->
    <div
      v-if="item.node.type === 'dir'"
      class="tree-dir-row"
      :style="{ paddingLeft: 4 + item.depth * 12 + 'px' }"
      @click="toggleDir(item.node.path)"
    >
      <ChevronRight :size="12" class="dir-chevron" :class="{ rotated: !collapsedDirs.has(item.node.path) }" />
      <Folder :size="13" class="dir-icon" />
      <span class="dir-name" :title="item.node.path">{{ item.node.name }}</span>
    </div>
    <!-- File row -->
    <ScmChangeRow
      v-else
      :file="item.node.file!"
      :is-staged="!!item.node.isStaged"
      :selected="selectedPath === item.node.path"
      :style="{ paddingLeft: 2 + item.depth * 12 + 'px' }"
      @select="emit('select', $event, !!item.node.isStaged)"
      @stage="emit('stage', $event)"
      @unstage="emit('unstage', $event)"
      @discard="emit('discard', $event)"
      @copy-path="emit('copyPath', $event)"
      @contextmenu="emit('contextmenu', $event)"
    />
  </template>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronRight, Folder } from 'lucide-vue-next'
import { buildChangeTree, flattenVisibleTree } from '@/composables/useScmChangesTree'
import type { ChangeTreeEntry } from '@/composables/useScmChangesTree'
import type { ScmFile } from '@/stores/scm'
import ScmChangeRow from './ScmChangeRow.vue'

const props = defineProps<{
  entries: ChangeTreeEntry[]
  selectedPath?: string | null
}>()

const emit = defineEmits<{
  select: [file: ScmFile, isStaged: boolean]
  stage: [file: ScmFile]
  unstage: [file: ScmFile]
  discard: [file: ScmFile]
  copyPath: [file: ScmFile]
  contextmenu: [payload: { file: ScmFile; isStaged: boolean; x: number; y: number }]
}>()

const collapsedDirs = ref<Set<string>>(new Set())

const visibleItems = computed(() =>
  flattenVisibleTree(buildChangeTree(props.entries), collapsedDirs.value)
)

function toggleDir(path: string): void {
  const next = new Set(collapsedDirs.value)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  collapsedDirs.value = next
}
</script>

<style lang="scss" scoped>
.tree-dir-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-height: 26px;

  &:hover { background: var(--surface-glass-hover); }
}

.dir-chevron {
  color: var(--text-muted);
  transition: transform var(--transition-fast);
  flex-shrink: 0;

  &.rotated { transform: rotate(90deg); }
}

.dir-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.dir-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
