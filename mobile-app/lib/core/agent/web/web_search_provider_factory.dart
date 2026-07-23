import 'package:http/http.dart' as http;

import 'brave_provider.dart';
import 'jina_provider.dart';
import 'tavily_provider.dart';
import 'web_search_provider.dart';

/// 根据 [WebSearchProviderType] 构建 [WebSearchProvider] 实例。
///
/// [client] 用于测试注入 MockClient;生产环境传入 null 时内部创建 http.Client()。
class WebSearchProviderFactory {
  const WebSearchProviderFactory._();

  static WebSearchProvider create(
    WebSearchProviderType type, {
    String? apiKey,
    http.Client? client,
  }) {
    switch (type) {
      case WebSearchProviderType.jina:
        return JinaProvider(apiKey: apiKey, client: client);
      case WebSearchProviderType.tavily:
        return TavilyProvider(apiKey: apiKey ?? '', client: client);
      case WebSearchProviderType.brave:
        return BraveProvider(apiKey: apiKey ?? '', client: client);
    }
  }

  /// 字符串 → 枚举解析(用于从 SharedPreferences 读取的字符串还原)。
  static WebSearchProviderType parseType(String value) {
    switch (value) {
      case 'tavily':
        return WebSearchProviderType.tavily;
      case 'brave':
        return WebSearchProviderType.brave;
      case 'jina':
      default:
        return WebSearchProviderType.jina;
    }
  }
}
