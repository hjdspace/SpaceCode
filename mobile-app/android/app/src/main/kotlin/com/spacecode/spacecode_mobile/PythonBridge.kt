package com.spacecode.spacecode_mobile

import android.content.Context
import android.util.Log
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Python 桥接器：处理 MethodChannel `spacecode/python` 的方法调用。
 *
 * 当前状态：Chaquopy 16.0.0 不兼容 Gradle 9，暂时未集成。
 * 所有方法返回未集成响应，PythonPlugin 在 Dart 端优雅降级不加载。
 *
 * 待 Chaquopy 发布兼容 Gradle 9 的版本后，
 * 恢复 Chaquopy 依赖和完整实现（见 git history: a73f2c2ae）。
 */
class PythonBridge(private val context: Context) : MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "PythonBridge"
        const val CHANNEL = "spacecode/python"
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "init" -> {
                // Chaquopy 未集成，返回 false
                Log.i(TAG, "init called but Chaquopy not integrated (Gradle 9 incompatibility)")
                result.success(false)
            }
            "isReady" -> result.success(false)
            "runCode", "runFile" -> {
                result.success(mapOf(
                    "exit_code" to -1,
                    "stdout" to "",
                    "stderr" to "Python not available: Chaquopy not integrated",
                    "duration_ms" to 0,
                    "timed_out" to false
                ))
            }
            else -> result.notImplemented()
        }
    }

    /// 释放资源
    fun dispose() {
        // 无资源需要释放
    }
}
