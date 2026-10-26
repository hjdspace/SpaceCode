/**
 * 语音识别模型的不可变清单 — 版本、下载源与校验值的唯一真相源。
 *
 * 资产锁定 2026-06-05 的 streaming 导出：同族 non-streaming 包在构造
 * OnlineRecognizer 时会触发原生 abort（见 docs/adr/0014-local-voice-input.md）。
 * 不要按模型族名抓取，也不要在这里接受“更新版本”。
 */
export interface SpeechModelFileSpec {
  name: string
  bytes: number
  sha256: string
}

export interface SpeechModelManifest {
  version: string
  assetName: string
  url: string
  archiveBytes: number
  archiveSha256: string
  files: SpeechModelFileSpec[]
}

export const SPEECH_MODEL_MANIFEST: SpeechModelManifest = {
  version: '2026-06-05',
  assetName:
    'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2',
  url:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2',
  archiveBytes: 133_895_136,
  archiveSha256: 'fa5f63d618e5a01526e275a358bb7772e403f84808a4769fba52cffd8160bf74',
  files: [
    {
      name: 'encoder.int8.onnx',
      bytes: 155_278_641,
      sha256: '908596dcc137a73b95be908ca55e88caa1b3dbbe8027c171615f4b0609c5eb1e',
    },
    {
      name: 'decoder.onnx',
      bytes: 11_309_084,
      sha256: 'a1cbc9eac2d5e3fb6617a218c67ad6daaa7f4e0fd225f08b2c22ab0413c8c257',
    },
    {
      name: 'joiner.int8.onnx',
      bytes: 2_581_422,
      sha256: 'aedb7fa697b2ab43f20499826fff7c997eea7d67db77be97769aeeeb726e63b3',
    },
    {
      name: 'tokens.txt',
      bytes: 58_806,
      sha256: 'b818a60878b9aae978cbb8ad594acbd403d76d1af2e31ef4197c84e2dbdba27c',
    },
  ],
}

export function expectedInstalledBytes(manifest: SpeechModelManifest = SPEECH_MODEL_MANIFEST): number {
  return manifest.files.reduce((sum, file) => sum + file.bytes, 0)
}
