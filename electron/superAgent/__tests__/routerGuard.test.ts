// @vitest-environment node
/**
 * Router noWait 守卫（#95）。
 *
 * Router 的职责是把新候选尽快路由出去，不是等结果：报告与作业输出会作为新输入
 * 自动到达。守卫在主进程侧识别「阻塞式等待」的工具调用，由 routerRunner 在权限
 * 请求处拒绝 —— 这是代码拒绝，不依赖提示词自律。
 *
 * 判定口径对齐原型 `src/app/sessions.ts` 的 `noWait`：
 *  - shell 命令位 sleep；
 *  - shell 自带超时 > 30 秒；
 *  - job_output / TaskOutput 的阻塞等待 > 5 秒。
 */
import { describe, expect, it } from 'vitest'
import { inspectRouterToolCall } from '../routerGuard'

describe('inspectRouterToolCall — shell 等待', () => {
  it.each([
    ['sleep 30', 'sleep 30'],
    ['sleep 1 && npm test', 'sleep 1 && npm test'],
    ['npm run build; sleep 5', 'npm run build; sleep 5'],
    ['npm run build && sleep 5', 'npm run build && sleep 5'],
    ['echo done\nsleep 2', 'sleep 2'],
    ['FOO=1 sleep 60', 'sleep 60'],
    ['sudo sleep 10', 'sleep 10'],
  ])('拒绝命令位 sleep：%s', (command) => {
    const violation = inspectRouterToolCall('Bash', { command })
    expect(violation).toMatchObject({ rule: 'sleep' })
  })

  it('does not reject the word sleep inside an argument or echo text', () => {
    expect(inspectRouterToolCall('Bash', { command: 'echo "sleep 5"' })).toBeNull()
    expect(inspectRouterToolCall('Bash', { command: 'grep -r sleep src' })).toBeNull()
  })

  it('rejects a shell call whose own timeout is longer than 30 seconds', () => {
    expect(inspectRouterToolCall('Bash', { command: 'npm test', timeout: 60_000 })).toMatchObject({
      rule: 'shellTimeout',
    })
    expect(inspectRouterToolCall('Bash', { command: 'npm test', timeout: 30_000 })).toBeNull()
    expect(inspectRouterToolCall('Bash', { command: 'npm test' })).toBeNull()
  })

  it('recognises PowerShell and its sleep cmdlet', () => {
    expect(inspectRouterToolCall('PowerShell', { command: 'Start-Sleep -Seconds 10' })).toMatchObject({
      rule: 'sleep',
    })
    expect(inspectRouterToolCall('powershell', { command: 'Get-ChildItem' })).toBeNull()
  })
})

describe('inspectRouterToolCall — 作业等待', () => {
  it('rejects a TaskOutput call that blocks longer than 5 seconds', () => {
    // 默认 timeout=30000ms 且 block=true：不写参数就是一次 30 秒的阻塞等待。
    expect(inspectRouterToolCall('TaskOutput', { task_id: 't1' })).toMatchObject({ rule: 'jobWait' })
    expect(inspectRouterToolCall('TaskOutput', { task_id: 't1', timeout: 10_000 })).toMatchObject({
      rule: 'jobWait',
    })
    expect(inspectRouterToolCall('TaskOutput', { task_id: 't1', timeout: 4_000 })).toBeNull()
    expect(inspectRouterToolCall('TaskOutput', { task_id: 't1', block: false, timeout: 60_000 })).toBeNull()
  })

  it('covers the pi job_output shape as well', () => {
    expect(inspectRouterToolCall('job_output', { job_id: 'j1', timeout: 8_000 })).toMatchObject({
      rule: 'jobWait',
    })
    expect(inspectRouterToolCall('job_output', { job_id: 'j1', block: false })).toBeNull()
  })
})

describe('inspectRouterToolCall — 无关工具', () => {
  it('leaves read-only and unknown tools alone', () => {
    expect(inspectRouterToolCall('Read', { file_path: '/repo/a.ts' })).toBeNull()
    expect(inspectRouterToolCall('Grep', { pattern: 'sleep' })).toBeNull()
    expect(inspectRouterToolCall('mcp__browser-use__browse', { url: 'https://example.com' })).toBeNull()
  })
})
