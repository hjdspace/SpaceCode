import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../../core/config/mobile_config.dart';

/// 从 OpenAI compatible /models 端点拉取可用模型列表。
class ModelService {
  final String apiKey;
  final String baseUrl;
  final http.Client _client;

  ModelService({
    required this.apiKey,
    required this.baseUrl,
    http.Client? client,
  }) : _client = client ?? http.Client();

  static const List<String> defaultModels = [
    'gpt-4o',
    'gpt-4o-mini',
    'claude-3-5-sonnet',
    'deepseek-chat',
  ];

  Future<List<String>> fetchModels() async {
    try {
      final url = Uri.parse('$baseUrl/models');
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      if (apiKey.isNotEmpty) {
        headers['Authorization'] = 'Bearer $apiKey';
      }

      final response = await _client.get(url, headers: headers);
      if (response.statusCode != 200) {
        return defaultModels;
      }

      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final data = body['data'] as List<dynamic>? ?? const [];
      return data
          .whereType<Map<String, dynamic>>()
          .map((model) => model['id'] as String?)
          .whereType<String>()
          .toList();
    } catch (_) {
      return defaultModels;
    }
  }
}

/// 基于当前 [MobileConfig] 提供 [ModelService] 实例。
final modelServiceProvider = Provider<ModelService>((ref) {
  final config = ref.watch(mobileConfigProvider);
  return ModelService(apiKey: config.apiKey, baseUrl: config.baseUrl);
});

/// 异步获取模型 ID 列表，失败时回退到 [ModelService.defaultModels]。
final modelsProvider = FutureProvider<List<String>>((ref) async {
  final service = ref.watch(modelServiceProvider);
  return service.fetchModels();
});
