import 'dart:convert';

import 'package:http/http.dart' as http;

import 'web_search_provider.dart';

/// Brave Search 实现独立索引,不依赖 Google/Bing。
///
/// 端点:GET https://api.search.brave.com/res/v1/web/search?q=<q>&count=<n>
/// Header:X-Subscription-Token: <apiKey>
/// 响应:{ web: { results: [ { title, url, description } ] } }
class BraveProvider implements WebSearchProvider {
  final String apiKey;
  final http.Client client;

  BraveProvider({required this.apiKey, http.Client? client})
      : client = client ?? http.Client();

  @override
  WebSearchProviderType get type => WebSearchProviderType.brave;

  @override
  bool get requiresApiKey => true;

  @override
  Future<List<WebSearchResult>> search({
    required String query,
    int maxResults = 5,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (apiKey.isEmpty) {
      throw StateError('请先在设置中配置 Brave API Key');
    }
    final uri = Uri.https('api.search.brave.com', '/res/v1/web/search', {
      'q': query,
      'count': maxResults.toString(),
    });
    final response = await client.get(uri, headers: {
      'x-subscription-token': apiKey,
      'accept': 'application/json',
    }).timeout(timeout);

    if (response.statusCode == 429) {
      throw const WebSearchException('请求过于频繁,请稍后重试', statusCode: 429);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw WebSearchException(
        'Brave 搜索失败: ${response.body}'.substring(0, response.body.length > 500 ? 500 : response.body.length),
        statusCode: response.statusCode,
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) return const [];
    final web = decoded['web'];
    if (web is! Map<String, dynamic>) return const [];
    final results = web['results'];
    if (results is! List) return const [];
    return results
        .whereType<Map<String, dynamic>>()
        .take(maxResults)
        .map((item) => WebSearchResult(
              title: (item['title'] ?? '').toString(),
              url: (item['url'] ?? '').toString(),
              snippet: (item['description'] ?? '').toString(),
            ))
        .toList(growable: false);
  }
}
