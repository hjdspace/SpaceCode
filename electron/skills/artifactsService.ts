/**
 * Artifacts Service — lists, opens, and reveals generated output files.
 *
 * Work-mode assistants write deliverables (.pptx/.docx/.xlsx/.pdf/…) into an
 * `outputs/` folder inside the session working directory. This service exposes
 * that folder to the renderer's Artifacts panel.
 *
 * Design and code sessions have no such convention — the agent writes straight
 * into the workspace. `scanWorkspaceRoot` covers that for the turn summary card,
 * restricted to deliverable file types, and callers keep it to files touched in
 * the current turn.
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

export interface ArtifactListOptions {
  /**
   * 除 `<workingDir>/outputs/` 外，还扫描工作区根目录（design / code 会话的 agent
   * 直接把文件写在工作区里，没有 outputs/ 约定）。根目录里既有源码也有构建产物，
   * 所以这一路只收交付物类型，避免把整棵项目树报成"本次产物"。
   */
  scanWorkspaceRoot?: boolean
}

/**
 * 工作区根目录扫描深度：agent 常把交付物放进 `output/`、`pages/assets/` 这类
 * 一二级子目录，取 3 层；再深就要付出遍历整棵仓库的代价（这里是同步 fs 调用）。
 */
const WORKSPACE_ROOT_SCAN_DEPTH = 3

/** 工作区根目录里算作"交付物"的扩展名；outputs/ 下的文件不受此限制（目录约定本身就意味着成果）。 */
const DELIVERABLE_EXTS = new Set([
  // 办公文档
  'pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'pdf',
  // 网页与图片
  'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
])

export function listArtifacts(
  workingDir: string,
  options?: ArtifactListOptions,
): ArtifactEntry[] {
  if (!workingDir || typeof workingDir !== 'string') return []

  const results: ArtifactEntry[] = []
  const walk = (dir: string, depth: number, deliverableOnly = false) => {
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
        walk(full, depth - 1, deliverableOnly)
      } else if (entry.isFile()) {
        if (NOISE_FILES.has(lower)) continue
        const dot = entry.name.lastIndexOf('.')
        const ext = dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : ''
        // 扩展名过滤放在 stat 之前：根目录扫描要路过成千上万个文件，
        // 先按名字淘汰非交付物可以省掉绝大部分同步 stat 开销。
        if (deliverableOnly && !DELIVERABLE_EXTS.has(ext)) continue
        try {
          const st = statSync(full)
          results.push({
            name: entry.name,
            path: full,
            ext,
            size: st.size,
            mtime: st.mtimeMs,
          })
        } catch { /* ignore */ }
      }
    }
  }

  // 主扫描路径：<workingDir>/outputs/
  const outputsDir = join(workingDir, OUTPUTS_DIRNAME)
  if (existsSync(outputsDir)) {
    walk(outputsDir, 3)
  }

  // 后备扫描：<workingDir>/.claude/commands/*/outputs/
  // 某些技能（如 morph-ppt）可能误将产物生成在技能目录下的 outputs/ 中，
  // 此后备扫描确保这些产物也能被产物面板发现。
  const commandsDir = join(workingDir, '.claude', 'commands')
  if (existsSync(commandsDir)) {
    try {
      for (const cmdDir of readdirSync(commandsDir, { withFileTypes: true })) {
        if (!cmdDir.isDirectory()) continue
        const fullCmdOutputs = join(commandsDir, cmdDir.name, OUTPUTS_DIRNAME)
        if (existsSync(fullCmdOutputs)) {
          walk(fullCmdOutputs, 3)
        }
      }
    } catch { /* ignore */ }
  }

  // 工作区根目录扫描：design / code 会话的产物直接落在工作区里。
  // 只收交付物类型，且根扫描会再次经过 outputs/，因此按路径去重，同一文件只入列一次。
  if (options?.scanWorkspaceRoot) {
    walk(workingDir, WORKSPACE_ROOT_SCAN_DEPTH, true)
    const seen = new Set<string>()
    const unique: ArtifactEntry[] = []
    for (const a of results) {
      if (seen.has(a.path)) continue
      seen.add(a.path)
      unique.push(a)
    }
    results.length = 0
    results.push(...unique)
  }

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
  let watchCount = 0

  // recursive: true — macOS/Windows 原生支持，Linux 被忽略（仅监听顶层）
  if (existsSync(artifactsDir)) {
    try {
      artifactsWatcher = watch(artifactsDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        if (filename.includes('node_modules') || filename.includes('.git')) return
        notifyArtifactsChanged()
      })
      artifactsWatcher.on('error', (err) => {
        console.error('[Artifacts] Watcher error:', err)
      })
      watchCount++
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
  }

  // 后备监听：<workingDir>/.claude/commands/*/outputs/
  const commandsDir = join(workingDir, '.claude', 'commands')
  if (existsSync(commandsDir)) {
    try {
      for (const cmdDir of readdirSync(commandsDir, { withFileTypes: true })) {
        if (!cmdDir.isDirectory()) continue
        const cmdOutputs = join(commandsDir, cmdDir.name, OUTPUTS_DIRNAME)
        if (!existsSync(cmdOutputs)) continue
        try {
          const sw = watch(cmdOutputs, { recursive: true }, (_eventType, filename) => {
            if (!filename) return
            notifyArtifactsChanged()
          })
          sw.on('error', () => { /* ignore */ })
          subWatchers.push(sw)
          watchCount++
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  if (watchCount > 0) {
    console.log('[Artifacts] Watch started for:', workingDir, `(${watchCount} director${watchCount > 1 ? 'ies' : 'y'})`)
  }
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
  ipcMain.handle('artifacts:list', async (_e, workingDir: string, options?: ArtifactListOptions) => {
    return { artifacts: listArtifacts(workingDir, options) }
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
