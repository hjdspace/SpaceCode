// extractAutoPreviewTarget：从工具输入解析值得自动预览的交付物路径。
// 覆盖 Write/Edit 的 file_path、Bash 的 officecli 命令、相对路径补全与负例。
import { describe, expect, it } from 'vitest'
import { extractAutoPreviewTarget } from '../eventHandlers'

describe('extractAutoPreviewTarget', () => {
  it('Write 的 file_path 是交付物时返回原路径', () => {
    expect(extractAutoPreviewTarget('Write', { file_path: 'D:\\ws\\报价单.xlsx' })).toBe('D:\\ws\\报价单.xlsx')
  })

  it('Edit 的相对 file_path 按会话工作目录补全并归一化', () => {
    expect(extractAutoPreviewTarget('Edit', { file_path: 'outputs/报告.docx' }, 'D:/doc/AI/ws')).toBe(
      'D:\\doc\\AI\\ws\\outputs\\报告.docx'
    )
  })

  it('Bash 解析 officecli 命令的目标文档（带引号与参数尾巴）', () => {
    expect(
      extractAutoPreviewTarget('Bash', { command: 'officecli create "考勤表.xlsx" --type workbook' }, 'D:\\ws')
    ).toBe('D:\\ws\\考勤表.xlsx')
    expect(
      extractAutoPreviewTarget('Bash', { command: 'officecli.exe add 报表.xlsx /sheet[1]' }, 'D:\\ws')
    ).toBe('D:\\ws\\报表.xlsx')
  })

  it('Bash 非 officecli 命令返回 null', () => {
    expect(extractAutoPreviewTarget('Bash', { command: 'npm run test' }, 'D:\\ws')).toBeNull()
  })

  it('非交付物扩展名返回 null', () => {
    expect(extractAutoPreviewTarget('Write', { file_path: 'D:\\ws\\index.ts' })).toBeNull()
    expect(extractAutoPreviewTarget('Bash', { command: 'officecli create notes.md' }, 'D:\\ws')).toBeNull()
  })

  it('相对路径且无工作目录时返回 null', () => {
    expect(extractAutoPreviewTarget('Write', { file_path: '报表.xlsx' })).toBeNull()
  })

  it('无输入返回 null', () => {
    expect(extractAutoPreviewTarget('Write', undefined)).toBeNull()
    expect(extractAutoPreviewTarget('Bash', {})).toBeNull()
  })
})
