/**
 * 记忆页 store — 项目/文件列表、当前打开的文件、草稿与保存。
 *
 * 竞态策略：每类请求各自持有一个自增序号，响应回来时序号不匹配（说明已有
 * 更新的请求发出）或项目上下文已切换，就丢弃结果，避免慢响应覆盖新状态。
 * 保存还额外校验「项目+文件+草稿」三元组，避免把 A 文件的保存结果写回 B 文件。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/services/electronAPI'
import type { MemoryFile, MemoryFileDetail, MemoryProject } from '@/types/memory'

/** 只有存在记忆目录（或其中有文件）的项目可被选中。 */
function canSelectMemoryProject(project: MemoryProject): boolean {
  return project.exists || project.fileCount > 0
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const useMemoryStore = defineStore('memory', () => {
  const projects = ref<MemoryProject[]>([])
  const files = ref<MemoryFile[]>([])
  const selectedProjectId = ref<string | null>(null)
  const selectedFile = ref<MemoryFileDetail | null>(null)
  const draftContent = ref('')
  const isLoadingProjects = ref(false)
  const isLoadingFiles = ref(false)
  const isLoadingFile = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const lastSavedAt = ref<string | null>(null)
  /** 外部请求打开某个记忆文件（绝对路径）时的一次性载荷。 */
  const pendingOpenPath = ref<string | null>(null)

  let projectsRequest = 0
  let filesRequest = 0
  let fileRequest = 0
  let saveRequest = 0

  /** 切换项目上下文：让所有在途请求作废。 */
  function invalidateProjectContext(): void {
    filesRequest += 1
    fileRequest += 1
    saveRequest += 1
  }

  async function fetchProjects(cwd?: string): Promise<void> {
    const request = ++projectsRequest
    isLoadingProjects.value = true
    error.value = null
    try {
      const { projects: fetched } = await api.memory.listProjects(cwd)
      if (request !== projectsRequest) return
      const selectableProjects = fetched.filter(canSelectMemoryProject)
      const current = selectableProjects.find((project) => project.isCurrent)
      const previousSelectedProjectId = selectedProjectId.value
      const nextSelectedProjectId =
        previousSelectedProjectId && selectableProjects.some((project) => project.id === previousSelectedProjectId)
          ? previousSelectedProjectId
          : current?.id ?? selectableProjects[0]?.id ?? null

      if (nextSelectedProjectId !== previousSelectedProjectId) {
        invalidateProjectContext()
        files.value = []
        selectedFile.value = null
        draftContent.value = ''
        lastSavedAt.value = null
        isLoadingFiles.value = false
        isLoadingFile.value = false
        isSaving.value = false
      }
      projects.value = fetched
      selectedProjectId.value = nextSelectedProjectId
      isLoadingProjects.value = false
    } catch (err) {
      if (request !== projectsRequest) return
      error.value = errorMessage(err)
      isLoadingProjects.value = false
    }
  }

  function selectProject(projectId: string): void {
    if (selectedProjectId.value === projectId) return
    invalidateProjectContext()
    selectedProjectId.value = projectId
    files.value = []
    selectedFile.value = null
    draftContent.value = ''
    isLoadingFiles.value = false
    isLoadingFile.value = false
    isSaving.value = false
    error.value = null
    lastSavedAt.value = null
  }

  async function fetchFiles(projectId: string): Promise<void> {
    const request = ++filesRequest
    isLoadingFiles.value = true
    error.value = null
    try {
      const { files: fetched } = await api.memory.listFiles(projectId)
      if (request !== filesRequest || selectedProjectId.value !== projectId) return
      const stillSelected = Boolean(
        selectedFile.value && fetched.some((file) => file.path === selectedFile.value?.path),
      )
      if (!stillSelected) {
        selectedFile.value = null
        draftContent.value = ''
      }
      files.value = fetched
      isLoadingFiles.value = false
    } catch (err) {
      if (request !== filesRequest || selectedProjectId.value !== projectId) return
      error.value = errorMessage(err)
      isLoadingFiles.value = false
    }
  }

  async function openFile(projectId: string, path: string): Promise<boolean> {
    const request = ++fileRequest
    isLoadingFile.value = true
    error.value = null
    try {
      const { file } = await api.memory.readFile(projectId, path)
      if (request !== fileRequest || selectedProjectId.value !== projectId) {
        return false
      }
      selectedFile.value = file
      draftContent.value = file.content
      isLoadingFile.value = false
      lastSavedAt.value = null
      return true
    } catch (err) {
      if (request !== fileRequest || selectedProjectId.value !== projectId) {
        return false
      }
      error.value = errorMessage(err)
      isLoadingFile.value = false
      return false
    }
  }

  function updateDraft(content: string): void {
    draftContent.value = content
  }

  function setPendingOpenPath(path: string | null): void {
    pendingOpenPath.value = path
  }

  async function saveFile(): Promise<boolean> {
    const projectId = selectedProjectId.value
    const file = selectedFile.value
    const content = draftContent.value
    if (!projectId || !file || isSaving.value) return false

    const request = ++saveRequest
    const identity = `${projectId}\0${file.path}`
    isSaving.value = true
    error.value = null
    try {
      const { file: revision } = await api.memory.saveFile({
        projectId,
        path: file.path,
        content,
        expectedUpdatedAt: file.updatedAt,
        expectedBytes: file.bytes,
      })
      const currentFile = selectedFile.value
      if (
        request !== saveRequest ||
        !currentFile ||
        `${selectedProjectId.value}\0${currentFile.path}` !== identity ||
        draftContent.value !== content
      ) {
        if (request === saveRequest) isSaving.value = false
        return false
      }
      selectedFile.value = { ...currentFile, updatedAt: revision.updatedAt, bytes: revision.bytes, content }
      isSaving.value = false
      lastSavedAt.value = revision.updatedAt
      await fetchFiles(projectId)
      return true
    } catch (err) {
      if (request !== saveRequest) return false
      error.value = errorMessage(err)
      isSaving.value = false
      return false
    }
  }

  return {
    projects,
    files,
    selectedProjectId,
    selectedFile,
    draftContent,
    isLoadingProjects,
    isLoadingFiles,
    isLoadingFile,
    isSaving,
    error,
    lastSavedAt,
    pendingOpenPath,
    fetchProjects,
    selectProject,
    fetchFiles,
    openFile,
    updateDraft,
    saveFile,
    setPendingOpenPath,
  }
})
