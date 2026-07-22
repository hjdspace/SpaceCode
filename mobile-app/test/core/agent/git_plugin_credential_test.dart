import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/plugins/git_plugin.dart';

void main() {
  group('defaultGitExecutor credential helper injection', () {
    test('injects credential helper for pull when token present', () async {
      final captured = <List<String>>[];
      final result = await defaultGitExecutor(
        'termux:git',
        ['pull', 'origin'],
        workingDirectory: '/tmp',
        environment: {'SPACECODE_GITHUB_TOKEN': 'tok123'},
        testExecutor: (args) async {
          captured.add(args);
          return const GitCommandResult(
            exitCode: 0,
            stdout: 'Already up to date',
            stderr: '',
            durationMs: 100,
          );
        },
      );

      expect(result.exitCode, 0);
      expect(captured, isNotEmpty);
      // 第一段 args 应是 -c credential.helper=...
      expect(captured.first[0], '-c');
      expect(captured.first[1], contains('credential.helper'));
      expect(captured.first[1], contains('tok123'));
      // 后续才是原命令 pull origin
      expect(captured.first[2], 'pull');
      expect(captured.first[3], 'origin');
    });

    test('does not inject for status command', () async {
      final captured = <List<String>>[];
      await defaultGitExecutor(
        'termux:git',
        ['status', '--porcelain'],
        workingDirectory: '/tmp',
        environment: {'SPACECODE_GITHUB_TOKEN': 'tok123'},
        testExecutor: (args) async {
          captured.add(args);
          return const GitCommandResult(
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 10,
          );
        },
      );

      expect(captured.first, ['status', '--porcelain']);
    });

    test('does not inject when token absent', () async {
      final captured = <List<String>>[];
      await defaultGitExecutor(
        'termux:git',
        ['pull', 'origin'],
        workingDirectory: '/tmp',
        environment: {},
        testExecutor: (args) async {
          captured.add(args);
          return const GitCommandResult(
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 10,
          );
        },
      );

      expect(captured.first, ['pull', 'origin']);
    });

    test('injects for push, fetch, and ls-remote', () async {
      for (final cmd in ['push', 'fetch', 'ls-remote']) {
        final captured = <List<String>>[];
        await defaultGitExecutor(
          'termux:git',
          [cmd, 'origin'],
          workingDirectory: '/tmp',
          environment: {'SPACECODE_GITHUB_TOKEN': 'tok'},
          testExecutor: (args) async {
            captured.add(args);
            return const GitCommandResult(
              exitCode: 0,
              stdout: '',
              stderr: '',
              durationMs: 10,
            );
          },
        );
        expect(captured.first[0], '-c', reason: '$cmd should be injected');
      }
    });

    test('does not inject for local binary mode (non-termux)', () async {
      final captured = <List<String>>[];
      // 本地二进制模式:gitPath 不是 termux:git,应走 Process.run
      // testExecutor 在本地模式下也应捕获原始 args(不注入)
      await defaultGitExecutor(
        '/usr/bin/git',
        ['pull', 'origin'],
        workingDirectory: '/tmp',
        environment: {'SPACECODE_GITHUB_TOKEN': 'tok123'},
        testExecutor: (args) async {
          captured.add(args);
          return const GitCommandResult(
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 10,
          );
        },
      );

      expect(captured.first, ['pull', 'origin']);
    });
  });
}
