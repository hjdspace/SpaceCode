import '../agent/termux_bridge.dart';
import 'clone_progress.dart';

/// 通过 Termux 执行真正的 `git clone`,产出含 `.git` 的完整仓库。
///
/// 采用分段执行策略(规格 §6.1 降级路径):
/// 1. `git init` → ClonePhase.downloading
/// 2. `git remote add origin <url-with-token>` → ClonePhase.downloading
/// 3. `git fetch origin <branch>` → ClonePhase.extracting
/// 4. `git checkout <branch>` → ClonePhase.extracting
/// 5. `git remote set-url origin <clean-url>` (清除 token) → ClonePhase.done
///
/// 每段用阻塞式 [TermuxBridge.runGit],进度为四段式阶段进度。
/// 目录准备(删除/创建目标目录)由调用方负责。
class GitCloneService {
  final String token;
  final TermuxBridge bridge;

  GitCloneService({
    required this.token,
    TermuxBridge? bridge,
  }) : bridge = bridge ?? TermuxBridge.instance;

  /// 执行 git clone,流式推送进度。
  Stream<CloneProgress> cloneViaTermux({
    required String repository, // owner/repo
    required String branch,
    required String targetDirectory,
  }) async* {
    final tokenUrl =
        'https://x-access-token:$token@github.com/$repository.git';
    final cleanUrl = 'https://github.com/$repository.git';

    // 阶段 1: git init
    yield const CloneProgress(
      phase: ClonePhase.downloading,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final initResult = await bridge.runGit(
      args: ['init', targetDirectory],
    );
    if (initResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage: 'git init 失败: ${_sanitize(initResult.stderr, token)}',
      );
      return;
    }

    // 阶段 2: git remote add origin <url-with-token>
    yield const CloneProgress(
      phase: ClonePhase.downloading,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final remoteResult = await bridge.runGit(
      args: ['remote', 'add', 'origin', tokenUrl],
      workdir: targetDirectory,
    );
    if (remoteResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage:
            'git remote add 失败: ${_sanitize(remoteResult.stderr, token)}',
      );
      return;
    }

    // 阶段 3: git fetch origin <branch>
    yield const CloneProgress(
      phase: ClonePhase.extracting,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final fetchResult = await bridge.runGit(
      args: ['fetch', 'origin', branch],
      workdir: targetDirectory,
      timeoutMs: 300000, // fetch 可能较慢,5 分钟
    );
    if (fetchResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage:
            'git fetch 失败: ${_sanitize(fetchResult.stderr, token)}',
      );
      return;
    }

    // 阶段 4: git checkout <branch>
    yield const CloneProgress(
      phase: ClonePhase.extracting,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final checkoutResult = await bridge.runGit(
      args: ['checkout', branch],
      workdir: targetDirectory,
    );
    if (checkoutResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage:
            'git checkout 失败: ${_sanitize(checkoutResult.stderr, token)}',
      );
      return;
    }

    // 阶段 5: 清除 remote URL 中的 token
    await bridge.runGit(
      args: ['remote', 'set-url', 'origin', cleanUrl],
      workdir: targetDirectory,
    );

    // 统计文件数
    final lsResult = await bridge.runGit(
      args: ['ls-files'],
      workdir: targetDirectory,
    );
    final fileCount = lsResult.stdout.split('\n').where((l) => l.isNotEmpty).length;

    yield CloneProgress(
      phase: ClonePhase.done,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: fileCount,
      totalFiles: fileCount,
      resultPath: targetDirectory,
    );
  }

  /// 脱敏 stderr 中的 token。
  String _sanitize(String text, String token) {
    if (token.isEmpty) return text;
    final masked = token.length > 4
        ? '${token.substring(0, 4)}****'
        : '****';
    return text.replaceAll(token, masked);
  }
}
