import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:spacecode_mobile/core/config/mobile_config.dart';
import 'package:spacecode_mobile/core/github/clone_notifier.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';
import 'package:spacecode_mobile/core/github/github_service.dart';
import 'package:spacecode_mobile/core/github/git_clone_service.dart';

void main() {
  group('CloneNotifier', () {
    test('startClone throws StateError when token is empty', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith(
            (ref) => _StubConfigNotifier(const MobileConfig())),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(token, stream: const Stream.empty())),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      expect(
        () => notifier.startClone(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: '/tmp/repo',
          useTermux: false,
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('startClone throws StateError when already running', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) =>
            _StubConfigNotifier(const MobileConfig(githubToken: 't'))),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(token, stream: _neverCompletingStream())),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      // 启动但不等完成
      unawaited(notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
        useTermux: false,
      ));
      // 等待 state 切到 running
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(container.read(cloneProvider).status, CloneStatus.running);

      expect(
        () => notifier.startClone(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: '/tmp/repo2',
          useTermux: false,
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('consumes stream and transitions to done state', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) =>
            _StubConfigNotifier(const MobileConfig(githubToken: 't'))),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(
              token,
              stream: Stream.fromIterable([
                const CloneProgress(
                    phase: ClonePhase.downloading,
                    receivedBytes: 10,
                    totalBytes: 100,
                    processedFiles: 0),
                const CloneProgress(
                    phase: ClonePhase.extracting,
                    receivedBytes: 100,
                    totalBytes: 100,
                    processedFiles: 5,
                    totalFiles: 5),
                const CloneProgress(
                    phase: ClonePhase.done,
                    receivedBytes: 100,
                    totalBytes: 100,
                    processedFiles: 5,
                    totalFiles: 5,
                    resultPath: '/tmp/repo'),
              ]),
            )),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
        useTermux: false,
      );

      final state = container.read(cloneProvider);
      expect(state.status, CloneStatus.done);
      expect(state.resultPath, '/tmp/repo');
      expect(state.repositoryName, 'spacecode/mobile');
    });

    test('reset returns state to idle', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) =>
            _StubConfigNotifier(const MobileConfig(githubToken: 't'))),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(
              token,
              stream: Stream.fromIterable([
                const CloneProgress(
                    phase: ClonePhase.done,
                    receivedBytes: 0,
                    totalBytes: 0,
                    processedFiles: 0,
                    resultPath: '/tmp/repo'),
              ]),
            )),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
        useTermux: false,
      );
      expect(container.read(cloneProvider).status, CloneStatus.done);

      notifier.reset();
      expect(container.read(cloneProvider).status, CloneStatus.idle);
    });

    test('error phase transitions state to error', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) =>
            _StubConfigNotifier(const MobileConfig(githubToken: 't'))),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(
              token,
              stream: Stream.fromIterable([
                const CloneProgress(
                    phase: ClonePhase.error,
                    receivedBytes: 0,
                    totalBytes: null,
                    processedFiles: 0,
                    errorMessage: 'HTTP 404'),
              ]),
            )),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
        useTermux: false,
      );

      final state = container.read(cloneProvider);
      expect(state.status, CloneStatus.error);
      expect(state.errorMessage, 'HTTP 404');
    });

    test('useTermux=true delegates to GitCloneService', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) =>
            _StubConfigNotifier(const MobileConfig(githubToken: 't'))),
        gitCloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGitCloneService(stream: Stream.fromIterable([
              const CloneProgress(
                  phase: ClonePhase.downloading,
                  receivedBytes: 0,
                  totalBytes: null,
                  processedFiles: 0),
              const CloneProgress(
                  phase: ClonePhase.done,
                  receivedBytes: 0,
                  totalBytes: null,
                  processedFiles: 3,
                  totalFiles: 3,
                  resultPath: '/tmp/repo'),
            ]))),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
        useTermux: true,
      );

      final state = container.read(cloneProvider);
      expect(state.status, CloneStatus.done);
      expect(state.resultPath, '/tmp/repo');
    });

    test('useTermux=true error phase transitions to error state', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) =>
            _StubConfigNotifier(const MobileConfig(githubToken: 't'))),
        gitCloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGitCloneService(stream: Stream.fromIterable([
              const CloneProgress(
                  phase: ClonePhase.error,
                  receivedBytes: 0,
                  totalBytes: null,
                  processedFiles: 0,
                  errorMessage: 'git fetch 失败'),
            ]))),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
        useTermux: true,
      );

      final state = container.read(cloneProvider);
      expect(state.status, CloneStatus.error);
      expect(state.errorMessage, 'git fetch 失败');
    });
  });
}

/// 测试用的 MobileConfigNotifier：跳过 SharedPreferences 加载，
/// 直接以构造时传入的 [MobileConfig] 作为初始 state。
class _StubConfigNotifier extends MobileConfigNotifier {
  _StubConfigNotifier(MobileConfig config) : super() {
    state = config;
  }

  @override
  Future<MobileConfig> load() async => state;
}

class _FakeGithubService extends GithubService {
  final Stream<CloneProgress> stream;
  _FakeGithubService(String token, {required this.stream})
      : super(token: token);

  @override
  Stream<CloneProgress> cloneRepository({
    required String repository,
    required String branch,
    required String targetDirectory,
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) {
    return stream;
  }
}

Stream<CloneProgress> _neverCompletingStream() {
  final controller = StreamController<CloneProgress>();
  // 不关闭，永不完成
  return controller.stream;
}

class _FakeGitCloneService extends GitCloneService {
  final Stream<CloneProgress> stream;
  _FakeGitCloneService({required this.stream}) : super(token: 't');

  @override
  Stream<CloneProgress> cloneViaTermux({
    required String repository,
    required String branch,
    required String targetDirectory,
  }) {
    return stream;
  }
}
