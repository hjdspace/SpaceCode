import 'package:flutter/material.dart';

class CodeTheme {
  final Color bg, fg, keyword, string, number, comment, function, builtin, attr, tag;

  const CodeTheme({
    required this.bg, required this.fg,
    required this.keyword, required this.string, required this.number,
    required this.comment, required this.function, required this.builtin,
    required this.attr, required this.tag,
  });

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
}
