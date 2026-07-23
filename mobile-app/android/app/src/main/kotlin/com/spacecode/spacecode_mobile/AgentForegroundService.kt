package com.spacecode.spacecode_mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/// Agent 前台服务。
///
/// 在 LLM 任务运行期间保持应用活跃，防止手机息屏后系统进入 Doze 模式
/// 导致网络连接断开、Dart isolate 被挂起。
///
/// 工作机制：
/// 1. startForeground 显示持久通知，使应用进程优先级提升至前台级别
/// 2. 获取 PARTIAL_WAKE_LOCK 防止 CPU 休眠（仅影响 CPU，不影响屏幕）
/// 3. 任务结束后调用 stop 释放资源
///
/// 通知可通过 update action 更新内容（显示当前任务进度）。
class AgentForegroundService : Service() {

    companion object {
        private const val TAG = "AgentFgService"
        const val CHANNEL_ID = "spacecode_agent_service"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START = "spacecode.action.START_SERVICE"
        const val ACTION_STOP = "spacecode.action.STOP_SERVICE"
        const val ACTION_UPDATE = "spacecode.action.UPDATE_SERVICE"

        const val EXTRA_TITLE = "title"
        const val EXTRA_CONTENT = "content"

        /// 启动前台服务。
        ///
        /// Android 8+ 必须用 startForegroundService，否则抛
        /// BackgroundServiceStartNotAllowedException。
        fun start(context: Context, title: String, content: String) {
            val intent = Intent(context, AgentForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_CONTENT, content)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /// 停止前台服务。
        ///
        /// 用 stopService 而非 startForegroundService 传 ACTION_STOP：
        /// 若服务未运行，startForegroundService 会要求 5 秒内调用 startForeground，
        /// 否则抛 ForegroundServiceDidNotStartInTimeException。
        /// stopService 在服务未运行时为 no-op，安全可靠。
        fun stop(context: Context) {
            val intent = Intent(context, AgentForegroundService::class.java)
            context.stopService(intent)
        }

        fun update(context: Context, content: String) {
            val intent = Intent(context, AgentForegroundService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_CONTENT, content)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "update: service not running: ${e.message}")
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    /// 标记当前是否处于前台模式，用于 onDestroy 判断是否需要移除通知
    private var isForegroundRunning = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "SpaceCode Agent"
                val content = intent.getStringExtra(EXTRA_CONTENT) ?: ""
                startForegroundWithNotification(title, content)
                isForegroundRunning = true
                acquireWakeLock()
            }
            ACTION_STOP -> {
                // 兜底路径：stop() 主走 stopService → onDestroy，此处保留以防手动 Intent
                if (isForegroundRunning) {
                    stopForegroundCompat()
                    isForegroundRunning = false
                }
                releaseWakeLock()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> {
                val content = intent.getStringExtra(EXTRA_CONTENT) ?: ""
                updateNotification(content)
            }
            else -> {
                // 无 action（如系统重启服务）且未 startForeground 时，直接停止避免 ANR
                stopSelf()
                return START_NOT_STICKY
            }
        }
        return START_STICKY
    }

    /// 启动前台并显示通知。
    ///
    /// Android 14+ (API 34) 强制要求声明 foregroundServiceType，
    /// 否则抛 ForegroundServiceTypeMissing 等异常。
    /// dataSync 类型适用于网络数据传输类任务（LLM 流式响应）。
    private fun startForegroundWithNotification(title: String, content: String) {
        val notification = buildNotification(title, content)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(title: String, content: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(this, 0, it, flags)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        builder
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setPriority(Notification.PRIORITY_LOW)
        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent)
        }
        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SpaceCode Agent Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps Agent tasks running when screen is off"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun updateNotification(content: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, buildNotification("SpaceCode Agent", content))
    }

    /// 获取 PARTIAL_WAKE_LOCK 防止 CPU 休眠。
    ///
    /// 仅锁定 CPU，不保持屏幕亮起（省电）。
    /// 设置 30 分钟超时防止泄漏：单次 LLM 任务极少超过此时长。
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
        wakeLock = powerManager?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SpaceCode:AgentWakeLock"
        )
        wakeLock?.acquire(30 * 60 * 1000L)
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    override fun onDestroy() {
        // stopService 主路径：清理前台通知 + WakeLock
        if (isForegroundRunning) {
            stopForegroundCompat()
            isForegroundRunning = false
        }
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
