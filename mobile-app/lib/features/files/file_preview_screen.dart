import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;

import '../../core/config/mobile_config.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/code_theme.dart';
import '../../core/workspace/file_explorer_service.dart';
import '../../core/workspace/workspace_target.dart';
import '../chat/widgets/code_block.dart';

/// 文件预览页：在主页面覆盖聊天，展示文件内容。
///
/// 顶栏采用面包屑路径（方案 B），支持代码高亮、Markdown 渲染、
/// 图片预览（双指缩放）和纯文本。
class FilePreviewScreen extends ConsumerStatefulWidget {
  final WorkspaceTarget workspace;
  final FileEntry entry;

  const FilePreviewScreen({
    super.key,
    required this.workspace,
    required this.entry,
  });

  @override
  ConsumerState<FilePreviewScreen> createState() => _FilePreviewScreenState();
}

class _FilePreviewScreenState extends ConsumerState<FilePreviewScreen> {
  late final FileExplorerService _service;
  FilePreviewContent? _content;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    final token = ref.read(mobileConfigProvider).githubToken;
    _service = FileExplorerService(githubToken: token.isEmpty ? null : token);
    _load();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final content = await _service.readFile(
        widget.workspace,
        widget.entry.relativePath,
      );
      if (!mounted) return;
      setState(() {
        _content = content;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _friendlyError(error);
        _loading = false;
      });
    }
  }

  String _friendlyError(Object error) {
    final msg = error.toString();
    if (msg.contains('NOT_FOUND')) return I18n.t('filePreview.notFound');
    if (msg.contains('RATE_LIMITED')) return I18n.t('fileExplorer.rateLimited');
    return I18n.t('filePreview.error', {'error': msg});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: _buildBreadcrumb(theme),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy_outlined, size: 20),
            tooltip: I18n.t('filePreview.copyPath'),
            onPressed: _copyPath,
          ),
        ],
      ),
      body: _buildBody(context),
    );
  }

  /// 面包屑路径（方案 B）：按 `/` 分割，最后一段加粗。
  Widget _buildBreadcrumb(ThemeData theme) {
    final parts = widget.entry.relativePath.split('/');
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (int i = 0; i < parts.length; i++) ...[
            if (i > 0)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Text(
                  '/',
                  style: TextStyle(
                    fontSize: 13,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.35),
                  ),
                ),
              ),
            Text(
              parts[i],
              style: TextStyle(
                fontSize: 13,
                fontWeight:
                    i == parts.length - 1 ? FontWeight.w600 : FontWeight.w400,
                color: i == parts.length - 1
                    ? theme.colorScheme.onSurface
                    : theme.colorScheme.onSurface.withValues(alpha: 0.55),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(strokeWidth: 2.5),
            const SizedBox(height: 12),
            Text(
              I18n.t('filePreview.loading'),
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(context)
                    .colorScheme
                    .onSurface
                    .withValues(alpha: 0.5),
              ),
            ),
          ],
        ),
      );
    }
    if (_error != null) {
      return _buildErrorView(_error!);
    }
    final content = _content;
    if (content == null) {
      return _buildErrorView(I18n.t('filePreview.unsupported'));
    }
    return _buildContent(context, content);
  }

  Widget _buildContent(BuildContext context, FilePreviewContent content) {
    switch (content.type) {
      case FilePreviewType.code:
        return _buildCode(context, content);
      case FilePreviewType.markdown:
        return _buildMarkdown(context, content);
      case FilePreviewType.image:
        return _buildImage(context, content);
      case FilePreviewType.text:
        return _buildPlainText(context, content);
      case FilePreviewType.unsupported:
        return _buildUnsupported(context, content);
    }
  }

  Widget _buildCode(BuildContext context, FilePreviewContent content) {
    final ct = CodeTheme.of(context);
    return Column(
      children: [
        if (content.truncated) _buildTruncationBanner(context, content),
        Expanded(
          child: Container(
            color: ct.bg,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(14),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: HighlightView(
                  content.textContent ?? '',
                  language: content.language ?? 'plaintext',
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
        ),
        // 底部语言标签栏
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          color: ct.bg.withValues(alpha: 0.6),
          child: Row(
            children: [
              Text(
                content.language ?? 'plaintext',
                style: TextStyle(
                  color: ct.fg.withValues(alpha: 0.5),
                  fontSize: 11,
                  fontFamily: 'monospace',
                ),
              ),
              const Spacer(),
              Text(
                _formatSize(content.size),
                style: TextStyle(
                  color: ct.fg.withValues(alpha: 0.4),
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildMarkdown(BuildContext context, FilePreviewContent content) {
    final theme = Theme.of(context);
    return Column(
      children: [
        if (content.truncated) _buildTruncationBanner(context, content),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(14),
            child: MarkdownBody(
              data: content.textContent ?? '',
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
        ),
      ],
    );
  }

  Widget _buildImage(BuildContext context, FilePreviewContent content) {
    final theme = Theme.of(context);
    return Container(
      color: theme.colorScheme.surface,
      child: InteractiveViewer(
        maxScale: 5.0,
        minScale: 0.5,
        child: Center(
          child: content.imageBytes == null
              ? const Icon(Icons.broken_image_outlined, size: 48)
              : Image.memory(
                  Uint8List.fromList(content.imageBytes!),
                  errorBuilder: (_, error, __) => Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.broken_image_outlined, size: 48),
                      const SizedBox(height: 8),
                      Text(
                        I18n.t('filePreview.error', {'error': error.toString()}),
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.5),
                        ),
                      ),
                    ],
                  ),
                ),
        ),
      ),
    );
  }

  Widget _buildPlainText(BuildContext context, FilePreviewContent content) {
    final theme = Theme.of(context);
    return Column(
      children: [
        if (content.truncated) _buildTruncationBanner(context, content),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(14),
            child: SelectableText(
              content.textContent ?? '',
              style: TextStyle(
                fontSize: 13,
                fontFamily: 'monospace',
                height: 1.5,
                color: theme.colorScheme.onSurface,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildUnsupported(BuildContext context, FilePreviewContent content) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.do_not_disturb_alt_outlined,
              size: 48,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.25),
            ),
            const SizedBox(height: 12),
            Text(
              I18n.t('filePreview.unsupported'),
              style: TextStyle(
                fontSize: 14,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              _formatSize(content.size),
              style: TextStyle(
                fontSize: 12,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTruncationBanner(
      BuildContext context, FilePreviewContent content) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      color: theme.colorScheme.error.withValues(alpha: 0.08),
      child: Row(
        children: [
          Icon(Icons.warning_amber_rounded,
              size: 16, color: theme.colorScheme.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              I18n.t('filePreview.fileTooLarge', {
                'lines': (content.truncatedLines ?? 0).toString(),
              }),
              style: TextStyle(
                fontSize: 12,
                color: theme.colorScheme.error,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorView(String message) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline_rounded,
                size: 36, color: theme.colorScheme.error.withValues(alpha: 0.5)),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: () {
                setState(() {
                  _loading = true;
                  _error = null;
                  _content = null;
                });
                _load();
              },
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: Text(I18n.t('common.refresh')),
            ),
          ],
        ),
      ),
    );
  }

  void _copyPath() {
    Clipboard.setData(ClipboardData(text: widget.entry.relativePath));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(I18n.t('filePreview.pathCopied')),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)}KB';
    return '${(bytes / 1024 / 1024).toStringAsFixed(1)}MB';
  }
}

/// Markdown 内嵌代码块构建器（复用 CodeBlock 渲染）。
class _PreBlockBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitText(md.Text text, TextStyle? preferredStyle) {
    return const SizedBox.shrink();
  }

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
      final language =
          codeChild.attributes['class']?.replaceFirst('language-', '');
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
