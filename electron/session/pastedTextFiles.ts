/**
 * 长文本粘贴的落盘件。
 *
 * 粘贴进来的十几 KB 原文如果留在正文里，会撑爆输入框、消息气泡与会话存储，
 * 引擎侧也不好在正文里定位。这里把原文写进临时目录，正文只保留 @"路径" 引用。
 *
 * 刻意不并入 sweepStaleTempArtifacts 的清扫范围：这些文件被历史消息引用，
 * 按 24h TTL 删掉后旧会话里的"粘贴的文本"就打不开了，交给操作系统回收。
 */
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { sessionTempDir } from './tempArtifacts'

export const PASTED_TEXT_DIR_NAME = 'pasted'

export function pastedTextDir(rootDir: string = sessionTempDir()): string {
  return path.join(rootDir, PASTED_TEXT_DIR_NAME)
}

export function savePastedText(text: string, rootDir: string = sessionTempDir()): string {
  const dir = pastedTextDir(rootDir)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const filePath = path.join(dir, `pasted-${randomUUID()}.txt`)
  fs.writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 })
  return filePath
}
