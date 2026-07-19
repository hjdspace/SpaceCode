import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/config/mobile_config.dart';
import 'core/i18n/strings.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer();
  // 预加载手机 Agent 引擎配置，避免 chat 发送消息时读到默认空值
  final config = await container.read(mobileConfigProvider.notifier).load();
  await _initI18n(config.appLocale);
  runApp(UncontrolledProviderScope(
    container: container,
    child: const SpaceCodeApp(),
  ));
}

/// 加载指定 locale 的 JSON 字符串表到 I18n 静态类。
/// 加载失败时保持默认（key 本身），不阻断启动。
Future<void> _initI18n(String localeCode) async {
  final locale = localeCode == 'en' ? AppLocale.en : AppLocale.zh;
  final path = locale == AppLocale.en
      ? 'lib/core/i18n/locales/en.json'
      : 'lib/core/i18n/locales/zh.json';
  try {
    final json = await rootBundle.loadString(path);
    final decoded = jsonDecode(json) as Map<String, dynamic>;
    I18n.init(locale, decoded.map((k, v) => MapEntry(k, v.toString())));
  } catch (_) {
    // 加载失败保持默认（key 本身）
  }
}
