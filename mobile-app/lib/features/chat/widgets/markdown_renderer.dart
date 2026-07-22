import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;
import 'code_block.dart';

class MarkdownRenderer extends StatefulWidget {
  final String content;
  final bool isStreaming;

  const MarkdownRenderer({
    super.key,
    required this.content,
    this.isStreaming = false,
  });

  @override
  State<MarkdownRenderer> createState() => _MarkdownRendererState();
}

class _MarkdownRendererState extends State<MarkdownRenderer>
    with SingleTickerProviderStateMixin {
  late AnimationController _cursorController;

  @override
  void initState() {
    super.initState();
    _cursorController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 530),
    );
    if (widget.isStreaming) {
      _cursorController.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(MarkdownRenderer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isStreaming && !oldWidget.isStreaming) {
      _cursorController.repeat(reverse: true);
    } else if (!widget.isStreaming && oldWidget.isStreaming) {
      _cursorController.stop();
    }
  }

  @override
  void dispose() {
    _cursorController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // RepaintBoundary 隔离 markdown 重绘，避免光标动画触发整树 paint
        RepaintBoundary(
          child: MarkdownBody(
            data: widget.content,
            selectable: true,
            styleSheet: MarkdownStyleSheet(
              p: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: 15,
                height: 1.6,
              ),
              h1: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: 22,
                fontWeight: FontWeight.w700,
                height: 1.4,
              ),
              h2: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: 20,
                fontWeight: FontWeight.w600,
                height: 1.4,
              ),
              h3: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: 18,
                fontWeight: FontWeight.w600,
                height: 1.4,
              ),
              h4: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: 16,
                fontWeight: FontWeight.w600,
                height: 1.4,
              ),
              code: TextStyle(
                color: theme.colorScheme.primary,
                fontSize: 13,
                fontFamily: 'monospace',
                backgroundColor: theme.colorScheme.surface,
              ),
              em: TextStyle(
                color: theme.colorScheme.onSurface,
                fontStyle: FontStyle.italic,
              ),
              strong: TextStyle(
                color: theme.colorScheme.onSurface,
                fontWeight: FontWeight.w700,
              ),
              blockquote: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                fontSize: 14,
                fontStyle: FontStyle.italic,
              ),
              blockquoteDecoration: BoxDecoration(
                color: theme.colorScheme.surface,
                borderRadius: BorderRadius.circular(4),
                border: Border(
                  left: BorderSide(
                    color: theme.colorScheme.primary,
                    width: 3,
                  ),
                ),
              ),
              listBullet: TextStyle(
                color: theme.colorScheme.primary,
                fontSize: 15,
              ),
              tableHead: TextStyle(
                color: theme.colorScheme.onSurface,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
              tableBody: TextStyle(
                color: theme.colorScheme.onSurface,
                fontSize: 14,
              ),
              a: TextStyle(
                color: theme.colorScheme.primary,
                decoration: TextDecoration.underline,
              ),
            ),
            builders: {
              'pre': _PreBlockBuilder(),
            },
          ),
        ),
        // 流式输出时在内容末尾显示闪烁光标
        if (widget.isStreaming)
          FadeTransition(
            opacity: _cursorController,
            child: Text(
              '▌',
              style: TextStyle(
                color: theme.colorScheme.primary,
                fontSize: 15,
                height: 1.6,
              ),
            ),
          ),
      ],
    );
  }
}

class _PreBlockBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final codeChild = element.children?.firstWhere(
      (c) => c is md.Element && c.tag == 'code',
      orElse: () => md.Text(''),
    );

    if (codeChild is md.Element) {
      final code = codeChild.textContent;
      final language = codeChild.attributes['class']?.replaceFirst('language-', '');
      return CodeBlock(
        code: code,
        language: language,
      );
    }

    return CodeBlock(
      code: element.textContent,
      language: null,
    );
  }
}
