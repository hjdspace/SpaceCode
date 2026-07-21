import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import 'binary_resolver.dart';

/// Git 二进制解压器。
///
/// 负责从 Flutter assets 中解压预编译的 git 二进制到 App 专属 bin 目录，
/// 并通过 SHA-256 校验完整性。成功后注册到 [BinaryResolver]。
///
/// 资源命名约定：
/// - 清单文件：`assets/binaries/git-manifest.json`
/// - 二进制文件：`assets/binaries/git-{abi}`（如 git-arm64-v8a）
///
/// 清单格式：
/// ```json
/// {
///   "version": "2.43.0",
///   "binaries": {
///     "arm64-v8a": { "asset": "assets/binaries/git-arm64-v8a", "sha256": "..." },
///     "armeabi-v7a": { "asset": "assets/binaries/git-armeabi-v7a", "sha256": "..." },
///     "x86_64": { "asset": "assets/binaries/git-x86_64", "sha256": "..." }
///   }
/// }
/// ```
///
/// 当 assets 中不存在清单文件时（开发模式或未捆绑 git），[extract] 返回 null，
/// GitPlugin 不会加载，Agent 降级为无 git 能力。
class GitBinaryExtractor {
  /// 从 assets 解压 git 二进制并注册到 [BinaryResolver]。
  ///
  /// 返回值：
  /// - 成功：git 二进制的绝对路径
  /// - 未找到 assets 或校验失败：null
  ///
  /// [abiOverride] 用于测试时注入指定 ABI，默认从 `Platform.operatingSystem`
  /// 推断（Android 走 `_detectAndroidAbi`）。
  static Future<String?> extract({
    String? abiOverride,
    Future<Directory> Function()? docsDirectoryProvider,
    Future<ByteData> Function(String)? assetLoader,
    BinaryResolver? resolver,
  }) async {
    final binaryResolver = resolver ?? BinaryResolver.instance;
    if (!binaryResolver.isInitialized) return null;
    final loader = assetLoader ?? rootBundle.load;

    // 1. 加载清单
    final ByteData manifestData;
    try {
      manifestData = await loader('assets/binaries/git-manifest.json');
    } catch (_) {
      // 未捆绑 git 二进制，优雅降级
      return null;
    }

    Map<String, dynamic> manifest;
    try {
      manifest =
          jsonDecode(utf8.decode(manifestData.buffer.asUint8List()))
              as Map<String, dynamic>;
    } catch (_) {
      return null;
    }

    final binaries = manifest['binaries'] as Map<String, dynamic>?;
    if (binaries == null || binaries.isEmpty) return null;

    // 2. 选择当前 ABI 对应的二进制
    final abi = abiOverride ?? _detectAbi();
    if (abi == null) return null;
    final entry = binaries[abi] as Map<String, dynamic>?;
    if (entry == null) return null;

    final assetPath = entry['asset'] as String?;
    final expectedSha256 = entry['sha256'] as String?;
    if (assetPath == null || assetPath.isEmpty) return null;

    // 3. 加载二进制数据
    final ByteData binaryData;
    try {
      binaryData = await loader(assetPath);
    } catch (_) {
      return null;
    }

    final bytes = binaryData.buffer.asUint8List();

    // 4. SHA-256 校验（若清单提供了 sha256）
    if (expectedSha256 != null && expectedSha256.isNotEmpty) {
      final actualHash = _sha256Hex(bytes);
      if (actualHash.toLowerCase() != expectedSha256.toLowerCase()) {
        return null;
      }
    }

    // 5. 写入 bin 目录并设置可执行权限
    final docs = await (docsDirectoryProvider ??
        getApplicationDocumentsDirectory)();
    final binDir = Directory('${docs.path}/spacecode/bin');
    if (!await binDir.exists()) {
      await binDir.create(recursive: true);
    }
    final gitFile = File('${binDir.path}/git');
    await gitFile.writeAsBytes(bytes, flush: true);

    // 设置可执行权限（Unix only）
    if (!Platform.isWindows) {
      final result = await Process.run('chmod', ['755', gitFile.path]);
      if (result.exitCode != 0) {
        // chmod 失败不致命：某些 Android 环境 chmod 无效但文件默认可执行
      }
    }

    // 6. 注册到 BinaryResolver
    binaryResolver.registerGitBinary(gitFile.path);
    return gitFile.path;
  }

  /// 检测当前设备的 ABI。
  ///
  /// Android 通过 `Platform.operatingSystem` + 环境变量 `ANDROID_ABI` 推断；
  /// 无法确定时返回 null。
  ///
  /// 注意：真正的 ABI 检测需要 platform channel（`android.os.Build.SUPPORTED_ABIS`），
  /// 这里使用简化版本。生产环境应通过 MethodChannel 获取。
  static String? _detectAbi() {
    if (Platform.isAndroid) {
      // 优先从环境变量读取（由 MainActivity 注入）
      // 退化到 arm64-v8a（2024+ Android 主流）
      return const String.fromEnvironment('ANDROID_ABI',
          defaultValue: 'arm64-v8a');
    }
    if (Platform.isLinux || Platform.isMacOS || Platform.isWindows) {
      // 桌面开发/测试模式：使用系统 git
      return 'host';
    }
    return null;
  }

  /// 计算字节数组的 SHA-256 哈希（十六进制小写）。
  static String _sha256Hex(List<int> bytes) {
    // 使用 dart:io 的 Process 调用 sha256sum 不够可靠，
    // 这里用纯 Dart 实现的 SHA-256。
    // 为避免引入 crypto 包的额外依赖，使用内联实现。
    final hash = _Sha256().hash(bytes);
    return hash.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }
}

/// 纯 Dart SHA-256 实现（避免引入 crypto 包依赖）。
class _Sha256 {
  static const List<int> _k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  List<int> hash(List<int> input) {
    final padded = _pad(input);
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (var offset = 0; offset < padded.length; offset += 64) {
      final w = List<int>.filled(64, 0);
      for (var i = 0; i < 16; i++) {
        w[i] = (padded[offset + i * 4] << 24) |
            (padded[offset + i * 4 + 1] << 16) |
            (padded[offset + i * 4 + 2] << 8) |
            padded[offset + i * 4 + 3];
      }
      for (var i = 16; i < 64; i++) {
        final s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        final s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xFFFFFFFF;
      }

      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (var i = 0; i < 64; i++) {
        final s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
        final ch = (e & f) ^ (~e & g);
        final temp1 = (h + s1 + ch + _k[i] + w[i]) & 0xFFFFFFFF;
        final s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
        final maj = (a & b) ^ (a & c) ^ (b & c);
        final temp2 = (s0 + maj) & 0xFFFFFFFF;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) & 0xFFFFFFFF;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) & 0xFFFFFFFF;
      }

      h0 = (h0 + a) & 0xFFFFFFFF;
      h1 = (h1 + b) & 0xFFFFFFFF;
      h2 = (h2 + c) & 0xFFFFFFFF;
      h3 = (h3 + d) & 0xFFFFFFFF;
      h4 = (h4 + e) & 0xFFFFFFFF;
      h5 = (h5 + f) & 0xFFFFFFFF;
      h6 = (h6 + g) & 0xFFFFFFFF;
      h7 = (h7 + h) & 0xFFFFFFFF;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7];
  }

  List<int> _pad(List<int> input) {
    final originalLength = input.length;
    final bitLength = originalLength * 8;
    final padded = List<int>.from(input);
    padded.add(0x80);
    while (padded.length % 64 != 56) {
      padded.add(0);
    }
    // 追加 64 位大端长度
    for (var i = 7; i >= 0; i--) {
      padded.add((bitLength >> (i * 8)) & 0xFF);
    }
    return padded;
  }

  int _rotr(int value, int count) {
    return ((value >> count) | (value << (32 - count))) & 0xFFFFFFFF;
  }
}
