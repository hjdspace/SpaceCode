import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/mobile_config.dart';
import '../../core/i18n/strings.dart';
import '../../core/storage/storage_permission_service.dart';
import '../../core/workspace/file_explorer_service.dart';
import '../../core/workspace/workspace_target.dart';

/// 文件管理页：树形展示项目目录，在 Drawer 内覆盖会话列表。
///
/// 文件夹点击展开/折叠，文件点击通过 [onPreviewFile] 回调触发预览。
class FileExplorerScreen extends ConsumerStatefulWidget {
  final WorkspaceTarget workspace;

  /// 项目显示名称（分组标题）。
  final String displayName;

  /// 点击文件时触发，由调用方负责关闭 Drawer 并 push 预览页。
  final void Function(FileEntry entry) onPreviewFile;

  const FileExplorerScreen({
    super.key,
    required this.workspace,
    required this.displayName,
    required this.onPreviewFile,
  });

  @override
  ConsumerState<FileExplorerScreen> createState() =>
      _FileExplorerScreenState();
}

class _FileExplorerScreenState extends ConsumerState<FileExplorerScreen> {
  late final FileExplorerService _service;

  /// 每个目录的子条目缓存，key 为目录的 relativePath（根目录为空串）。
  final Map<String, List<FileEntry>> _childrenCache = {};

  /// 已展开的目录路径集合。
  final Set<String> _expandedDirs = {};

  /// 正在加载的目录路径集合。
  final Set<String> _loadingDirs = {};

  /// 目录加载错误，key 为目录 relativePath。
  final Map<String, String> _errorsByDir = {};

  bool _initialLoading = true;
  String? _initialError;

  /// 本地存储权限状态：null=未检查，true=已授权，false=未授权。
  bool? _storageGranted;

  @override
  void initState() {
    super.initState();
    final token = ref.read(mobileConfigProvider).githubToken;
    _service = FileExplorerService(githubToken: token.isEmpty ? null : token);
    _initLoad();
  }

  /// 本地项目访问外部存储路径前先检查权限；GitHub API 模式无需权限。
  Future<void> _initLoad() async {
    if (_isUsingGithubApi) {
      _loadDirectory('');
      return;
    }
    final granted = await StoragePermissionService.hasAccess();
    if (!mounted) return;
    setState(() => _storageGranted = granted);
    if (granted) {
      _loadDirectory('');
    } else {
      setState(() => _initialLoading = false);
    }
  }

  /// 用户点击"前往设置授权"按钮。
  Future<void> _requestStoragePermission() async {
    final granted = await StoragePermissionService.request();
    if (!mounted) return;
    setState(() => _storageGranted = granted);
    if (granted) {
      setState(() => _initialLoading = true);
      _loadDirectory('');
    }
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  /// GitHub 项目无本地 clone 时走 API，需要提示用户。
  bool get _isUsingGithubApi =>
      widget.workspace.mode == WorkspaceMode.github &&
      (widget.workspace.localPath == null ||
          widget.workspace.localPath!.isEmpty);

  Future<void> _loadDirectory(String relativePath) async {
    setState(() {
      _loadingDirs.add(relativePath);
      _errorsByDir.remove(relativePath);
    });
    try {
      final entries = await _service.listDirectory(
        widget.workspace,
        relativePath: relativePath,
      );
      if (!mounted) return;
      setState(() {
        _childrenCache[relativePath] = entries;
        _loadingDirs.remove(relativePath);
        if (relativePath.isEmpty) _initialLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        final msg = _friendlyError(error);
        _errorsByDir[relativePath] = msg;
        _loadingDirs.remove(relativePath);
        if (relativePath.isEmpty) {
          _initialLoading = false;
          _initialError = msg;
        }
      });
    }
  }

  void _toggleDir(FileEntry entry) {
    if (_expandedDirs.contains(entry.relativePath)) {
      setState(() => _expandedDirs.remove(entry.relativePath));
    } else {
      setState(() => _expandedDirs.add(entry.relativePath));
      if (!_childrenCache.containsKey(entry.relativePath)) {
        _loadDirectory(entry.relativePath);
      }
    }
  }

  String _friendlyError(Object error) {
    final msg = error.toString();
    if (msg.contains('NOT_FOUND')) {
      return I18n.t('filePreview.notFound');
    }
    if (msg.contains('RATE_LIMITED')) {
      return I18n.t('fileExplorer.rateLimited');
    }
    return I18n.t('fileExplorer.error', {'error': msg});
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
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            Text(
              _subtitle(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              ),
            ),
          ],
        ),
      ),
      body: _buildBody(context),
    );
  }

  String _subtitle() {
    final ws = widget.workspace;
    if (ws.mode == WorkspaceMode.github) {
      final repo = ws.repository ?? '';
      final branch = ws.branch ?? '';
      if (_isUsingGithubApi) {
        return '${I18n.t('fileExplorer.githubProject')} · $repo@$branch · API';
      }
      return '${I18n.t('fileExplorer.githubProject')} · $repo@$branch';
    }
    return '${I18n.t('fileExplorer.localProject')} · ${ws.localPath ?? ''}';
  }

  Widget _buildBody(BuildContext context) {
    // 本地项目且未授权外部存储权限：显示引导 UI
    if (!_isUsingGithubApi && _storageGranted == false) {
      return _buildPermissionGate(context);
    }
    if (_initialLoading) {
      return _buildLoading();
    }
    if (_initialError != null) {
      return _buildError(_initialError!, () => _retryInitial());
    }
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 4),
      children: [
        if (_isUsingGithubApi)
          _buildApiBanner(context),
        ..._buildDirChildren('', 0),
      ],
    );
  }

  /// 权限未授予时的引导 UI。
  Widget _buildPermissionGate(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.folder_off_outlined,
              size: 56,
              color: theme.colorScheme.primary.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              I18n.t('fileExplorer.permissionTitle'),
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: theme.colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              I18n.t('fileExplorer.permissionMessage'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                height: 1.5,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _requestStoragePermission,
              icon: const Icon(Icons.settings_rounded, size: 18),
              label: Text(I18n.t('fileExplorer.permissionGrant')),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(I18n.t('common.cancel')),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildApiBanner(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_outlined,
              size: 14, color: theme.colorScheme.primary),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              I18n.t('fileExplorer.githubApiFallback'),
              style: TextStyle(
                fontSize: 11,
                color: theme.colorScheme.primary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 递归构建一个目录下的所有可见条目（含展开的子目录内容）。
  List<Widget> _buildDirChildren(String dirPath, int depth) {
    final children = _childrenCache[dirPath];
    if (children == null) return [];

    final widgets = <Widget>[];
    for (final entry in children) {
      final isExpanded = _expandedDirs.contains(entry.relativePath);
      widgets.add(_buildEntryTile(entry, depth, isExpanded));
      if (entry.isDirectory && isExpanded) {
        final subLoading = _loadingDirs.contains(entry.relativePath);
        final subError = _errorsByDir[entry.relativePath];
        if (subError != null) {
          widgets.add(_buildInlineError(subError, depth + 1, entry.relativePath));
        } else if (subLoading && !_childrenCache.containsKey(entry.relativePath)) {
          widgets.add(_buildInlineLoading(depth + 1));
        } else {
          widgets.addAll(_buildDirChildren(entry.relativePath, depth + 1));
        }
      }
    }
    if (children.isEmpty) {
      widgets.add(_buildEmpty(depth));
    }
    return widgets;
  }

  Widget _buildEntryTile(FileEntry entry, int depth, bool isExpanded) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: entry.isDirectory
          ? () => _toggleDir(entry)
          : () => widget.onPreviewFile(entry),
      child: Padding(
        padding: EdgeInsets.only(
          left: 12.0 + depth * 20,
          right: 12,
          top: 9,
          bottom: 9,
        ),
        child: Row(
          children: [
            // 展开/折叠箭头（仅目录）
            SizedBox(
              width: 16,
              child: entry.isDirectory
                  ? Icon(
                      isExpanded
                          ? Icons.keyboard_arrow_down_rounded
                          : Icons.chevron_right_rounded,
                      size: 18,
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                    )
                  : const SizedBox.shrink(),
            ),
            const SizedBox(width: 4),
            Icon(
              _iconFor(entry),
              size: 18,
              color: _iconColorFor(entry, theme),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                entry.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  color: theme.colorScheme.onSurface,
                  fontWeight:
                      entry.isDirectory ? FontWeight.w500 : FontWeight.w400,
                ),
              ),
            ),
            if (!entry.isDirectory && entry.size != null)
              Text(
                _formatSize(entry.size!),
                style: TextStyle(
                  fontSize: 11,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.35),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoading() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(strokeWidth: 2.5),
          const SizedBox(height: 12),
          Text(
            I18n.t('fileExplorer.loading'),
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

  Widget _buildInlineLoading(int depth) {
    return Padding(
      padding: EdgeInsets.only(left: 12.0 + depth * 20),
      child: const SizedBox(
        width: 20,
        height: 36,
        child: Center(
          child: SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 1.5),
          ),
        ),
      ),
    );
  }

  Widget _buildError(String message, VoidCallback onRetry) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
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
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: Text(I18n.t('common.refresh')),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInlineError(
      String message, int depth, String dirPath) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(left: 12.0 + depth * 20, right: 12),
      child: Row(
        children: [
          Icon(Icons.error_outline_rounded,
              size: 14, color: theme.colorScheme.error.withValues(alpha: 0.5)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              message,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                color: theme.colorScheme.error.withValues(alpha: 0.7),
              ),
            ),
          ),
          InkWell(
            onTap: () => _loadDirectory(dirPath),
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: Icon(Icons.refresh_rounded,
                  size: 14,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty(int depth) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(left: 12.0 + depth * 20, top: 8, bottom: 8),
      child: Text(
        I18n.t('fileExplorer.empty'),
        style: TextStyle(
          fontSize: 12,
          color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
          fontStyle: FontStyle.italic,
        ),
      ),
    );
  }

  void _retryInitial() {
    setState(() {
      _initialLoading = true;
      _initialError = null;
      _childrenCache.clear();
      _expandedDirs.clear();
      _errorsByDir.clear();
    });
    _loadDirectory('');
  }

  IconData _iconFor(FileEntry entry) {
    if (entry.isDirectory) return Icons.folder_rounded;
    final ext = entry.name.split('.').last.toLowerCase();
    if (['md', 'markdown'].contains(ext)) return Icons.article_outlined;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].contains(ext)) {
      return Icons.image_outlined;
    }
    if ([
      'dart', 'py', 'js', 'ts', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp',
      'json', 'yaml', 'yml', 'xml', 'html', 'css', 'sql', 'sh'
    ].contains(ext)) {
      return Icons.code_rounded;
    }
    return Icons.insert_drive_file_outlined;
  }

  Color _iconColorFor(FileEntry entry, ThemeData theme) {
    if (entry.isDirectory) {
      return theme.colorScheme.primary.withValues(alpha: 0.7);
    }
    final ext = entry.name.split('.').last.toLowerCase();
    if (['md', 'markdown'].contains(ext)) {
      return const Color(0xff6366f1);
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].contains(ext)) {
      return const Color(0xff10b981);
    }
    return theme.colorScheme.onSurface.withValues(alpha: 0.45);
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)}KB';
    return '${(bytes / 1024 / 1024).toStringAsFixed(1)}MB';
  }
}
