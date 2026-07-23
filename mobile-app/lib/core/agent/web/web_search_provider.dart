/// 搜索 Provider 类型枚举。
enum WebSearchProviderType { jina, tavily, brave }

/// 统一搜索结果数据结构。
class WebSearchResult {
  final String title;
  final String url;
  final String snippet;

  const WebSearchResult({
    required this.title,
    required this.url,
    required this.snippet,
  });

  Map<String, dynamic> toJson() => {
        'title': title,
        'url': url,
        'snippet': snippet,
      };
}

/// 搜索后端抽象接口。
///
/// 三个实现:JinaProvider(默认免 Key)、TavilyProvider、BraveProvider。
/// 由 [WebSearchProviderFactory] 根据 [WebSearchProviderType] 构建。
abstract class WebSearchProvider {
  WebSearchProviderType get type;
  bool get requiresApiKey;
  Future<List<WebSearchResult>> search({
    required String query,
    int maxResults = 5,
    Duration timeout = const Duration(seconds: 30),
  });
}

/// 搜索异常,携带可读消息。
class WebSearchException implements Exception {
  final String message;
  final int? statusCode;
  const WebSearchException(this.message, {this.statusCode});

  @override
  String toString() =>
      statusCode == null ? message : '$message (HTTP $statusCode)';
}
