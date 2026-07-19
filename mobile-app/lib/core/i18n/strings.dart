/// 轻量国际化方案。
///
/// 避免引入 flutter_localizations，自建 key-value 字符串表。
/// 语言选择由 MobileConfig.appLocale 控制（任务 11）。
class I18n {
  static AppLocale _locale = AppLocale.zh;
  static Map<String, String> _strings = const {};

  static AppLocale get locale => _locale;

  /// 初始化：加载指定 locale 的字符串表。
  static void init(AppLocale locale, Map<String, String> strings) {
    _locale = locale;
    _strings = strings;
  }

  /// 测试专用：直接注入字符串表。
  static void initForTest({
    required AppLocale locale,
    required Map<String, String> strings,
  }) {
    init(locale, strings);
  }

  /// 翻译 key，支持 {placeholder} 插值。
  ///
  /// 未找到 key 时返回 key 本身（便于发现遗漏）。
  static String t(String key, [Map<String, String>? args]) {
    final lookup = _strings[key];
    if (lookup == null) return key;
    if (args == null || args.isEmpty) return lookup;
    var value = lookup;
    for (final entry in args.entries) {
      value = value.replaceAll('{${entry.key}}', entry.value);
    }
    return value;
  }
}

enum AppLocale { zh, en }
