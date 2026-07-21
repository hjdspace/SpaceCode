package com.spacecode.spacecode_mobile

import android.content.Context
import android.util.Log
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Chaquopy Python 桥接器：处理 MethodChannel `spacecode/python` 的方法调用。
 *
 * 实现以下方法：
 * - `init`：初始化 Chaquopy Python 实例，写入 sitecustomize.py
 * - `isReady`：检查 Chaquopy 是否已初始化
 * - `runCode`：执行 Python 代码，返回 {exit_code, stdout, stderr, duration_ms, timed_out}
 * - `runFile`：执行 Python 文件，返回同上
 *
 * 沙盒约束：
 * - sitecustomize.py 覆盖 builtins.__import__，拦截 subprocess/socket/ctypes 等模块
 * - 超时通过 Future.cancel + Thread.interrupt 实现
 * - stdout/stderr 通过重定向 sys.stdout/sys.stderr 到 io.StringIO 捕获
 */
class PythonBridge(private val context: Context) : MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "PythonBridge"

        /// MethodChannel 名称（供 MainActivity 注册时使用）
        const val CHANNEL = "spacecode/python"

        /// Chaquopy 单例：首次 init 后全局可用
        @Volatile
        private var python: Python? = null

        /// 是否已注入 sitecustomize
        @Volatile
        private var sandboxInstalled = false
    }

    /// 单线程执行器：Python 调用串行化，避免 GIL + 线程安全问题
    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "spacecode-python").apply { isDaemon = true }
    }

    /// 正在运行的 Future（用于取消）
    private val runningTasks = ConcurrentHashMap<String, Future<*>>()

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "init" -> handleInit(call, result)
            "isReady" -> result.success(isReady())
            "runCode" -> handleRunCode(call, result)
            "runFile" -> handleRunFile(call, result)
            else -> result.notImplemented()
        }
    }

    // ---------- init ----------

    private fun handleInit(call: MethodCall, result: MethodChannel.Result) {
        try {
            if (python == null) {
                if (!Python.isStarted()) {
                    Python.start(AndroidPlatform(context))
                }
                python = Python.getInstance()
            }
            // 注入 sitecustomize.py（沙盒 import hook）
            val sitecustomize = call.argument<String>("sitecustomize") ?: ""
            if (sitecustomize.isNotEmpty()) {
                installSitecustomize(sitecustomize)
            }
            Log.i(TAG, "Chaquopy Python initialized, sandbox=${sandboxInstalled}")
            result.success(true)
        } catch (e: Exception) {
            Log.e(TAG, "Chaquopy init failed", e)
            result.success(false)
        }
    }

    /// 把 sitecustomize.py 写入 Chaquopy 的 Python 临时目录，并在 sys.path 中优先加载。
    private fun installSitecustomize(content: String) {
        try {
            val py = python ?: return
            // 写入到 App 缓存目录
            val sandboxDir = File(context.cacheDir, "spacecode-python")
            if (!sandboxDir.exists()) sandboxDir.mkdirs()
            val siteFile = File(sandboxDir, "sitecustomize.py")
            siteFile.writeText(content)

            // 在 Python 中把 sandboxDir 加入 sys.path[0]，使 sitecustomize.py 在下次 import 时生效
            val execModule = py.getModule("builtins")
            execModule.callAttr("exec", """
                import sys
                sandbox_dir = r'${sandboxDir.absolutePath}'
                if sandbox_dir not in sys.path:
                    sys.path.insert(0, sandbox_dir)
                # 立即执行一次 sitecustomize
                try:
                    import sitecustomize
                except Exception as e:
                    print(f"[SpaceCode Sandbox] sitecustomize load failed: {e}", file=sys.stderr)
            """.trimIndent())
            sandboxInstalled = true
            Log.i(TAG, "sitecustomize.py installed at ${siteFile.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to install sitecustomize", e)
            // 沙盒安装失败不致命：Python 仍可用，但无 import 限制
        }
    }

    // ---------- isReady ----------

    private fun isReady(): Boolean {
        return try {
            python != null && Python.isStarted()
        } catch (e: Exception) {
            false
        }
    }

    // ---------- runCode ----------

    private fun handleRunCode(call: MethodCall, result: MethodChannel.Result) {
        val code = call.argument<String>("code") ?: ""
        val args = call.argument<List<String>>("args") ?: emptyList()
        val stdin = call.argument<String>("stdin") ?: ""
        val timeoutMs = call.argument<Int>("timeout_ms") ?: 30000

        executePython(
            taskId = "code-${System.nanoTime()}",
            timeoutMs = timeoutMs,
            runnable = { runPythonCode(code, args, stdin) },
            result = result
        )
    }

    // ---------- runFile ----------

    private fun handleRunFile(call: MethodCall, result: MethodChannel.Result) {
        val filePath = call.argument<String>("file_path") ?: ""
        val args = call.argument<List<String>>("args") ?: emptyList()
        val stdin = call.argument<String>("stdin") ?: ""
        val timeoutMs = call.argument<Int>("timeout_ms") ?: 30000

        executePython(
            taskId = "file-${System.nanoTime()}",
            timeoutMs = timeoutMs,
            runnable = { runPythonFile(filePath, args, stdin) },
            result = result
        )
    }

    // ---------- 执行核心 ----------

    /// 在后台线程执行 Python，带超时控制
    private fun executePython(
        taskId: String,
        timeoutMs: Int,
        runnable: () -> Map<String, Any>,
        result: MethodChannel.Result
    ) {
        if (python == null) {
            result.success(mapOf(
                "exit_code" to -1,
                "stdout" to "",
                "stderr" to "Python not initialized",
                "duration_ms" to 0,
                "timed_out" to false
            ))
            return
        }

        val startMs = System.currentTimeMillis()
        val future = executor.submit<Map<String, Any>> {
            try {
                runnable()
            } catch (e: Throwable) {
                mapOf(
                    "exit_code" to -1,
                    "stdout" to "",
                    "stderr" to (e.message ?: e.toString()),
                    "duration_ms" to (System.currentTimeMillis() - startMs),
                    "timed_out" to false
                )
            }
        }
        runningTasks[taskId] = future

        try {
            val taskResult = future.get(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            result.success(taskResult)
        } catch (e: TimeoutException) {
            future.cancel(true)
            result.success(mapOf(
                "exit_code" to -1,
                "stdout" to "",
                "stderr" to "Execution timed out after ${timeoutMs}ms",
                "duration_ms" to timeoutMs,
                "timed_out" to true
            ))
        } catch (e: Exception) {
            result.success(mapOf(
                "exit_code" to -1,
                "stdout" to "",
                "stderr" to (e.message ?: e.toString()),
                "duration_ms" to (System.currentTimeMillis() - startMs),
                "timed_out" to false
            ))
        } finally {
            runningTasks.remove(taskId)
        }
    }

    /// 执行 Python 代码字符串：捕获 stdout/stderr，返回结构化结果
    private fun runPythonCode(code: String, args: List<String>, stdin: String): Map<String, Any> {
        val py = python ?: return errorResult("Python not initialized")
        val startMs = System.currentTimeMillis()

        // 通过一个 wrapper 脚本执行：重定向 stdout/stderr，捕获 exit code
        val wrapper = """
            import sys, io, traceback

            # 保存原始流
            _orig_stdout, _orig_stderr = sys.stdout, sys.stderr
            _stdout_buf, _stderr_buf = io.StringIO(), io.StringIO()
            sys.stdout, sys.stderr = _stdout_buf, _stderr_buf

            _exit_code = 0
            try:
                # 设置 sys.argv
                import sys as _sys
                _sys.argv = ['<string>'] + list(${argsToJsonArray(args)})

                # 如果有 stdin，注入到 _sys.stdin
                ${if (stdin.isNotEmpty()) "_sys.stdin = io.StringIO(${jsonString(stdin)})" else "# no stdin"}

                # 执行用户代码
                exec(compile(${jsonString(code)}, '<string>', 'exec'), {'__name__': '__main__'})
            except SystemExit as e:
                _exit_code = e.code if isinstance(e.code, int) else 1
            except Exception:
                traceback.print_exc()
                _exit_code = 1
            finally:
                sys.stdout, sys.stderr = _orig_stdout, _orig_stderr

            # 输出 JSON 结果到 Chaquopy 的 Python <-> Java 通道
            _result = {
                'exit_code': _exit_code,
                'stdout': _stdout_buf.getvalue(),
                'stderr': _stderr_buf.getvalue(),
            }
        """.trimIndent()

        val builtins = py.getModule("builtins")
        val ns = builtins.callAttr("dict")
        builtins.callAttr("exec", wrapper, ns)
        val resultCode = ns.callAttr("__getitem__", "_result")

        // _result 是 dict，通过 Chaquopy 转换
        val exitCode = resultCode.callAttr("__getitem__", "exit_code").toJava(Int::class.java)
        val stdout = resultCode.callAttr("__getitem__", "stdout").toJava(String::class.java)
        val stderr = resultCode.callAttr("__getitem__", "stderr").toJava(String::class.java)

        return mapOf(
            "exit_code" to exitCode,
            "stdout" to stdout,
            "stderr" to stderr,
            "duration_ms" to (System.currentTimeMillis() - startMs),
            "timed_out" to false
        )
    }

    /// 执行 Python 文件：读取文件内容后复用 runPythonCode
    private fun runPythonFile(filePath: String, args: List<String>, stdin: String): Map<String, Any> {
        val file = File(filePath)
        if (!file.exists() || !file.isFile) {
            return errorResult("File not found: $filePath")
        }
        val code = file.readText()
        // 对于文件执行，sys.argv[0] 设为文件路径
        val fileArgs = listOf(filePath) + args
        return runPythonCode(code, fileArgs, stdin)
    }

    // ---------- 辅助 ----------

    private fun errorResult(message: String): Map<String, Any> = mapOf(
        "exit_code" to -1,
        "stdout" to "",
        "stderr" to message,
        "duration_ms" to 0,
        "timed_out" to false
    )

    /// 把 Kotlin List<String> 转为 Python list literal（带 JSON 转义）
    private fun argsToJsonArray(args: List<String>): String {
        return args.joinToString(prefix = "[", postfix = "]") { arg ->
            "\"" + arg.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        }
    }

    /// 把字符串转为 Python 字符串字面量
    private fun jsonString(s: String): String {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""
    }

    /// 释放资源（在 Activity destroy 时调用）
    fun dispose() {
        runningTasks.values.forEach { it.cancel(true) }
        runningTasks.clear()
        executor.shutdownNow()
    }
}
