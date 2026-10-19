import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFileWriteLedgerStore } from '@/stores/fileWriteLedger'

const ROOT = 'D:/repo'

describe('fileWriteLedger store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('只登记写文件工具', () => {
    const ledger = useFileWriteLedgerStore()

    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Read', input: { file_path: `${ROOT}/a.ts` } })
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Bash', input: { file_path: `${ROOT}/a.ts` } })
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Write', input: { path: `${ROOT}/a.ts` } })

    expect(ledger.lastWriter(ROOT, 'a.ts')?.sessionId).toBe('s1')
  })

  it('仓库内路径归一成相对键，仓库外保留归一后的绝对路径', () => {
    const ledger = useFileWriteLedgerStore()

    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: { file_path: `${ROOT}/src/a.ts` } })
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: { file_path: 'D:\\elsewhere\\b.md' } })

    expect(ledger.lastWriter(ROOT, 'src/a.ts')?.tool).toBe('Edit')
    // 键口径与 collect 一致：反斜杠统一成正斜杠，仓库外不剥前缀
    expect(ledger.lastWriter(ROOT, 'D:/elsewhere/b.md')?.tool).toBe('Edit')
    expect(ledger.lastWriter(ROOT, 'b.md')).toBeNull()
  })

  it('相对 file_path 按会话工作目录补全后再入库', () => {
    const ledger = useFileWriteLedgerStore()

    ledger.recordToolWrite({
      projectRoot: ROOT,
      sessionId: 's1',
      toolName: 'Write',
      input: { file_path: 'nested/c.ts' },
      workingDirectory: `${ROOT}/packages/app`,
    })

    expect(ledger.lastWriter(ROOT, 'packages/app/nested/c.ts')?.sessionId).toBe('s1')
  })

  it('后写者覆盖前写者，迟到的旧结果不覆盖新记录', () => {
    const ledger = useFileWriteLedgerStore()

    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: { file_path: `${ROOT}/a.ts` } }, 1000)
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's2', toolName: 'Edit', input: { file_path: `${ROOT}/a.ts` } }, 2000)
    expect(ledger.lastWriter(ROOT, 'a.ts')?.sessionId).toBe('s2')

    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: { file_path: `${ROOT}/a.ts` } }, 1500)
    expect(ledger.lastWriter(ROOT, 'a.ts')?.sessionId).toBe('s2')
  })

  it('按项目根隔离，切换仓库不会串档', () => {
    const ledger = useFileWriteLedgerStore()

    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: { file_path: `${ROOT}/a.ts` } })

    expect(ledger.lastWriter(ROOT, 'a.ts')).not.toBeNull()
    expect(ledger.lastWriter('D:/other-repo', 'a.ts')).toBeNull()
    // 同一路径、大小写不同的项目根视为同一个仓库
    expect(ledger.lastWriter('d:\\repo', 'a.ts')).not.toBeNull()
  })

  it('没有项目根或没有路径时不写入也不抛错', () => {
    const ledger = useFileWriteLedgerStore()

    ledger.recordToolWrite({ projectRoot: null, sessionId: 's1', toolName: 'Edit', input: { file_path: `${ROOT}/a.ts` } })
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: {} })
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: undefined })
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: '', toolName: 'Edit', input: { file_path: `${ROOT}/a.ts` } })

    expect(ledger.lastWriter(ROOT, 'a.ts')).toBeNull()
  })
})
