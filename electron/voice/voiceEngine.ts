/**
 * 语音推理引擎的接缝 —— 会话服务只依赖这个窄接口。
 *
 * 生产实现是 worker_threads + sherpa-onnx-node；测试注入假引擎按脚本
 * 发 partial / final，不加载任何原生模块。引擎一次只服务一个会话。
 */
export interface VoiceEngineHandlers {
  /** 当前流的最新累计文本（已提交分段 + 正在解码的一段）。 */
  onPartial(text: string): void
  /** 加载失败、worker 异常退出或推理抛错；会话服务据此把会话转 failed。 */
  onFailure(error: Error): void
}

export interface VoiceEngine {
  /** 懒启动 worker 并加载模型；已加载时立即 resolve。 */
  start(modelDir: string): Promise<void>
  /** 按调用顺序把 16kHz PCM16 块交给识别器。 */
  sendAudio(samples: Int16Array): void
  /** 喂完已收到的音频并收口，resolve 终稿。 */
  stop(): Promise<string>
  /** 丢弃当前会话，保留 worker 与已加载的模型。 */
  cancel(): void
  /** 终止 worker；之后的 start 必须创建新实例。 */
  dispose(): void
}

export interface VoiceEngineFactory {
  create(handlers: VoiceEngineHandlers): VoiceEngine
}
