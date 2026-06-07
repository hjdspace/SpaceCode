import 'package:flutter/material.dart';

class SpaceCodeTheme {
  static ThemeData light() => _buildTheme(_lightColors);
  static ThemeData dark() => _buildTheme(_darkColors);
  static ThemeData anthropic() => _buildTheme(_anthropicColors);
  static ThemeData anthropicDark() => _buildTheme(_anthropicDarkColors);

  static ThemeData fromSyncData(Map<String, dynamic> colors) {
    return _buildTheme(_colorsFromMap(colors));
  }

  static const _ColorSet _lightColors = _ColorSet(
    bgPrimary: Color(0xfff8f9fb),
    bgSecondary: Color(0xfff0f1f5),
    bgTertiary: Color(0xffe7e9ef),
    bgElevated: Color(0xffffffff),
    bgHover: Color(0xffe4e6ec),
    bgActive: Color(0xffdbdde5),
    textPrimary: Color(0xff18191f),
    textSecondary: Color(0xff44475a),
    textMuted: Color(0xff6e7191),
    accentPrimary: Color(0xff0d9488),
    accentSecondary: Color(0xff6366f1),
    accentTertiary: Color(0xff7c3aed),
    success: Color(0xff059669),
    warning: Color(0xffd97706),
    error: Color(0xffdc2626),
  );

  static const _ColorSet _darkColors = _ColorSet(
    bgPrimary: Color(0xff0d0d0d),
    bgSecondary: Color(0xff141414),
    bgTertiary: Color(0xff1a1a1a),
    bgElevated: Color(0xff1f1f1f),
    bgHover: Color(0xff262626),
    bgActive: Color(0xff2e2e2e),
    textPrimary: Color(0xfff5f5f5),
    textSecondary: Color(0xffa3a3a3),
    textMuted: Color(0xff737373),
    accentPrimary: Color(0xff3b82f6),
    accentSecondary: Color(0xff64748b),
    accentTertiary: Color(0xff8b5cf6),
    success: Color(0xff22c55e),
    warning: Color(0xfff59e0b),
    error: Color(0xffef4444),
  );

  static const _ColorSet _anthropicColors = _ColorSet(
    bgPrimary: Color(0xfffaf9f5),
    bgSecondary: Color(0xffefe9de),
    bgTertiary: Color(0xffe8e0d2),
    bgElevated: Color(0xfffaf9f5),
    bgHover: Color(0xffe5e0d5),
    bgActive: Color(0xffdcd6c8),
    textPrimary: Color(0xff141413),
    textSecondary: Color(0xff3d3d3a),
    textMuted: Color(0xff6c6a64),
    accentPrimary: Color(0xffcc785c),
    accentSecondary: Color(0xff5db8a6),
    accentTertiary: Color(0xffe8a55a),
    success: Color(0xff5db872),
    warning: Color(0xffd4a017),
    error: Color(0xffc64545),
  );

  static const _ColorSet _anthropicDarkColors = _ColorSet(
    bgPrimary: Color(0xff181715),
    bgSecondary: Color(0xff1c1b1a),
    bgTertiary: Color(0xff1f1e1b),
    bgElevated: Color(0xff252320),
    bgHover: Color(0xff2d2c29),
    bgActive: Color(0xff353332),
    textPrimary: Color(0xfffaf9f5),
    textSecondary: Color(0xffa09d96),
    textMuted: Color(0xff6c6a64),
    accentPrimary: Color(0xffcc785c),
    accentSecondary: Color(0xff5db8a6),
    accentTertiary: Color(0xffe8a55a),
    success: Color(0xff5db872),
    warning: Color(0xffd4a017),
    error: Color(0xffc64545),
  );

  static ThemeData _buildTheme(_ColorSet c) {
    final colorScheme = ColorScheme(
      brightness: c.textPrimary.computeLuminance() > 0.5 ? Brightness.dark : Brightness.light,
      primary: c.accentPrimary,
      onPrimary: c.bgElevated,
      secondary: c.accentSecondary,
      onSecondary: c.bgElevated,
      tertiary: c.accentTertiary,
      onTertiary: c.bgElevated,
      error: c.error,
      onError: c.bgElevated,
      surface: c.bgPrimary,
      onSurface: c.textPrimary,
      surfaceContainerHighest: c.bgActive,
    );

    return ThemeData(
      colorScheme: colorScheme,
      scaffoldBackgroundColor: c.bgPrimary,
      appBarTheme: AppBarTheme(
        backgroundColor: c.bgElevated,
        foregroundColor: c.textPrimary,
        elevation: 0,
      ),
      cardTheme: CardThemeData(
        color: c.bgElevated,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: c.textMuted.withValues(alpha: 0.1)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.bgSecondary,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }

  static _ColorSet _colorsFromMap(Map<String, dynamic> m) => _ColorSet(
    bgPrimary: _parseColor(m['bgPrimary']),
    bgSecondary: _parseColor(m['bgSecondary']),
    bgTertiary: _parseColor(m['bgTertiary']),
    bgElevated: _parseColor(m['bgElevated']),
    bgHover: _parseColor(m['bgHover']),
    bgActive: _parseColor(m['bgActive']),
    textPrimary: _parseColor(m['textPrimary']),
    textSecondary: _parseColor(m['textSecondary']),
    textMuted: _parseColor(m['textMuted']),
    accentPrimary: _parseColor(m['accentPrimary']),
    accentSecondary: _parseColor(m['accentSecondary']),
    accentTertiary: _parseColor(m['accentTertiary']),
    success: _parseColor(m['success']),
    warning: _parseColor(m['warning']),
    error: _parseColor(m['error']),
  );

  static Color _parseColor(dynamic value) {
    if (value == null) return const Color(0xff000000);
    final str = value.toString();
    if (str.startsWith('#') && str.length == 7) {
      return Color(int.parse(str.substring(1), radix: 16) + 0xff000000);
    }
    return const Color(0xff000000);
  }
}

class _ColorSet {
  final Color bgPrimary, bgSecondary, bgTertiary, bgElevated, bgHover, bgActive;
  final Color textPrimary, textSecondary, textMuted;
  final Color accentPrimary, accentSecondary, accentTertiary;
  final Color success, warning, error;

  const _ColorSet({
    required this.bgPrimary, required this.bgSecondary, required this.bgTertiary,
    required this.bgElevated, required this.bgHover, required this.bgActive,
    required this.textPrimary, required this.textSecondary, required this.textMuted,
    required this.accentPrimary, required this.accentSecondary, required this.accentTertiary,
    required this.success, required this.warning, required this.error,
  });
}
