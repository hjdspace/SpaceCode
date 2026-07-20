import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/mobile_config.dart';
import 'clone_progress.dart';
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
  }) async {
    if (state.status == CloneStatus.running) {
      throw StateError('已有 clone 任务运行中');
    }
    final token = _ref.read(mobileConfigProvider).githubToken;
    if (token.isEmpty) {
      throw StateError('未连接 GitHub');
    }
    final service = _ref.read(cloneServiceFactoryProvider)(token);
    _abortCompleter = Completer<void>();
    _cancelled = false;
    state = CloneState(
      status: CloneStatus.running,
      progress: null,
      repositoryName: repository,
    );
    _task = _runTask(
      service: service,
      repository: repository,
      branch: branch,
      targetDirectory: targetDirectory,
    );
    await _task;
  }

  Future<void> _runTask({
    required GithubService service,
    required String repository,
    required String branch,
    required String targetDirectory,
  }) async {
    try {
      await for (final progress in service.cloneRepository(
        repository: repository,
        branch: branch,
        targetDirectory: targetDirectory,
        abortTrigger: _abortCompleter?.future,
        isCancelled: () => _cancelled,
      )) {
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
