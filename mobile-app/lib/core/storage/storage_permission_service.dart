import 'dart:io';

import 'package:permission_handler/permission_handler.dart';

/// 外部存储访问权限服务。
///
/// Android 11+ (API 30+) 上，访问用户选择的外部共享目录
/// （如 `/storage/emulated/0/Documents/xxx`）需要 `MANAGE_EXTERNAL_STORAGE`
/// 权限。该权限是特殊权限，需要跳转到系统设置页让用户手动开启，
/// 不能用标准弹窗授权。
///
/// 对 Android 10 及以下，回退到 `READ_EXTERNAL_STORAGE` 标准运行时权限。
class StoragePermissionService {
  /// 检查应用是否有权访问外部存储。
  static Future<bool> hasAccess() async {
    if (!Platform.isAndroid) return true;

    if (await _isAndroidApi30OrAbove()) {
      return Permission.manageExternalStorage.status.isGranted;
    }
    return Permission.storage.status.isGranted;
  }

  /// 请求外部存储访问权限。
  ///
  /// Android 11+：跳转到"所有文件访问权限"系统设置页，用户手动开启后返回。
  /// 调用方应在调用前先弹窗解释原因。
  /// Android 10 及以下：弹出标准运行时权限对话框。
  ///
  /// 返回 `true` 表示权限已授予。
  static Future<bool> request() async {
    if (!Platform.isAndroid) return true;

    if (await _isAndroidApi30OrAbove()) {
      final status = await Permission.manageExternalStorage.status;
      if (status.isGranted) return true;
      await openAppSettings();
      // 用户从设置页返回后重新检查
      return (await Permission.manageExternalStorage.status).isGranted;
    }

    final result = await Permission.storage.request();
    return result.isGranted;
  }

  /// 打开应用系统设置页（用于用户手动修改权限）。
  static Future<void> openSettings() => openAppSettings();

  /// 是否需要引导用户去系统设置开启权限（Android 11+ 场景）。
  static Future<bool> needsSystemSettings() async {
    if (!Platform.isAndroid) return false;
    return _isAndroidApi30OrAbove();
  }

  /// 解析 Android SDK 版本号判断是否 ≥ 30（Android 11）。
  static Future<bool> _isAndroidApi30OrAbove() async {
    // Platform.operatingSystemVersion 在 Android 上返回形如 "16"（API 36）
    // 或 "Android 11" 等格式，尝试解析首个数字。
    final version = Platform.operatingSystemVersion;
    final match = RegExp(r'\d+').firstMatch(version);
    if (match == null) return true; // 无法判断时按新版本处理（更安全）
    final sdk = int.tryParse(match.group(0)!);
    return sdk == null ? true : sdk >= 30;
  }
}
