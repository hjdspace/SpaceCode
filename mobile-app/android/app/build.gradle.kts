buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // 注：Chaquopy 16.0.0 目前不兼容 Gradle 9（使用了已移除的 org.gradle.util.VersionNumber）
        // 暂时禁用 Chaquopy 插件，Python 功能将不可用（PythonPlugin 优雅降级不加载）
        // 待 Chaquopy 发布兼容 Gradle 9 的版本后，取消下方注释即可启用
        // classpath("com.chaquo.python:gradle:16.0.0")
    }
}

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Chaquopy 暂时禁用（不兼容 Gradle 9）
    // id("com.chaquo.python")
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

    // Chaquopy Python 嵌入配置（暂时禁用，待兼容 Gradle 9 后启用）
    // chaquopy {
    //     defaultConfig {
    //         version = "3.11"
    //         pip {
    //             // 暂不预装第三方包；Agent 运行时所需的 stdlib 已随 CPython 打包
    //             // 后续可在此添加 pure-Python 包，如 "requests"
    //         }
    //     }
    // }

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
