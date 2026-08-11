import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'web_search_provider.dart';

/// Jina s.jina.ai 搜索实现。
///
/// 默认 Provider,免 API Key 即可用(速率 5 RPM)。
/// 配置 Key 后速率提升至 40 RPM。
/// 端点:GET https://s.jina.ai/<query>
/// 响应(JSON 模式):{ data: [ { title, url, content } ] }
class JinaProvider implements WebSearchProvider {
  final String? apiKey;
  final http.Client client;

  JinaProvider({this.apiKey, http.Client? client})
      : client = client ?? http.Client();

  @override
  WebSearchProviderType get type => WebSearchProviderType.jina;

  @override
  bool get requiresApiKey => false;

  @override
  Future<List<WebSearchResult>> search({
    required String query,
    int maxResults = 5,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final uri = Uri.parse('https://s.jina.ai/${Uri.encodeComponent(query)}');
    final headers = <String, String>{'accept': 'application/json'};
    if (apiKey != null && apiKey!.isNotEmpty) {
      headers['authorization'] = 'Bearer $apiKey';
    }
    final http.Response response;
    try {
      response = await client.get(uri, headers: headers).timeout(timeout);
    } on TimeoutException {
      throw const WebSearchException('Jina 搜索请求超时，请检查网络后重试');
    } on SocketException {
      throw const WebSearchException('无法连接 Jina 搜索服务，请检查网络、代理或切换搜索服务');
    } on http.ClientException {
      throw const WebSearchException('无法连接 Jina 搜索服务，请检查网络、代理或切换搜索服务');
    }

    if (response.statusCode == 429) {
      throw const WebSearchException('请求过于频繁,请稍后重试或配置 API Key 提升额度',
          statusCode: 429);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw WebSearchException(
        'Jina 搜索失败: ${response.body}'.substring(
            0, response.body.length > 500 ? 500 : response.body.length),
        statusCode: response.statusCode,
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) return const [];
    final data = decoded['data'];
    if (data is! List) return const [];
    return data
        .whereType<Map<String, dynamic>>()
        .take(maxResults)
        .map((item) => WebSearchResult(
              title: (item['title'] ?? '').toString(),
              url: (item['url'] ?? '').toString(),
              snippet: (item['content'] ?? '').toString(),
            ))
        .toList(growable: false);
  }
}
