import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'theme_definitions.dart';
import 'code_theme.dart';

enum AppTheme { light, dark, anthropic, anthropicDark }

/// 主题状态：当前选中的 AppTheme + 对应的 ThemeData
///
/// 之前 currentTheme 是 ThemeNotifier 的普通字段，导致 currentThemeProvider
/// 永远返回初始值、UI 选中态不更新。改为元组纳入 state 后，setTheme 会自动触发重建。
class ThemeState {
  final AppTheme current;
  final ThemeData data;

  const ThemeState({required this.current, required this.data});
}

final themeProvider =
    StateNotifierProvider<ThemeNotifier, ThemeState>((ref) {
  return ThemeNotifier();
});

final codeThemeProvider = StateProvider<CodeTheme>((ref) => CodeTheme.dark);

/// 当前选中的 AppTheme（响应式）
final currentThemeProvider = Provider<AppTheme>((ref) {
  return ref.watch(themeProvider).current;
});

/// 持久化的 SharedPreferences key
const _kThemePrefKey = 'app_theme';

class ThemeNotifier extends StateNotifier<ThemeState> {
  ThemeNotifier()
      : super(ThemeState(
          current: AppTheme.anthropicDark,
          data: SpaceCodeTheme.anthropicDark(),
        )) {
    _loadFromPrefs();
  }

  /// 启动时从 SharedPreferences 异步读取持久化主题
  Future<void> _loadFromPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_kThemePrefKey);
      if (saved != null) {
        final parsed = _parseThemeName(saved);
        setTheme(parsed);
      }
    } catch (_) {
      // 读取失败保持默认值
    }
  }

  void setTheme(AppTheme theme) {
    final data = _themeDataOf(theme);
    state = ThemeState(current: theme, data: data);
    _persist(theme);
  }

  Future<void> _persist(AppTheme theme) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kThemePrefKey, theme.name);
    } catch (_) {
      // 持久化失败不应影响 UI
    }
  }

  ThemeData _themeDataOf(AppTheme theme) {
    switch (theme) {
      case AppTheme.light:
        return SpaceCodeTheme.light();
      case AppTheme.dark:
        return SpaceCodeTheme.dark();
      case AppTheme.anthropic:
        return SpaceCodeTheme.anthropic();
      case AppTheme.anthropicDark:
        return SpaceCodeTheme.anthropicDark();
    }
  }

  AppTheme _parseThemeName(String name) {
    switch (name) {
      case 'light':
        return AppTheme.light;
      case 'dark':
        return AppTheme.dark;
      case 'anthropic':
        return AppTheme.anthropic;
      case 'anthropicDark':
        return AppTheme.anthropicDark;
      default:
        return AppTheme.anthropicDark;
    }
  }

  void applyThemeSync(Map<String, dynamic> themeData) {
    final themeName = themeData['theme'] as String? ?? 'dark';
    final colors = themeData['colors'] as Map<String, dynamic>?;

    if (colors != null && colors.isNotEmpty) {
      // 桌面端推送的自定义颜色：保留当前 current 不变，仅替换 data
      state = ThemeState(
        current: state.current,
        data: SpaceCodeTheme.fromSyncData(colors),
      );
    } else {
      final theme = _parseThemeName(themeName);
      setTheme(theme);
    }
  }
}
