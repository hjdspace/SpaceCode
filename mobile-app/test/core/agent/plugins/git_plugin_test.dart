import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/git_plugin.dart';

void main() {
  group('GitPlugin', () {
    test('createTools exposes 12 git tools', () {
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (_, {required workingDirectory, required environment}) async =>
            const GitCommandResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tools = plugin.createTools();
      expect(tools.length, 12);
      final names = tools.map((t) => t.definition.name).toSet();
      expect(names, containsAll([
        'git_status', 'git_log', 'git_diff', 'git_branch_list', 'git_show',
        'git_add', 'git_commit', 'git_branch_create', 'git_branch_switch',
        'git_push', 'git_pull', 'git_reset',
      ]));
    });

    test('git_status parses porcelain v2 output', () async {
      const stdout = '# branch.head main\n'
          '# branch.ab +2 -1\n'
          '1 M. N... 100644 100644 100644 abc123 def456 file1.txt\n'
          '? new_file.txt\n'
          'u UU N... 100644 100644 100644 100644 abc123 def456 ghi789 conflict.txt\n';
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          expect(args.first, 'status');
          return const GitCommandResult(
              exitCode: 0, stdout: stdout, stderr: '', durationMs: 5);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_status');
      final result = await tool.execute({}, AgentCancellationToken());
      expect(result.isError, isFalse);
      final parsed = jsonDecode(result.content) as Map<String, dynamic>;
      expect(parsed['branch'], 'main');
      expect(parsed['ahead'], 2);
      expect(parsed['behind'], 1);
      expect((parsed['staged'] as List).length, 1);
      expect((parsed['untracked'] as List).length, 1);
      expect((parsed['modified'] as List).length, 1);
    });

    test('git_log parses commit entries', () async {
      const stdout = 'abc123\x1fAuthor\x1f2026-01-01\x1fFix bug\n'
          'def456\x1fAuthor2\x1f2026-01-02\x1fAdd feature\n';
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          expect(args.first, 'log');
          return const GitCommandResult(
              exitCode: 0, stdout: stdout, stderr: '', durationMs: 3);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_log');
      final result = await tool.execute({}, AgentCancellationToken());
      final parsed = jsonDecode(result.content) as Map<String, dynamic>;
      final commits = parsed['commits'] as List;
      expect(commits.length, 2);
      expect(commits[0]['hash'], 'abc123');
      expect(commits[0]['message'], 'Fix bug');
    });

    test('git_add stages paths and returns added count', () async {
      List<String>? calledArgs;
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          calledArgs = args;
          return const GitCommandResult(
              exitCode: 0, stdout: '', stderr: '', durationMs: 1);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_add');
      final result = await tool.execute({
        'paths': ['file1.txt', 'file2.txt'],
      }, AgentCancellationToken());
      expect(result.isError, isFalse);
      expect(calledArgs, ['add', '--', 'file1.txt', 'file2.txt']);
      final parsed = jsonDecode(result.content) as Map<String, dynamic>;
      expect(parsed['added'], 2);
    });

    test('git_commit returns hash from rev-parse', () async {
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          if (args.first == 'commit') {
            return const GitCommandResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 10);
          }
          if (args.first == 'rev-parse') {
            return const GitCommandResult(
                exitCode: 0, stdout: 'newhash123\n', stderr: '', durationMs: 1);
          }
          return const GitCommandResult(
              exitCode: 1, stdout: '', stderr: 'unexpected', durationMs: 0);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_commit');
      final result = await tool.execute({
        'message': 'Test commit',
      }, AgentCancellationToken());
      expect(result.isError, isFalse);
      final parsed = jsonDecode(result.content) as Map<String, dynamic>;
      expect(parsed['hash'], 'newhash123');
      expect(parsed['summary'], 'Test commit');
    });

    test('git_push with force=true passes --force', () async {
      List<String>? calledArgs;
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          calledArgs = args;
          return const GitCommandResult(
              exitCode: 0, stdout: '', stderr: '', durationMs: 100);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_push');
      final result = await tool.execute({
        'remote': 'origin',
        'force': true,
      }, AgentCancellationToken());
      expect(result.isError, isFalse);
      expect(calledArgs, ['push', '--force', 'origin']);
    });

    test('git_pull detects conflicts via exit code 1', () async {
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          return const GitCommandResult(
              exitCode: 1,
              stdout: 'CONFLICT (content): Merge conflict in file.txt',
              stderr: 'Auto-merging file.txt',
              durationMs: 50);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_pull');
      final result = await tool.execute({}, AgentCancellationToken());
      // 冲突不视为 isError（用户可处理）
      expect(result.isError, isFalse);
      final parsed = jsonDecode(result.content) as Map<String, dynamic>;
      expect(parsed['conflicts'], true);
      expect(parsed['updated'], false);
    });

    test('git_reset with mode=hard passes --hard', () async {
      List<String>? calledArgs;
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          calledArgs = args;
          return const GitCommandResult(
              exitCode: 0, stdout: '', stderr: '', durationMs: 2);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_reset');
      final result = await tool.execute({
        'ref': 'HEAD~1',
        'mode': 'hard',
      }, AgentCancellationToken());
      expect(result.isError, isFalse);
      expect(calledArgs, ['reset', '--hard', 'HEAD~1']);
    });

    test('git_diff parses --stat output', () async {
      const stdout = ' file1.txt | 10 +++++++---\n'
          ' file2.txt |  3 ++\n'
          ' 2 files changed, 9 insertions(+), 4 deletions(-)\n';
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          return const GitCommandResult(
              exitCode: 0, stdout: stdout, stderr: '', durationMs: 5);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_diff');
      final result = await tool.execute({'staged': true}, AgentCancellationToken());
      expect(result.isError, isFalse);
      final parsed = jsonDecode(result.content) as Map<String, dynamic>;
      final files = parsed['files'] as List;
      expect(files.length, 2);
      expect(files[0]['path'], 'file1.txt');
      expect(files[0]['changes'], 10);
    });

    test('error responses include exit_code and stderr', () async {
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          return const GitCommandResult(
              exitCode: 128,
              stdout: '',
              stderr: 'fatal: not a git repository',
              durationMs: 1);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_status');
      final result = await tool.execute({}, AgentCancellationToken());
      expect(result.isError, isTrue);
      final parsed = jsonDecode(result.content) as Map<String, dynamic>;
      expect(parsed['exit_code'], 128);
      expect(parsed['stderr'], 'fatal: not a git repository');
    });

    test('git_show requires ref argument', () async {
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          return const GitCommandResult(
              exitCode: 0, stdout: '', stderr: '', durationMs: 0);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_show');
      final result = await tool.execute({}, AgentCancellationToken());
      expect(result.isError, isTrue);
      expect(result.content, 'ref is required');
    });

    test('git_add rejects empty paths array', () async {
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (args, {required workingDirectory, required environment}) async {
          return const GitCommandResult(
              exitCode: 0, stdout: '', stderr: '', durationMs: 0);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'git_add');
      final result = await tool.execute({'paths': []}, AgentCancellationToken());
      expect(result.isError, isTrue);
      expect(result.content, 'paths must not be empty');
    });
  });

  group('GitPlugin tool definitions', () {
    test('git_push and git_reset use sequential execution mode', () {
      final plugin = GitPlugin.forTest(
        gitPath: '/usr/bin/git',
        workingDirectory: '/tmp',
        environment: const {},
        executor: (_, {required workingDirectory, required environment}) async =>
            const GitCommandResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tools = plugin.createTools();
      final push = tools.firstWhere((t) => t.definition.name == 'git_push');
      final reset = tools.firstWhere((t) => t.definition.name == 'git_reset');
      expect(push.executionMode, AgentToolExecutionMode.sequential);
      expect(reset.executionMode, AgentToolExecutionMode.sequential);
    });
  });
}
