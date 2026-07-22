package com.spacecode.spacecode_mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    private var pythonBridge: PythonBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // 注册 Python 桥接 MethodChannel
        val bridge = PythonBridge(this)
        pythonBridge = bridge
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PythonBridge.CHANNEL)
            .setMethodCallHandler(bridge)
    }

    override fun onDestroy() {
        pythonBridge?.dispose()
        pythonBridge = null
        super.onDestroy()
    }
}
