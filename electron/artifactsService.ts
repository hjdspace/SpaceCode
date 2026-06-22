/**
 * Artifacts Service — lists, opens, and reveals generated output files.
 *
 * Work-mode assistants write deliverables (.pptx/.docx/.xlsx/.pdf/…) into an
 * `outputs/` folder inside the session working directory. This service exposes
 * that folder to the renderer's Artifacts panel.
 */

import { ipcMain, shell } from 'electron'
import { join } from 'path'
import { readdirSync, statSync, existsSync } from 'fs'

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

  console.log('[Artifacts] IPC handlers registered')
}
