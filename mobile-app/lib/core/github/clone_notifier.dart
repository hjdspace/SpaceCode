import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/mobile_config.dart';
import 'clone_progress.dart';
import 'git_clone_service.dart';
import 'github_service.dart';

/// Clone 任务状态。
enum CloneStatus { idle, running, done, error }

/// Clone 任务状态快照。
class CloneState {
  final CloneStatus status;
  final CloneProgress? progress;
  final String? resultPath;
  final String? errorMessage;
  final String? repositoryName;

  const CloneState({
    required this.status,
    this.progress,
    this.resultPath,
    this.errorMessage,
    this.repositoryName,
  });

  static const idle = CloneState(status: CloneStatus.idle);

  CloneState copyWith({
    CloneStatus? status,
    CloneProgress? progress,
    String? resultPath,
    String? errorMessage,
    String? repositoryName,
    bool clearProgress = false,
  }) =>
      CloneState(
        status: status ?? this.status,
        progress: clearProgress ? null : progress ?? this.progress,
        resultPath: resultPath ?? this.resultPath,
        errorMessage: errorMessage ?? this.errorMessage,
        repositoryName: repositoryName ?? this.repositoryName,
      );
}

/// GithubService 工厂 Provider：默认返回真实 [GithubService]，
/// 测试时可 override 返回 mock service。
final cloneServiceFactoryProvider =
    Provider<GithubService Function(String token)>((ref) {
  return (token) => GithubService(token: token);
});

/// GitCloneService 工厂 Provider:测试时可 override。
final gitCloneServiceFactoryProvider =
    Provider<GitCloneService Function(String token)>((ref) {
  return (token) => GitCloneService(token: token);
});

/// Clone 任务的后台 StateNotifier。
///
/// 生命周期独立于设置页：StateNotifier 持有任务 Future，
/// 用户退出设置页后任务继续运行，再次进入设置页时通过
/// [cloneProvider] 监听最新状态。
class CloneNotifier extends StateNotifier<CloneState> {
  final Ref _ref;
  Completer<void>? _abortCompleter;
  bool _cancelled = false;
  Future<void>? _task;

  CloneNotifier(this._ref) : super(CloneState.idle);

  /// 启动后台 clone 任务。若已有任务运行中，抛 [StateError]。
  Future<void> startClone({
    required String repository,
    required String branch,
    required String targetDirectory,
    required bool useTermux,
  }) async {
    if (state.status == CloneStatus.running) {
      throw StateError('已有 clone 任务运行中');
    }
    final token = _ref.read(mobileConfigProvider).githubToken;
    if (token.isEmpty) {
      throw StateError('未连接 GitHub');
    }
    _abortCompleter = Completer<void>();
    _cancelled = false;
    state = CloneState(
      status: CloneStatus.running,
      progress: null,
      repositoryName: repository,
    );
    _task = useTermux
        ? _runTermuxTask(
            token: token,
            repository: repository,
            branch: branch,
            targetDirectory: targetDirectory,
          )
        : _runZipballTask(
            token: token,
            repository: repository,
            branch: branch,
            targetDirectory: targetDirectory,
          );
    await _task;
  }

  Future<void> _runZipballTask({
    required String token,
    required String repository,
    required String branch,
    required String targetDirectory,
  }) async {
    final service = _ref.read(cloneServiceFactoryProvider)(token);
    try {
      await for (final progress in service.cloneRepository(
        repository: repository,
        branch: branch,
        targetDirectory: targetDirectory,
        abortTrigger: _abortCompleter?.future,
        isCancelled: () => _cancelled,
      )) {
        _emitProgress(progress, repository);
      }
    } catch (error) {
      state = CloneState(
        status: CloneStatus.error,
        errorMessage: error.toString(),
        repositoryName: repository,
      );
    } finally {
      service.dispose();
    }
  }

  Future<void> _runTermuxTask({
    required String token,
    required String repository,
    required String branch,
    required String targetDirectory,
  }) async {
    final service = _ref.read(gitCloneServiceFactoryProvider)(token);
    try {
      await for (final progress in service.cloneViaTermux(
        repository: repository,
        branch: branch,
        targetDirectory: targetDirectory,
      )) {
        _emitProgress(progress, repository);
        if (_cancelled) {
          state = CloneState(
            status: CloneStatus.error,
            errorMessage: '已取消',
            repositoryName: repository,
          );
          return;
        }
      }
    } catch (error) {
      state = CloneState(
        status: CloneStatus.error,
        errorMessage: error.toString(),
        repositoryName: repository,
      );
    }
  }

  /// 把 CloneProgress 映射到 CloneState。
  void _emitProgress(CloneProgress progress, String repository) {
    if (progress.phase == ClonePhase.done) {
      state = CloneState(
        status: CloneStatus.done,
        progress: progress,
        resultPath: progress.resultPath,
        repositoryName: repository,
      );
    } else if (progress.phase == ClonePhase.error) {
      state = CloneState(
        status: CloneStatus.error,
        progress: progress,
        errorMessage: progress.errorMessage,
        repositoryName: repository,
      );
    } else {
      state = state.copyWith(
        status: CloneStatus.running,
        progress: progress,
        repositoryName: repository,
      );
    }
  }

  /// 取消当前任务。
  Future<void> cancel() async {
    _cancelled = true;
    _abortCompleter?.complete();
    // 等待任务真正结束
    await _task;
  }

  /// 清除完成/错误状态，回到 idle。
  void reset() {
    if (state.status == CloneStatus.running) return;
    state = CloneState.idle;
  }
}

final cloneProvider =
    StateNotifierProvider<CloneNotifier, CloneState>((ref) {
  return CloneNotifier(ref);
});
