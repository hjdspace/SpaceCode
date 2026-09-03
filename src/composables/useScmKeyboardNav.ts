/**
 * Keyboard navigation for the SCM changes list (VSCode-style):
 * ↑/↓ move focus, Space toggles stage, Enter opens the diff, Delete discards.
 */
import { ref } from 'vue'
import { useScmStore } from '@/stores/scm'
import { useScmActions } from '@/composables/useScmActions'
import type { ScmFile } from '@/stores/scm'

export interface ScmNavEntry {
  file: ScmFile
  isStaged: boolean
}

export function useScmKeyboardNav(getEntries: () => ScmNavEntry[]) {
  const scmStore = useScmStore()
  const actions = useScmActions()

  const focusIndex = ref(-1)

  function setFocus(index: number): void {
    const entries = getEntries()
    if (entries.length === 0) {
      focusIndex.value = -1
      return
    }
    const clamped = Math.max(0, Math.min(index, entries.length - 1))
    focusIndex.value = clamped
    const entry = entries[clamped]
    scmStore.selectFile(entry.file, entry.isStaged)
  }

  function moveFocus(delta: number): void {
    const entries = getEntries()
    if (entries.length === 0) return
    if (focusIndex.value === -1) {
      setFocus(delta > 0 ? 0 : entries.length - 1)
      return
    }
    setFocus(focusIndex.value + delta)
  }

  function handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveFocus(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveFocus(-1)
        break
      case 'Home':
        e.preventDefault()
        setFocus(0)
        break
      case 'End':
        e.preventDefault()
        setFocus(getEntries().length - 1)
        break
      case ' ':
      case 'Spacebar': {
        e.preventDefault()
        const entry = getEntries()[focusIndex.value]
        if (!entry) return
        if (entry.isStaged) actions.unstageFile(entry.file)
        else actions.stageFile(entry.file)
        break
      }
      case 'Enter': {
        e.preventDefault()
        const entry = getEntries()[focusIndex.value]
        if (!entry) return
        actions.openFileDiff(entry.file, entry.isStaged)
        break
      }
      case 'Delete': {
        e.preventDefault()
        const entry = getEntries()[focusIndex.value]
        if (!entry || entry.isStaged || entry.file.status === 'untracked') return
        actions.discardFile(entry.file)
        break
      }
    }
  }

  return { focusIndex, handleKeydown }
}
