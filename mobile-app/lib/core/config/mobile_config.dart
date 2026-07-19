import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MobileConfig {
  final String apiKey;
  final String baseUrl;
  final String model;
  final String githubToken;
  final String githubLogin;

  const MobileConfig({
    this.apiKey = '',
    this.baseUrl = 'https://api.openai.com/v1',
    this.model = 'gpt-4o-mini',
    this.githubToken = '',
    this.githubLogin = '',
  });

  MobileConfig copyWith({
    String? apiKey,
    String? baseUrl,
    String? model,
    String? githubToken,
    String? githubLogin,
  }) =>
      MobileConfig(
        apiKey: apiKey ?? this.apiKey,
        baseUrl: baseUrl ?? this.baseUrl,
        model: model ?? this.model,
        githubToken: githubToken ?? this.githubToken,
        githubLogin: githubLogin ?? this.githubLogin,
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
}
