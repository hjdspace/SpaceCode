import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/binary_resolver.dart';
import 'package:spacecode_mobile/core/agent/termux_bridge.dart';
import 'package:spacecode_mobile/core/agent/termux_readiness_checker.dart';

void main() {
  group('TermuxReadinessChecker', () {
    test('returns notInstalled when checkInstalled returns false', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(installed: false),
      );
      expect(await checker.check(), TermuxReadiness.notInstalled);
    });

    test('returns ready when git --version succeeds with valid output', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionResult: const TermuxResult(
            exitCode: 0,
            stdout: 'git version 2.45.0',
            stderr: '',
            durationMs: 100,
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.ready);
    });

    test('returns installedNoGit when git --version exits non-zero', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionResult: const TermuxResult(
            exitCode: 127,
            stdout: '',
            stderr: 'git: command not found',
            durationMs: 50,
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });

    test('returns installedNoGit when git --version throws PlatformException', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionException: PlatformException(
            code: 'START_FAILED',
            message: 'allow-external-apps not configured',
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });

    test('returns installedNoGit when stdout lacks "git version"', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionResult: const TermuxResult(
            exitCode: 0,
            stdout: 'unexpected output',
            stderr: '',
            durationMs: 10,
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });
  });
}

/// Stub TermuxBridge —— 通过子类化覆盖方法,避免触发 MethodChannel(测试环境未注册)。
class _FakeTermuxBridge extends TermuxBridge {
  final bool installed;
  final TermuxResult? versionResult;
  final PlatformException? versionException;

  _FakeTermuxBridge({
    required this.installed,
    this.versionResult,
    this.versionException,
  }) : super.forTesting();

  @override
  Future<bool> checkInstalled() async => installed;

  @override
  Future<TermuxResult> runGit({
    required List<String> args,
    String? workdir,
    int timeoutMs = 30000,
  }) async {
    if (versionException != null) throw versionException!;
    return versionResult!;
  }
}
