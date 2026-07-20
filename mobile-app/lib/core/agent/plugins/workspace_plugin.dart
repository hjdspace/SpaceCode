import 'dart:io';

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';

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
    if (normalized.startsWith('/') || segments.contains('..')) {
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
        description: 'Create or replace a UTF-8 text file in the workspace.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {'type': 'string'},
            'content': {'type': 'string'},
          },
          'required': ['path', 'content'],
        },
      );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> arguments,
      AgentCancellationToken cancellationToken) async {
    cancellationToken.throwIfCancelled();
    final file = File(safePath(arguments['path'] as String? ?? ''));
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
        description:
            'Replace one exact text occurrence in an existing UTF-8 file.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {'type': 'string'},
            'old_text': {'type': 'string'},
            'new_text': {'type': 'string'},
          },
          'required': ['path', 'old_text', 'new_text'],
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
    final oldText = arguments['old_text'] as String? ?? '';
    if (oldText.isEmpty) {
      return const AgentToolResult(
          content: 'old_text must not be empty', isError: true);
    }
    final content = await file.readAsString();
    final first = content.indexOf(oldText);
    if (first < 0) {
      return const AgentToolResult(
          content: 'old_text was not found', isError: true);
    }
    if (content.indexOf(oldText, first + oldText.length) >= 0) {
      return const AgentToolResult(
          content: 'old_text occurs more than once', isError: true);
    }
    final next = content.replaceRange(
        first, first + oldText.length, arguments['new_text'] as String? ?? '');
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
