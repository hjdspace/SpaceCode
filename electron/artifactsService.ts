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
      const full = join(dir, entry.name)
      if (entry.isFile()) {
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
      } else if (entry.isDirectory() && depth > 0) {
        walk(full, depth - 1)
      }
    }
  }
  walk(outputsDir, 2)

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
