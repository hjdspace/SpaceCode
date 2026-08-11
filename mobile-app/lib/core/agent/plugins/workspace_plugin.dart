import 'dart:io';

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';

/// 路径解析结果。调用方应先检查 [isError]。
class PathResolution {
  final String? path;
  final String? error;

  const PathResolution._({this.path, this.error});

  bool get isError => error != null;

  const PathResolution.ok(String path) : this._(path: path);
  const PathResolution.error(String message) : this._(error: message);
}

class WorkspacePlugin extends AgentPlugin {
  final String rootPath;

  WorkspacePlugin(this.rootPath);

  @override
  List<AgentTool> createTools() => [
        _ListFilesTool(rootPath),
        _ReadFileTool(rootPath),
        _WriteFileTool(rootPath),
        _EditFileTool(rootPath),
        _GrepFilesTool(rootPath),
      ];
}

abstract class _WorkspaceTool extends AgentTool {
  final String rootPath;

  _WorkspaceTool(this.rootPath);

  String safePath(String relativePath) {
    final normalized = relativePath.replaceAll('\\', '/');
    final segments =
        normalized.split('/').where((segment) => segment.isNotEmpty).toList();
    // Windows 盘符绝对路径（如 D:\foo）或 Unix 绝对路径（/foo）都拒绝
    final isAbsolute = normalized.startsWith('/') ||
        RegExp(r'^[a-zA-Z]:[\\/]').hasMatch(normalized);
    if (isAbsolute || segments.contains('..')) {
      throw StateError('Path must stay inside the workspace');
    }
    final resolvedRoot = Directory(rootPath).resolveSymbolicLinksSync();
    final suffix = segments.join(Platform.pathSeparator);
    final candidate = suffix.isEmpty
        ? resolvedRoot
        : File('$resolvedRoot${Platform.pathSeparator}$suffix').absolute.path;
    var existingAncestor = candidate;
    while (FileSystemEntity.typeSync(existingAncestor, followLinks: false) ==
        FileSystemEntityType.notFound) {
      final parent = FileSystemEntity.parentOf(existingAncestor);
      if (parent == existingAncestor) break;
      existingAncestor = parent;
    }
    final resolvedAncestor = File(existingAncestor).resolveSymbolicLinksSync();
    final comparableRoot =
        Platform.isWindows ? resolvedRoot.toLowerCase() : resolvedRoot;
    final comparableAncestor =
        Platform.isWindows ? resolvedAncestor.toLowerCase() : resolvedAncestor;
    if (comparableAncestor != comparableRoot &&
        !comparableAncestor
            .startsWith('$comparableRoot${Platform.pathSeparator}')) {
      throw StateError('Path must stay inside the workspace');
    }
    return candidate;
  }

  /// 从 [arguments] 提取相对路径，兼容 `path`（本地历史）和 `file_path`
  /// （Claude Code 习惯）两种字段名。
  /// 返回 null 表示调用方未提供路径。
  String? readPathArg(Map<String, dynamic> arguments) {
    final raw = arguments['path'] ?? arguments['file_path'];
    if (raw is String && raw.isNotEmpty) return raw;
    return null;
  }

  /// 从 [arguments] 提取字符串字段，按 [keys] 顺序返回首个非空值。
  /// 用于兼容 `old_string`/`old_text` 等同义字段名。
  String readStringArg(Map<String, dynamic> arguments, List<String> keys,
      [String defaultValue = '']) {
    for (final key in keys) {
      final v = arguments[key];
      if (v is String) return v;
    }
    return defaultValue;
  }

  /// 解析并校验路径。失败时返回包含明确提示的错误消息。
  /// 调用方应检查返回的 `isError` 字段。
  PathResolution resolvePath(Map<String, dynamic> arguments) {
    final raw = readPathArg(arguments);
    if (raw == null) {
      return const PathResolution.error(
          'path (or file_path) is required and must be a non-empty relative path');
    }
    try {
      return PathResolution.ok(safePath(raw));
    } on StateError {
      return PathResolution.error(
          'Path must be a relative path inside the workspace '
          '(got: "$raw"). Use forward slashes for subdirectories, '
          'e.g. "src/foo.dart".');
    }
  }

  String relativePath(String absolutePath) {
    final root = Directory(rootPath).absolute.path;
    return absolutePath
        .substring(root.length)
        .replaceFirst(RegExp(r'^[\\/]'), '')
        .replaceAll('\\', '/');
  }
}

class _ListFilesTool extends _WorkspaceTool {
  _ListFilesTool(super.rootPath);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'list_files',
        description: 'List files and directories in the workspace.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {
              'type': 'string',
              'description':
                  'Relative directory path. Defaults to workspace root.'
            },
          },
        },
      );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> arguments,
      AgentCancellationToken cancellationToken) async {
    cancellationToken.throwIfCancelled();
    final directory = Directory(safePath(arguments['path'] as String? ?? '.'));
    if (!await directory.exists()) {
      return const AgentToolResult(
          content: 'Directory not found', isError: true);
    }
    final entries = await directory.list(followLinks: false).take(200).toList();
    entries.sort((a, b) => a.path.compareTo(b.path));
    return AgentToolResult(
      content: entries
          .map((entry) =>
              '${relativePath(entry.path)}${entry is Directory ? '/' : ''}')
          .join('\n'),
    );
  }
}

class _ReadFileTool extends _WorkspaceTool {
  _ReadFileTool(super.rootPath);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'read_file',
        description:
            'Read a UTF-8 text file. Use offset and limit for large files.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {'type': 'string'},
            'offset': {'type': 'integer', 'minimum': 0},
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 1000},
          },
          'required': ['path'],
        },
      );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> arguments,
      AgentCancellationToken cancellationToken) async {
    cancellationToken.throwIfCancelled();
    final file = File(safePath(arguments['path'] as String? ?? ''));
    if (!await file.exists()) {
      return const AgentToolResult(content: 'File not found', isError: true);
    }
    final lines = await file.readAsLines();
    final offset = (arguments['offset'] as int? ?? 0).clamp(0, lines.length);
    final limit = (arguments['limit'] as int? ?? 400).clamp(1, 1000);
    final selected = lines.skip(offset).take(limit).toList();
    final numbered = <String>[];
    for (var index = 0; index < selected.length; index++) {
      numbered.add('${offset + index + 1}: ${selected[index]}');
    }
    return AgentToolResult(content: numbered.join('\n'));
  }
}

class _WriteFileTool extends _WorkspaceTool {
  _WriteFileTool(super.rootPath);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'write_file',
        description: 'Create or replace a UTF-8 text file in the workspace. '
            'Pass a relative path (e.g. "src/foo.dart"); '
            '"file_path" is accepted as an alias for "path".',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {
              'type': 'string',
              'description': 'Relative path from workspace root.'
            },
            'content': {'type': 'string'},
          },
          'required': ['path', 'content'],
        },
      );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> arguments,
      AgentCancellationToken cancellationToken) async {
    cancellationToken.throwIfCancelled();
    final resolution = resolvePath(arguments);
    if (resolution.isError) {
      return AgentToolResult(content: resolution.error!, isError: true);
    }
    final file = File(resolution.path!);
    await file.parent.create(recursive: true);
    await file.writeAsString(arguments['content'] as String? ?? '');
    return AgentToolResult(content: 'Wrote ${relativePath(file.path)}');
  }
}

class _EditFileTool extends _WorkspaceTool {
  _EditFileTool(super.rootPath);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'edit_file',
        description: 'Replace one exact text occurrence in an existing UTF-8 file. '
            'Use old_string/new_string (old_text/new_text accepted as aliases). '
            'Pass a relative path (e.g. "src/foo.dart"); '
            '"file_path" is accepted as an alias for "path".',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {
              'type': 'string',
              'description': 'Relative path from workspace root.'
            },
            'old_string': {'type': 'string'},
            'new_string': {'type': 'string'},
          },
          'required': ['path', 'old_string', 'new_string'],
        },
      );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> arguments,
      AgentCancellationToken cancellationToken) async {
    cancellationToken.throwIfCancelled();
    final resolution = resolvePath(arguments);
    if (resolution.isError) {
      return AgentToolResult(content: resolution.error!, isError: true);
    }
    final file = File(resolution.path!);
    if (!await file.exists()) {
      return const AgentToolResult(content: 'File not found', isError: true);
    }
    // 兼容 old_string（Claude Code 标准）和 old_text（历史别名）
    final oldText = readStringArg(arguments, ['old_string', 'old_text']);
    if (oldText.isEmpty) {
      return const AgentToolResult(
          content: 'old_string must not be empty', isError: true);
    }
    final newText = readStringArg(arguments, ['new_string', 'new_text']);
    final content = await file.readAsString();
    final first = content.indexOf(oldText);
    if (first < 0) {
      return const AgentToolResult(
          content: 'old_string was not found in file', isError: true);
    }
    if (content.indexOf(oldText, first + oldText.length) >= 0) {
      return const AgentToolResult(
          content:
              'old_string occurs more than once; provide more context to uniquely identify the occurrence',
          isError: true);
    }
    final next = content.replaceRange(first, first + oldText.length, newText);
    await file.writeAsString(next);
    return AgentToolResult(content: 'Edited ${relativePath(file.path)}');
  }
}

class _GrepFilesTool extends _WorkspaceTool {
  _GrepFilesTool(super.rootPath);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'grep_files',
        description:
            'Search UTF-8 text files in the workspace for a literal string.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'query': {'type': 'string'},
            'path': {'type': 'string'},
            'max_results': {'type': 'integer', 'minimum': 1, 'maximum': 100},
          },
          'required': ['query'],
        },
      );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> arguments,
      AgentCancellationToken cancellationToken) async {
    final query = arguments['query'] as String? ?? '';
    if (query.isEmpty) {
      return const AgentToolResult(
          content: 'query must not be empty', isError: true);
    }
    final root = Directory(safePath(arguments['path'] as String? ?? '.'));
    if (!await root.exists()) {
      return const AgentToolResult(
          content: 'Directory not found', isError: true);
    }
    final maxResults = (arguments['max_results'] as int? ?? 50).clamp(1, 100);
    final matches = <String>[];
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      cancellationToken.throwIfCancelled();
      if (entity is! File || await entity.length() > 1024 * 1024) continue;
      try {
        final lines = await entity.readAsLines();
        for (var index = 0; index < lines.length; index++) {
          if (lines[index].contains(query)) {
            matches.add(
                '${relativePath(entity.path)}:${index + 1}: ${lines[index]}');
            if (matches.length >= maxResults) {
              return AgentToolResult(content: matches.join('\n'));
            }
          }
        }
      } on FormatException {
        continue;
      }
    }
    return AgentToolResult(
        content: matches.isEmpty ? 'No matches found' : matches.join('\n'));
  }
}
