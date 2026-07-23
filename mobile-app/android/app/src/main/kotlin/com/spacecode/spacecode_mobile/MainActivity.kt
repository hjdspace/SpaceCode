package com.spacecode.spacecode_mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    private var pythonBridge: PythonBridge? = null
    private var termuxBridge: TermuxBridge? = null
    private var foregroundServiceBridge: ForegroundServiceBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // 注册 Python 桥接 MethodChannel
        val bridge = PythonBridge(this)
        pythonBridge = bridge
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PythonBridge.CHANNEL)
            .setMethodCallHandler(bridge)

        // 注册 Termux 桥接 MethodChannel
        val termux = TermuxBridge(this)
        termuxBridge = termux
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, TermuxBridge.CHANNEL)
            .setMethodCallHandler(termux)

        // 注册前台服务 MethodChannel（保持 LLM 任务在息屏后继续运行）
        val fgBridge = ForegroundServiceBridge(this)
        foregroundServiceBridge = fgBridge
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, ForegroundServiceBridge.CHANNEL)
            .setMethodCallHandler(fgBridge)
    }

    override fun onDestroy() {
        pythonBridge?.dispose()
        pythonBridge = null
        termuxBridge?.dispose()
        termuxBridge = null
        // 停止前台服务（防止应用销毁后通知残留）
        AgentForegroundService.stop(this)
        foregroundServiceBridge = null
        super.onDestroy()
    }
}
