/**
 * 引擎正文里的「用户消息信封」解析。
 *
 * 发送时宿主会把不该给人看的痕迹写进引擎正文，但 UI 气泡只展示用户输入：
 *   1. `@"<绝对路径>"` —— 上传/粘贴文件在引擎侧的引用（引擎据此读文件）；
 *   2. 末尾的 `Attachments: [File: …]` / `Images: [Image: …]` 说明块；
 *   3. Super Agent 的宿主注入段 —— Router 契约与工单事实（见下面的信封）。
 *
 * 历史会话只能从引擎 JSONL 恢复正文，所以展示前必须先剥掉这些痕迹，
 * 否则重开应用后气泡里会直接出现临时文件路径、"Attachments: [...]" 字样，
 * 或者整段 Router 角色说明（它不是人打的字）。
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

/**
 * Super Agent 宿主注入段的成对标记。
 *
 * Router 的角色契约与 `[工单快照]` 必须逐轮追加到人消息尾部：安装版 CLI 的
 * `--resume` 复用历史 prompt 快照，argv 里的 `--append-system-prompt` 与
 * initialize 的新值都进不了 API 请求，system 通道对旧会话无效。那段文字对模型
 * 必要、对人无关，所以加一对标记，让回放侧能整段逆向下掉。
 */
export const SUPER_AGENT_HOST_CONTEXT_OPEN = '<super-agent:host-context>'
export const SUPER_AGENT_HOST_CONTEXT_CLOSE = '</super-agent:host-context>'

const HOST_CONTEXT_RE = new RegExp(
  `${SUPER_AGENT_HOST_CONTEXT_OPEN}[\\s\\S]*?${SUPER_AGENT_HOST_CONTEXT_CLOSE}[\\s]*`,
  'g',
)

/** 包一层信封；内容为空时返回空串，让调用方的拼接自然跳过这一段。 */
export function wrapSuperAgentHostContext(blocks: Array<string | null | undefined>): string {
  const inner = blocks.map((block) => (block ?? '').trim()).filter(Boolean).join('\n\n')
  if (!inner) return ''
  return `${SUPER_AGENT_HOST_CONTEXT_OPEN}\n${inner}\n${SUPER_AGENT_HOST_CONTEXT_CLOSE}`
}

/**
 * 加信封之前写入的转录没有成对标记，只能按宿主注入段的已知行首锚点截断。
 * 锚点必须独占一行且由空行分隔（宿主永远用空行拼接注入段），人在正文里自己
 * 打出同样的词不算。整条消息以锚点开头时全部剥掉 —— 那是宿主中继的事实，
 * 不是人说的话，实时也没有给它推气泡。
 */
const LEGACY_HOST_ANCHORS = [
  '# Super Agent Router',
  '[工单快照]',
  '[人消息索引]',
  '[工单事件]',
  '[宿主协议校正]',
]

/** 供漂移守卫使用：这些字面量的真源在主进程提示词里，改一边就得同时改另一边。 */
export const SUPER_AGENT_LEGACY_HOST_ANCHORS = LEGACY_HOST_ANCHORS

function cutLegacyHostContext(text: string): string {
  let cut = -1
  for (const anchor of LEGACY_HOST_ANCHORS) {
    for (let index = text.indexOf(anchor); index >= 0; index = text.indexOf(anchor, index + 1)) {
      const before = text.slice(0, index)
      const startsAnIsolatedLine = before === '' || /\n[ \t]*\r?\n[ \t]*$/.test(before)
      if (startsAnIsolatedLine && (cut < 0 || index < cut)) cut = index
    }
  }
  return cut < 0 ? text : text.slice(0, cut)
}

export function parseEngineUserPrompt(raw: string): EngineUserPrompt {
  const fileRefs: string[] = []
  let text = raw.replace(FILE_REF_RE, (_match, ref: string) => {
    if (!fileRefs.includes(ref)) fileRefs.push(ref)
    return ''
  })

  text = cutLegacyHostContext(text.replace(HOST_CONTEXT_RE, ''))

  while (TRAILING_META_RE.test(text)) {
    text = text.replace(TRAILING_META_RE, '')
  }

  return { text: text.trim(), fileRefs }
}
