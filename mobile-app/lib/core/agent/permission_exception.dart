import 'agent_plugin.dart';
import 'agent_types.dart';

/// 权限询问异常。
///
/// 由 [AgentPlugin.beforeToolCall] 抛出，触发 [AgentSession] 推送权限请求事件
/// 并等待用户响应。用户响应通过 [AgentSession.resolvePermission] 注入。
///
/// 流程：
/// 1. Plugin 在 beforeToolCall 中判断需要询问用户 → 抛此异常
/// 2. AgentSession 捕获异常 → 推送 permissionRequest 事件给 UI
/// 3. UI 渲染 PermissionCard → 用户点击允许/拒绝
/// 4. ChatNotifier 调用 AgentSession.resolvePermission(reqId, decision)
/// 5. 异常被解除，AgentSession 继续 _executeToolBatch
class PermissionRequestedException implements Exception {
  /// 唯一请求 ID，用于关联 UI 响应
  final String requestId;

  /// 触发权限询问的工具调用
  final AgentToolCall toolCall;

  /// 危险等级（read/write/dangerous）
  final String dangerLevel;

  /// 询问原因（用于 UI 展示）
  final String reason;

  const PermissionRequestedException({
    required this.requestId,
    required this.toolCall,
    required this.dangerLevel,
    required this.reason,
  });

  @override
  String toString() =>
      'PermissionRequestedException($requestId, tool=${toolCall.name}, level=$dangerLevel)';
}

/// 权限询问结果回调签名。
///
/// Plugin 抛出 [PermissionRequestedException] 时，由 AgentSession 调用此回调
/// 推送事件给上层（ChatNotifier），等待用户响应后通过 Completer 解锁。
typedef PermissionRequestHandler = Future<AgentToolDecision> Function(
    PermissionRequestedException request);
