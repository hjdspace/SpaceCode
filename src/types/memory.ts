/**
 * 项目记忆（memory/ 目录）相关类型。
 *
 * 记忆文件由引擎写入 `<claude 配置目录>/projects/<projectId>/memory/`，
 * 与同一项目的会话 JSONL 共享一个 projectId，因此这里的所有路径
 * 都是相对记忆目录的正斜杠相对路径（如 `notes/manual.md`）。
 */

/** 一个项目记忆目录。 */
export interface MemoryProject {
  /** 项目目录名（即 sanitize 后的项目根路径）。 */
  id: string
  /** 项目根路径；无法还原真实路径时为 projectId 的反推形式。 */
  label: string
  /** 记忆目录绝对路径。 */
  memoryDir: string
  /** 记忆目录是否存在（或至少含一个 Markdown 记忆文件）。 */
  exists: boolean
  /** 记忆目录下的 .md 文件数量（扫描上限 500）。 */
  fileCount: number
  /** 是否为当前工作目录对应的项目。 */
  isCurrent: boolean
}

/** 记忆目录下的一个 Markdown 文件。 */
export interface MemoryFile {
  /** 相对记忆目录的正斜杠路径。 */
  path: string
  /** 文件名（含扩展名）。 */
  name: string
  bytes: number
  /** 修改时间（ISO 字符串）。 */
  updatedAt: string
  /** frontmatter 中的 type，仅 user/feedback/project/reference 有效。 */
  type?: string
  /** frontmatter 中的 description。 */
  description?: string
  /** 列表展示用的标题（索引文件固定为 MEMORY.md，其余去掉 .md）。 */
  title: string
  /** 是否为索引文件 MEMORY.md。 */
  isIndex: boolean
}

/** 记忆文件正文。 */
export interface MemoryFileDetail {
  path: string
  content: string
  updatedAt: string
  bytes: number
}

/** 写入记忆文件的参数。 */
export interface MemorySaveInput {
  projectId: string
  path: string
  content: string
  /**
   * 读取时的版本标记，与 expectedBytes 必须同时提供。
   * 两者都提供时，服务端会在写入前比对磁盘上的 mtime/size，
   * 不一致则拒绝保存（避免覆盖外部改动）。
   */
  expectedUpdatedAt?: string
  expectedBytes?: number
}

/** 写入成功后的新版本标记。 */
export interface MemoryFileRevision {
  path: string
  updatedAt: string
  bytes: number
}
