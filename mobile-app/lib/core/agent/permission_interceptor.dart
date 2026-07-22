import 'command_classifier.dart';
import 'agent_plugin.dart';
import 'agent_types.dart';
import 'permission_exception.dart';

/// 横切权限拦截 Plugin。
///
/// 不提供任何工具，只实现 [beforeToolCall] 钩子，对其他所有 Plugin 的
/// 工具调用生效。可单独单测、可独立开关。
///
/// 决策矩阵（行=permissionMode，列=dangerLevel）：
///
/// | mode \ level   | read       | write      | dangerous |
/// |----------------|------------|------------|-----------|
/// | default        | allow      | ask user   | ask user  |
/// | plan           | allow      | deny       | deny      |
/// | acceptEdits    | allow      | allow      | ask user  |
/// | bypassPermissions | allow   | allow      | allow     |
///
/// "ask user" 通过抛 [PermissionRequestedException] 实现，由 [AgentSession]
/// 推送事件给 UI 并等待用户响应。
class PermissionInterceptorPlugin extends AgentPlugin {
  /// 用于生成权限请求唯一 ID 的工厂。
  ///
  /// 测试时可注入固定 ID 生成器以简化断言。
  final String Function() requestIdFactory;

  PermissionInterceptorPlugin({
    String Function()? requestIdFactory,
  }) : requestIdFactory = requestIdFactory ?? _defaultRequestIdFactory;

  static int _counter = 0;

  static String _defaultRequestIdFactory() {
    _counter += 1;
    return 'perm-${DateTime.now().millisecondsSinceEpoch}-$_counter';
  }

  @override
  Future<AgentToolDecision> beforeToolCall(
    AgentToolCall call, {
    String permissionMode = PermissionMode.defaultMode,
  }) async {
    final dangerLevel = CommandClassifier.classify(call.name, call.arguments);

    switch (permissionMode) {
      case PermissionMode.plan:
        switch (dangerLevel) {
          case DangerLevel.read:
            return const AgentToolDecision.allow();
          case DangerLevel.write:
          case DangerLevel.dangerous:
            return const AgentToolDecision.deny(
                'Plan 模式下禁止任何写/危险操作');
        }

      case PermissionMode.acceptEdits:
        switch (dangerLevel) {
          case DangerLevel.read:
          case DangerLevel.write:
            return const AgentToolDecision.allow();
          case DangerLevel.dangerous:
            throw PermissionRequestedException(
              requestId: requestIdFactory(),
              toolCall: call,
              dangerLevel: _levelName(dangerLevel),
              reason: '危险操作需要用户确认',
            );
        }

      case PermissionMode.bypassPermissions:
        return const AgentToolDecision.allow();

      case PermissionMode.defaultMode:
      default:
        switch (dangerLevel) {
          case DangerLevel.read:
            return const AgentToolDecision.allow();
          case DangerLevel.write:
          case DangerLevel.dangerous:
            throw PermissionRequestedException(
              requestId: requestIdFactory(),
              toolCall: call,
              dangerLevel: _levelName(dangerLevel),
              reason: dangerLevel == DangerLevel.dangerous
                  ? '危险操作需要用户确认'
                  : '写操作需要用户确认',
            );
        }
    }
  }

  String _levelName(DangerLevel level) {
    switch (level) {
      case DangerLevel.read:
        return 'read';
      case DangerLevel.write:
        return 'write';
      case DangerLevel.dangerous:
        return 'dangerous';
    }
  }
}
