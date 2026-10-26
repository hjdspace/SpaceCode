# 语音输入走本地 sherpa-onnx，主进程 worker 推理

## Status

Accepted（2026-10-25）。术语见根目录 `CONTEXT.md` 的 Voice Input 一节。

## Context

桌面端需要把语音实时转成文字写进聊天输入框。约束是中英混说、纯本地离线、Windows x64，并且输入框是 contenteditable（`src/components/chat/ChatInput.vue`），已带 chip 插入、斜杠命令、撤销栈与中文输入法状态。

相关事实：

- `engine/` 的 CLI 已有云端 STT（Anthropic `voice_stream`、豆包），但它只在 TUI 内运行，renderer 没有音频入口。
- `sherpa-onnx` 是 Apache-2.0 的本地 ASR 工具包；`sherpa-onnx-node` 是基于 node-addon-api（N-API）的预编译 Node 插件，Windows x64 包内自带 `onnxruntime.dll` 与 `sherpa-onnx*.dll`。
- 候选模型中，X-ASR 480ms 中英双语流式 zipformer（Apache-2.0，2026-06）自带标点，int8 压缩包约 127MB；2023 双语大模型 int8 约 189MB 且无标点；中文 14M 模型无法处理英文代码词。

## Decision

1. v1 只做本地识别，不接云端 STT，也不覆盖 H5/移动端。
2. 渲染层只负责采音：`getUserMedia` + AudioWorklet，输出 16kHz 单声道 PCM16；渲染层不加载 WASM 或原生插件。
3. 主进程用 `worker_threads` 加载 `sherpa-onnx-node@2.0.0`，PCM 经 MessagePort 进入 worker，partial/final 经 IPC 回渲染层；模型加载与解码不占用主进程事件循环。
4. 录音会话绑定一个 ChatInput 与其 chat session。录音期间锁定 contenteditable，ASR 独占写入；取消时恢复快照；停止时提交终稿，不自动发送。切换会话或输入框卸载立即取消并丢弃。
5. 入口是输入框麦克风按钮加全局 `Alt+V` 切换；写入最后聚焦的 ChatInput，窗口隐藏时先显示并聚焦；所有 ChatInput 生效。
6. 模型固定为 X-ASR 480ms 标点版 int8。首次使用下载，源顺序为 GitHub → 现有 GitHub 镜像前缀（gh-proxy / ghproxy）→ 用户自定义完整 URL，落盘前做 SHA256 校验；不内置进安装包。发布资产为 `sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2`（133,895,136 字节，SHA256 `fa5f63d618e5a01526e275a358bb7772e403f84808a4769fba52cffd8160bf74`），解包后只需 `encoder.int8.onnx` / `decoder.onnx` / `joiner.int8.onnx` / `tokens.txt`，合计约 169MB。下载写 `.part` 临时文件并支持 Range 断点续传、进度上报、取消与重试；校验通过后原子就位。
7. 原生插件与 DLL 必须 `asarUnpack`；模型存放于 `userData`。
8. 解包使用系统 `tar`（Windows 10+ 自带 bsdtar，支持 bzip2），不引入额外解压依赖；解包后按文件大小核对，再写入清单。

## Consequences

- 安装包体积不增加，但首次使用需联网下载约 127MB 压缩包，解包后模型约 169MB。
- 下载中断会留下 `.part` 文件，最多额外占用一个压缩包的空间；取消下载或移除模型时一并清理。
- `sherpa-onnx-node@2.0.0` 发布仅两天，Electron 43 加载、流式解码、打包后 DLL 加载均已在冒烟中验证通过（见 Verification）。若后续 2.0.0 的补丁版本出现回归，可回退 1.13.8（ASR API 兼容）。
- 录音时输入框只读是刻意取舍；在 IME、撤销栈、光标位置没有可靠方案前，不应改成并发编辑。
- 热词、麦克风设备选择、常开监听、自动发送均为 v1 明确范围外。
- 音频不落盘、转写不写日志、不上报遥测。
- 模型下载失败或校验不通过时，语音入口保留但不可录音，并给出可重试的错误态。
- `worker_threads` 隔离的是事件循环，不是崩溃：模型与插件不匹配时原生 `abort()` 会带走整个 Electron 进程（实测 exit 127）。因此 SHA256 校验与固定的模型变体是安全边界，不是可选优化；worker 的 `error`/`exit` 处理只能覆盖可捕获的异常。

## Verification

2026-10-25 在本机 Windows x64、Electron 43.6.0、Node 24.19、`sherpa-onnx-node` 2.0.0（ORT 1.28.2、N-API 10）上完成的冒烟：

| 场景 | 加载耗时 | 首个 partial | RTF | 单块解码峰值 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| Node 主线程，480ms 标点 int8，10.1s 音频 | 3.2s | 88ms | 0.059 | 31ms | 中英混说带标点，正确 |
| Electron 主线程，同模型同音频 | 3.5s | 90ms | 0.059 | 36ms | 同上 |
| Electron `worker_threads`，同模型同音频 | 3.6s | 88ms | 0.057 | — | 同上，`isMainThread=false` |
| asar 打包（`asarUnpack` 原生包），同模型 | 3.9s | — | 0.060 | — | DLL 从 `app.asar.unpacked` 正常加载 |

补充观测：

- 其余三条示例音频（5.1s / 4.7s / 8.8s）RTF 稳定在 0.060–0.061，首个 partial 59–90ms。
- 解码 10s 音频期间进程 RSS：Electron 主线程 351MB，worker 387MB；Node 279MB。
- `sherpa.readWave()` 返回由外部缓冲区支撑的 `Float32Array`，Electron 的 N-API 校验会拒绝它；冒烟改为自写 PCM16 WAV 解析。生产路径的 PCM 来自渲染层，不受影响，但任何在主进程侧读文件的功能都不能复用 `readWave`。
- 同族但非 streaming 导出的 X-ASR 模型（例如 HF 上 2026-06-03 的仓库）元数据为 `comment=non-streaming zipformer2`，构造 `OnlineRecognizer` 即触发原生 abort。发布资产 `2026-06-05` 的元数据为 `comment=streaming zipformer2`、`encoder_dims=192,256,512,768,512,256`。这印证了必须按资产名与哈希锁定模型，而不是按模型族名抓取。

## Alternatives considered

- **渲染层 WASM**：无原生依赖，但当前 CSP 不允许 `wasm-unsafe-eval`，且 WASM 版单线程，模型加载会占用渲染内存。
- **复用 engine 的云端 STT**：上线最快，但违背离线要求，还要把引擎内部能力暴露到 renderer。
- **流式预览 + SenseVoice 终稿**：终稿质量更好，但两套模型、约 350MB 下载，且用户会看到整段文字被重写。
- **2023 双语大模型**：更成熟，但体积更大、无模型内标点、CPU 开销更高。
- **主进程直接推理**：少一层消息通道，但模型加载与解码会阻塞 IPC。
- **全局按住说话**：Electron `globalShortcut` 只能收到 keydown，按住式需要额外的全局键盘钩子依赖。
