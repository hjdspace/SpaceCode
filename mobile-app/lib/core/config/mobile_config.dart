import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MobileConfig {
  final String apiKey;
  final String baseUrl;
  final String model;
  final String githubToken;
  final String githubLogin;
  final String appLocale;
  final String searchProvider;
  final String searchApiKey;

  const MobileConfig({
    this.apiKey = '',
    this.baseUrl = 'https://api.openai.com/v1',
    this.model = 'gpt-4o-mini',
    this.githubToken = '',
    this.githubLogin = '',
    this.appLocale = 'zh',
    this.searchProvider = 'jina',
    this.searchApiKey = '',
  });

  MobileConfig copyWith({
    String? apiKey,
    String? baseUrl,
    String? model,
    String? githubToken,
    String? githubLogin,
    String? appLocale,
    String? searchProvider,
    String? searchApiKey,
  }) =>
      MobileConfig(
        apiKey: apiKey ?? this.apiKey,
        baseUrl: baseUrl ?? this.baseUrl,
        model: model ?? this.model,
        githubToken: githubToken ?? this.githubToken,
        githubLogin: githubLogin ?? this.githubLogin,
        appLocale: appLocale ?? this.appLocale,
        searchProvider: searchProvider ?? this.searchProvider,
        searchApiKey: searchApiKey ?? this.searchApiKey,
      );
}

final mobileConfigProvider =
    StateNotifierProvider<MobileConfigNotifier, MobileConfig>(
  (ref) => MobileConfigNotifier(),
);

class MobileConfigNotifier extends StateNotifier<MobileConfig> {
  static const _apiKey = 'mobile_engine_api_key';
  static const _baseUrl = 'mobile_engine_base_url';
  static const _model = 'mobile_engine_model';
  static const _githubToken = 'mobile_github_token';
  static const _githubLogin = 'mobile_github_login';
  static const _appLocale = 'mobile_app_locale';
  static const _searchProvider = 'mobile_search_provider';
  static const _searchApiKey = 'mobile_search_api_key';

  MobileConfigNotifier() : super(const MobileConfig()) {
    load();
  }

  Future<MobileConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    state = MobileConfig(
      apiKey: prefs.getString(_apiKey) ?? '',
      baseUrl: prefs.getString(_baseUrl) ?? 'https://api.openai.com/v1',
      model: prefs.getString(_model) ?? 'gpt-4o-mini',
      githubToken: prefs.getString(_githubToken) ?? '',
      githubLogin: prefs.getString(_githubLogin) ?? '',
      appLocale: prefs.getString(_appLocale) ?? 'zh',
    );
    return state;
  }

  Future<void> save({
    required String apiKey,
    required String baseUrl,
    required String model,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final normalizedBaseUrl = baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    await prefs.setString(_apiKey, apiKey.trim());
    await prefs.setString(_baseUrl, normalizedBaseUrl);
    await prefs.setString(_model, model.trim());
    state = state.copyWith(
      apiKey: apiKey.trim(),
      baseUrl: normalizedBaseUrl,
      model: model.trim(),
    );
  }

  Future<void> saveGithub(
      {required String token, required String login}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_githubToken, token.trim());
    await prefs.setString(_githubLogin, login.trim());
    state =
        state.copyWith(githubToken: token.trim(), githubLogin: login.trim());
  }

  Future<void> clearGithub() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_githubToken);
    await prefs.remove(_githubLogin);
    state = state.copyWith(githubToken: '', githubLogin: '');
  }

  Future<void> saveModel(String model) async {
    final prefs = await SharedPreferences.getInstance();
    final trimmedModel = model.trim();
    await prefs.setString(_model, trimmedModel);
    state = state.copyWith(model: trimmedModel);
  }

  Future<void> saveLocale(String locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_appLocale, locale);
    state = state.copyWith(appLocale: locale);
  }

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
}
