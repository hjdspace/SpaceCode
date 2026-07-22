import 'package:flutter/services.dart';

import 'binary_resolver.dart';
import 'termux_bridge.dart';

/// 检测 Termux 就绪状态(三态)。
///
/// 通过 [TermuxBridge.checkInstalled] 检测是否安装,
/// 再通过 `git --version` 验证 allow-external-apps + git 可用性。
///
/// 生产用法:`await TermuxReadinessChecker().check()`
/// 测试用法:传入 mock [bridge]
class TermuxReadinessChecker {
  final TermuxBridge bridge;

  TermuxReadinessChecker({TermuxBridge? bridge})
      : bridge = bridge ?? TermuxBridge.instance;

  /// 执行检测,返回三态之一。
  Future<TermuxReadiness> check() async {
    if (!await bridge.checkInstalled()) {
      return TermuxReadiness.notInstalled;
    }
    try {
      final result = await bridge.runGit(
        args: const ['--version'],
        timeoutMs: 5000,
      );
      if (result.exitCode == 0 && result.stdout.contains('git version')) {
        return TermuxReadiness.ready;
      }
      return TermuxReadiness.installedNoGit;
    } on PlatformException {
      // START_FAILED 通常意味着 allow-external-apps 未配置
      return TermuxReadiness.installedNoGit;
    }
  }
}
