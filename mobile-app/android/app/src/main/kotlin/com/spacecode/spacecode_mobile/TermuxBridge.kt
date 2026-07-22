package com.spacecode.spacecode_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.app.PendingIntent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.atomic.AtomicInteger

/// Termux 桥接插件。
///
/// 通过 Termux 的 `RunCommandService` 在 Termux 环境中执行命令，
/// 并通过 `PendingIntent` + `BroadcastReceiver` 接收执行结果。
///
/// 前置条件：
/// 1. 用户已安装 Termux（`com.termux`）
/// 2. Termux 设置中 `allow-external-apps=true`（`~/.termux/termux.properties`）
/// 3. 本 app 声明了 `com.termux.permission.RUN_COMMAND` 权限
class TermuxBridge(private val context: Context) : MethodChannel.MethodCallHandler {

    companion object {
        const val CHANNEL = "spacecode/termux"
        private const val TAG = "TermuxBridge"

        private const val TERMUX_PACKAGE = "com.termux"
        private const val RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService"
        private const val ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND"

        // RunCommandService extras
        private const val EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH"
        private const val EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
        private const val EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR"
        private const val EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
        private const val EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT"

        // 结果回调 extras（Termux 返回的 PendingIntent 中）
        const val EXTRA_STDOUT = "stdout"
        const val EXTRA_STDERR = "stderr"
        const val EXTRA_EXIT_CODE = "exitCode"
        const val EXTRA_ERR = "err"
        const val EXTRA_ERRCD = "errcd"

        // Termux 前缀路径
        const val TERMUX_PREFIX = "/data/data/com.termux/files/usr"
    }

    private val requestCodeCounter = AtomicInteger(0)
    private val handler = Handler(Looper.getMainLooper())
    private val activeReceivers = mutableMapOf<Int, BroadcastReceiver>()

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isInstalled" -> result.success(isInstalled())
            "runCommand" -> {
                val command = call.argument<String>("command") ?: ""
                val args = call.argument<List<String>>("args") ?: emptyList()
                val workdir = call.argument<String>("workdir")
                val timeoutMs = call.argument<Long>("timeoutMs") ?: 30000L
                runCommand(command, args, workdir, timeoutMs, result)
            }
            else -> result.notImplemented()
        }
    }

    /// 检测 Termux 是否安装。
    fun isInstalled(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(
                    TERMUX_PACKAGE,
                    android.content.pm.PackageManager.PackageInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    /// 通过 Termux RunCommandService 执行命令。
    ///
    /// 流程：
    /// 1. 构造 Intent 调用 RunCommandService
    /// 2. 创建 PendingIntent + BroadcastReceiver 接收结果
    /// 3. 超时自动清理
    private fun runCommand(
        command: String,
        args: List<String>,
        workdir: String?,
        timeoutMs: Long,
        result: MethodChannel.Result,
    ) {
        if (!isInstalled()) {
            result.error("TERMUX_NOT_INSTALLED", "Termux is not installed", null)
            return
        }

        // 命令路径：如果是绝对路径直接用，否则拼接 Termux prefix
        val commandPath = if (command.startsWith("/")) command else "$TERMUX_PREFIX/bin/$command"

        val requestCode = requestCodeCounter.incrementAndGet()
        val resultAction = "spacecode.termux.RESULT_$requestCode"

        val timeoutRunnable = Runnable {
            synchronized(activeReceivers) {
                activeReceivers.remove(requestCode)?.let { receiver ->
                    try {
                        context.unregisterReceiver(receiver)
                    } catch (e: Exception) {
                        // 已注销
                    }
                }
            }
            result.error("TIMEOUT", "Command timed out after ${timeoutMs}ms", null)
        }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                handler.removeCallbacks(timeoutRunnable)
                synchronized(activeReceivers) {
                    activeReceivers.remove(requestCode)
                }
                try {
                    context.unregisterReceiver(this)
                } catch (e: Exception) {
                    // 已注销
                }

                if (intent == null) {
                    result.error("NO_RESULT", "Received null intent", null)
                    return
                }

                val err = intent.getStringExtra(EXTRA_ERR)
                val errcd = intent.getIntExtra(EXTRA_ERRCD, -1)
                if (err != null || errcd != -1) {
                    result.error(
                        "TERMUX_ERROR",
                        err ?: "Unknown Termux error (code=$errcd)",
                        mapOf("errcd" to errcd)
                    )
                    return
                }

                val stdout = intent.getStringExtra(EXTRA_STDOUT) ?: ""
                val stderr = intent.getStringExtra(EXTRA_STDERR) ?: ""
                val exitCode = intent.getIntExtra(EXTRA_EXIT_CODE, -1)

                result.success(
                    mapOf(
                        "stdout" to stdout,
                        "stderr" to stderr,
                        "exitCode" to exitCode
                    )
                )
            }
        }

        // 注册 BroadcastReceiver
        synchronized(activeReceivers) {
            activeReceivers[requestCode] = receiver
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, IntentFilter(resultAction), Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, IntentFilter(resultAction))
        }

        // 构造 PendingIntent
        val resultIntent = Intent(resultAction)
        resultIntent.setPackage(context.packageName)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getBroadcast(context, requestCode, resultIntent, flags)

        // 构造 RunCommand Intent
        val runIntent = Intent().apply {
            action = ACTION_RUN_COMMAND
            setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE)
            putExtra(EXTRA_COMMAND_PATH, commandPath)
            putExtra(EXTRA_ARGUMENTS, args.toTypedArray())
            if (workdir != null) putExtra(EXTRA_WORKDIR, workdir)
            putExtra(EXTRA_BACKGROUND, true)
            putExtra(EXTRA_PENDING_INTENT, pendingIntent)
        }

        try {
            context.startService(runIntent)
        } catch (e: Exception) {
            handler.removeCallbacks(timeoutRunnable)
            synchronized(activeReceivers) {
                activeReceivers.remove(requestCode)
            }
            try {
                context.unregisterReceiver(receiver)
            } catch (e2: Exception) {
                // 忽略
            }
            Log.e(TAG, "Failed to start Termux RunCommandService", e)
            result.error(
                "START_FAILED",
                "Failed to start Termux service: ${e.message}. " +
                    "Ensure 'allow-external-apps=true' in ~/.termux/termux.properties",
                null
            )
            return
        }

        // 设置超时
        handler.postDelayed(timeoutRunnable, timeoutMs)
    }

    /// 清理所有活跃的 receiver。
    fun dispose() {
        synchronized(activeReceivers) {
            for (receiver in activeReceivers.values) {
                try {
                    context.unregisterReceiver(receiver)
                } catch (e: Exception) {
                    // 忽略
                }
            }
            activeReceivers.clear()
        }
    }
}
