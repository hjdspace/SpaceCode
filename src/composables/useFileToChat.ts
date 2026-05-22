import { ref } from 'vue'

interface FileToAdd {
  name: string
  path: string
  isFolder: boolean
}

const pendingFile = ref<FileToAdd | null>(null)

export function useFileToChat() {
  function addFileToFile(file: { name: string; path: string; type: 'file' | 'directory' }) {
    pendingFile.value = {
      name: file.name,
      path: file.path,
      isFolder: file.type === 'directory'
    }
  }

  function consumePendingFile(): FileToAdd | null {
    const file = pendingFile.value
    pendingFile.value = null
    return file
  }

  function clearPendingFile() {
    pendingFile.value = null
  }

  return {
    pendingFile,
    addFileToFile,
    consumePendingFile,
    clearPendingFile
  }
}
