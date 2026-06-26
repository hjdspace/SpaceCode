/**
 * Artifacts Service — lists, opens, and reveals generated output files.
 *
 * Work-mode assistants write deliverables (.pptx/.docx/.xlsx/.pdf/…) into an
 * `outputs/` folder inside the session working directory. This service exposes
 * that folder to the renderer's Artifacts panel.
 */

import { ipcMain, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { readdirSync, statSync, existsSync, watch, type FSWatcher } from 'fs'

export interface ArtifactEntry {
  name: string
  path: string
  ext: string
  size: number
  mtime: number
}

const OUTPUTS_DIRNAME = 'outputs'

// 过程产物 / 噪声目录：不递归、不展示（避免 node_modules 等刷屏）
const NOISE_DIRS = new Set([
  'node_modules', '.git', '.cache', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.pytest_cache', '.mypy_cache', 'vendor', '.idea', '.vscode',
])

// 噪声文件：构建/锁定/隐藏文件，不作为"成果"展示
const NOISE_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', '.ds_store', 'thumbs.db',
])

function listArtifacts(workingDir: string): ArtifactEntry[] {
  if (!workingDir || typeof workingDir !== 'string') return []
  const outputsDir = join(workingDir, OUTPUTS_DIRNAME)
  if (!existsSync(outputsDir)) return []

  const results: ArtifactEntry[] = []
  const walk = (dir: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const lower = entry.name.toLowerCase()
      // 跳过隐藏项与噪声目录
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (NOISE_DIRS.has(lower) || depth <= 0) continue
        walk(full, depth - 1)
      } else if (entry.isFile()) {
        if (NOISE_FILES.has(lower)) continue
        try {
          const st = statSync(full)
          const dot = entry.name.lastIndexOf('.')
          results.push({
            name: entry.name,
            path: full,
            ext: dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : '',
            size: st.size,
            mtime: st.mtimeMs,
          })
        } catch { /* ignore */ }
      }
    }
  }
  walk(outputsDir, 3)

  // 最近修改在前
  results.sort((a, b) => b.mtime - a.mtime)
  return results
}

// ===== Phase 6: fs.watch 实时推送 =====

let artifactsWatcher: FSWatcher | null = null
/** Linux 下 recursive 不支持，需额外监听子目录 */
const subWatchers: FSWatcher[] = []

/** 防抖：短时间多次变更合并为一次通知 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyArtifactsChanged(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('artifacts:changed', { eventType: 'change', filename: '' })
    }
    debounceTimer = null
  }, 300)
}

function startArtifactsWatch(workingDir: string): void {
  // 停止旧 watcher
  stopArtifactsWatch()

  if (!workingDir) return
  const artifactsDir = join(workingDir, OUTPUTS_DIRNAME)
  if (!existsSync(artifactsDir)) {
    console.warn('[Artifacts] Watch target does not exist:', artifactsDir)
    return
  }

  // recursive: true — macOS/Windows 原生支持，Linux 被忽略（仅监听顶层）
  try {
    artifactsWatcher = watch(artifactsDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      if (filename.includes('node_modules') || filename.includes('.git')) return
      notifyArtifactsChanged()
    })
    artifactsWatcher.on('error', (err) => {
      console.error('[Artifacts] Watcher error:', err)
    })
  } catch (err) {
    console.error('[Artifacts] Failed to start recursive watch:', err)
  }

  // Linux 兼容：补充监听一层子目录
  if (process.platform === 'linux') {
    try {
      const subdirs = readdirSync(artifactsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => join(artifactsDir, d.name))
      for (const subdir of subdirs) {
        try {
          const sw = watch(subdir, () => notifyArtifactsChanged())
          sw.on('error', () => { /* ignore sub-dir watch errors */ })
          subWatchers.push(sw)
        } catch { /* ignore */ }
      }
    } catch {
      // 子目录监听失败不阻断主流程
    }
  }

  console.log('[Artifacts] Watch started for:', artifactsDir)
}

export function stopArtifactsWatch(): void {
  if (artifactsWatcher) {
    artifactsWatcher.close()
    artifactsWatcher = null
  }
  for (const sw of subWatchers) {
    try { sw.close() } catch { /* ignore */ }
  }
  subWatchers.length = 0
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

export function registerArtifactsIPCHandlers(): void {
  ipcMain.handle('artifacts:list', async (_e, workingDir: string) => {
    return { artifacts: listArtifacts(workingDir) }
  })

  ipcMain.handle('artifacts:open', async (_e, filePath: string) => {
    if (!filePath) return { success: false }
    const err = await shell.openPath(filePath)
    return { success: !err, error: err || undefined }
  })

  ipcMain.handle('artifacts:reveal', async (_e, filePath: string) => {
    if (!filePath) return { success: false }
    shell.showItemInFolder(filePath)
    return { success: true }
  })

  // Phase 6: fs.watch 实时推送
  ipcMain.handle('artifacts:startWatch', async (_e, workingDir: string) => {
    startArtifactsWatch(workingDir)
    return true
  })

  ipcMain.handle('artifacts:stopWatch', async () => {
    stopArtifactsWatch()
    return true
  })

  console.log('[Artifacts] IPC handlers registered')
}
