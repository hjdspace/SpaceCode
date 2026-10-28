/**
 * 引擎正文里的「用户消息信封」解析。
 *
 * 发送时 ChatPanel 会把附件信息写进引擎正文，但 UI 气泡只展示用户输入：
 *   1. `@"<绝对路径>"` —— 上传/粘贴文件在引擎侧的引用（引擎据此读文件）；
 *   2. 末尾的 `Attachments: [File: …]` / `Images: [Image: …]` 说明块。
 *
 * 历史会话只能从引擎 JSONL 恢复正文，所以展示前必须先剥掉这些痕迹，
 * 否则重开应用后气泡里会直接出现临时文件路径和 "Attachments: [...]" 字样。
 */

export interface EngineUserPrompt {
  /** 剥掉文件引用与附件说明后的用户可读正文 */
  text: string
  /** 正文引用到的文件路径（按出现顺序去重） */
  fileRefs: string[]
}

/** 文件引用本身可能带空格，一直吃到下一个双引号为止 */
const FILE_REF_RE = /@"([^"\r\n]+)"/g

/**
 * 末尾的附件说明块。Attachments 与 Images 各占一行（中间可能只有一个空行），
 * 逐行从尾部剥离，避免把用户正文里正常出现的 "Attachments:" 也删掉。
 */
const TRAILING_META_RE =
  /(?:\r?\n){0,2}(?:Attachments|Images):\s*(?:\[(?:File|Folder|Image):[^\]\r\n]*\](?:,\s*)?)+\s*$/

export function parseEngineUserPrompt(raw: string): EngineUserPrompt {
  const fileRefs: string[] = []
  let text = raw.replace(FILE_REF_RE, (_match, ref: string) => {
    if (!fileRefs.includes(ref)) fileRefs.push(ref)
    return ''
  })

  while (TRAILING_META_RE.test(text)) {
    text = text.replace(TRAILING_META_RE, '')
  }

  return { text: text.trim(), fileRefs }
}
