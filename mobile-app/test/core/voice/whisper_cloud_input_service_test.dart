import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/voice/voice_input_service.dart';
import 'package:spacecode_mobile/core/voice/whisper_cloud_input_service.dart';

void main() {
  group('WhisperCloudInputService', () {
    test('startListening returns false and emits noApiKey error when API key is empty',
        () async {
      final service = WhisperCloudInputService(
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
      );
      addTearDown(service.dispose);

      VoiceInputError? capturedError;
      VoiceInputState? capturedState;
      final ok = await service.startListening(
        onResult: (_) {},
        onError: (e) => capturedError = e,
        onStateChange: (s) => capturedState = s,
      );

      expect(ok, isFalse);
      expect(capturedError, isNotNull);
      expect(capturedError!.code, 'noApiKey');
      // 状态不应进入 listening
      expect(capturedState, isNull);
    });

    test('updateConfig updates API key and base URL', () async {
      final service = WhisperCloudInputService(
        apiBaseUrl: 'https://old.example.com/v1',
        apiKey: 'old-key',
      );
      addTearDown(service.dispose);

      service.updateConfig(
        apiBaseUrl: 'https://new.example.com/v1',
        apiKey: 'new-key',
      );

      // 验证：用空 key 调 updateConfig 后，startListening 应触发 noApiKey
      service.updateConfig(
        apiBaseUrl: 'https://new.example.com/v1',
        apiKey: '',
      );

      VoiceInputError? capturedError;
      final ok = await service.startListening(
        onResult: (_) {},
        onError: (e) => capturedError = e,
        onStateChange: (_) {},
      );

      expect(ok, isFalse);
      expect(capturedError?.code, 'noApiKey');
    });

    test('initialize returns false when API key is empty', () async {
      final service = WhisperCloudInputService(
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
      );
      addTearDown(service.dispose);

      final ok = await service.initialize();
      expect(ok, isFalse);
    });
  });

  group('VoiceInputState', () {
    test('has three distinct states', () {
      const states = VoiceInputState.values;
      expect(states.length, 3);
      expect(states, contains(VoiceInputState.idle));
      expect(states, contains(VoiceInputState.listening));
      expect(states, contains(VoiceInputState.transcribing));
    });
  });

  group('VoiceInputResult', () {
    test('isFinal defaults to true', () {
      const result = VoiceInputResult(text: 'hello');
      expect(result.text, 'hello');
      expect(result.isFinal, isTrue);
    });

    test('partial result has isFinal false', () {
      const result = VoiceInputResult(text: 'hel', isFinal: false);
      expect(result.isFinal, isFalse);
    });
  });

  group('VoiceInputError', () {
    test('carries code and message', () {
      const error = VoiceInputError(code: 'network', message: 'timeout');
      expect(error.code, 'network');
      expect(error.message, 'timeout');
    });
  });
}
