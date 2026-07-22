import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';
import '../termux_bridge.dart';

/// Git 命令执行结果。
class GitCommandResult {
  final int exitCode;
  final String stdout;
  final String stderr;
  final int durationMs;

  const GitCommandResult({
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    this.durationMs = 0,
  });

  bool get isSuccess => exitCode == 0;
}

/// Git 命令执行器函数类型。
///
/// 接收 git 参数列表，返回 [GitCommandResult]。
/// 测试时可注入 mock executor，生产使用 [defaultGitExecutor]。
typedef GitExecutor = Future<GitCommandResult> Function(
  List<String> args, {
  required String workingDirectory,
  required Map<String, String> environment,
});

/// 默认执行器：调用 `gitPath args...`。
///
/// 当 `gitPath` 为 `termux:git` 时，通过 [TermuxBridge] 执行 git 命令。
/// 否则通过 [Process.run] 执行本地 git 二进制。
///
/// 对 `pull/push/fetch/ls-remote` 命令,若 environment 含
/// `SPACECODE_GITHUB_TOKEN`,注入临时 credential helper(token 不持久化)。
///
/// [testExecutor] 仅供测试注入,生产留空走默认路径(TermuxBridge 或 Process.run)。
Future<GitCommandResult> defaultGitExecutor(
  String gitPath,
  List<String> args, {
  required String workingDirectory,
  required Map<String, String> environment,
  Future<GitCommandResult> Function(List<String> effectiveArgs)? testExecutor,
}) async {
  // Termux 桥接模式
  if (gitPath == 'termux:git') {
    // 对需要认证的命令注入临时 credential helper
    const authCommands = ['pull', 'push', 'fetch', 'ls-remote'];
    final needsAuth = args.isNotEmpty && authCommands.contains(args.first);
    final token = environment['SPACECODE_GITHUB_TOKEN'];
    List<String> effectiveArgs = args;
    if (needsAuth && token != null && token.isNotEmpty) {
      // 临时 credential helper:命令结束后不留痕迹
      final helper =
          "!f(){ echo username=x-access-token; echo password=$token; }; f";
      effectiveArgs = ['-c', 'credential.helper=$helper', ...args];
    }
    debugPrint('[GitPlugin] Executing via Termux: git ${effectiveArgs.join(" ")}');

    // 测试注入路径:不触发真实 TermuxBridge
    if (testExecutor != null) {
      return testExecutor(effectiveArgs);
    }

    try {
      final result = await TermuxBridge.instance.runGit(
        args: effectiveArgs,
        workdir: workingDirectory,
        timeoutMs: 60000,
      );
      return GitCommandResult(
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      );
    } on PlatformException catch (e) {
      return GitCommandResult(
        exitCode: -1,
        stdout: '',
        stderr: 'Termux error: ${e.code} - ${e.message}',
        durationMs: 0,
      );
    }
  }

  // 本地二进制模式
  if (testExecutor != null) {
    return testExecutor(args);
  }
  final sw = Stopwatch()..start();
  final result = await Process.run(
    gitPath,
    args,
    workingDirectory: workingDirectory,
    environment: environment,
    stdoutEncoding: utf8,
    stderrEncoding: utf8,
  );
  return GitCommandResult(
    exitCode: result.exitCode,
    stdout: result.stdout as String? ?? '',
    stderr: result.stderr as String? ?? '',
    durationMs: sw.elapsedMilliseconds,
  );
}

/// 提供 12 个结构化 Git 工具。
///
/// 工具列表（危险等级见 [CommandClassifier]）：
/// - 读：git_status / git_log / git_diff / git_branch_list / git_show
/// - 写：git_add / git_commit / git_branch_create / git_branch_switch
/// - 危险：git_push / git_pull / git_reset
///
/// 所有工具通过 `git` 二进制执行（[gitPath]），工作目录固定在 [workingDirectory]。
/// 未知 git 环境下（gitPath == null）不加载此 Plugin。
class GitPlugin extends AgentPlugin {
  final String gitPath;
  final String workingDirectory;
  final Map<String, String> environment;
  final GitExecutor executor;

  GitPlugin({
    required this.gitPath,
    required this.workingDirectory,
    required this.environment,
    GitExecutor? executor,
  }) : executor =
            executor ?? ((args, {required workingDirectory, required environment}) => defaultGitExecutor(gitPath, args, workingDirectory: workingDirectory, environment: environment));

  @visibleForTesting
  GitPlugin.forTest({
    required this.gitPath,
    required this.workingDirectory,
    required this.environment,
    required this.executor,
  });

  @override
  List<AgentTool> createTools() => [
        _GitStatusTool(this),
        _GitLogTool(this),
        _GitDiffTool(this),
        _GitBranchListTool(this),
        _GitShowTool(this),
        _GitAddTool(this),
        _GitCommitTool(this),
        _GitBranchCreateTool(this),
        _GitBranchSwitchTool(this),
        _GitPushTool(this),
        _GitPullTool(this),
        _GitResetTool(this),
      ];

  /// 执行 git 命令并返回 JSON 字符串结果。
  Future<AgentToolResult> _run(
    List<String> args, {
    Map<String, dynamic>? successPayload,
    String? errorContext,
    AgentCancellationToken? cancellationToken,
  }) async {
    if (cancellationToken != null) {
      cancellationToken.throwIfCancelled();
    }
    final result = await executor(
      args,
      workingDirectory: workingDirectory,
      environment: environment,
    );
    if (!result.isSuccess) {
      return AgentToolResult(
        content: jsonEncode({
          'error': errorContext ?? 'git ${args.first} failed',
          'exit_code': result.exitCode,
          'stderr': result.stderr.trim(),
          'duration_ms': result.durationMs,
        }),
        isError: true,
      );
    }
    final payload = successPayload ?? <String, dynamic>{};
    return AgentToolResult(
      content: jsonEncode({
        ...payload,
        'duration_ms': result.durationMs,
      }),
    );
  }
}

// ============ 读工具 ============

class _GitStatusTool extends AgentTool {
  final GitPlugin plugin;
  _GitStatusTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_status',
        description: 'Show working tree status (staged, modified, untracked, ahead/behind).',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {'type': 'string', 'description': 'Optional path filter'},
          },
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final args = ['status', '--porcelain=v2', '--branch'];
    final path = arguments['path'] as String?;
    if (path != null && path.isNotEmpty) args.addAll(['--', path]);
    final result = await plugin.executor(
      args,
      workingDirectory: plugin.workingDirectory,
      environment: plugin.environment,
    );
    if (!result.isSuccess) {
      return AgentToolResult(
        content: jsonEncode({
          'error': 'git status failed',
          'exit_code': result.exitCode,
          'stderr': result.stderr.trim(),
        }),
        isError: true,
      );
    }
    final parsed = _parseStatusPorcelainV2(result.stdout);
    return AgentToolResult(content: jsonEncode(parsed));
  }

  Map<String, dynamic> _parseStatusPorcelainV2(String output) {
    final staged = <Map<String, String>>[];
    final modified = <Map<String, String>>[];
    final untracked = <Map<String, String>>[];
    int ahead = 0, behind = 0;
    String? branch;

    for (final line in output.split('\n')) {
      if (line.isEmpty) continue;
      if (line.startsWith('# branch.head')) {
        branch = line.substring('# branch.head '.length).trim();
        continue;
      }
      if (line.startsWith('# branch.ab')) {
        final match = RegExp(r'\+(\d+) -(\d+)').firstMatch(line);
        if (match != null) {
          ahead = int.parse(match.group(1)!);
          behind = int.parse(match.group(2)!);
        }
        continue;
      }
      if (line.startsWith('#')) continue;
      if (line.startsWith('1 ') || line.startsWith('2 ')) {
        final parts = line.split(' ');
        final xy = parts[1];
        final file = parts.last;
        staged.add({'status': xy, 'file': file});
      } else if (line.startsWith('? ')) {
        untracked.add({'file': line.substring(2)});
      } else if (line.startsWith('u ')) {
        final parts = line.split(' ');
        modified.add({'status': 'UU', 'file': parts.last});
      }
    }
    return {
      'branch': branch,
      'ahead': ahead,
      'behind': behind,
      'staged': staged,
      'modified': modified,
      'untracked': untracked,
    };
  }
}

class _GitLogTool extends AgentTool {
  final GitPlugin plugin;
  _GitLogTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_log',
        description: 'Show commit history.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100, 'default': 20},
            'path': {'type': 'string', 'description': 'Optional file path filter'},
          },
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final limit = (arguments['limit'] as int? ?? 20).clamp(1, 100);
    final args = [
      'log',
      '--format=%H%x1f%an%x1f%ad%x1f%s',
      '-$limit',
    ];
    final path = arguments['path'] as String?;
    if (path != null && path.isNotEmpty) args.addAll(['--', path]);

    final result = await plugin.executor(
      args,
      workingDirectory: plugin.workingDirectory,
      environment: plugin.environment,
    );
    if (!result.isSuccess) {
      return AgentToolResult(
        content: jsonEncode({
          'error': 'git log failed',
          'exit_code': result.exitCode,
          'stderr': result.stderr.trim(),
        }),
        isError: true,
      );
    }
    final commits = <Map<String, String>>[];
    for (final line in result.stdout.split('\n')) {
      if (line.isEmpty) continue;
      final parts = line.split('\x1f');
      if (parts.length >= 4) {
        commits.add({
          'hash': parts[0],
          'author': parts[1],
          'date': parts[2],
          'message': parts[3],
        });
      }
    }
    return AgentToolResult(content: jsonEncode({'commits': commits}));
  }
}

class _GitDiffTool extends AgentTool {
  final GitPlugin plugin;
  _GitDiffTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_diff',
        description: 'Show changes between commits, working tree, etc.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'staged': {'type': 'boolean', 'default': false, 'description': 'Show staged changes (--cached)'},
            'path': {'type': 'string', 'description': 'Optional file path filter'},
          },
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final staged = arguments['staged'] as bool? ?? false;
    final args = ['diff', '--stat', if (staged) '--cached'];
    final path = arguments['path'] as String?;
    if (path != null && path.isNotEmpty) args.addAll(['--', path]);

    final result = await plugin.executor(
      args,
      workingDirectory: plugin.workingDirectory,
      environment: plugin.environment,
    );
    if (!result.isSuccess) {
      return AgentToolResult(
        content: jsonEncode({
          'error': 'git diff failed',
          'exit_code': result.exitCode,
          'stderr': result.stderr.trim(),
        }),
        isError: true,
      );
    }
    final files = <Map<String, dynamic>>[];
    for (final line in result.stdout.split('\n')) {
      final match = RegExp(r'^\s*(.+?)\s+\|\s+(\d+)\s+([+-]*)$').firstMatch(line);
      if (match != null) {
        files.add({
          'path': match.group(1)!.trim(),
          'changes': int.parse(match.group(2)!),
          'indicator': match.group(3),
        });
      }
    }
    return AgentToolResult(content: jsonEncode({'files': files}));
  }
}

class _GitBranchListTool extends AgentTool {
  final GitPlugin plugin;
  _GitBranchListTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_branch_list',
        description: 'List branches.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'remote': {'type': 'boolean', 'default': false, 'description': 'Include remote branches'},
          },
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final remote = arguments['remote'] as bool? ?? false;
    final args = ['branch', '--format=%(HEAD)%00%(refname:short)%00%(upstream:short)'];
    if (remote) args.insert(1, '-a');

    final result = await plugin.executor(
      args,
      workingDirectory: plugin.workingDirectory,
      environment: plugin.environment,
    );
    if (!result.isSuccess) {
      return AgentToolResult(
        content: jsonEncode({
          'error': 'git branch failed',
          'exit_code': result.exitCode,
          'stderr': result.stderr.trim(),
        }),
        isError: true,
      );
    }
    final branches = <Map<String, dynamic>>[];
    for (final line in result.stdout.split('\n')) {
      if (line.isEmpty) continue;
      final parts = line.split('\x00');
      if (parts.length >= 2) {
        branches.add({
          'current': parts[0].trim() == '*',
          'name': parts[1].trim(),
          'upstream': parts.length >= 3 ? parts[2].trim() : '',
        });
      }
    }
    return AgentToolResult(content: jsonEncode({'branches': branches}));
  }
}

class _GitShowTool extends AgentTool {
  final GitPlugin plugin;
  _GitShowTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_show',
        description: 'Show information about a commit (message + diff).',
        inputSchema: {
          'type': 'object',
          'properties': {
            'ref': {'type': 'string', 'description': 'Commit hash, tag, or branch name'},
          },
          'required': ['ref'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final ref = arguments['ref'] as String?;
    if (ref == null || ref.isEmpty) {
      return const AgentToolResult(
        content: 'ref is required',
        isError: true,
      );
    }
    final args = ['show', '--format=%H%n%an%n%ad%n%n%s%n%n%b', ref];

    final result = await plugin.executor(
      args,
      workingDirectory: plugin.workingDirectory,
      environment: plugin.environment,
    );
    if (!result.isSuccess) {
      return AgentToolResult(
        content: jsonEncode({
          'error': 'git show failed',
          'exit_code': result.exitCode,
          'stderr': result.stderr.trim(),
        }),
        isError: true,
      );
    }
    final output = result.stdout;
    final lines = output.split('\n');
    final commit = <String, dynamic>{};
    if (lines.length >= 4) {
      commit['hash'] = lines[0];
      commit['author'] = lines[1];
      commit['date'] = lines[2];
      commit['message'] = lines.sublist(4).join('\n').trim();
    }
    commit['diff'] = lines.skip(4).join('\n');
    return AgentToolResult(content: jsonEncode({'commit': commit}));
  }
}

// ============ 写工具 ============

class _GitAddTool extends AgentTool {
  final GitPlugin plugin;
  _GitAddTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_add',
        description: 'Stage file contents for commit.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'paths': {
              'type': 'array',
              'items': {'type': 'string'},
              'description': 'File paths to stage',
            },
          },
          'required': ['paths'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final paths = (arguments['paths'] as List?)?.cast<String>() ?? const [];
    if (paths.isEmpty) {
      return const AgentToolResult(content: 'paths must not be empty', isError: true);
    }
    return plugin._run(
      ['add', '--', ...paths],
      successPayload: {'added': paths.length},
      errorContext: 'git add failed',
      cancellationToken: cancellationToken,
    );
  }
}

class _GitCommitTool extends AgentTool {
  final GitPlugin plugin;
  _GitCommitTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_commit',
        description: 'Record changes to the repository.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'message': {'type': 'string', 'description': 'Commit message'},
          },
          'required': ['message'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final message = arguments['message'] as String?;
    if (message == null || message.trim().isEmpty) {
      return const AgentToolResult(content: 'message must not be empty', isError: true);
    }
    final result = await plugin._run(
      ['commit', '-m', message],
      errorContext: 'git commit failed',
      cancellationToken: cancellationToken,
    );
    if (result.isError) return result;
    // 获取 commit hash
    final revResult = await plugin.executor(
      ['rev-parse', 'HEAD'],
      workingDirectory: plugin.workingDirectory,
      environment: plugin.environment,
    );
    final hash = revResult.isSuccess ? revResult.stdout.trim() : '';
    return AgentToolResult(
      content: jsonEncode({
        'hash': hash,
        'summary': message,
        'duration_ms': 0,
      }),
    );
  }
}

class _GitBranchCreateTool extends AgentTool {
  final GitPlugin plugin;
  _GitBranchCreateTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_branch_create',
        description: 'Create a new branch.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'name': {'type': 'string', 'description': 'Branch name'},
            'from': {'type': 'string', 'description': 'Starting point (commit/branch/tag)'},
          },
          'required': ['name'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final name = arguments['name'] as String?;
    if (name == null || name.trim().isEmpty) {
      return const AgentToolResult(content: 'name must not be empty', isError: true);
    }
    final from = arguments['from'] as String?;
    final args = ['branch', name];
    if (from != null && from.isNotEmpty) args.add(from);
    return plugin._run(
      args,
      successPayload: {'name': name},
      errorContext: 'git branch create failed',
      cancellationToken: cancellationToken,
    );
  }
}

class _GitBranchSwitchTool extends AgentTool {
  final GitPlugin plugin;
  _GitBranchSwitchTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_branch_switch',
        description: 'Switch to an existing branch.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'name': {'type': 'string', 'description': 'Target branch name'},
          },
          'required': ['name'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final name = arguments['name'] as String?;
    if (name == null || name.trim().isEmpty) {
      return const AgentToolResult(content: 'name must not be empty', isError: true);
    }
    return plugin._run(
      ['checkout', name],
      successPayload: {'name': name},
      errorContext: 'git branch switch failed',
      cancellationToken: cancellationToken,
    );
  }
}

// ============ 危险工具 ============

class _GitPushTool extends AgentTool {
  final GitPlugin plugin;
  _GitPushTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_push',
        description: 'Push local commits to remote. Use force=true for force push (dangerous).',
        inputSchema: {
          'type': 'object',
          'properties': {
            'remote': {'type': 'string', 'default': 'origin'},
            'force': {'type': 'boolean', 'default': false},
          },
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final remote = arguments['remote'] as String? ?? 'origin';
    final force = arguments['force'] as bool? ?? false;
    final args = ['push', if (force) '--force', remote];
    return plugin._run(
      args,
      successPayload: {'remote': remote, 'force': force, 'success': true},
      errorContext: 'git push failed',
      cancellationToken: cancellationToken,
    );
  }
}

class _GitPullTool extends AgentTool {
  final GitPlugin plugin;
  _GitPullTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_pull',
        description: 'Fetch from remote and integrate with current branch.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'remote': {'type': 'string', 'default': 'origin'},
          },
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final remote = arguments['remote'] as String? ?? 'origin';
    final result = await plugin.executor(
      ['pull', '--no-stat', remote],
      workingDirectory: plugin.workingDirectory,
      environment: plugin.environment,
    );
    // git pull 可能返回 1 表示冲突
    if (result.exitCode == 0) {
      return AgentToolResult(
        content: jsonEncode({
          'remote': remote,
          'updated': true,
          'conflicts': false,
          'output': result.stdout.trim(),
        }),
      );
    }
    final hasConflicts = result.stderr.contains('CONFLICT') ||
        result.stdout.contains('CONFLICT') ||
        result.exitCode == 1;
    return AgentToolResult(
      content: jsonEncode({
        'remote': remote,
        'updated': false,
        'conflicts': hasConflicts,
        'error': result.stderr.trim(),
        'output': result.stdout.trim(),
        'exit_code': result.exitCode,
      }),
      isError: !hasConflicts,
    );
  }
}

class _GitResetTool extends AgentTool {
  final GitPlugin plugin;
  _GitResetTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'git_reset',
        description: 'Reset current HEAD to specified state. mode=hard discards working changes (dangerous).',
        inputSchema: {
          'type': 'object',
          'properties': {
            'ref': {'type': 'string', 'description': 'Commit hash or ref to reset to'},
            'mode': {
              'type': 'string',
              'enum': ['soft', 'mixed', 'hard'],
              'default': 'mixed',
            },
          },
          'required': ['ref'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final ref = arguments['ref'] as String?;
    if (ref == null || ref.trim().isEmpty) {
      return const AgentToolResult(content: 'ref is required', isError: true);
    }
    final mode = arguments['mode'] as String? ?? 'mixed';
    final modeFlag = '--$mode';
    return plugin._run(
      ['reset', modeFlag, ref],
      successPayload: {'ref': ref, 'mode': mode},
      errorContext: 'git reset failed',
      cancellationToken: cancellationToken,
    );
  }
}
