import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import '../../../core/theme/code_theme.dart';

class CodeBlock extends StatelessWidget {
  final String code;
  final String? language;

  /// 可选的代码主题。未传入时按 [CodeTheme.of] 自动匹配当前应用主题。
  final CodeTheme? codeTheme;

  /// 内容区最大高度。默认 400，传 [double.infinity] 表示不限制。
  final double maxHeight;

  /// 是否显示头部工具栏（语言标签 + 复制按钮）。默认 true。
  final bool showHeader;

  const CodeBlock({
    super.key,
    required this.code,
    this.language,
    this.codeTheme,
    this.maxHeight = 400,
    this.showHeader = true,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ct = codeTheme ?? CodeTheme.of(context);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: ct.bg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (showHeader)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: ct.bg.withValues(alpha: 0.8),
                border: Border(
                  bottom: BorderSide(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
                  ),
                ),
              ),
              child: Row(
                children: [
                  Text(
                    language ?? 'code',
                    style: TextStyle(
                      color: ct.fg.withValues(alpha: 0.5),
                      fontSize: 12,
                      fontFamily: 'monospace',
                    ),
                  ),
                  const Spacer(),
                  InkWell(
                    onTap: () {
                      Clipboard.setData(ClipboardData(text: code));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: const Text('已复制到剪贴板'),
                          duration: const Duration(seconds: 1),
                          backgroundColor: theme.colorScheme.primary,
                        ),
                      );
                    },
                    borderRadius: BorderRadius.circular(4),
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.copy_rounded,
                            size: 14,
                            color: ct.fg.withValues(alpha: 0.5),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '复制',
                            style: TextStyle(
                              color: ct.fg.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: maxHeight),
            child: SingleChildScrollView(
              scrollDirection: Axis.vertical,
              padding: const EdgeInsets.all(12),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: HighlightView(
                  code.trim(),
                  language: language ?? 'plaintext',
                  theme: ct.toHighlightMap,
                  textStyle: const TextStyle(
                    fontSize: 13,
                    fontFamily: 'monospace',
                    height: 1.5,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
