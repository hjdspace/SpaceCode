package com.spacecode.spacecode_mobile

import android.content.Context
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/// 前台服务 MethodChannel 桥接。
///
/// Flutter 侧通过 `spacecode/foreground_service` channel 调用：
/// - `start(title, content)`: 启动前台服务 + WakeLock
/// - `stop()`: 停止前台服务，释放 WakeLock
/// - `update(content)`: 更新通知内容（显示当前任务进度）
class ForegroundServiceBridge(private val context: Context) :
    MethodChannel.MethodCallHandler {

    companion object {
        const val CHANNEL = "spacecode/foreground_service"
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "start" -> {
                val title = call.argument<String>("title") ?: "SpaceCode Agent"
                val content = call.argument<String>("content") ?: ""
                try {
                    AgentForegroundService.start(context, title, content)
                    result.success(true)
                } catch (e: Exception) {
                    result.error("START_FAILED", e.message, null)
                }
            }
            "stop" -> {
                try {
                    AgentForegroundService.stop(context)
                    result.success(true)
                } catch (e: Exception) {
                    result.error("STOP_FAILED", e.message, null)
                }
            }
            "update" -> {
                val content = call.argument<String>("content") ?: ""
                try {
                    AgentForegroundService.update(context, content)
                    result.success(true)
                } catch (e: Exception) {
                    result.error("UPDATE_FAILED", e.message, null)
                }
            }
            else -> result.notImplemented()
        }
    }
}
