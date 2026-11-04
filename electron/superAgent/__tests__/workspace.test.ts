// @vitest-environment node
/**
 * 共享目录脏区探针（T05 #75）：launch 前的 git status 检查。
 * 覆盖：干净/脏区解析、HEAD 提取、git 不可用时的降级、条目数裁剪。
 */
import { describe, expect, it } from 'vitest'
import { createGitWorkspaceProbe, type GitCommandRunner } from '../workspace'

function runnerOf(stdout: string): GitCommandRunner {
  return async (args, cwd) => {
    expect(args).toEqual(['status', '--porcelain=v1', '-b'])
    expect(cwd).toBe('/repo')
    return stdout
  }
}

describe('createGitWorkspaceProbe', () => {
  it('reports a clean workspace with the branch head', async () => {
    const probe = createGitWorkspaceProbe(runnerOf('## main...origin/main\n'))

    const status = await probe.probe('/repo')
    expect(status.dirty).toBe(false)
    expect(status.head).toBe('main')
    expect(status.entries).toEqual([])
    expect(status.statusText).toBe('')
  })

  it('reports a dirty workspace with the porcelain entries', async () => {
    const probe = createGitWorkspaceProbe(
      runnerOf('## main...origin/main\n M src/a.ts\n?? notes.md\n'),
    )

    const status = await probe.probe('/repo')
    expect(status.dirty).toBe(true)
    expect(status.entries).toEqual([' M src/a.ts', '?? notes.md'])
    expect(status.statusText).toBe(' M src/a.ts\n?? notes.md')
  })

  it('degrades to a stable note when git is unavailable instead of throwing', async () => {
    const probe = createGitWorkspaceProbe(async () => {
      throw new Error('git not found')
    })

    const status = await probe.probe('/repo')
    expect(status.dirty).toBe(false)
    expect(status.head).toBeNull()
    expect(status.entries).toEqual([])
    expect(status.statusText).toContain('不可用')
  })

  it('trims long status lists to the budget with a summary line', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `?? file-${i}.ts`)
    const probe = createGitWorkspaceProbe(runnerOf(`## main\n${lines.join('\n')}\n`))

    const status = await probe.probe('/repo')
    expect(status.entries).toHaveLength(20)
    expect(status.dirty).toBe(true)
    expect(status.statusText.split('\n')).toHaveLength(21)
    expect(status.statusText).toContain('25')
  })
})
