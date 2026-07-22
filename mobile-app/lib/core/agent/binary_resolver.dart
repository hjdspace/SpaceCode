import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Termux 就绪状态。
enum TermuxReadiness {
  /// 未安装 Termux
  notInstalled,
  /// 已安装 Termux 但 git 不可用(未 pkg install git 或未配置 allow-external-apps)
  installedNoGit,
  /// 完全就绪:Termux 已安装 + git 可执行
  ready,
}

/// 二进制路径解析与环境变量管理。
///
/// 启动时通过 [initialize] 创建 App 专属的 `home` 和 `bin` 目录，
/// 构建 PATH 环境变量（包含 `_binDir` + 系统路径 + git 二进制所在目录），
/// 并暴露 [gitPath] / [pythonReady] 供 Plugin 层做条件加载。
///
/// 设计目标：
/// - 单例 [instance] 用于生产（main.dart 启动时调用 initialize）
/// - 测试时直接 `BinaryResolver()` 创建独立实例，通过 `docsDirectoryProvider`
///   和 `systemEnvironment` 注入 mock
/// - 阶段 3 仅实现 PATH 管理框架；git 二进制捆绑（阶段 4）和 Python 沙盒（阶段 5）
///   通过 [registerGitBinary] / [markPythonReady] 注册
class BinaryResolver {
  static final BinaryResolver instance = BinaryResolver._();

  BinaryResolver._();

  /// 测试用公开构造函数（生产代码应使用 [instance] 单例）。
  @visibleForTesting
  BinaryResolver.forTest();

  late String _homeDir;
  late String _binDir;
  late Map<String, String> _env;
  Map<String, String> _systemEnvironment = const {};
  String? _gitPath;
  bool _pythonReady = false;
  TermuxReadiness _termuxReadiness = TermuxReadiness.notInstalled;
  bool _initialized = false;

  /// 初始化：创建目录、构建环境变量。
  ///
  /// [docsDirectoryProvider] 默认调用 `getApplicationDocumentsDirectory`，
  /// 测试时可注入返回临时目录的函数。
  /// [systemEnvironment] 默认使用 `Platform.environment`，测试时可注入。
  Future<void> initialize({
    Future<Directory> Function()? docsDirectoryProvider,
    Map<String, String>? systemEnvironment,
  }) async {
    final docs =
        await (docsDirectoryProvider ?? getApplicationDocumentsDirectory)();
    _homeDir = '${docs.path}/spacecode/home';
    _binDir = '${docs.path}/spacecode/bin';
    Directory(_homeDir).createSync(recursive: true);
    Directory(_binDir).createSync(recursive: true);
    _systemEnvironment = systemEnvironment ?? Platform.environment;
    _env = _buildEnvironment();
    _initialized = true;
  }

  Map<String, String> _buildEnvironment() {
    final pathParts = <String>[
      _binDir,
      '/system/bin',
      '/system/xbin',
      '/vendor/bin',
      if (_gitPath != null) File(_gitPath!).parent.path,
    ];
    return {
      ..._systemEnvironment,
      'PATH': pathParts.join(':'),
      'HOME': _homeDir,
      'TERM': 'dumb',
      'LANG': 'en_US.UTF-8',
      'GIT_CONFIG_NOSYSTEM': '1',
      'GIT_AUTHOR_NAME': 'SpaceCode Mobile',
      'GIT_AUTHOR_EMAIL': 'mobile@spacecode.local',
      'GIT_COMMITTER_NAME': 'SpaceCode Mobile',
      'GIT_COMMITTER_EMAIL': 'mobile@spacecode.local',
    };
  }

  /// 注册已解压的 git 二进制路径（阶段 4 调用）。
  /// 调用后会自动把 git 所在目录追加到 PATH。
  void registerGitBinary(String absolutePath) {
    _gitPath = absolutePath;
    if (_initialized) {
      _env = _buildEnvironment();
    }
  }

  /// 标记 Python 沙盒已就绪（阶段 5 调用）。
  void markPythonReady() {
    _pythonReady = true;
  }

  /// 设置 Termux 就绪状态。
  ///
  /// 当 [readiness] 为 [TermuxReadiness.ready] 时,自动设置 [gitPath] 为 `termux:git`,
  /// 让 GitPlugin 通过 Termux 桥接执行。
  void setTermuxReadiness(TermuxReadiness readiness) {
    _termuxReadiness = readiness;
    if (readiness == TermuxReadiness.ready) {
      _gitPath ??= 'termux:git';
    }
  }

  /// Termux 桥接就绪状态。
  TermuxReadiness get termuxReadiness => _termuxReadiness;

  /// 标记 Termux 桥接已就绪(向后兼容)。
  ///
  /// 等价于 `setTermuxReadiness(TermuxReadiness.ready)`。
  void markTermuxReady() {
    setTermuxReadiness(TermuxReadiness.ready);
  }

  String? get gitPath => _gitPath;
  bool get pythonReady => _pythonReady;
  Map<String, String> get environment => _env;
  String get homeDir => _homeDir;
  String get binDir => _binDir;
  bool get isInitialized => _initialized;
}
