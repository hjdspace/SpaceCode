import 'package:flutter/material.dart';

class CodeTheme {
  final Color bg, fg, keyword, string, number, comment, function, builtin, attr, tag;

  const CodeTheme({
    required this.bg, required this.fg,
    required this.keyword, required this.string, required this.number,
    required this.comment, required this.function, required this.builtin,
    required this.attr, required this.tag,
  });

  /// 转换为 `flutter_highlight` 所需的 theme map。
  ///
  /// key 对应 highlight.js 的 CSS class（如 'root'、'keyword'、'string'），
  /// value 是该 class 的文本样式。背景色由 'root' 承载。
  Map<String, TextStyle> get toHighlightMap => {
        'root': TextStyle(
          backgroundColor: bg,
          color: fg,
          fontFamily: 'monospace',
          fontSize: 13,
          height: 1.5,
        ),
        'keyword': TextStyle(color: keyword, fontWeight: FontWeight.w600),
        'literal': TextStyle(color: number),
        'symbol': TextStyle(color: keyword),
        'bullet': TextStyle(color: number),
        'section': TextStyle(color: function, fontWeight: FontWeight.w600),
        'title': TextStyle(color: function, fontWeight: FontWeight.w600),
        'title.function': TextStyle(color: function, fontWeight: FontWeight.w600),
        'title.class': TextStyle(color: function, fontWeight: FontWeight.w600),
        'string': TextStyle(color: string),
        'string.escape': TextStyle(color: string),
        'number': TextStyle(color: number),
        'comment': TextStyle(color: comment, fontStyle: FontStyle.italic),
        'function': TextStyle(color: function),
        'built_in': TextStyle(color: builtin),
        'attr': TextStyle(color: attr),
        'tag': TextStyle(color: tag),
        'meta': TextStyle(color: comment),
        'variable': TextStyle(color: fg),
        'params': TextStyle(color: fg),
        'type': TextStyle(color: builtin),
        'operator': TextStyle(color: keyword),
        'property': TextStyle(color: attr),
        'punctuation': TextStyle(color: fg),
        'regexp': TextStyle(color: string),
        'selector': TextStyle(color: attr),
        'class': TextStyle(color: function),
        'doctag': TextStyle(color: comment),
        'name': TextStyle(color: tag),
        'strong': const TextStyle(fontWeight: FontWeight.bold),
        'emphasis': const TextStyle(fontStyle: FontStyle.italic),
      };

  static const light = CodeTheme(
    bg: Color(0xffeef0f5), fg: Color(0xff18191f),
    keyword: Color(0xffbe123c), string: Color(0xff1e40af), number: Color(0xff7c3aed),
    comment: Color(0xff6e7191), function: Color(0xff0d9488), builtin: Color(0xff0d9488),
    attr: Color(0xff6366f1), tag: Color(0xff059669),
  );

  static const dark = CodeTheme(
    bg: Color(0xff0d1117), fg: Color(0xffc9d1d9),
    keyword: Color(0xffff7b72), string: Color(0xffa5d6ff), number: Color(0xff79c0ff),
    comment: Color(0xff8b949e), function: Color(0xffd2a8ff), builtin: Color(0xffffa657),
    attr: Color(0xff79c0ff), tag: Color(0xff7ee787),
  );

  static const anthropic = CodeTheme(
    bg: Color(0xfff0ede4), fg: Color(0xff2d2a24),
    keyword: Color(0xffc44e3f), string: Color(0xff5db872), number: Color(0xffe8a55a),
    comment: Color(0xff8e8b82), function: Color(0xff5db8a6), builtin: Color(0xffcc785c),
    attr: Color(0xff5db8a6), tag: Color(0xff5db872),
  );

  static const anthropicDark = CodeTheme(
    bg: Color(0xff1a1918), fg: Color(0xfffaf9f5),
    keyword: Color(0xffe08870), string: Color(0xff7dce94), number: Color(0xfff0b56a),
    comment: Color(0xff6c6a64), function: Color(0xff7dccbe), builtin: Color(0xffdd8a6e),
    attr: Color(0xff7dccbe), tag: Color(0xff7dce94),
  );

  static CodeTheme fromMap(Map<String, dynamic> m) => CodeTheme(
    bg: _parseColor(m['bg']), fg: _parseColor(m['fg']),
    keyword: _parseColor(m['keyword']), string: _parseColor(m['string']),
    number: _parseColor(m['number']), comment: _parseColor(m['comment']),
    function: _parseColor(m['function']), builtin: _parseColor(m['builtin']),
    attr: _parseColor(m['attr']), tag: _parseColor(m['tag']),
  );

  static Color _parseColor(dynamic value) {
    if (value == null) return const Color(0xff000000);
    final str = value.toString();
    if (str.startsWith('#') && str.length == 7) {
      return Color(int.parse(str.substring(1), radix: 16) + 0xff000000);
    }
    return const Color(0xff000000);
  }

  /// 根据当前 [BuildContext] 的 scaffoldBackgroundColor 精确匹配 4 套主题。
  /// 无法匹配时按 Brightness 回退到 light / dark。
  static CodeTheme of(BuildContext context) {
    final bgColor = Theme.of(context).scaffoldBackgroundColor;
    if (bgColor == const Color(0xfffaf9f5)) return CodeTheme.anthropic;
    if (bgColor == const Color(0xff181715)) return CodeTheme.anthropicDark;
    if (bgColor == const Color(0xff0d0d0d)) return CodeTheme.dark;
    if (bgColor == const Color(0xfff8f9fb)) return CodeTheme.light;
    // 自定义主题颜色：按亮度回退
    return Theme.of(context).brightness == Brightness.dark
        ? CodeTheme.dark
        : CodeTheme.light;
  }
}
