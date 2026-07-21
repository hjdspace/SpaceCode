plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Chaquopy：嵌入式 CPython，提供 PythonPlugin 的 Android 端实现
    id("com.chaquo.python")
}

android {
    namespace = "com.spacecode.spacecode_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.spacecode.spacecode_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // Chaquopy 支持的 ABI：arm64-v8a（主）/ armeabi-v7a（老设备）/ x86_64（模拟器）
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    // Chaquopy Python 嵌入配置
    // - version：CPython 版本（Chaquopy 16 支持 3.8-3.12）
    // - pip：仅允许纯 Python 包，避免 C 扩展编译问题
    chaquopy {
        defaultConfig {
            version = "3.11"
            pip {
                // 暂不预装第三方包；Agent 运行时所需的 stdlib 已随 CPython 打包
                // 后续可在此添加 pure-Python 包，如 "requests"
            }
        }
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
