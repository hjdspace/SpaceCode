import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'voice_input_service.dart';

// Stub: record 包暂因 record_linux 版本不兼容被移除，
// 语音输入回退到 speech_to_text 方案。恢复 record 依赖后还原此文件。
class AudioRecorder {
  Future<bool> hasPermission() async => false;
  Future<void> start(dynamic config, {required String path}) async {
    throw UnsupportedError('record package not available');
  }
  Future<void> stop() async {}
  Future<void> dispose() async {}
}
class RecordConfig {
  final dynamic encoder;
  final int sampleRate;
  final int numChannels;
  final int bitRate;
  const RecordConfig({
    required this.encoder,
    required this.sampleRate,
    required this.numChannels,
    required this.bitRate,
  });
}
class AudioEncoder {
  static const aacLc = null;
}

/// 基于 record + OpenAI Whisper API 的语音输入实现
///
/// 适用于所有平台（特别是国内 Android，无 Google 服务依赖）。
/// 需要 OpenAI 兼容的 API key 和支持 /audio/transcriptions 的端点。
class WhisperCloudInputService implements VoiceInputService {
  final AudioRecorder _recorder = AudioRecorder();
  String? _currentPath;

  String _apiBaseUrl;
  String _apiKey;
  final String _whisperModel;

  void Function(VoiceInputResult)? _onResult;
  void Function(VoiceInputError)? _onError;
  void Function(VoiceInputState)? _onStateChange;

  bool _listening = false;

  WhisperCloudInputService({
    required String apiBaseUrl,
    required String apiKey,
    String whisperModel = 'whisper-1',
  })  : _apiBaseUrl = apiBaseUrl,
        _apiKey = apiKey,
        _whisperModel = whisperModel;

  /// 更新 API 配置（在 startListening 前调用以确保使用最新配置）
  void updateConfig({required String apiBaseUrl, required String apiKey}) {
    _apiBaseUrl = apiBaseUrl;
    _apiKey = apiKey;
  }

  @override
  Future<bool> initialize() async {
    if (_apiKey.isEmpty) return false;
    return _recorder.hasPermission();
  }

  @override
  Future<bool> startListening({
    required ValueChanged<VoiceInputResult> onResult,
    required ValueChanged<VoiceInputError> onError,
    required ValueChanged<VoiceInputState> onStateChange,
  }) async {
    if (_apiKey.isEmpty) {
      onError(const VoiceInputError(
        code: 'noApiKey',
        message: 'API key not configured',
      ));
      return false;
    }

    _onResult = onResult;
    _onError = onError;
    _onStateChange = onStateChange;

    try {
      final dir = await getTemporaryDirectory();
      final path =
          '${dir.path}/voice_input_${DateTime.now().millisecondsSinceEpoch}.m4a';
      _currentPath = path;

      const config = RecordConfig(
        encoder: AudioEncoder.aacLc,
        sampleRate: 44100,
        numChannels: 1,
        bitRate: 128000,
      );

      // AudioRecorder.start 返回 Future<void>，失败会抛异常
      await _recorder.start(config, path: path);
      _listening = true;
      onStateChange(VoiceInputState.listening);
      return true;
    } catch (e) {
      onError(VoiceInputError(
        code: 'recordStartFailed',
        message: e.toString(),
      ));
      return false;
    }
  }

  @override
  Future<void> stop() async {
    if (!_listening) return;
    _listening = false;
    _onStateChange?.call(VoiceInputState.transcribing);

    String? path;
    try {
      path = _currentPath;
      _currentPath = null;
      await _recorder.stop();
    } catch (e) {
      _onError?.call(VoiceInputError(
        code: 'recordStopFailed',
        message: e.toString(),
      ));
      _onStateChange?.call(VoiceInputState.idle);
      return;
    }

    if (path == null) {
      _onError?.call(const VoiceInputError(
        code: 'noRecording',
        message: 'No recording to transcribe',
      ));
      _onStateChange?.call(VoiceInputState.idle);
      return;
    }

    final file = File(path);
    if (!await file.exists()) {
      _onError?.call(const VoiceInputError(
        code: 'fileNotFound',
        message: 'Recording file not found',
      ));
      _onStateChange?.call(VoiceInputState.idle);
      return;
    }

    try {
      final text = await _transcribe(file);
      // 清理临时文件
      try {
        await file.delete();
      } catch (_) {}

      if (text.isNotEmpty) {
        _onResult?.call(VoiceInputResult(text: text, isFinal: true));
      }
      _onStateChange?.call(VoiceInputState.idle);
    } catch (e) {
      // 清理临时文件
      try {
        await file.delete();
      } catch (_) {}
      _onError?.call(VoiceInputError(
        code: 'transcribeFailed',
        message: e.toString(),
      ));
      _onStateChange?.call(VoiceInputState.idle);
    }
  }

  Future<String> _transcribe(File audioFile) async {
    final base = _apiBaseUrl.replaceAll(RegExp(r'/+$'), '');
    final url = '$base/audio/transcriptions';

    final request = http.MultipartRequest('POST', Uri.parse(url))
      ..headers['Authorization'] = 'Bearer $_apiKey'
      ..fields['model'] = _whisperModel
      ..fields['language'] = 'zh'
      ..files.add(await http.MultipartFile.fromPath(
        'file',
        audioFile.path,
        filename: 'voice.m4a',
      ));

    final streamResponse = await request.send();
    final response = await http.Response.fromStream(streamResponse);

    if (response.statusCode != 200) {
      throw Exception(
        'Whisper API ${response.statusCode}: ${response.body}',
      );
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return (body['text'] as String?)?.trim() ?? '';
  }

  @override
  Future<void> cancel() async {
    if (_listening) {
      try {
        await _recorder.stop();
      } catch (_) {}
      _listening = false;
    }
    if (_currentPath != null) {
      try {
        final f = File(_currentPath!);
        if (await f.exists()) await f.delete();
      } catch (_) {}
      _currentPath = null;
    }
    _onStateChange?.call(VoiceInputState.idle);
  }

  @override
  Future<void> dispose() async {
    await _recorder.dispose();
    _onResult = null;
    _onError = null;
    _onStateChange = null;
  }
}
