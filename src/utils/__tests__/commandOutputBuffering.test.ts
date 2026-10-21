import { describe, expect, it } from 'vitest'
import { hasBufferingOutputPipe } from '@/utils/commandOutputBuffering'

describe('hasBufferingOutputPipe', () => {
  it('识别 tail/head 管道', () => {
    expect(hasBufferingOutputPipe('npm run test:coverage 2>&1 | tail -60')).toBe(true)
    expect(hasBufferingOutputPipe('npm test |tail')).toBe(true)
    expect(hasBufferingOutputPipe('cat app.log | head -n 20')).toBe(true)
  })

  it('识别文件重定向', () => {
    expect(hasBufferingOutputPipe('npm test > /tmp/full.log')).toBe(true)
    expect(hasBufferingOutputPipe('npm test >> build.log')).toBe(true)
    expect(hasBufferingOutputPipe('npm test &> build.log')).toBe(true)
  })

  it('不把 stderr 重定向当成输出缓冲', () => {
    expect(hasBufferingOutputPipe('npm test 2>&1')).toBe(false)
    expect(hasBufferingOutputPipe('npm test 2>/dev/null')).toBe(false)
    expect(hasBufferingOutputPipe('npm test >&2')).toBe(false)
  })

  it('普通命令与 tee 管道保持实时', () => {
    expect(hasBufferingOutputPipe('npm run dev')).toBe(false)
    expect(hasBufferingOutputPipe('npm test | tee test.log')).toBe(false)
    expect(hasBufferingOutputPipe('')).toBe(false)
    expect(hasBufferingOutputPipe(undefined)).toBe(false)
  })
})
