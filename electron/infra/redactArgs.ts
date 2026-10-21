import { existsSync } from 'fs'

/**
 * argv 脱敏 —— 启动日志会把 spawn 的 argv join 成一行（sessionProcess /
 * PiSessionProcess 的 Starting process 行），凭据与提示词正文不能跟着进日志：
 * 会话日志保留 35 个文件且镜像到 console。logger 既有 redactSensitive 只覆盖
 * 结构化 data 对象，旗标值经 message 模板拼接会绕过它，这里补上 argv 维度。
 *
 * 独立成模块（不挂在 logger 上）是有意的：各测试对 logger 的 mock 逐个枚举
 * 导出键，加导出会连坐一片；本模块零依赖（仅 fs 探测路径存在），引擎直接 import。
 */

/** 值一律打码的旗标：--api-key 是凭据；--system-prompt 的值恒为内联正文 */
const ARG_VALUE_MASKERS: Record<string, (value: string) => string> = {
  '--api-key': maskSecretValue,
  '--system-prompt': maskPromptValue,
  // 同旗标两种形态：pi 的 persona 是刚落盘的文件路径（有排查价值，保留）；
  // Claude 侧是内联正文（打码）。以"磁盘上是否存在"区分。
  '--append-system-prompt': (value) => (isExistingPath(value) ? value : maskPromptValue(value)),
}

function maskSecretValue(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}****${value.slice(-4)}` : '****'
}

function maskPromptValue(value: string): string {
  return `<redacted len=${value.length}>`
}

function isExistingPath(value: string): boolean {
  try {
    return value.length > 0 && !value.includes('\n') && existsSync(value)
  } catch {
    return false
  }
}

/**
 * 返回用于日志输出的 argv 拷贝：敏感旗标的值被打码。
 * 只影响日志呈现，spawn 仍必须使用原始 argv。
 */
export function redactArgsForLog(args: string[]): string[] {
  const out = args.slice()
  for (let i = 0; i < out.length; i++) {
    const token = out[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    const name = eq > 0 ? token.slice(0, eq) : token
    const mask = ARG_VALUE_MASKERS[name]
    if (!mask) continue
    if (eq > 0) {
      out[i] = `${name}=${mask(token.slice(eq + 1))}`
    } else if (i + 1 < out.length && !out[i + 1].startsWith('--')) {
      out[i + 1] = mask(out[i + 1])
    }
  }
  return out
}
