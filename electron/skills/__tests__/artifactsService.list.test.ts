// @vitest-environment node
/**
 * listArtifacts — 产物发现的文件系统契约。
 *
 *  - 默认只认 `<workingDir>/outputs/`（work 助手的写入约定），工作区里既有的
 *    项目文件不算产物
 *  - `scanWorkspaceRoot` 为 design 会话额外扫工作区：agent 直接把交付物写在
 *    工作区根目录，没有 outputs/ 约定。扫根目录时 outputs/ 会被经过两次，
 *    因此结果必须按路径去重
 *  - 隐藏项、过程目录（node_modules 等）、构建/锁定文件始终排除
 *  - 根扫描深度有限，不吃掉整棵项目树
 *  - 最近修改的在前
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import { listArtifacts } from '@electron/skills/artifactsService'

let workspace = ''

function write(relative: string, content = 'x', mtimeSeconds?: number): string {
  const full = join(workspace, ...relative.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  if (mtimeSeconds !== undefined) {
    // 固定 mtime，避免同一秒内创建的文件排序不稳定
    utimesSync(full, new Date(mtimeSeconds * 1000), new Date(mtimeSeconds * 1000))
  }
  return full
}

function namesOf(list: ReturnType<typeof listArtifacts>): string[] {
  return list.map(a => a.name)
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'artifacts-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('listArtifacts（默认：只扫 outputs/）', () => {
  it('picks up deliverables under outputs/ and ignores the workspace root', () => {
    const inOutputs = write('outputs/考勤表.xlsx', 'a', 3000)
    write('outputs/nested/deck.pptx', 'b', 2000)
    const atRoot = write('index.html', 'c', 4000)

    const result = listArtifacts(workspace)

    expect(namesOf(result)).toEqual(['考勤表.xlsx', 'deck.pptx'])
    expect(result[0].path).toBe(inOutputs)
    expect(result.some(a => a.path === atRoot)).toBe(false)
  })

  it('reads ext and size from the file itself, newest first', () => {
    write('outputs/report.PDF', 'abcde', 1000)
    write('outputs/考勤表.xlsx', 'x', 5000)

    const result = listArtifacts(workspace)

    expect(namesOf(result)).toEqual(['考勤表.xlsx', 'report.PDF'])
    expect(result[1].ext).toBe('pdf')
    expect(result[1].size).toBe(5)
    expect(result[1].mtime).toBe(1000 * 1000)
  })

  it('collects every file type under outputs/ — the folder itself is the promise', () => {
    write('outputs/notes.md', 'a', 3000)
    write('outputs/build.py', 'b', 3000)

    expect(namesOf(listArtifacts(workspace)).sort()).toEqual(['build.py', 'notes.md'])
  })

  it('returns nothing for a missing or invalid working directory', () => {
    expect(listArtifacts(join(workspace, 'does-not-exist'))).toEqual([])
    expect(listArtifacts('')).toEqual([])
    expect(listArtifacts(undefined as unknown as string)).toEqual([])
  })
})

describe('listArtifacts（scanWorkspaceRoot：design 工作区）', () => {
  it('includes workspace-root deliverables alongside outputs/', () => {
    write('outputs/考勤表.xlsx', 'a', 3000)
    write('attendance.xlsx', 'b', 4000)

    const result = listArtifacts(workspace, { scanWorkspaceRoot: true })

    expect(namesOf(result)).toEqual(['attendance.xlsx', '考勤表.xlsx'])
  })

  it('lists each outputs/ file once even though the root scan passes it again', () => {
    write('outputs/考勤表.xlsx', 'a', 3000)

    const result = listArtifacts(workspace, { scanWorkspaceRoot: true })

    expect(namesOf(result)).toEqual(['考勤表.xlsx'])
  })

  it('reaches nested workspace deliverables but stops at the depth limit', () => {
    write('pages/landing.html', 'a', 3000)
    write('assets/img/chart.png', 'b', 3000)
    write('output/2026/考勤表.xlsx', 'c', 3000)
    write('a/b/c/d/deeper.html', 'd', 3000)

    const result = listArtifacts(workspace, { scanWorkspaceRoot: true })

    expect(namesOf(result).sort()).toEqual(['chart.png', 'landing.html', '考勤表.xlsx'])
  })

  it('ignores workspace files that are not deliverables', () => {
    write('考勤表.xlsx', 'a', 3000)
    write('README.md', 'b', 3000)
    write('main.ts', 'c', 3000)
    write('data.json', 'd', 3000)

    const result = listArtifacts(workspace, { scanWorkspaceRoot: true })

    expect(namesOf(result)).toEqual(['考勤表.xlsx'])
  })

  it('excludes hidden entries, process directories and build metadata', () => {
    write('考勤表.xlsx', 'a', 3000)
    write('.claude/skills/x/SKILL.md', 'b', 3000)
    write('node_modules/left-pad/index.js', 'c', 3000)
    write('dist/app.js', 'd', 3000)
    write('package.json', '{"name":"x"}', 3000)

    const result = listArtifacts(workspace, { scanWorkspaceRoot: true })

    expect(namesOf(result)).toEqual(['考勤表.xlsx'])
  })
})
