/**
 * 生图配置的共享契约：方言、预置表与配置形状。
 *
 * 放在 shared 而不是 electron/imagegen/：设置页要用这张预置表填表单，
 * 而主进程侧的配置模块顶层 import 了 fs/os —— 渲染层 import 它会把主进程依赖拖进浏览器 bundle。
 */

export type ImageGenDialect = 'openai' | 'seedream' | 'zhipu'

export type ImageGenPresetId = 'openai' | 'zhipu' | 'ark' | 'custom'

export interface ImageGenConfig {
  presetId: ImageGenPresetId
  /** 实际使用的协议方言。预置时锁定，custom 时由用户选。 */
  dialect: ImageGenDialect
  baseUrl: string
  /** 只写字段：渲染层填入并保存，主进程回读时一律清空，是否已配置看 hasApiKey。 */
  apiKey: string
  model: string
  /** 关闭供应商水印。默认 false —— 智谱要求账号先签署免责声明。 */
  disableWatermark: boolean
  /** 回读标记：磁盘上已存有 key。渲染层据此显示「已配置」，不需要明文。 */
  hasApiKey?: boolean
}

/**
 * 预置值只是起点：供应商随时上新版本，模型名一律可编辑。
 *
 * ark 的 presetId 与方言名刻意不同 —— 火山方舟宣传「OpenAI 兼容」，
 * 但图像接口走的是 seedream 方言（改图同端点、逐图错误藏在 HTTP 200 里）。
 */
export const IMAGEGEN_PRESETS: Record<
  Exclude<ImageGenPresetId, 'custom'>,
  { dialect: ImageGenDialect; baseUrl: string; model: string }
> = {
  openai: { dialect: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
  zhipu: { dialect: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4' },
  ark: { dialect: 'seedream', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-4-0-250828' },
}