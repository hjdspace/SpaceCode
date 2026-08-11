import 'dart:io';

import 'package:flutter/services.dart';

/// 前台服务封装（仅 Android）。
///
/// 在 LLM 任务运行期间启动 Android 前台服务 + PARTIAL_WAKE_LOCK，
/// 防止手机息屏后系统进入 Doze 模式导致：
/// 1. HTTP 流式连接被断开
/// 2. Dart isolate 被挂起
/// 3. 整个 Agent 任务异常终止
///
/// 使用引用计数管理生命周期，支持多会话并行：
/// - [acquire] 计数 +1，首次调用（0→1）真正启动服务
/// - [release] 计数 -1，归零时（1→0）真正停止服务
/// - [update] 更新通知内容（显示当前任务进度）
///
/// iOS 不支持前台服务，所有方法为 no-op。
class ForegroundService {
  static const _channel = MethodChannel('spacecode/foreground_service');

  /// 当前活跃的任务数（引用计数）
  static int _refCount = 0;

  /// 是否支持前台服务（仅 Android）
  static bool get isSupported => Platform.isAndroid;

  /// 获取前台服务是否正在运行
  static bool get isRunning => _refCount > 0;

  /// 启动前台服务（引用计数 +1）。
  ///
  /// [title] 通知标题（如 "SpaceCode Agent"）
  /// [content] 通知内容（如 "任务执行中..."）
  ///
  /// 首次调用（计数 0→1）时通过 MethodChannel 启动原生服务，
  /// 后续调用仅增加计数，不重复启动。
  static Future<void> acquire(String title, String content) async {
    _refCount++;
    if (_refCount == 1 && isSupported) {
      try {
        await _channel.invokeMethod('start', {
          'title': title,
          'content': content,
        });
      } on PlatformException {
        // 启动失败不阻断任务（如用户拒绝通知权限），降级为无前台服务运行
        _refCount = 0;
      }
    }
  }

  /// 释放前台服务（引用计数 -1）。
  ///
  /// 计数归零时（1→0）通过 MethodChannel 停止原生服务。
  static Future<void> release() async {
    if (_refCount > 0) _refCount--;
    if (_refCount == 0 && isSupported) {
      try {
        await _channel.invokeMethod('stop');
      } on PlatformException {
        // 忽略：服务可能已停止
      }
    }
  }

  /// 更新通知内容（显示当前任务进度）。
  ///
  /// 仅在服务运行时有效，否则为 no-op。
  static Future<void> update(String content) async {
    if (_refCount > 0 && isSupported) {
      try {
        await _channel.invokeMethod('update', {'content': content});
      } on PlatformException {
        // 忽略：更新失败不影响任务
      }
    }
  }

  /// 强制停止并重置引用计数（用于应用退出时的兜底清理）。
  static Future<void> forceStop() async {
    _refCount = 0;
    if (isSupported) {
      try {
        await _channel.invokeMethod('stop');
      } on PlatformException {
        // 忽略
      }
    }
  }
}
