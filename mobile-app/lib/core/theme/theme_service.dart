import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'theme_definitions.dart';
import 'code_theme.dart';

enum AppTheme { light, dark, anthropic, anthropicDark }

final themeProvider = StateNotifierProvider<ThemeNotifier, ThemeData>((ref) {
  return ThemeNotifier();
});

final codeThemeProvider = StateProvider<CodeTheme>((ref) => CodeTheme.dark);

final currentThemeProvider = Provider<AppTheme>((ref) {
  final notifier = ref.watch(themeProvider.notifier);
  return notifier.currentTheme;
});

class ThemeNotifier extends StateNotifier<ThemeData> {
  AppTheme currentTheme = AppTheme.anthropicDark;

  ThemeNotifier() : super(SpaceCodeTheme.anthropicDark());

  void setTheme(AppTheme theme) {
    currentTheme = theme;
    switch (theme) {
      case AppTheme.light:
        state = SpaceCodeTheme.light();
        break;
      case AppTheme.dark:
        state = SpaceCodeTheme.dark();
        break;
      case AppTheme.anthropic:
        state = SpaceCodeTheme.anthropic();
        break;
      case AppTheme.anthropicDark:
        state = SpaceCodeTheme.anthropicDark();
        break;
    }
  }

  void applyThemeSync(Map<String, dynamic> themeData) {
    final themeName = themeData['theme'] as String? ?? 'dark';
    final colors = themeData['colors'] as Map<String, dynamic>?;

    if (colors != null && colors.isNotEmpty) {
      state = SpaceCodeTheme.fromSyncData(colors);
    } else {
      switch (themeName) {
        case 'light':
          currentTheme = AppTheme.light;
          state = SpaceCodeTheme.light();
          break;
        case 'dark':
          currentTheme = AppTheme.dark;
          state = SpaceCodeTheme.dark();
          break;
        case 'anthropic':
          currentTheme = AppTheme.anthropic;
          state = SpaceCodeTheme.anthropic();
          break;
        case 'anthropic-dark':
          currentTheme = AppTheme.anthropicDark;
          state = SpaceCodeTheme.anthropicDark();
          break;
        default:
          currentTheme = AppTheme.dark;
          state = SpaceCodeTheme.dark();
      }
    }
  }
}
