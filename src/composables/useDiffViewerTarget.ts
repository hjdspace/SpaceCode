/**
 * Diff viewer data layer — resolves the diff target (active diff tab or SCM
 * selection), loads the raw patch, provides hunk metadata and hunk-level
 * stage/unstage actions with whole-file fallback.
 */
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { useScmStore } from '@/stores/scm'
import { useAppStore, type ScmDiffTabData } from '@/stores/app'
import {
  splitPatch,
  buildHunkPatch,
  computePatchStats,
  buildUntrackedPatch,
} from '@/services/diffFileBuilder'

export interface DiffViewerTarget {
  filePath: string
  staged: boolean
  /** Commit context — viewing a commit's diff (read-only, no hunk staging). */
  commitHash?: string
}

export function useDiffViewerTarget() {
  const scmStore = useScmStore()
  const appStore = useAppStore()

  const target = computed<DiffViewerTarget | null>(() => {
    const tab = appStore.activeInfoTab
    if (tab && tab.type === 'diff' && tab.data) {
      const d = tab.data as ScmDiffTabData
      if (d.commitHash) {
        return { filePath: d.filePath, staged: false, commitHash: d.commitHash }
      }
      return { filePath: d.filePath, staged: d.staged }
    }
    if (scmStore.selectedFile) {
      return { filePath: scmStore.selectedFile.path, staged: scmStore.selectedFileStaged }
    }
    return null
  })

  const isUntracked = computed(() => {
    const t = target.value
    if (!t) return false
    return (
      scmStore.selectedFile?.status === 'untracked' ||
      scmStore.untracked.some(f => f.path === t.filePath)
    )
  })

  const isBinary = computed(() => rawPatch.value.includes('Binary files'))

  const rawPatch = ref('')
  const isLoading = ref(false)

  /** Old/new side contents for syntax highlighting; null → hunk-only render. */
  const oldContent = ref<string | null>(null)
  const newContent = ref<string | null>(null)

  const stats = computed(() => computePatchStats(rawPatch.value))

  const hunkHeaders = computed(() =>
    splitPatch(rawPatch.value).hunks.map(h => h.split('\n')[0] ?? '')
  )

  const hunkCount = computed(() => hunkHeaders.value.length)

  async function load(): Promise<void> {
    const t = target.value
    const cwd = appStore.projectRoot
    if (!t || !cwd) {
      rawPatch.value = ''
      oldContent.value = null
      newContent.value = null
      return
    }

    isLoading.value = true
    try {
      let patch: string | null = ''
      if (t.commitHash) {
        // Commit view: whole-commit diff (first-parent), optionally per file
        patch = await api.git.getCommitDiff(cwd, t.commitHash, t.filePath || undefined)
      } else {
        patch = await api.git.getRawDiff(cwd, t.filePath, t.staged)

        // Untracked files have no git diff — synthesize a valid new-file patch
        // from the worktree content (also hunk-stageable via git apply --cached).
        if (!patch && isUntracked.value) {
          const content = await api.readFile(cwd.replace(/[/\\]$/, '') + '/' + t.filePath)
          if (content) patch = buildUntrackedPatch(t.filePath, content)
        }
      }
      rawPatch.value = patch || ''

      // Best-effort side contents for syntax highlighting. Only exact sources
      // are used — approximations would corrupt the rendered lines.
      oldContent.value = null
      newContent.value = null
      if (rawPatch.value && !isBinary.value && !isUntracked.value && !t.commitHash) {
        const head = await api.git.showFile(cwd, t.filePath, false)
        if (head !== null) oldContent.value = head
        const stagedContent = t.staged
          ? await api.git.showFile(cwd, t.filePath, true)
          : await api.readFile(cwd.replace(/[/\\]$/, '') + '/' + t.filePath)
        if (stagedContent !== null) newContent.value = stagedContent
      }
    } catch (e) {
      console.error('[useDiffViewerTarget] Failed to load diff:', e)
      rawPatch.value = ''
    } finally {
      isLoading.value = false
    }
  }

  async function applyHunk(index: number, stage: boolean): Promise<void> {
    const t = target.value
    const cwd = appStore.projectRoot
    if (!t || !cwd || t.commitHash) return
    const patch = buildHunkPatch(rawPatch.value, [index])
    if (patch) {
      const result = stage
        ? await api.git.stageHunks(cwd, t.filePath, patch)
        : await api.git.unstageHunks(cwd, t.filePath, patch)
      if (result?.success) {
        await scmStore.refresh()
        await load()
        return
      }
    }
    // Fallback: apply failed (CRLF/binary edge cases) — whole-file stage/unstage
    if (stage) await scmStore.stagePaths([t.filePath])
    else await scmStore.unstagePaths([t.filePath])
  }

  return {
    target,
    isUntracked,
    isBinary,
    rawPatch,
    isLoading,
    oldContent,
    newContent,
    stats,
    hunkHeaders,
    hunkCount,
    load,
    stageHunk: (index: number) => applyHunk(index, true),
    unstageHunk: (index: number) => applyHunk(index, false),
  }
}
