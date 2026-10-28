/**
 * 项目内 JSON 文件的原子写：临时文件 + rename。
 * 崩溃或并发读取时只会看到旧文件或新文件，不会读到半截内容。
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
    renameSync(tmpPath, path)
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw err
  }
}
