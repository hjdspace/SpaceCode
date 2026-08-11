# 手机端 AI Agent 联网搜索 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为手机端 AI Agent 新增 `web_search`（多 Provider 搜索）与 `fetch_url`（Jina r.jina.ai 网页抓取）两个工具,使其具备联网能力。

**架构：** 抽象 `WebSearchProvider` 接口 + Tavily/Brave/Jina 三个实现 + `WebSearchProviderFactory` 构建实例;`WebSearchPlugin` 持有 provider 提供 `web_search` 工具;`WebFetchPlugin` 固定调用 Jina r.jina.ai 提供 `fetch_url` 工具。两个工具均为 `DangerLevel.read`,无需用户确认。默认 Jina 免 Key 开箱即用。

**技术栈：** Flutter / Dart,`package:http` 发请求,`package:http/testing.dart` 的 `MockClient` 做单测,SharedPreferences 持久化配置,现有 `AgentPlugin`/`AgentTool` 扩展点。

**规格：** [docs/superpowers/specs/2026-07-23-mobile-agent-web-search-design.md](file:///d:/AI/SpaceCode/docs/superpowers/specs/2026-07-23-mobile-agent-web-search-design.md)

**测试命令：**
- 单测：`cd mobile-app && flutter test test/core/agent/web/ test/core/agent/plugins/web_search_plugin_test.dart test/core/agent/plugins/web_fetch_plugin_test.dart`
- 静态分析：`cd mobile-app && flutter analyze`
- 全量测试：`cd mobile-app && flutter test`

**约定：**
- 包导入路径前缀 `package:spacecode_mobile/`
- commit message 中文,前缀 `feat(mobile):` / `test(mobile):` / `refactor(mobile):`
- 所有可见文案走 i18n(`lib/core/i18n/locales/zh.json` + `en.json`)
- 不引入新依赖(`http` 已在 pubspec)

---

## 文件结构

**新增源码**
- `mobile-app/lib/core/agent/web/web_search_provider.dart` — `WebSearchProvider` 抽象接口 + `WebSearchResult` 数据类 + `WebSearchProviderType` 枚举
- `mobile-app/lib/core/agent/web/jina_provider.dart` — Jina s.jina.ai 实现(默认,免 Key)
- `mobile-app/lib/core/agent/web/tavily_provider.dart` — Tavily 实现
- `mobile-app/lib/core/agent/web/brave_provider.dart` — Brave 实现
- `mobile-app/lib/core/agent/web/web_search_provider_factory.dart` — 工厂
- `mobile-app/lib/core/agent/plugins/web_search_plugin.dart` — `WebSearchPlugin` + `web_search` 工具
- `mobile-app/lib/core/agent/plugins/web_fetch_plugin.dart` — `WebFetchPlugin` + `fetch_url` 工具

**新增测试**
- `mobile-app/test/core/agent/web/jina_provider_test.dart`
- `mobile-app/test/core/agent/web/tavily_provider_test.dart`
- `mobile-app/test/core/agent/web/brave_provider_test.dart`
- `mobile-app/test/core/agent/web/web_search_provider_factory_test.dart`
- `mobile-app/test/core/agent/plugins/web_search_plugin_test.dart`
- `mobile-app/test/core/agent/plugins/web_fetch_plugin_test.dart`

**改造**
- `mobile-app/lib/core/agent/command_classifier.dart` — `_toolDangerTable` 加 `web_search`/`fetch_url` → read
- `mobile-app/test/core/agent/command_classifier_test.dart` — 加断言
- `mobile-app/lib/core/config/mobile_config.dart` — 加 `searchProvider`/`searchApiKey` 字段 + 持久化
- `mobile-app/lib/core/agent/local_agent_service.dart` — 注册两个新 Plugin
- `mobile-app/lib/core/i18n/locales/zh.json` + `en.json` — 加文案
- `mobile-app/lib/features/settings/settings_screen.dart` — 加 `_webSearchCard`

---

### 任务 1：WebSearchProvider 接口与数据类

**文件：**
- 创建：`mobile-app/lib/core/agent/web/web_search_provider.dart`

此任务建立基础类型,无独立测试(由后续 provider 测试覆盖)。先建类型再写实现。

- [ ] **步骤 1：创建接口文件**

```dart
// mobile-app/lib/core/agent/web/web_search_provider.dart
import 'package:http/http.dart' as http;

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
```

- [ ] **步骤 2：验证编译**

运行：`cd mobile-app && flutter analyze lib/core/agent/web/web_search_provider.dart`
预期：无错误(可能有 unused_element 警告,后续任务消除)

- [ ] **步骤 3：Commit**

```bash
git add mobile-app/lib/core/agent/web/web_search_provider.dart
git commit -m "feat(mobile): 新增 WebSearchProvider 接口与数据类"
```

---

### 任务 2：JinaProvider 实现(默认,免 Key)

**文件：**
- 创建：`mobile-app/lib/core/agent/web/jina_provider.dart`
- 测试：`mobile-app/test/core/agent/web/jina_provider_test.dart`

- [ ] **步骤 1：编写失败的测试**

```dart
// mobile-app/test/core/agent/web/jina_provider_test.dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/jina_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

void main() {
  group('JinaProvider', () {
    test('type is jina and does not require api key', () {
      final provider = JinaProvider(client: MockClient((_) async => http.Response('{}', 200)));
      expect(provider.type, WebSearchProviderType.jina);
      expect(provider.requiresApiKey, isFalse);
    });

    test('search sends GET to s.jina.ai with Accept json header', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'data': [
              {'title': 'Result 1', 'url': 'https://a.com', 'content': 'snippet 1'},
              {'title': 'Result 2', 'url': 'https://b.com', 'content': 'snippet 2'},
            ]
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final provider = JinaProvider(client: client);

      final results = await provider.search(query: 'flutter', maxResults: 5);

      expect(captured!.method, 'GET');
      expect(captured!.url.toString(),
          'https://s.jina.ai/flutter');
      expect(captured!.headers['accept'], 'application/json');
      expect(results.length, 2);
      expect(results[0].title, 'Result 1');
      expect(results[0].url, 'https://a.com');
      expect(results[0].snippet, 'snippet 1');
    });

    test('search includes Authorization header when api key provided', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(jsonEncode({'data': []}), 200,
            headers: {'content-type': 'application/json'});
      });
      final provider = JinaProvider(apiKey: 'jina-key-123', client: client);

      await provider.search(query: 'test');

      expect(captured!.headers['authorization'], 'Bearer jina-key-123');
    });

    test('search without api key omits Authorization header', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(jsonEncode({'data': []}), 200,
            headers: {'content-type': 'application/json'});
      });
      final provider = JinaProvider(client: client);

      await provider.search(query: 'test');

      expect(captured!.headers.containsKey('authorization'), isFalse);
    });

    test('search throws WebSearchException on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate limited', 429));
      final provider = JinaProvider(client: client);

      expect(
        () => provider.search(query: 'test'),
        throwsA(isA<WebSearchException>()),
      );
    });

    test('search returns empty list when data field is empty', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({'data': []}), 200,
          headers: {'content-type': 'application/json'}));
      final provider = JinaProvider(client: client);

      final results = await provider.search(query: 'nothing');
      expect(results, isEmpty);
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/agent/web/jina_provider_test.dart`
预期：FAIL,报错 `jina_provider.dart` 不存在 / `JinaProvider` 未定义

- [ ] **步骤 3：编写实现**

```dart
// mobile-app/lib/core/agent/web/jina_provider.dart
import 'dart:convert';

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

  JinaProvider({this.apiKey, http.Client? client}) : client = client ?? http.Client();

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
    final response = await client
        .get(uri, headers: headers)
        .timeout(timeout);

    if (response.statusCode == 429) {
      throw const WebSearchException('请求过于频繁,请稍后重试或配置 API Key 提升额度',
          statusCode: 429);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw WebSearchException(
        'Jina 搜索失败: ${response.body}'.substring(0, response.body.length > 500 ? 500 : response.body.length),
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
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/agent/web/jina_provider_test.dart`
预期：PASS(6 个测试全通过)

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/agent/web/jina_provider.dart mobile-app/test/core/agent/web/jina_provider_test.dart
git commit -m "feat(mobile): 新增 JinaProvider 搜索实现(默认免 Key)"
```

---

### 任务 3：TavilyProvider 实现

**文件：**
- 创建：`mobile-app/lib/core/agent/web/tavily_provider.dart`
- 测试：`mobile-app/test/core/agent/web/tavily_provider_test.dart`

- [ ] **步骤 1：编写失败的测试**

```dart
// mobile-app/test/core/agent/web/tavily_provider_test.dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/tavily_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

void main() {
  group('TavilyProvider', () {
    test('type is tavily and requires api key', () {
      final provider = TavilyProvider(apiKey: 'k', client: MockClient((_) async => http.Response('{}', 200)));
      expect(provider.type, WebSearchProviderType.tavily);
      expect(provider.requiresApiKey, isTrue);
    });

    test('search throws StateError when api key is empty', () async {
      final provider = TavilyProvider(apiKey: '', client: MockClient((_) async => http.Response('{}', 200)));
      expect(
        () => provider.search(query: 'test'),
        throwsA(isA<StateError>()),
      );
    });

    test('search sends POST to api.tavily.com/search with bearer token and body', () async {
      http.Request? capturedReq;
      String? capturedBody;
      final client = MockClient((request) async {
        capturedReq = request;
        capturedBody = request.body;
        return http.Response(
          jsonEncode({
            'results': [
              {'title': 'T1', 'url': 'https://x.com', 'content': 'c1'},
            ]
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final provider = TavilyProvider(apiKey: 'tavily-key', client: client);

      final results = await provider.search(query: 'rust async', maxResults: 3);

      expect(capturedReq!.method, 'POST');
      expect(capturedReq!.url.toString(), 'https://api.tavily.com/search');
      expect(capturedReq!.headers['authorization'], 'Bearer tavily-key');
      expect(capturedReq!.headers['content-type'], 'application/json');
      final body = jsonDecode(capturedBody!) as Map<String, dynamic>;
      expect(body['query'], 'rust async');
      expect(body['max_results'], 3);
      expect(body['search_depth'], 'basic');
      expect(results.length, 1);
      expect(results[0].title, 'T1');
      expect(results[0].snippet, 'c1');
    });

    test('search throws WebSearchException on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate', 429));
      final provider = TavilyProvider(apiKey: 'k', client: client);
      expect(
        () => provider.search(query: 't'),
        throwsA(isA<WebSearchException>()),
      );
    });

    test('search returns empty list when results field absent', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({}), 200,
          headers: {'content-type': 'application/json'}));
      final provider = TavilyProvider(apiKey: 'k', client: client);
      final results = await provider.search(query: 't');
      expect(results, isEmpty);
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/agent/web/tavily_provider_test.dart`
预期：FAIL,`TavilyProvider` 未定义

- [ ] **步骤 3：编写实现**

```dart
// mobile-app/lib/core/agent/web/tavily_provider.dart
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
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/agent/web/tavily_provider_test.dart`
预期：PASS(5 个测试全通过)

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/agent/web/tavily_provider.dart mobile-app/test/core/agent/web/tavily_provider_test.dart
git commit -m "feat(mobile): 新增 TavilyProvider 搜索实现"
```

---

### 任务 4：BraveProvider 实现

**文件：**
- 创建：`mobile-app/lib/core/agent/web/brave_provider.dart`
- 测试：`mobile-app/test/core/agent/web/brave_provider_test.dart`

- [ ] **步骤 1：编写失败的测试**

```dart
// mobile-app/test/core/agent/web/brave_provider_test.dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/brave_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

void main() {
  group('BraveProvider', () {
    test('type is brave and requires api key', () {
      final provider = BraveProvider(apiKey: 'k', client: MockClient((_) async => http.Response('{}', 200)));
      expect(provider.type, WebSearchProviderType.brave);
      expect(provider.requiresApiKey, isTrue);
    });

    test('search throws StateError when api key is empty', () async {
      final provider = BraveProvider(apiKey: '', client: MockClient((_) async => http.Response('{}', 200)));
      expect(
        () => provider.search(query: 'test'),
        throwsA(isA<StateError>()),
      );
    });

    test('search sends GET to brave api with X-Subscription-Token and query params', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'web': {
              'results': [
                {'title': 'B1', 'url': 'https://y.com', 'description': 'desc1'},
              ]
            }
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final provider = BraveProvider(apiKey: 'brave-key', client: client);

      final results = await provider.search(query: 'dart language', maxResults: 7);

      expect(captured!.method, 'GET');
      expect(captured!.url.host, 'api.search.brave.com');
      expect(captured!.url.path, '/res/v1/web/search');
      expect(captured!.url.queryParameters['q'], 'dart language');
      expect(captured!.url.queryParameters['count'], '7');
      expect(captured!.headers['x-subscription-token'], 'brave-key');
      expect(captured!.headers['accept'], 'application/json');
      expect(results.length, 1);
      expect(results[0].title, 'B1');
      expect(results[0].snippet, 'desc1');
    });

    test('search throws WebSearchException on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate', 429));
      final provider = BraveProvider(apiKey: 'k', client: client);
      expect(
        () => provider.search(query: 't'),
        throwsA(isA<WebSearchException>()),
      );
    });

    test('search returns empty list when web.results absent', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({}), 200,
          headers: {'content-type': 'application/json'}));
      final provider = BraveProvider(apiKey: 'k', client: client);
      final results = await provider.search(query: 't');
      expect(results, isEmpty);
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/agent/web/brave_provider_test.dart`
预期：FAIL,`BraveProvider` 未定义

- [ ] **步骤 3：编写实现**

```dart
// mobile-app/lib/core/agent/web/brave_provider.dart
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
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/agent/web/brave_provider_test.dart`
预期：PASS(5 个测试全通过)

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/agent/web/brave_provider.dart mobile-app/test/core/agent/web/brave_provider_test.dart
git commit -m "feat(mobile): 新增 BraveProvider 搜索实现"
```

---

### 任务 5：WebSearchProviderFactory

**文件：**
- 创建：`mobile-app/lib/core/agent/web/web_search_provider_factory.dart`
- 测试：`mobile-app/test/core/agent/web/web_search_provider_factory_test.dart`

- [ ] **步骤 1：编写失败的测试**

```dart
// mobile-app/test/core/agent/web/web_search_provider_factory_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/brave_provider.dart';
import 'package:spacecode_mobile/core/agent/web/jina_provider.dart';
import 'package:spacecode_mobile/core/agent/web/tavily_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider_factory.dart';

void main() {
  final mockClient = MockClient((_) async => http.Response('{}', 200));

  group('WebSearchProviderFactory', () {
    test('create jina returns JinaProvider', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.jina,
        client: mockClient,
      );
      expect(p, isA<JinaProvider>());
      expect(p.type, WebSearchProviderType.jina);
      expect(p.requiresApiKey, isFalse);
    });

    test('create tavily returns TavilyProvider', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.tavily,
        apiKey: 'k',
        client: mockClient,
      );
      expect(p, isA<TavilyProvider>());
      expect(p.type, WebSearchProviderType.tavily);
    });

    test('create brave returns BraveProvider', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.brave,
        apiKey: 'k',
        client: mockClient,
      );
      expect(p, isA<BraveProvider>());
      expect(p.type, WebSearchProviderType.brave);
    });

    test('create tavily with null apiKey defaults to empty string', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.tavily,
        client: mockClient,
      ) as TavilyProvider;
      expect(p.apiKey, '');
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/agent/web/web_search_provider_factory_test.dart`
预期：FAIL,`WebSearchProviderFactory` 未定义

- [ ] **步骤 3：编写实现**

```dart
// mobile-app/lib/core/agent/web/web_search_provider_factory.dart
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
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/agent/web/web_search_provider_factory_test.dart`
预期：PASS(4 个测试全通过)

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/agent/web/web_search_provider_factory.dart mobile-app/test/core/agent/web/web_search_provider_factory_test.dart
git commit -m "feat(mobile): 新增 WebSearchProviderFactory 工厂"
```

---

### 任务 6：WebSearchPlugin(web_search 工具)

**文件：**
- 创建：`mobile-app/lib/core/agent/plugins/web_search_plugin.dart`
- 测试：`mobile-app/test/core/agent/plugins/web_search_plugin_test.dart`

- [ ] **步骤 1：编写失败的测试**

```dart
// mobile-app/test/core/agent/plugins/web_search_plugin_test.dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/web_search_plugin.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

/// 可控的假 Provider,用于注入测试。
class _FakeProvider implements WebSearchProvider {
  final List<WebSearchResult> results;
  final Object? error;
  _FakeProvider(this.results, {this.error});

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
    if (error != null) throw error!;
    return results.take(maxResults).toList(growable: false);
  }
}

void main() {
  AgentCancellationToken token() => AgentCancellationToken();

  group('WebSearchPlugin', () {
    test('exposes single web_search tool with correct definition', () {
      final plugin = WebSearchPlugin(_FakeProvider(const []));
      final tools = plugin.createTools();
      expect(tools, hasLength(1));
      final def = tools.first.definition;
      expect(def.name, 'web_search');
      final props = def.inputSchema['properties'] as Map<String, dynamic>;
      expect(props.containsKey('query'), isTrue);
      expect(props.containsKey('max_results'), isTrue);
      expect(def.inputSchema['required'], ['query']);
    });

    test('execute returns JSON results array with count and provider', () async {
      final plugin = WebSearchPlugin(_FakeProvider([
        const WebSearchResult(title: 'T1', url: 'https://a.com', snippet: 's1'),
        const WebSearchResult(title: 'T2', url: 'https://b.com', snippet: 's2'),
      ]));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'flutter'}, token());

      expect(result.isError, isFalse);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 2);
      expect(decoded['provider'], 'jina');
      final results = decoded['results'] as List;
      expect(results[0]['title'], 'T1');
      expect(results[0]['url'], 'https://a.com');
      expect(results[0]['snippet'], 's1');
    });

    test('execute truncates snippet beyond 1000 chars', () async {
      final longSnippet = 'x' * 1500;
      final plugin = WebSearchPlugin(_FakeProvider([
        WebSearchResult(title: 'T', url: 'https://a.com', snippet: longSnippet),
      ]));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'q'}, token());

      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      final results = decoded['results'] as List;
      expect((results[0]['snippet'] as String).length, 1000);
    });

    test('execute clamps max_results to 1..10', () async {
      final plugin = WebSearchPlugin(_FakeProvider([
        const WebSearchResult(title: 'T', url: 'u', snippet: 's'),
      ]));
      final tool = plugin.createTools().single;

      // max_results=0 → clamp 到 1
      var result = await tool.execute({'query': 'q', 'max_results': 0}, token());
      var decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 1);

      // max_results=999 → clamp 到 10,但 provider 只有 1 条
      result = await tool.execute({'query': 'q', 'max_results': 999}, token());
      decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 1);
    });

    test('execute returns count 0 for empty results', () async {
      final plugin = WebSearchPlugin(_FakeProvider(const []));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'nothing'}, token());

      expect(result.isError, isFalse);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 0);
      expect(decoded['results'], isEmpty);
    });

    test('execute returns isError when provider throws WebSearchException', () async {
      final plugin = WebSearchPlugin(_FakeProvider(
        const [],
        error: const WebSearchException('rate limited', statusCode: 429),
      ));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'q'}, token());

      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['error'], contains('rate limited'));
    });

    test('execute returns isError for empty query', () async {
      final plugin = WebSearchPlugin(_FakeProvider(const []));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': ''}, token());

      expect(result.isError, isTrue);
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/agent/plugins/web_search_plugin_test.dart`
预期：FAIL,`WebSearchPlugin` 未定义

- [ ] **步骤 3：编写实现**

```dart
// mobile-app/lib/core/agent/plugins/web_search_plugin.dart
import 'dart:convert';

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';
import '../web/web_search_provider.dart';

/// 提供 `web_search` 工具,委托 [WebSearchProvider] 执行搜索。
class WebSearchPlugin extends AgentPlugin {
  final WebSearchProvider provider;
  WebSearchPlugin(this.provider);

  static const int _maxSnippetChars = 1000;
  static const int _minResults = 1;
  static const int _maxResults = 10;
  static const int _defaultResults = 5;

  @override
  List<AgentTool> createTools() => [_WebSearchTool(this)];
}

class _WebSearchTool extends AgentTool {
  final WebSearchPlugin plugin;
  _WebSearchTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'web_search',
        description: '搜索互联网获取实时信息(新闻、天气、最新文档、股价等)。'
            '当问题涉及训练数据之后的事件或需要最新信息时使用。'
            '返回标题、摘要和 URL。需要全文时用 fetch_url 抓取。',
        inputSchema: {
          'type': 'object',
          'properties': {
            'query': {
              'type': 'string',
              'description': '搜索关键词',
            },
            'max_results': {
              'type': 'integer',
              'description': '返回结果数,默认 5,范围 1-10',
              'default': 5,
            },
          },
          'required': ['query'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    cancellationToken.throwIfCancelled();

    final query = (arguments['query'] as String? ?? '').trim();
    if (query.isEmpty) {
      return const AgentToolResult(
        content: '{"error":"query must not be empty"}',
        isError: true,
      );
    }

    final rawMax = arguments['max_results'] as int? ??
        WebSearchPlugin._defaultResults;
    final maxResults = rawMax.clamp(
        WebSearchPlugin._minResults, WebSearchPlugin._maxResults);

    try {
      final results = await plugin.provider.search(
        query: query,
        maxResults: maxResults,
      );
      final serialized = results
          .map((r) => WebSearchResult(
                title: r.title,
                url: r.url,
                snippet: r.snippet.length > WebSearchPlugin._maxSnippetChars
                    ? r.snippet.substring(0, WebSearchPlugin._maxSnippetChars)
                    : r.snippet,
              ).toJson())
          .toList();
      return AgentToolResult(
        content: jsonEncode({
          'results': serialized,
          'count': serialized.length,
          'provider': plugin.provider.type.name,
        }),
      );
    } on WebSearchException catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': e.message}),
        isError: true,
      );
    } on StateError catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': e.message}),
        isError: true,
      );
    } catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': '搜索失败: $e'}),
        isError: true,
      );
    }
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/agent/plugins/web_search_plugin_test.dart`
预期：PASS(7 个测试全通过)

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/agent/plugins/web_search_plugin.dart mobile-app/test/core/agent/plugins/web_search_plugin_test.dart
git commit -m "feat(mobile): 新增 WebSearchPlugin 提供 web_search 工具"
```

---

### 任务 7：WebFetchPlugin(fetch_url 工具)

**文件：**
- 创建：`mobile-app/lib/core/agent/plugins/web_fetch_plugin.dart`
- 测试：`mobile-app/test/core/agent/plugins/web_fetch_plugin_test.dart`

- [ ] **步骤 1：编写失败的测试**

```dart
// mobile-app/test/core/agent/plugins/web_fetch_plugin_test.dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/web_fetch_plugin.dart';

void main() {
  AgentCancellationToken token() => AgentCancellationToken();

  group('WebFetchPlugin', () {
    test('exposes single fetch_url tool with correct definition', () {
      final plugin = WebFetchPlugin(client: MockClient((_) async => http.Response('{}', 200)));
      final tools = plugin.createTools();
      expect(tools, hasLength(1));
      final def = tools.first.definition;
      expect(def.name, 'fetch_url');
      final props = def.inputSchema['properties'] as Map<String, dynamic>;
      expect(props.containsKey('url'), isTrue);
      expect(props.containsKey('max_chars'), isTrue);
      expect(def.inputSchema['required'], ['url']);
    });

    test('execute sends GET to r.jina.ai/<url> with Accept json', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'data': {'content': '# Title\nbody text'}
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      final result = await tool.execute(
        {'url': 'https://example.com/article'}, token());

      expect(captured!.method, 'GET');
      expect(captured!.url.toString(),
          'https://r.jina.ai/https://example.com/article');
      expect(captured!.headers['accept'], 'application/json');
      expect(result.isError, isFalse);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['url'], 'https://example.com/article');
      expect(decoded['content'], '# Title\nbody text');
      expect(decoded['truncated'], isFalse);
      expect(decoded['chars'], '# Title\nbody text'.length);
    });

    test('execute truncates content to max_chars and sets truncated true', () async {
      final longContent = 'a' * 30000;
      final client = MockClient((_) async => http.Response(
          jsonEncode({'data': {'content': longContent}}), 200,
          headers: {'content-type': 'application/json'}));
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      final result = await tool.execute(
        {'url': 'https://x.com', 'max_chars': 5000}, token());

      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['truncated'], isTrue);
      expect((decoded['content'] as String).length, 5000);
      expect(decoded['chars'], 5000);
    });

    test('execute clamps max_chars to 1000..50000', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({'data': {'content': 'short'}}), 200,
          headers: {'content-type': 'application/json'}));
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      // max_chars=0 → clamp 到 1000,但 content 仅 5 字符,不截断
      var result = await tool.execute(
        {'url': 'https://x.com', 'max_chars': 0}, token());
      var decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['content'], 'short');
      expect(decoded['truncated'], isFalse);
    });

    test('execute returns isError for invalid url', () async {
      final plugin = WebFetchPlugin(client: MockClient((_) async => http.Response('{}', 200)));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'url': 'not-a-url'}, token());
      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['error'], contains('URL'));
    });

    test('execute returns isError for empty url', () async {
      final plugin = WebFetchPlugin(client: MockClient((_) async => http.Response('{}', 200)));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'url': ''}, token());
      expect(result.isError, isTrue);
    });

    test('execute returns isError on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate', 429));
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      final result = await tool.execute(
        {'url': 'https://example.com'}, token());
      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['error'], contains('频繁'));
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/agent/plugins/web_fetch_plugin_test.dart`
预期：FAIL,`WebFetchPlugin` 未定义

- [ ] **步骤 3：编写实现**

```dart
// mobile-app/lib/core/agent/plugins/web_fetch_plugin.dart
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';

/// 提供 `fetch_url` 工具,固定调用 Jina r.jina.ai 抓取网页全文转 Markdown。
///
/// 独立于 [WebSearchPlugin] 的 provider 选择,所有 provider 下均可用。
/// 不执行 JS,适合静态文章/文档/博客。
class WebFetchPlugin extends AgentPlugin {
  final http.Client client;
  final Duration timeout;

  WebFetchPlugin({http.Client? client, Duration? timeout})
      : client = client ?? http.Client(),
        timeout = timeout ?? const Duration(seconds: 30);

  static const int _minChars = 1000;
  static const int _maxChars = 50000;
  static const int _defaultChars = 20000;

  @override
  List<AgentTool> createTools() => [_FetchUrlTool(this)];
}

class _FetchUrlTool extends AgentTool {
  final WebFetchPlugin plugin;
  _FetchUrlTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'fetch_url',
        description: '抓取指定网页全文并转为 Markdown。'
            '当需要阅读 web_search 返回的某个 URL 的完整内容时使用。'
            '不执行 JS,适合静态文章/文档/博客。需要 JS 渲染的动态页面内容可能不全。',
        inputSchema: {
          'type': 'object',
          'properties': {
            'url': {
              'type': 'string',
              'description': '要抓取的完整 URL(含 http/https)',
            },
            'max_chars': {
              'type': 'integer',
              'description': '返回内容最大字符数,默认 20000,范围 1000-50000',
              'default': 20000,
            },
          },
          'required': ['url'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    cancellationToken.throwIfCancelled();

    final url = (arguments['url'] as String? ?? '').trim();
    if (url.isEmpty) {
      return const AgentToolResult(
        content: '{"error":"url must not be empty"}',
        isError: true,
      );
    }
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme || !uri.hasAbsolutePath ||
        (uri.scheme != 'http' && uri.scheme != 'https')) {
      return const AgentToolResult(
        content: '{"error":"URL 格式无效,必须是 http/https 完整地址"}',
        isError: true,
      );
    }

    final rawMax = arguments['max_chars'] as int? ??
        WebFetchPlugin._defaultChars;
    final maxChars =
        rawMax.clamp(WebFetchPlugin._minChars, WebFetchPlugin._maxChars);

    try {
      final response = await plugin.client
          .get(
            Uri.parse('https://r.jina.ai/$url'),
            headers: {'accept': 'application/json'},
          )
          .timeout(plugin.timeout);

      if (response.statusCode == 429) {
        return const AgentToolResult(
          content: '{"error":"请求过于频繁,请稍后重试"}',
          isError: true,
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return AgentToolResult(
          content: jsonEncode({
            'error': '抓取失败 (HTTP ${response.statusCode})',
          }),
          isError: true,
        );
      }

      final decoded = jsonDecode(response.body);
      String content = '';
      if (decoded is Map<String, dynamic>) {
        final data = decoded['data'];
        if (data is Map<String, dynamic>) {
          content = (data['content'] ?? '').toString();
        } else {
          content = (decoded['content'] ?? '').toString();
        }
      }

      final bool truncated = content.length > maxChars;
      final String truncatedContent =
          truncated ? content.substring(0, maxChars) : content;
      return AgentToolResult(
        content: jsonEncode({
          'url': url,
          'content': truncatedContent,
          'truncated': truncated,
          'chars': truncatedContent.length,
        }),
      );
    } catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': '抓取失败: $e'}),
        isError: true,
      );
    }
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/agent/plugins/web_fetch_plugin_test.dart`
预期：PASS(7 个测试全通过)

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/agent/plugins/web_fetch_plugin.dart mobile-app/test/core/agent/plugins/web_fetch_plugin_test.dart
git commit -m "feat(mobile): 新增 WebFetchPlugin 提供 fetch_url 工具"
```

---

### 任务 8：CommandClassifier 扩展

**文件：**
- 修改：`mobile-app/lib/core/agent/command_classifier.dart:28-54`(`_toolDangerTable`)
- 测试：`mobile-app/test/core/agent/command_classifier_test.dart`

- [ ] **步骤 1：编写失败的测试(在现有文件追加)**

在 `mobile-app/test/core/agent/command_classifier_test.dart` 的 `main()` 内、`'unknown tool defaults to write'` 测试之前追加:

```dart
    test('web tools return read', () {
      expect(CommandClassifier.classify('web_search', const {'query': 'q'}),
          DangerLevel.read);
      expect(
          CommandClassifier.classify(
              'fetch_url', const {'url': 'https://x.com'}),
          DangerLevel.read);
    });
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/agent/command_classifier_test.dart`
预期：FAIL,`web_search` 当前走"未知工具默认 write"分支,断言 read 失败

- [ ] **步骤 3：修改实现**

在 `mobile-app/lib/core/agent/command_classifier.dart` 的 `_toolDangerTable` 中,`'run_python_file'` 行之后追加两行:

```dart
    // Web 联网(只读)
    'web_search': DangerLevel.read,
    'fetch_url': DangerLevel.read,
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/agent/command_classifier_test.dart`
预期：PASS(全部测试通过,含新增 web tools 断言)

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/agent/command_classifier.dart mobile-app/test/core/agent/command_classifier_test.dart
git commit -m "feat(mobile): web_search/fetch_url 归类为只读权限"
```

---

### 任务 9：MobileConfig 扩展(searchProvider / searchApiKey)

**文件：**
- 修改：`mobile-app/lib/core/config/mobile_config.dart`

此任务扩展配置类与持久化,UI 集成在任务 11。

- [ ] **步骤 1：修改 MobileConfig 数据类**

在 `mobile-app/lib/core/config/mobile_config.dart` 的 `MobileConfig` 类中:

1. 在字段区(第 6-11 行附近)`appLocale` 后追加:
```dart
  final String searchProvider;
  final String searchApiKey;
```

2. 构造函数(第 12-19 行附近)追加默认值:
```dart
    this.searchProvider = 'jina',
    this.searchApiKey = '',
```

3. `copyWith` 方法追加:
```dart
    String? searchProvider,
    String? searchApiKey,
```
并在 `copyWith` 函数体内追加:
```dart
        searchProvider: searchProvider ?? this.searchProvider,
        searchApiKey: searchApiKey ?? this.searchApiKey,
```

- [ ] **步骤 2：修改 MobileConfigNotifier 持久化**

在 `MobileConfigNotifier` 类中:

1. 在字段区(第 45-50 行附近)`_appLocale` 后追加:
```dart
  static const _searchProvider = 'mobile_search_provider';
  static const _searchApiKey = 'mobile_search_api_key';
```

2. `load()` 方法(第 56-67 行)的 `MobileConfig(...)` 构造中,`appLocale:` 行后追加:
```dart
      searchProvider: prefs.getString(_searchProvider) ?? 'jina',
      searchApiKey: prefs.getString(_searchApiKey) ?? '',
```

3. 在 `saveLocale` 方法后(第 113 行后)追加新方法:
```dart
  Future<void> saveSearch({
    required String provider,
    required String apiKey,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_searchProvider, provider);
    await prefs.setString(_searchApiKey, apiKey.trim());
    state = state.copyWith(
      searchProvider: provider,
      searchApiKey: apiKey.trim(),
    );
  }
```

- [ ] **步骤 3：验证编译与既有测试**

运行：`cd mobile-app && flutter analyze lib/core/config/mobile_config.dart`
预期：无错误

运行：`cd mobile-app && flutter test`
预期：既有测试全部通过(新字段有默认值,向后兼容)

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/lib/core/config/mobile_config.dart
git commit -m "feat(mobile): MobileConfig 新增 searchProvider/searchApiKey 字段及持久化"
```

---

### 任务 10：local_agent_service 集成(注册新 Plugin)

**文件：**
- 修改：`mobile-app/lib/core/agent/local_agent_service.dart`

- [ ] **步骤 1：添加 import**

在 `mobile-app/lib/core/agent/local_agent_service.dart` 顶部 import 区(第 17-21 行的 plugins import 之后)追加:

```dart
import 'plugins/web_fetch_plugin.dart';
import 'plugins/web_search_plugin.dart';
import 'web/web_search_provider_factory.dart';
```

- [ ] **步骤 2：在 plugins 列表追加两个 Plugin**

在 `complete()` 方法的 `final plugins = <AgentPlugin>[...];`(第 76-93 行)中,`SkillPlugin(...)` 条件项之后、列表闭合 `];` 之前追加:

```dart
      // 联网搜索 + 网页抓取(无 workspace 依赖,始终加载)
      WebSearchPlugin(
        WebSearchProviderFactory.create(
          WebSearchProviderFactory.parseType(config.searchProvider),
          apiKey: config.searchApiKey,
        ),
      ),
      WebFetchPlugin(),
```

- [ ] **步骤 3：验证编译与既有测试**

运行：`cd mobile-app && flutter analyze lib/core/agent/local_agent_service.dart`
预期：无错误

运行：`cd mobile-app && flutter test`
预期：既有测试全部通过(local_agent_service_test 若 mock config 无新字段,用默认值 'jina' / '')

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/lib/core/agent/local_agent_service.dart
git commit -m "feat(mobile): Agent 注册 web_search 与 fetch_url 工具"
```

---

### 任务 11：i18n 文案

**文件：**
- 修改：`mobile-app/lib/core/i18n/locales/zh.json`
- 修改：`mobile-app/lib/core/i18n/locales/en.json`

- [ ] **步骤 1：在 zh.json 追加文案**

在 `mobile-app/lib/core/i18n/locales/zh.json` 中,`"settings.languageEn": "English",` 行后追加:

```json
  "settings.webSearch.title": "联网搜索",
  "settings.webSearch.provider": "搜索引擎",
  "settings.webSearch.apiKey": "API Key",
  "settings.webSearch.apiKeyHint.jina": "Jina 免费免 Key 可用,配置 Key 可提升速率限额",
  "settings.webSearch.apiKeyHint.tavily": "在 tavily.com 注册获取",
  "settings.webSearch.apiKeyHint.brave": "在 brave.com/search/api 获取",
  "settings.webSearch.test": "测试",
  "settings.webSearch.testSuccess": "配置有效",
  "settings.webSearch.testFailed": "配置无效:{error}",
  "settings.webSearch.providerJina": "Jina(免费)",
  "settings.webSearch.providerTavily": "Tavily",
  "settings.webSearch.providerBrave": "Brave",
```

- [ ] **步骤 2：在 en.json 追加对应英文**

在 `mobile-app/lib/core/i18n/locales/en.json` 中对应位置追加:

```json
  "settings.webSearch.title": "Web Search",
  "settings.webSearch.provider": "Search Provider",
  "settings.webSearch.apiKey": "API Key",
  "settings.webSearch.apiKeyHint.jina": "Jina works without a key; adding one raises rate limits",
  "settings.webSearch.apiKeyHint.tavily": "Get it from tavily.com",
  "settings.webSearch.apiKeyHint.brave": "Get it from brave.com/search/api",
  "settings.webSearch.test": "Test",
  "settings.webSearch.testSuccess": "Configuration valid",
  "settings.webSearch.testFailed": "Invalid: {error}",
  "settings.webSearch.providerJina": "Jina (Free)",
  "settings.webSearch.providerTavily": "Tavily",
  "settings.webSearch.providerBrave": "Brave",
```

- [ ] **步骤 3：验证 JSON 合法性 + i18n 测试**

运行：`cd mobile-app && flutter test test/i18n_test.dart`
预期：PASS(i18n 测试通过,确认 key 加载正常)

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/lib/core/i18n/locales/zh.json mobile-app/lib/core/i18n/locales/en.json
git commit -m "feat(mobile): 新增联网搜索 i18n 文案(中英双语)"
```

---

### 任务 12：settings_screen 联网搜索卡片 UI

**文件：**
- 修改：`mobile-app/lib/features/settings/settings_screen.dart`

此任务为 UI 集成,验证以 `flutter analyze` 无错误 + 手动运行确认卡片渲染为准。先查看现有卡片模式再仿照实现。

- [ ] **步骤 1：阅读现有 _githubCard 作为模板**

运行：阅读 `mobile-app/lib/features/settings/settings_screen.dart` 第 730-845 行(`_githubCard` 方法),理解卡片结构(Card → ListTile 标题 → Padding 内容区 → TextField/按钮)与 i18n 调用方式(`AppLocalizations.of(context).t('key')` 或等价)。

- [ ] **步骤 2：在 ListView 中插入卡片调用**

在 `_buildBody`(约第 224-259 行)的卡片调用序列中,`_githubCard(theme),`(第 236 行)之后、`_appearanceCard(...)` 之前插入:

```dart
          _webSearchCard(theme),
```

- [ ] **步骤 3：实现 _webSearchCard 方法**

在 `settings_screen.dart` 中(`_githubCard` 方法结束后、`_appearanceCard` 方法之前)新增方法。需在文件顶部补充 import:

```dart
import '../core/agent/web/web_search_provider.dart';
import '../core/agent/web/web_search_provider_factory.dart';
import '../core/agent/plugins/web_search_plugin.dart';
```

方法实现(使用 Consumer 监听 mobileConfigProvider,与现有卡片一致的主题变量):

```dart
  Widget _webSearchCard(ThemeData theme) {
    return Consumer(builder: (context, ref, _) {
      final config = ref.watch(mobileConfigProvider);
      final l10n = AppLocalizations.of(context);
      final providerType =
          WebSearchProviderFactory.parseType(config.searchProvider);
      final needsKey = providerType != WebSearchProviderType.jina;
      final keyController =
          TextEditingController(text: config.searchApiKey);
      final testing = ValueNotifier<bool>(false);
      final testResult = ValueNotifier<String?>(null);

      return Card(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.t('settings.webSearch.title'),
                  style: theme.textTheme.titleMedium),
              const SizedBox(height: 12),
              // Provider 下拉选择
              Text(l10n.t('settings.webSearch.provider'),
                  style: theme.textTheme.bodySmall),
              const SizedBox(height: 4),
              DropdownButtonFormField<WebSearchProviderType>(
                value: providerType,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                items: [
                  DropdownMenuItem(
                    value: WebSearchProviderType.jina,
                    child: Text(l10n.t('settings.webSearch.providerJina')),
                  ),
                  DropdownMenuItem(
                    value: WebSearchProviderType.tavily,
                    child: Text(l10n.t('settings.webSearch.providerTavily')),
                  ),
                  DropdownMenuItem(
                    value: WebSearchProviderType.brave,
                    child: Text(l10n.t('settings.webSearch.providerBrave')),
                  ),
                ],
                onChanged: (value) async {
                  if (value == null) return;
                  await ref.read(mobileConfigProvider.notifier).saveSearch(
                        provider: value.name,
                        apiKey: config.searchApiKey,
                      );
                },
              ),
              const SizedBox(height: 12),
              // API Key 输入框
              Text(l10n.t('settings.webSearch.apiKey'),
                  style: theme.textTheme.bodySmall),
              const SizedBox(height: 4),
              TextField(
                controller: keyController,
                decoration: InputDecoration(
                  border: const OutlineInputBorder(),
                  isDense: true,
                  hintText: needsKey
                      ? l10n.t('settings.webSearch.apiKeyHint.${providerType.name}')
                      : l10n.t('settings.webSearch.apiKeyHint.jina'),
                ),
                onChanged: (value) async {
                  await ref
                      .read(mobileConfigProvider.notifier)
                      .saveSearch(
                        provider: config.searchProvider,
                        apiKey: value,
                      );
                },
              ),
              const SizedBox(height: 8),
              // 提示文案
              Text(
                needsKey
                    ? l10n.t('settings.webSearch.apiKeyHint.${providerType.name}')
                    : l10n.t('settings.webSearch.apiKeyHint.jina'),
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              // 测试按钮
              ValueListenableBuilder<bool>(
                valueListenable: testing,
                builder: (_, busy, __) {
                  return ValueListenableBuilder<String?>(
                    valueListenable: testResult,
                    builder: (_, result, __) {
                      return Row(
                        children: [
                          FilledButton.tonal(
                            onPressed: busy
                                ? null
                                : () async {
                                    testing.value = true;
                                    testResult.value = null;
                                    try {
                                      final provider =
                                          WebSearchProviderFactory.create(
                                        providerType,
                                        apiKey: config.searchApiKey,
                                      );
                                      await provider.search(query: 'test');
                                      testResult.value =
                                          l10n.t('settings.webSearch.testSuccess');
                                    } catch (e) {
                                      testResult.value =
                                          l10n.t('settings.webSearch.testFailed',
                                              args: {'error': e.toString()});
                                    } finally {
                                      testing.value = false;
                                    }
                                  },
                            child: Text(l10n.t('settings.webSearch.test')),
                          ),
                          const SizedBox(width: 12),
                          if (result != null)
                            Flexible(
                              child: Text(
                                result,
                                style: theme.textTheme.bodySmall,
                              ),
                            ),
                        ],
                      );
                    },
                  );
                },
              ),
            ],
          ),
        ),
      );
    });
  }
```

> **注意:** 上述代码假设 i18n 的 `t()` 方法支持 `args` 命名参数用于插值(`{error}`)。若现有 `AppLocalizations.t` 签名不同,需对照 `lib/core/i18n/strings.dart` 的实际签名调整插值调用(例如 `t(key, {'error': ...})`)。实现前先阅读 `strings.dart` 确认签名。

- [ ] **步骤 4：验证静态分析**

运行：`cd mobile-app && flutter analyze lib/features/settings/settings_screen.dart`
预期：无错误。若 i18n `t()` 签名不符,按 `strings.dart` 实际签名修正。

- [ ] **步骤 5：验证编译**

运行：`cd mobile-app && flutter analyze`
预期：整个项目无错误

- [ ] **步骤 6：Commit**

```bash
git add mobile-app/lib/features/settings/settings_screen.dart
git commit -m "feat(mobile): 设置页新增联网搜索配置卡片"
```

---

### 任务 13：全量验证

**文件：** 无修改,仅验证

- [ ] **步骤 1：全量静态分析**

运行：`cd mobile-app && flutter analyze`
预期：`No issues found!`

- [ ] **步骤 2：全量测试**

运行：`cd mobile-app && flutter test`
预期：所有测试通过,包含新增的 web/ 与 plugins/ 测试

- [ ] **步骤 3：针对新模块的测试单独确认**

运行：`cd mobile-app && flutter test test/core/agent/web/ test/core/agent/plugins/web_search_plugin_test.dart test/core/agent/plugins/web_fetch_plugin_test.dart test/core/agent/command_classifier_test.dart`
预期：全部 PASS

- [ ] **步骤 4：手动运行验证(可选,需真机/模拟器)**

运行：`cd mobile-app && flutter run`
验证点：
1. 设置页出现「联网搜索」卡片,默认选中 Jina(免费)
2. 切换到 Tavily/Brave 时显示对应 Key 获取提示
3. 不填 Key 点「测试」→ Jina 成功,Tavily/Brave 报「请先配置 API Key」
4. 聊天中问「今天北京天气怎么样」→ Agent 调用 `web_search` 工具并基于结果回答
5. 工具调用卡片显示 `web_search` / `fetch_url`,无需权限确认(只读)

- [ ] **步骤 5：若验证全部通过,无需额外 commit(本任务无代码变更)**

---

## 自检结果

**1. 规格覆盖度：** 逐节核对规格
- §2 目标(web_search + fetch_url 双工具) → 任务 6 + 7 ✓
- §2 多 Provider 可切换 → 任务 2/3/4/5 ✓
- §2 默认 Jina 免 Key → 任务 2(requiresApiKey=false)+ 任务 9(默认 'jina') ✓
- §2 fetch_url 固定 Jina r.jina.ai → 任务 7 ✓
- §2 只读权限 → 任务 8(command_classifier) ✓
- §2 i18n → 任务 11 ✓
- §5.1 接口 → 任务 1 ✓
- §5.2 三个 Provider → 任务 2/3/4 ✓
- §5.3 Factory → 任务 5 ✓
- §5.4 WebSearchPlugin → 任务 6 ✓
- §5.5 WebFetchPlugin → 任务 7 ✓
- §5.6 MobileConfig 扩展 → 任务 9 ✓
- §5.7 command_classifier → 任务 8 ✓
- §5.8 local_agent_service 集成 → 任务 10 ✓
- §6 错误处理(超时/429/空结果/URL 校验/截断) → 任务 2-7 实现均覆盖 ✓
- §7 UI 卡片 → 任务 12 ✓
- §8 i18n 文案 → 任务 11 ✓
- §9 测试策略 → 任务 2-8 均含测试 ✓

**2. 占位符扫描：** 无 TODO/待定/"添加适当错误处理"等模糊表述。任务 12 步骤 3 的注释是对 i18n 签名的不确定提示,已要求实现前阅读 `strings.dart` 确认——这是可执行的明确动作,非占位符。

**3. 类型一致性：**
- `WebSearchProvider.search({query, maxResults, timeout})` 签名在任务 1 定义,任务 2/3/4/6 一致使用 ✓
- `WebSearchResult(title, url, snippet)` 字段在任务 1 定义,任务 2/3/4/6 一致 ✓
- `WebSearchProviderType.{jina, tavily, brave}` 枚举值在任务 1 定义,任务 5(factory)、任务 9(config 默认 'jina')、任务 12(UI)一致 ✓
- `WebSearchException(message, statusCode)` 在任务 1 定义,任务 2/3/4/6 一致捕获 ✓
- 工具名 `web_search` / `fetch_url` 在任务 6/7 定义,任务 8(classifier)一致 ✓

无遗漏,无类型不一致。
