/**
 * sherpa-onnx-node 的最小类型声明。
 *
 * 上游包只带 JSDoc，没有 .d.ts；这里只声明本项目用到的 online recognizer
 * 表面，避免 `any` 漏进 worker。
 */
declare module 'sherpa-onnx-node' {
  export interface SherpaWaveform {
    samples: Float32Array
    sampleRate: number
  }

  export interface OnlineRecognizerResult {
    text: string
  }

  export interface OnlineStream {
    acceptWaveform(waveform: SherpaWaveform): void
    inputFinished(): void
  }

  export interface OnlineTransducerConfig {
    encoder?: string
    decoder?: string
    joiner?: string
  }

  export interface OnlineModelConfig {
    transducer?: OnlineTransducerConfig
    tokens?: string
    numThreads?: number
    provider?: string
    debug?: boolean | number
    modelType?: string
  }

  export interface FeatureConfig {
    sampleRate?: number
    featureDim?: number
  }

  export interface OnlineRecognizerConfig {
    featConfig?: FeatureConfig
    modelConfig?: OnlineModelConfig
    decodingMethod?: string
    maxActivePaths?: number
    enableEndpoint?: boolean | number
    rule1MinTrailingSilence?: number
    rule2MinTrailingSilence?: number
    rule3MinUtteranceLength?: number
  }

  export class OnlineRecognizer {
    constructor(config: OnlineRecognizerConfig)
    createStream(): OnlineStream
    isReady(stream: OnlineStream): boolean
    decode(stream: OnlineStream): void
    isEndpoint(stream: OnlineStream): boolean
    reset(stream: OnlineStream): void
    getResult(stream: OnlineStream): OnlineRecognizerResult
  }
}
