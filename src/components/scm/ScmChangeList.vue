<template>
  <!-- Staged files -->
  <template v-if="scmStore.staged.length > 0">
    <div class="sub-group-label">{{ t('scm.stagedChanges') }}</div>
    <ScmFileTree
      v-if="scmStore.viewMode === 'tree'"
      :entries="stagedEntries"
      :selected-path="scmStore.selectedFile?.path ?? null"
      @select="onSelect"
      @stage="actions.stageFile"
      @unstage="actions.unstageFile"
      @copy-path="actions.copyPath"
      @contextmenu="emit('contextmenu', $event)"
    />
    <template v-else>
      <ScmChangeRow
        v-for="file in scmStore.staged"
        :key="'staged-' + file.path"
        :file="file"
        :is-staged="true"
        :selected="scmStore.selectedFile?.path === file.path && scmStore.selectedFileStaged"
        :stats="scmStore.fileStats[file.path] ?? null"
        @select="onSelect($event, true)"
        @stage="actions.stageFile"
        @unstage="actions.unstageFile"
        @copy-path="actions.copyPath"
        @contextmenu="emit('contextmenu', $event)"
      />
    </template>
  </template>
  <!-- Unstaged + Untracked -->
  <template v-if="scmStore.unstaged.length > 0 || scmStore.untracked.length > 0">
    <div class="sub-group-label" @click.stop="actions.stageAll()" :title="t('scm.stageAllChanges')">
      {{ t('scm.changesCount') }} <span class="sub-count">{{ scmStore.unstaged.length + scmStore.untracked.length }}</span>
    </div>
    <ScmFileTree
      v-if="scmStore.viewMode === 'tree'"
      :entries="unstagedEntries"
      :selected-path="scmStore.selectedFile?.path ?? null"
      @select="onSelect"
      @stage="actions.stageFile"
      @copy-path="actions.copyPath"
      @contextmenu="emit('contextmenu', $event)"
    />
    <template v-else>
      <ScmChangeRow
        v-for="file in scmStore.unstaged"
        :key="'unstaged-' + file.path"
        :file="file"
        :is-staged="false"
        :selected="scmStore.selectedFile?.path === file.path && !scmStore.selectedFileStaged"
        :stats="scmStore.fileStats[file.path] ?? null"
        @select="onSelect($event, false)"
        @stage="actions.stageFile"
        @discard="actions.discardFile"
        @copy-path="actions.copyPath"
        @contextmenu="emit('contextmenu', $event)"
      />
      <ScmChangeRow
        v-for="file in scmStore.untracked"
        :key="'untracked-' + file.path"
        :file="file"
        :is-staged="false"
        :selected="scmStore.selectedFile?.path === file.path && !scmStore.selectedFileStaged"
        :stats="scmStore.fileStats[file.path] ?? null"
        @select="onSelect($event, false)"
        @stage="actions.stageFile"
        @contextmenu="emit('contextmenu', $event)"
      />
    </template>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useScmStore } from '@/stores/scm'
import { useScmActions } from '@/composables/useScmActions'
import type { ScmFile } from '@/stores/scm'
import type { ChangeTreeEntry } from '@/composables/useScmChangesTree'
import ScmChangeRow from './ScmChangeRow.vue'
import ScmFileTree from './ScmFileTree.vue'

const emit = defineEmits<{
  contextmenu: [payload: { file: ScmFile; isStaged: boolean; x: number; y: number }]
}>()

const scmStore = useScmStore()
const { t } = useI18n()
const actions = useScmActions()

const stagedEntries = computed<ChangeTreeEntry[]>(() =>
  scmStore.staged.map(file => ({ file, isStaged: true }))
)

const unstagedEntries = computed<ChangeTreeEntry[]>(() => [
  ...scmStore.unstaged.map(file => ({ file, isStaged: false })),
  ...scmStore.untracked.map(file => ({ file, isStaged: false })),
])

function onSelect(file: ScmFile, isStaged: boolean): void {
  actions.openFileDiff(file, isStaged)
}
</script>

<style lang="scss" scoped>
.sub-group-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary, var(--text-muted));
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 4px 8px 2px;
  cursor: pointer;

  .sub-count {
    color: var(--accent-primary);
  }
}
</style>
