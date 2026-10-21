import { describe, it, expect } from 'vitest'
import type { Message, ToolCall } from '@/types'
import {
  collectSessionFileChanges,
  extractToolFilePaths,
  filesOfTurn,
  lastChangeTurn,
  sessionFilesSignature,
} from '@/lib/sessionFileChanges'

const ROOT = 'D:/doc/AI/SpaceCode'

function toolCall(name: string, input: Record<string, any>, overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: `${name}-${Math.random().toString(36).slice(2)}`, name, input, status: 'completed', ...overrides }
}

function assistant(toolCalls: ToolCall[]): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls,
  } as unknown as Message
}

function user(content: string): Message {
  return { id: `u-${Math.random().toString(36).slice(2)}`, role: 'user', content, timestamp: Date.now() } as unknown as Message
}

describe('collectSessionFileChanges', () => {
  it('把仓库内的绝对路径归一成相对正斜杠路径并记录轮次', () => {
    const files = collectSessionFileChanges(
      [user('改一下'), assistant([toolCall('Edit', { file_path: `${ROOT}/src/app.ts` })])],
      { projectRoot: ROOT },
    )

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('src/app.ts')
    expect(files[0].turns).toEqual([1])
    expect(files[0].tools).toEqual(['Edit'])
  })

  it('同一文件被多轮多次编辑时合并成一条，工具与轮次累积', () => {
    const files = collectSessionFileChanges([
      assistant([toolCall('Write', { file_path: `${ROOT}/a.ts` })]),
      user('继续'),
      assistant([toolCall('Edit', { file_path: `${ROOT}/a.ts` })]),
      assistant([toolCall('Edit', { file_path: `${ROOT}/a.ts` })]),
    ], { projectRoot: ROOT })

    expect(files).toHaveLength(1)
    expect(files[0].tools).toEqual(['Write', 'Edit', 'Edit'])
    // user 消息不占轮次号：三轮 assistant → 1 / 2 / 3
    expect(files[0].turns).toEqual([1, 2, 3])
  })

  it('会话工作目录在子目录时，相对 file_path 按工作目录补全', () => {
    const files = collectSessionFileChanges(
      [assistant([toolCall('Write', { file_path: 'nested/index.html' })])],
      { projectRoot: ROOT, workingDirectory: `${ROOT}/docs` },
    )

    expect(files[0].path).toBe('docs/nested/index.html')
  })

  it('Windows 反斜杠与盘符大小写不一致仍能正确剥出相对路径', () => {
    const files = collectSessionFileChanges(
      [assistant([toolCall('Edit', { file_path: 'd:\\doc\\AI\\SpaceCode\\src\\stores\\app.ts' })])],
      { projectRoot: 'D:\\doc\\AI\\SpaceCode' },
    )

    expect(files[0].path).toBe('src/stores/app.ts')
  })

  it('仓库外的文件保留绝对路径并标为不在仓库内', () => {
    const files = collectSessionFileChanges(
      [assistant([toolCall('Write', { file_path: 'D:/other/project/notes.md' })])],
      { projectRoot: ROOT },
    )

    expect(files[0].path).toBe('D:/other/project/notes.md')
    expect(files[0].inRepo).toBe(false)
  })

  it('仓库内的文件标为 inRepo，供展示层区分"读不到 git 数字"与"改动已提交"', () => {
    const files = collectSessionFileChanges(
      [assistant([toolCall('Edit', { file_path: `${ROOT}/src/a.ts` })])],
      { projectRoot: ROOT },
    )

    expect(files[0].inRepo).toBe(true)
  })

  it('NotebookEdit 与批量形态 edits[]/files[] 里的路径都被收进来', () => {
    const files = collectSessionFileChanges([
      assistant([toolCall('NotebookEdit', { notebook_path: `${ROOT}/nb.ipynb` })]),
      assistant([toolCall('MultiEdit', { file_path: `${ROOT}/m.ts`, edits: [{ old_string: 'a', new_string: 'b' }] })]),
      assistant([toolCall('FileWrite', { files: [{ file_path: `${ROOT}/b1.ts` }, { file_path: `${ROOT}/b2.ts` }] })]),
    ], { projectRoot: ROOT })

    expect(files.map(f => f.path).sort()).toEqual(['b1.ts', 'b2.ts', 'm.ts', 'nb.ipynb'])
  })

  it('忽略非写文件工具与还没拿到路径的调用', () => {
    const files = collectSessionFileChanges([
      assistant([
        toolCall('Read', { file_path: `${ROOT}/read-only.ts` }),
        toolCall('Bash', { command: 'npm run build' }),
        toolCall('Edit', {}, { status: 'pending' }),
      ]),
    ], { projectRoot: ROOT })

    expect(files).toHaveLength(0)
  })

  it('报错的写调用仍然计入 —— 是否真的落盘由 git 实况裁决', () => {
    const files = collectSessionFileChanges(
      [assistant([toolCall('Edit', { file_path: `${ROOT}/failed.ts` }, { status: 'error' })])],
      { projectRoot: ROOT },
    )

    expect(files.map(f => f.path)).toEqual(['failed.ts'])
  })

  it('没有 projectRoot 时不猜测相对路径的归属', () => {
    const files = collectSessionFileChanges(
      [assistant([toolCall('Edit', { file_path: 'relative.ts' })])],
      {},
    )

    expect(files).toHaveLength(0)
  })
})

describe('turn helpers', () => {
  const files = collectSessionFileChanges([
    assistant([toolCall('Edit', { file_path: `${ROOT}/first.ts` })]),
    user('再来'),
    assistant([toolCall('Write', { file_path: `${ROOT}/second.ts` })]),
  ], { projectRoot: ROOT })

  it('lastChangeTurn 给出最近一次改动所在轮次', () => {
    expect(lastChangeTurn(files)).toBe(2)
    expect(lastChangeTurn([])).toBe(0)
  })

  it('filesOfTurn 按轮次切分', () => {
    expect(filesOfTurn(files, 2).map(f => f.path)).toEqual(['second.ts'])
    expect(filesOfTurn(files, 1).map(f => f.path)).toEqual(['first.ts'])
  })
})

describe('sessionFilesSignature', () => {
  it('写调用数不变、路径从半截补全为完整时签名必须变化', () => {
    const tc = toolCall('Write', { path: `${ROOT}/src/composables/__` })
    const messages = [assistant([tc])]
    const partial = sessionFilesSignature(messages)

    tc.input = { ...tc.input, path: `${ROOT}/src/composables/__tests__/useContentEditor.test.ts` }

    expect(sessionFilesSignature(messages)).not.toBe(partial)
  })

  it('commandFiles 异步回填时签名必须变化', () => {
    const msg = assistant([])
    const before = sessionFilesSignature([msg])

    msg.metadata = { commandFiles: [{ path: 'dist/report.xlsx', at: 1 }] }

    expect(sessionFilesSignature([msg])).not.toBe(before)
  })

  it('content 的流式增量不改变签名', () => {
    const tc = toolCall('Write', { path: `${ROOT}/src/a.ts`, content: 'a' })
    const messages = [assistant([tc])]
    const before = sessionFilesSignature(messages)

    tc.input = { ...tc.input, content: 'a'.repeat(1000) }

    expect(sessionFilesSignature(messages)).toBe(before)
  })

  it('非写工具、Bash 与 pending 写调用不进入签名', () => {
    expect(sessionFilesSignature([
      assistant([
        toolCall('Read', { file_path: `${ROOT}/x.ts` }),
        toolCall('Bash', { command: 'ls' }),
        toolCall('Edit', { file_path: `${ROOT}/y.ts` }, { status: 'pending' }),
      ]),
    ])).toBe('')
  })
})

describe('extractToolFilePaths', () => {
  it('同一调用里 file_path 与 path 同时出现时去重', () => {
    expect(extractToolFilePaths({ file_path: 'a.ts', path: 'a.ts' })).toEqual(['a.ts'])
    expect(extractToolFilePaths({ file_path: 'a.ts', edits: [{ file_path: 'b.ts' }] })).toEqual(['a.ts', 'b.ts'])
    expect(extractToolFilePaths(undefined)).toEqual([])
    expect(extractToolFilePaths({ file_path: '   ' })).toEqual([])
    expect(extractToolFilePaths({ edits: 'not-an-array' })).toEqual([])
  })
})
