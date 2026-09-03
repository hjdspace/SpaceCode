/**
 * SCM action layer — bridges the scm store with UI concerns
 * (confirm dialogs, diff tab opening, multi-step action sequences).
 * Must be called within component setup context.
 */
import { useScmStore } from '@/stores/scm'
import { useAppStore } from '@/stores/app'
import { useDialog } from '@/composables/useDialog'
import { useI18n } from 'vue-i18n'
import type { ScmFile } from '@/stores/scm'

export function useScmActions() {
  const scmStore = useScmStore()
  const appStore = useAppStore()
  const { showConfirm } = useDialog()
  const { t } = useI18n()

  function openFileDiff(file: ScmFile, isStaged: boolean): void {
    scmStore.selectFile(file, isStaged)
    appStore.openScmDiff(file.path, isStaged)
  }

  function copyPath(file: ScmFile): void {
    navigator.clipboard.writeText(file.path).catch(() => {})
  }

  async function stageFile(file: ScmFile): Promise<void> {
    await scmStore.stagePaths([file.path])
  }

  async function unstageFile(file: ScmFile): Promise<void> {
    await scmStore.unstagePaths([file.path])
  }

  async function discardFile(file: ScmFile): Promise<void> {
    await scmStore.discardFileChanges([file.path])
  }

  async function stageAll(): Promise<void> {
    await scmStore.stageAllFiles()
  }

  async function unstageAll(): Promise<void> {
    await scmStore.unstageAllFiles()
  }

  async function discardAll(): Promise<void> {
    const allPaths = [
      ...scmStore.unstaged.map(f => f.path),
      ...scmStore.untracked.map(f => f.path),
    ]
    if (allPaths.length === 0) return
    if (!await showConfirm(t('scm.confirmDiscard', { count: allPaths.length }), { variant: 'danger' })) return
    await scmStore.discardFileChanges(allPaths)
  }

  function hasCommitInput(): boolean {
    return scmStore.commitMessage.trim().length > 0 && scmStore.stagedCount > 0
  }

  async function commit(): Promise<void> {
    if (!hasCommitInput()) return
    await scmStore.commitChanges()
  }

  async function commitAmend(): Promise<void> {
    if (!hasCommitInput()) return
    await scmStore.commitChanges(undefined, true)
  }

  async function commitAndPush(): Promise<void> {
    if (!hasCommitInput()) return
    const result = await scmStore.commitChanges()
    if (result?.success) {
      await scmStore.push()
    }
  }

  async function commitAndSync(): Promise<void> {
    if (!hasCommitInput()) return
    await scmStore.pull()
    const result = await scmStore.commitChanges()
    if (result?.success) {
      await scmStore.push()
    }
  }

  async function generateCommitMessage(): Promise<void> {
    if (scmStore.stagedCount === 0) return
    try {
      const message = await scmStore.generateCommitMessage()
      if (message) {
        scmStore.commitMessage = message
      }
    } catch (e: any) {
      console.error('[useScmActions] AI commit message generation failed:', e)
      scmStore.error = e.message || 'Failed to generate commit message'
      setTimeout(() => { if (scmStore.error === e.message) scmStore.error = null }, 4000)
    }
  }

  async function refresh(): Promise<void> {
    await scmStore.refresh()
    await scmStore.refreshBranches()
  }

  async function pull(): Promise<void> {
    await scmStore.pull()
  }

  async function push(): Promise<void> {
    await scmStore.push()
  }

  async function fetchAll(): Promise<void> {
    await scmStore.fetchAll()
  }

  async function toggleStash(): Promise<void> {
    if (scmStore.unstagedCount > 0) {
      await scmStore.stash()
    } else {
      await scmStore.stashPop()
    }
  }

  async function checkout(ref: string): Promise<void> {
    await scmStore.checkoutBranch(ref)
  }

  async function createBranch(name: string): Promise<void> {
    if (!name.trim()) return
    await scmStore.createBranch(name.trim(), true)
  }

  return {
    openFileDiff,
    copyPath,
    stageFile,
    unstageFile,
    discardFile,
    stageAll,
    unstageAll,
    discardAll,
    commit,
    commitAmend,
    commitAndPush,
    commitAndSync,
    generateCommitMessage,
    refresh,
    pull,
    push,
    fetchAll,
    toggleStash,
    checkout,
    createBranch,
  }
}
