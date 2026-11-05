/**
 * 斜杠命令宿主裁剪（T04 #74）：excludeSlashCommands 只隐藏动作、不裁剪组件能力 ——
 * Super Agent Router 宿主用它隐藏依赖主聊天 UI（回退/差异/上下文弹窗）的命令。
 */
import { describe, expect, it } from 'vitest'
import { excludeSlashCommands } from '../useSlashCommands'
import { BUILT_IN_COMMANDS } from '@/lib/constants/commands'

describe('excludeSlashCommands', () => {
  it('按名称过滤，别名随命令一起隐藏', () => {
    const result = excludeSlashCommands(BUILT_IN_COMMANDS, ['rewind'])

    expect(result.some(cmd => cmd.name === 'rewind')).toBe(false)
    // checkpoint 是 rewind 的别名，同一条命令必须一起消失
    expect(result.some(cmd => cmd.aliases?.includes('checkpoint'))).toBe(false)
    expect(result.some(cmd => cmd.name === 'help')).toBe(true)
  })

  it('用别名过滤时同样命中主命令', () => {
    const result = excludeSlashCommands(BUILT_IN_COMMANDS, ['checkpoint'])

    expect(result.some(cmd => cmd.name === 'rewind')).toBe(false)
  })

  it('空排除列表返回原样，不防御性复制（纯过滤无 mutation）', () => {
    const result = excludeSlashCommands(BUILT_IN_COMMANDS, [])

    expect(result).toBe(BUILT_IN_COMMANDS)
  })
})
