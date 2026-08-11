import 'dart:convert';

import 'package:http/http.dart' as http;

import 'web_search_provider.dart';

/// Tavily 搜索实现。
///
/// 端点:POST https://api.tavily.com/search
/// Header:Authorization: Bearer <apiKey>
/// Body:{ query, max_results, search_depth: "basic" }
/// 响应:{ results: [ { title, url, content } ] }
class TavilyProvider implements WebSearchProvider {
  final String apiKey;
  final http.Client client;

  TavilyProvider({required this.apiKey, http.Client? client})
      : client = client ?? http.Client();

  @override
  WebSearchProviderType get type => WebSearchProviderType.tavily;

  @override
  bool get requiresApiKey => true;

  @override
  Future<List<WebSearchResult>> search({
    required String query,
    int maxResults = 5,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (apiKey.isEmpty) {
      throw StateError('请先在设置中配置 Tavily API Key');
    }
    final response = await client
        .post(
          Uri.parse('https://api.tavily.com/search'),
          headers: {
            'authorization': 'Bearer $apiKey',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'query': query,
            'max_results': maxResults,
            'search_depth': 'basic',
          }),
        )
        .timeout(timeout);

    if (response.statusCode == 429) {
      throw const WebSearchException('请求过于频繁,请稍后重试', statusCode: 429);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw WebSearchException(
        'Tavily 搜索失败: ${response.body}'.substring(0, response.body.length > 500 ? 500 : response.body.length),
        statusCode: response.statusCode,
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) return const [];
    final results = decoded['results'];
    if (results is! List) return const [];
    return results
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
