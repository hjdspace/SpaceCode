/**
 * 跨输入框语音目标注册表 —— 决定 Alt+V 落在哪个输入框。
 *
 * 每个已挂载的 ChatInput 注册一个目标；焦点与最近聚焦时间由注册表记录。
 * 选择规则只有一条：在仍挂载且当前可编辑的目标里取最近聚焦的那个。
 * 它不认识 Vue、DOM 或 IPC：启动/停止回调由输入框自己提供。
 */

export interface VoiceInputTarget {
  /** 同一输入框在挂载期间保持不变。 */
  id: string
  /** 输入框当前是否允许开始录音（已发送/优化中/禁用时为 false）。 */
  isEditable(): boolean
  isRecording(): boolean
  /** 与麦克风按钮同一条启动路径（含模型门禁与首次安装）。 */
  start(): void | Promise<void>
  stop(): void | Promise<void>
}

interface RegistryRecord {
  target: VoiceInputTarget
  focused: boolean
  lastFocusedAt: number
}

export class VoiceTargetRegistry {
  private readonly records = new Map<string, RegistryRecord>()
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  get size(): number {
    return this.records.size
  }

  /** 注册一个已挂载的输入框；返回值用于卸载时立即退出候选。 */
  register(target: VoiceInputTarget): () => void {
    this.records.set(target.id, {
      target,
      focused: false,
      lastFocusedAt: 0,
    })
    return () => this.unregister(target.id)
  }

  unregister(id: string): void {
    this.records.delete(id)
  }

  focus(id: string): void {
    const record = this.records.get(id)
    if (!record) return
    for (const other of this.records.values()) other.focused = false
    record.focused = true
    record.lastFocusedAt = this.now()
  }

  blur(id: string): void {
    const record = this.records.get(id)
    if (record) record.focused = false
  }

  focusedId(): string | null {
    for (const [id, record] of this.records) {
      if (record.focused) return id
    }
    return null
  }

  lastFocusedAt(id: string): number {
    return this.records.get(id)?.lastFocusedAt ?? 0
  }

  /** 最近聚焦、仍挂载且可编辑的输入框；没有则返回 null。 */
  select(): VoiceInputTarget | null {
    let selected: RegistryRecord | null = null
    for (const record of this.records.values()) {
      if (!record.target.isEditable()) continue
      if (!selected || record.lastFocusedAt > selected.lastFocusedAt) selected = record
    }
    return selected?.target ?? null
  }

  recording(): VoiceInputTarget | null {
    for (const record of this.records.values()) {
      if (record.target.isRecording()) return record.target
    }
    return null
  }
}

export type VoiceShortcutDispatch =
  | { kind: 'stopped'; id: string }
  | { kind: 'started'; id: string }
  | { kind: 'no-target' }

/**
 * Alt+V 的单一派发点：录音中只停止正在录的那个输入框，
 * 否则只启动最近聚焦的输入框；没有可用目标时什么都不做。
 */
export async function dispatchVoiceShortcut(
  registry: VoiceTargetRegistry,
): Promise<VoiceShortcutDispatch> {
  const recording = registry.recording()
  if (recording) {
    await recording.stop()
    return { kind: 'stopped', id: recording.id }
  }

  const target = registry.select()
  if (!target) return { kind: 'no-target' }

  await target.start()
  return { kind: 'started', id: target.id }
}

/** 渲染进程内共享的注册表；所有 ChatInput 实例都往这里登记。 */
export const voiceTargetRegistry = new VoiceTargetRegistry()
