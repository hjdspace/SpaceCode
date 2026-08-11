import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_to_text.dart';

import 'voice_input_service.dart';

/// 基于 speech_to_text 包的语音输入实现
///
/// 适用于 iOS（系统原生 Speech Framework）和支持 Google 服务的 Android 设备。
/// 国内 Android 设备通常不可用，应使用 [WhisperCloudInputService]。
class SpeechToTextInputService implements VoiceInputService {
  final SpeechToText _speech = SpeechToText();
  bool _initialized = false;
  bool _listening = false;

  void Function(VoiceInputError)? _onError;
  void Function(VoiceInputState)? _onStateChange;

  @override
  Future<bool> initialize() async {
    if (_initialized) return true;
    try {
      final available = await _speech.initialize(
        onError: (error) {
          _onError?.call(VoiceInputError(
            code: error.permanent ? 'permanent' : 'transient',
            message: error.errorMsg,
          ));
        },
        onStatus: (status) {
          switch (status) {
            case 'listening':
              _listening = true;
              _onStateChange?.call(VoiceInputState.listening);
              break;
            case 'done':
            case 'notListening':
              _listening = false;
              _onStateChange?.call(VoiceInputState.idle);
              break;
            default:
              break;
          }
        },
        debugLogging: kDebugMode,
        options: [SpeechToText.androidIntentLookup],
      );
      _initialized = available;
      return available;
    } catch (_) {
      _initialized = false;
      return false;
    }
  }

  @override
  Future<bool> startListening({
    required ValueChanged<VoiceInputResult> onResult,
    required ValueChanged<VoiceInputError> onError,
    required ValueChanged<VoiceInputState> onStateChange,
  }) async {
    if (!_initialized) {
      final ok = await initialize();
      if (!ok) return false;
    }

    _onError = onError;
    _onStateChange = onStateChange;

    try {
      await _speech.listen(
        onResult: (result) {
          final text = result.recognizedWords;
          if (text.isEmpty) return;
          onResult(VoiceInputResult(
            text: text,
            isFinal: result.finalResult,
          ));
        },
        listenOptions: SpeechListenOptions(
          partialResults: true,
          // 改为 false：让 UI 层显式处理错误，避免国内设备瞬间 cancel 导致用户看不到反馈
          cancelOnError: false,
          autoPunctuation: true,
          listenFor: const Duration(seconds: 30),
          pauseFor: const Duration(seconds: 3),
          localeId: 'zh_CN',
        ),
      );
      _listening = true;
      onStateChange(VoiceInputState.listening);
      return true;
    } catch (e) {
      onError(VoiceInputError(
        code: 'listenFailed',
        message: e.toString(),
      ));
      return false;
    }
  }

  @override
  Future<void> stop() async {
    if (!_listening) return;
    await _speech.stop();
    _listening = false;
    _onStateChange?.call(VoiceInputState.idle);
  }

  @override
  Future<void> cancel() async {
    await _speech.cancel();
    _listening = false;
    _onStateChange?.call(VoiceInputState.idle);
  }

  @override
  Future<void> dispose() async {
    await _speech.cancel();
    _onError = null;
    _onStateChange = null;
  }
}
