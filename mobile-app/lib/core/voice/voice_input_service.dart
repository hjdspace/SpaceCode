import 'package:flutter/foundation.dart';

/// 语音输入状态
enum VoiceInputState {
  /// 空闲
  idle,

  /// 正在聆听/录音
  listening,

  /// 正在转写（仅云端方案有此状态）
  transcribing,
}

/// 语音输入结果
class VoiceInputResult {
  final String text;
  final bool isFinal;

  const VoiceInputResult({required this.text, this.isFinal = true});
}

/// 语音输入错误
class VoiceInputError {
  final String code;
  final String message;

  const VoiceInputError({required this.code, required this.message});
}

/// 语音输入服务抽象接口
///
/// iOS 由 [SpeechToTextInputService] 实现（系统原生 Speech Framework），
/// Android 由 [WhisperCloudInputService] 实现（录音 + Whisper API）。
abstract class VoiceInputService {
  /// 初始化服务，返回是否可用
  Future<bool> initialize();

  /// 开始聆听/录音
  ///
  /// [onResult] 在有识别结果时回调（partialResults=true 时会多次回调中间结果）
  /// [onError] 在发生错误时回调
  /// [onStateChange] 在状态变化时回调
  Future<bool> startListening({
    required ValueChanged<VoiceInputResult> onResult,
    required ValueChanged<VoiceInputError> onError,
    required ValueChanged<VoiceInputState> onStateChange,
  });

  /// 停止聆听/录音，触发转写（如果是云端方案）
  Future<void> stop();

  /// 取消当前操作，不产生结果
  Future<void> cancel();

  /// 释放资源
  Future<void> dispose();
}
