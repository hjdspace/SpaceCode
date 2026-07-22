import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/termux_bridge.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';
import 'package:spacecode_mobile/core/github/git_clone_service.dart';

void main() {
  group('GitCloneService', () {
    test('emits 4 phase progresses + done on success', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''), // add 和 set-url 都用此响应
          'fetch': _ok(''),
          'checkout': _ok(''),
          'ls-files': _ok('README.md\nmain.dart\n'),
        },
      );
      final service = GitCloneService(token: 'tok123', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      // 期望:4 个阶段进度(init/remote/fetch/checkout) + done = 5
      expect(progresses.length, 5);
      expect(progresses[0].phase, ClonePhase.downloading); // init
      expect(progresses[1].phase, ClonePhase.downloading); // remote add
      expect(progresses[2].phase, ClonePhase.extracting); // fetch
      expect(progresses[3].phase, ClonePhase.extracting); // checkout
      expect(progresses[4].phase, ClonePhase.done);
      expect(progresses[4].resultPath, '/tmp/repo');
      expect(progresses[4].processedFiles, 2);
      expect(progresses[4].totalFiles, 2);
    });

    test('emits error when git init fails', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _fail('permission denied'),
        },
      );
      final service = GitCloneService(token: 'tok123', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      // init 进度 + error = 2
      expect(progresses.length, 2);
      expect(progresses[0].phase, ClonePhase.downloading);
      expect(progresses[1].phase, ClonePhase.error);
      expect(progresses[1].errorMessage, contains('git init 失败'));
    });

    test('emits error when git fetch fails', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''),
          'fetch': _fail('Authentication failed'),
          'checkout': _ok(''),
          'ls-files': _ok(''),
        },
      );
      final service = GitCloneService(token: 'bad-token', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      expect(progresses.last.phase, ClonePhase.error);
      expect(progresses.last.errorMessage, contains('git fetch 失败'));
      expect(progresses.last.errorMessage, contains('Authentication failed'));
    });

    test('remote add URL contains token; set-url URL is clean', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''),
          'fetch': _ok(''),
          'checkout': _ok(''),
          'ls-files': _ok('a.txt\n'),
        },
      );
      final service = GitCloneService(token: 'secret-tok', bridge: bridge);

      await for (final _ in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {}

      // remote add 调用应包含带 token 的 URL
      final remoteAddCall = bridge.calls.firstWhere(
        (c) => c.args[0] == 'remote' && c.args[1] == 'add',
      );
      expect(
        remoteAddCall.args,
        contains(
          'https://x-access-token:secret-tok@github.com/owner/repo.git',
        ),
      );

      // remote set-url 调用应包含干净 URL(不含 token)
      final setUrlCall = bridge.calls.firstWhere(
        (c) => c.args[0] == 'remote' && c.args[1] == 'set-url',
      );
      expect(setUrlCall.args, contains('https://github.com/owner/repo.git'));
      expect(setUrlCall.args.any((a) => a.contains('secret-tok')), isFalse);
    });

    test('sanitizes token from error message', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''),
          'fetch': _fail(
            'fatal: Authentication failed for '
            'https://x-access-token:secret-tok@github.com/',
          ),
          'checkout': _ok(''),
          'ls-files': _ok(''),
        },
      );
      final service = GitCloneService(token: 'secret-tok', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      expect(progresses.last.phase, ClonePhase.error);
      expect(progresses.last.errorMessage, isNot(contains('secret-tok')));
    });
  });
}

TermuxResult _ok(String stdout) => TermuxResult(
      exitCode: 0,
      stdout: stdout,
      stderr: '',
      durationMs: 10,
    );

TermuxResult _fail(String stderr) => TermuxResult(
      exitCode: 1,
      stdout: '',
      stderr: stderr,
      durationMs: 10,
    );

/// 记录所有调用的 fake TermuxBridge。
/// 用 args.first 作为 key 匹配预设响应。
class _RecordingTermuxBridge extends TermuxBridge {
  final Map<String, TermuxResult> responses;
  final calls = <_CallRecord>[];

  _RecordingTermuxBridge({required this.responses}) : super.forTesting();

  @override
  Future<TermuxResult> runGit({
    required List<String> args,
    String? workdir,
    int timeoutMs = 30000,
  }) async {
    calls.add(_CallRecord(args: args, workdir: workdir));
    final key = args.first;
    final result = responses[key];
    if (result == null) {
      throw StateError('No mock for git ${args.first} (args: $args)');
    }
    return result;
  }
}

class _CallRecord {
  final List<String> args;
  final String? workdir;
  _CallRecord({required this.args, this.workdir});
}
