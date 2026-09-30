/**
 * 把聊天附件的 data URL 转成引擎 user 轮的 Anthropic image content block。
 *
 * 图片必须内联在 **user 轮**，不能只给文件路径让模型自己 Read：
 * 引擎的 OpenAI 兼容转换 (packages/@ant/model-provider/src/shared/
 * openaiConvertMessages.ts 的 convertToolResult) 把 tool_result 压成纯字符串，
 * 其中 image block 因为没有 `text` 字段被整块丢弃。也就是说走 `@"路径"` →
 * Read 工具这条链时，非 Anthropic 网关的模型根本拿不到像素，只会拿着上下文里
 * 残留的旧图作答（识图答非所图的成因）。user 轮的 image block 则会被正常转成
 * `image_url`。
 *
 * 只接受 Anthropic 认可的四种 media_type（含 jpeg 别名）。BMP/SVG/HEIC 等内联会
 * 被 API 直接拒掉，返回 null 让调用方退回文件路径引用。尺寸不用在这里操心 ——
 * 引擎的 maybeResizeAndDownsampleImageBlock 会自行降采样到 5MB base64 上限内。
 */

/** Anthropic API 接受的 base64 图片来源类型，同时做别名归一 */
const INLINABLE_MEDIA_TYPES: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
}

export interface InlineImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

/** `data:<mime>[;param]*;base64,<payload>` */
const DATA_URL_RE = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/

/**
 * 附件可内联时返回 image block，否则返回 null（由调用方决定回退策略）。
 *
 * @param img 渲染端传来的附件，`data` 为完整 data URL
 */
export function toInlineImageBlock(img: { data?: unknown }): InlineImageBlock | null {
  if (typeof img.data !== 'string') return null

  const matches = img.data.match(DATA_URL_RE)
  if (!matches) return null

  const mediaType = INLINABLE_MEDIA_TYPES[matches[1].toLowerCase()]
  const base64Data = matches[2].trim()
  if (!mediaType || !base64Data) return null

  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: base64Data },
  }
}
