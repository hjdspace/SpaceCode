# 手机端 AI Agent 联网搜索设计

> 日期: 2026-07-23
> 范围: `mobile-app/`

## 1. 背景与问题

当前手机 app 的 AI Agent([local_agent_service.dart](file:///d:/AI/SpaceCode/mobile-app/lib/core/agent/local_agent_service.dart))基于 Plugin 模式,已具备 Workspace / Shell / Git / Python / Skill 五类工具,但**没有联网能力**。LLM 只能依赖训练数据回答问题,无法获取实时信息(天气、新闻、最新文档、股价等),也无法主动检索网络以验证事实。

用户希望 Agent 能在手机端联网搜索,突破训练数据时效性限制。

## 2. 目标

- **两个核心工具**:为 Agent 提供 `web_search`(关键词搜索,返回标题+摘要+URL)与 `fetch_url`(抓取指定网页全文转 Markdown)工具
- **多 Provider 可切换**:支持 Tavily / Brave / Jina 三种搜索后端,用户在设置页选择并填对应 API Key
- **开箱即用**:默认 Jina provider,免 API Key 即可用(有速率限制),降低首次使用门槛
- **统一抓取**:`fetch_url` 固定走 Jina r.jina.ai(免费免 Key),对所有 provider 通用
- **只读权限**:搜索与抓取均为只读操作,归为 `DangerLevel.read`,无需用户确认
- **i18n**:所有可见文案经 Flutter i18n `t()` 函数处理(中英双语,文案写入 `lib/core/i18n/locales/zh.json` / `en.json`)

## 3. 用户决策记录

| # | 问题 | 决策 |
|---|------|------|
| 1 | 搜索方案选择 | 多 Provider 可切换(Tavily / Brave / Jina) |
| 2 | 工具范围 | 搜索 + 网页抓取(`web_search` + `fetch_url`) |
| 3 | 架构方案 | 方案 C:抽象 `WebSearchProvider` 接口 + 单个 `WebSearchPlugin` 持有 provider 实例 |
| 4 | 默认 provider | Jina(免 Key 开箱即用),用户可在设置切换 |
| 5 | `fetch_url` 实现 | 统一用 Jina r.jina.ai,独立于 search provider |
| 6 | 权限等级 | `web_search` / `fetch_url` 均为 `DangerLevel.read` |

## 4. 架构总览

### 4.1 模块清单

**新增**
- `lib/core/agent/web/web_search_provider.dart` — `WebSearchProvider` 抽象接口 + `WebSearchResult` 数据类 + `WebSearchProviderType` 枚举
- `lib/core/agent/web/tavily_provider.dart` — Tavily 实现(POST `https://api.tavily.com/search`)
- `lib/core/agent/web/brave_provider.dart` — Brave 实现(GET `https://api.search.brave.com/res/v1/web/search`)
- `lib/core/agent/web/jina_provider.dart` — Jina 实现(GET `https://s.jina.ai/<query>`)
- `lib/core/agent/web/web_search_provider_factory.dart` — 根据 provider 类型 + apiKey 构建实例
- `lib/core/agent/plugins/web_search_plugin.dart` — `WebSearchPlugin`,持有 `WebSearchProvider`,提供 `web_search` 工具
- `lib/core/agent/plugins/web_fetch_plugin.dart` — `WebFetchPlugin`,提供 `fetch_url` 工具,固定调用 Jina r.jina.ai

**改造**
- `lib/core/agent/local_agent_service.dart` — `complete()` 内根据 `config.searchProvider` / `config.searchApiKey` 构建 `WebSearchProvider` 并注册 `WebSearchPlugin` + `WebFetchPlugin`
- `lib/core/config/mobile_config.dart` — `MobileConfig` 扩展 `searchProvider` / `searchApiKey` 字段 + 持久化
- `lib/core/agent/command_classifier.dart` — `_toolDangerTable` 增加 `web_search` / `fetch_url` → `DangerLevel.read`
- `lib/features/settings/settings_screen.dart` — 新增「联网搜索」配置卡片(provider 选择 + API Key 输入)
- `lib/core/i18n/locales/zh.json` / `en.json` — 新增联网搜索相关文案

### 4.2 数据流

```
用户提问(需实时信息)
  → AgentSession 调用 LLM
  → LLM 决定调用 web_search(query)
  → PermissionInterceptorPlugin.beforeToolCall → DangerLevel.read → allow
  → WebSearchPlugin.execute
     → WebSearchProvider.search(query)
        → HTTP 请求(Tavily/Brave/Jina 之一)
        → 解析响应为 List<WebSearchResult>
     → JSON 格式化返回给 LLM
  → LLM 若需全文 → 调用 fetch_url(url)
  → WebFetchPlugin.execute
     → GET https://r.jina.ai/<url>
     → 截断为 max_chars 返回 Markdown
  → LLM 综合搜索结果 + 全文生成最终回答
```

## 5. 详细设计

### 5.1 WebSearchProvider 接口

```dart
// lib/core/agent/web/web_search_provider.dart

enum WebSearchProviderType { jina, tavily, brave }

class WebSearchResult {
  final String title;
  final String url;
  final String snippet;
  const WebSearchResult({
    required this.title,
    required this.url,
    required this.snippet,
  });
}

abstract class WebSearchProvider {
  WebSearchProviderType get type;
  String get displayName;       // i18n key 解析后的显示名
  bool get requiresApiKey;      // Jina=false, Tavily/Brave=true
  Future<List<WebSearchResult>> search({
    required String query,
    int maxResults = 5,
    Duration timeout = const Duration(seconds: 30),
  });
}
```

### 5.2 三个 Provider 实现

**JinaProvider**(默认,免 Key):
- `GET https://s.jina.ai/<query>`,header `Accept: application/json`
- 可选 `Authorization: Bearer <key>`(有 key 时速率从 5 RPM 提升到 40 RPM)
- 响应 JSON:`{ data: [ { title, url, content } ] }`,`content` 映射为 `snippet`
- `requiresApiKey = false`

**TavilyProvider**:
- `POST https://api.tavily.com/search`,header `Authorization: Bearer <apiKey>`
- body: `{ "query": <q>, "max_results": 5, "search_depth": "basic" }`
- 响应:`{ results: [ { title, url, content } ] }`
- `requiresApiKey = true`,无 key 时 `search()` 抛 `StateError('请先在设置中配置 Tavily API Key')`

**BraveProvider**:
- `GET https://api.search.brave.com/res/v1/web/search?q=<q>&count=5`,header `X-Subscription-Token: <apiKey>`
- 响应:`{ web: { results: [ { title, url, description } ] } }`,`description` 映射为 `snippet`
- `requiresApiKey = true`,无 key 时抛 `StateError`

### 5.3 WebSearchProviderFactory

```dart
class WebSearchProviderFactory {
  static WebSearchProvider create(
    WebSearchProviderType type, {
    String? apiKey,
    http.Client? client,
  }) {
    switch (type) {
      case WebSearchProviderType.jina:
        return JinaProvider(apiKey: apiKey, client: client ?? http.Client());
      case WebSearchProviderType.tavily:
        return TavilyProvider(apiKey: apiKey ?? '', client: client ?? http.Client());
      case WebSearchProviderType.brave:
        return BraveProvider(apiKey: apiKey ?? '', client: client ?? http.Client());
    }
  }
}
```

### 5.4 WebSearchPlugin

```dart
class WebSearchPlugin extends AgentPlugin {
  final WebSearchProvider provider;
  WebSearchPlugin(this.provider);

  @override
  List<AgentTool> createTools() => [_WebSearchTool(this)];
}

class _WebSearchTool extends AgentTool {
  // name: 'web_search'
  // description: '搜索互联网获取实时信息(新闻、天气、最新文档等)。
  //               当问题涉及训练数据之后的事件或需要最新信息时使用。
  //               返回标题、摘要和 URL。'
  // inputSchema: { query: string (required), max_results: int (default 5) }
  // 执行: provider.search() → JSON 数组
  // 每条 snippet 截断到 1000 字符,总结果数受 max_results 限制(1-10)
}
```

工具返回格式:
```json
{
  "results": [
    { "title": "...", "url": "...", "snippet": "..." }
  ],
  "count": 3,
  "provider": "jina"
}
```

### 5.5 WebFetchPlugin

```dart
class WebFetchPlugin extends AgentPlugin {
  // 固定调用 https://r.jina.ai/<url>
  // name: 'fetch_url'
  // description: '抓取指定网页全文并转为 Markdown。
  //               当需要阅读 web_search 返回的某个 URL 的完整内容时使用。
  //               不执行 JS,适合静态文章/文档/博客。'
  // inputSchema: { url: string (required), max_chars: int (default 20000) }
  // 执行: GET r.jina.ai/<url>,header Accept: application/json
  // 响应 JSON: { data: { content } }
  // content 截断到 max_chars(范围 1000-50000)
}
```

工具返回格式:
```json
{
  "url": "...",
  "content": "...(markdown,截断后)",
  "truncated": false,
  "chars": 12345
}
```

### 5.6 配置存储(MobileConfig 扩展)

[mobile_config.dart](file:///d:/AI/SpaceCode/mobile-app/lib/core/config/mobile_config.dart) 扩展:

```dart
class MobileConfig {
  // 现有字段...
  final String searchProvider;   // 'jina' | 'tavily' | 'brave',默认 'jina'
  final String searchApiKey;     // 搜索 provider 的 API Key,Jina 可空
}

// SharedPreferences keys:
// mobile_search_provider (默认 'jina')
// mobile_search_api_key (默认 '')
```

`MobileConfigNotifier` 新增 `saveSearch({provider, apiKey})` 方法,实时持久化。provider 切换即时生效——下次 `complete()` 调用构建 plugins 时读取最新 config。

### 5.7 命令分类

[command_classifier.dart](file:///d:/AI/SpaceCode/mobile-app/lib/core/agent/command_classifier.dart) 的 `_toolDangerTable` 增加:

```dart
'web_search': DangerLevel.read,
'fetch_url': DangerLevel.read,
```

两个工具在所有权限模式下(default/plan/acceptEdits/bypassPermissions)均直接放行,无需用户确认。

### 5.8 集成点(local_agent_service.dart)

`complete()` 内构建 plugins 时:

```dart
final plugins = <AgentPlugin>[
  PermissionInterceptorPlugin(),
  if (localPath != null) WorkspacePlugin(localPath),
  if (localPath != null) ShellPlugin(...),
  if (localPath != null && gitPath != null) GitPlugin(...),
  if (pythonReady) PythonPlugin(),
  if (skillRegistry != null && skillRegistry.skills.isNotEmpty) SkillPlugin(...),
  // 新增:联网搜索(无 workspace 依赖,始终加载)
  WebSearchPlugin(
    WebSearchProviderFactory.create(
      _parseProviderType(config.searchProvider),
      apiKey: config.searchApiKey,
    ),
  ),
  WebFetchPlugin(),
];
```

联网工具不依赖 workspace,始终注册,确保无工作区时 Agent 仍能联网。

## 6. 错误处理与限制

| 场景 | 处理 |
|------|------|
| 网络超时 | 默认 30s,超时返回 `isError: true` + `"搜索超时"` |
| API Key 缺失(Tavily/Brave) | `search()` 抛 `StateError`,工具捕获返回 `isError: true` + 提示去设置配置 |
| HTTP 429 速率限制 | 返回 `isError: true` + `"请求过于频繁,请稍后重试或配置 API Key 提升额度"` |
| HTTP 其他错误 | 返回 `isError: true` + 状态码 + 响应体摘要(截断 500 字符) |
| 搜索结果为空 | 返回空 `results` 数组 + `count: 0`,非错误 |
| `fetch_url` URL 无效 | 参数校验,返回 `isError: true` + `"URL 格式无效"` |
| `fetch_url` 内容过长 | 按 `max_chars` 截断,置 `truncated: true` |
| `web_search` query 为空 | 参数校验,返回 `isError: true` |

**截断策略**(参考 `ShellPlugin._maxFieldBytes`):
- `web_search` 每条 snippet ≤ 1000 字符
- `fetch_url` content ≤ `max_chars`(默认 20000,范围 1000-50000)
- `max_results` 范围 1-10,默认 5

## 7. UI 设计(settings_screen.dart)

在设置页新增「联网搜索」卡片:

- **Provider 选择**:下拉菜单(Jina / Tavily / Brave),默认 Jina
- **API Key 输入框**:
  - Jina 选中时显示提示「Jina 免费免 Key 可用,配置 Key 可提升速率限额」,输入框可选(灰色)
  - Tavily / Brave 选中时输入框必填,显示对应获取 Key 的说明
- **实时持久化**:provider 切换或 Key 输入失焦时立即保存到 SharedPreferences
- **测试按钮**:点击后用当前配置发一次 `web_search("test")`,成功显示「配置有效」,失败显示错误信息。用于验证 API Key 是否有效、provider 是否可达

UI 元素使用主题变量(`--bg-primary` 等价的 Flutter theme),文案全部走 i18n。

## 8. i18n 文案

`zh.json` / `en.json` 新增 key:

| key | zh | en |
|-----|----|----|
| `settings.webSearch.title` | 联网搜索 | Web Search |
| `settings.webSearch.provider` | 搜索引擎 | Search Provider |
| `settings.webSearch.apiKey` | API Key | API Key |
| `settings.webSearch.apiKeyHint.jina` | Jina 免费免 Key 可用,配置 Key 可提升速率限额 | Jina works without a key; adding one raises rate limits |
| `settings.webSearch.apiKeyHint.tavily` | 在 tavily.com 注册获取 | Get it from tavily.com |
| `settings.webSearch.apiKeyHint.brave` | 在 brave.com/search/api 获取 | Get it from brave.com/search/api |
| `settings.webSearch.test` | 测试 | Test |
| `settings.webSearch.testSuccess` | 配置有效 | Configuration valid |
| `settings.webSearch.testFailed` | 配置无效:{error} | Invalid: {error} |

## 9. 测试策略

### 9.1 Provider 单测(注入 mock http.Client)
- `tavily_provider_test.dart`:验证 POST 请求构造、header、body;验证响应解析为 `WebSearchResult`;验证无 key 抛错
- `brave_provider_test.dart`:验证 GET 请求 URL + header;验证响应解析;验证无 key 抛错
- `jina_provider_test.dart`:验证无 key 可用;验证有 key 时 header 注入;验证 JSON 响应解析

### 9.2 Plugin 单测(注入 mock provider)
- `web_search_plugin_test.dart`:
  - 工具定义(name/description/schema)正确
  - 正常搜索返回 JSON 数组
  - snippet 截断到 1000 字符
  - max_results 范围限制
  - 空结果返回 `count: 0`
  - provider 抛错时返回 `isError: true`
- `web_fetch_plugin_test.dart`:
  - 工具定义正确
  - 正常抓取返回 content + truncated
  - max_chars 截断
  - URL 无效返回错误
  - r.jina.ai 请求构造正确

### 9.3 集成测试
- `command_classifier_test.dart`:新增 `web_search` / `fetch_url` 归为 `read` 的断言
- `mobile_config_test.dart`(若不存在则新增):`searchProvider` / `searchApiKey` 持久化往返

## 10. 非目标(YAGNI)

- 不实现浏览器自动化(如 Puppeteer/Playwright 等价的 JS 渲染抓取)——`fetch_url` 仅静态抓取
- 不实现搜索结果缓存——每次实时搜索
- 不实现多 provider 并行搜索——单 provider 一次搜索
- 不实现搜索结果重排序/相关性打分——直接透传 provider 返回顺序
- 不为 `fetch_url` 支持 POST/登录/Cookie——只读 GET
- 不实现桌面端联动——本特性仅手机端

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Jina 免费档速率低(5 RPM) | UI 提示,引导用户配置 Key 或切换 Tavily/Brave |
| 手机网络不稳定 | 30s 超时 + 错误友好提示,Agent 可重试 |
| `fetch_url` 抓取动态页面内容不全 | 工具描述明确说明「不执行 JS」,引导 Agent 选静态页面 |
| API Key 明文存储 | 与现有 `apiKey`/`githubToken` 一致,存 SharedPreferences;后续可升级到 flutter_secure_storage(非本范围) |
