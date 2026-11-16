/**
 * 生图配置的归一化与读取。
 *
 * 归一化是纯函数，读取才碰文件系统 —— 这条缝让调用方测试不需要真实 home 目录。
 * 配置存在 gui-settings.json（与对话模型同一个文件），但独立于 Profile：
 * 生图账号与对话账号是两套，跟着 Profile 切换会迫使重复填写。
 *
 * 类型与预置表在 @/shared/imageGenReference —— 设置页也要用，不能经这里把 fs 拖进渲染层。
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { IMAGEGEN_PRESETS } from '@/shared/imageGenReference'
import type { ImageGenConfig, ImageGenDialect, ImageGenPresetId } from '@/shared/imageGenReference'

const PRESET_IDS: ImageGenPresetId[] = ['openai', 'zhipu', 'ark', 'custom']
const DIALECTS: ImageGenDialect[] = ['openai', 'seedream', 'zhipu']

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 配置不完整回 null —— 调用方据此回「请去设置里配置」，而不是拿半个配置去发请求。 */
export function normalizeImageGenConfig(raw: unknown): ImageGenConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>

  const presetId = PRESET_IDS.includes(input.presetId as ImageGenPresetId)
    ? (input.presetId as ImageGenPresetId)
    : 'custom'
  const preset = presetId === 'custom' ? null : IMAGEGEN_PRESETS[presetId]

  // 预置锁方言：协议由供应商决定，让用户选只会选出错的组合。
  const dialect = preset
    ? preset.dialect
    : DIALECTS.includes(input.dialect as ImageGenDialect)
      ? (input.dialect as ImageGenDialect)
      : null
  if (!dialect) return null

  const baseUrl = (asTrimmedString(input.baseUrl) || preset?.baseUrl || '').replace(/\/+$/, '')
  if (!/^https?:\/\/\S+$/i.test(baseUrl)) return null

  const apiKey = asTrimmedString(input.apiKey)
  if (!apiKey) return null

  const model = asTrimmedString(input.model) || preset?.model || ''
  if (!model) return null

  return {
    presetId,
    dialect,
    baseUrl,
    apiKey,
    model,
    disableWatermark: input.disableWatermark === true,
  }
}

export function loadImageGenConfig(homeDir: string = homedir()): ImageGenConfig | null {
  const path = join(homeDir, '.claude', 'gui-settings.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    return normalizeImageGenConfig(parsed.imageGenConfig)
  } catch {
    return null
  }
}

/** 只认「文档是对象且带着一个对象形态的 imageGenConfig」，其余一律交给调用方原样处理。 */
function parseImageGenSection(raw: string): { doc: Record<string, unknown>; section: Record<string, unknown> } | null {
  try {
    const doc: unknown = JSON.parse(raw)
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    const section = (doc as Record<string, unknown>).imageGenConfig
    if (!section || typeof section !== 'object' || Array.isArray(section)) return null
    return { doc: doc as Record<string, unknown>, section: section as Record<string, unknown> }
  } catch {
    return null
  }
}

/**
 * 回读边界：把整份 gui-settings 文档里的生图 key 换成「是否已配置」。
 *
 * key 是只写字段 —— 渲染层能填入并保存，但读回来永远只有布尔标记。
 * 主进程自己读配置走 loadImageGenConfig，不经这里，所以执行面仍拿得到明文。
 */
export function redactImageGenApiKey(settingsJson: string): string {
  const parsed = parseImageGenSection(settingsJson)
  if (!parsed) return settingsJson
  const hasApiKey = asTrimmedString(parsed.section.apiKey).length > 0
  parsed.section.apiKey = ''
  parsed.section.hasApiKey = hasApiKey
  return JSON.stringify(parsed.doc, null, 2)
}

/**
 * 保存边界：留空的 key 沿用磁盘上那份。
 *
 * 渲染层手里没有明文 key，所以它每次保存（包括改字号这种无关改动）交上来的都是空 key。
 * 不在这里合并的话，任何一次无关保存都会把生图 key 抹掉。
 */
export function mergeImageGenApiKey(settingsJson: string, persistedJson: string | null): string {
  const parsed = parseImageGenSection(settingsJson)
  if (!parsed) return settingsJson
  const persistedKey = persistedJson ? asTrimmedString(parseImageGenSection(persistedJson)?.section.apiKey) : ''
  const apiKey = asTrimmedString(parsed.section.apiKey) || persistedKey
  parsed.section.apiKey = apiKey
  parsed.section.hasApiKey = apiKey.length > 0
  return JSON.stringify(parsed.doc, null, 2)
}