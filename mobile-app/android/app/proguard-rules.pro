# release 构建一旦开启代码收缩（R8），这些规则必须生效。
#
# ML Kit 的组件注册类是运行时反射实例化的：firebase-components 拿到类名后调用
# Class.forName(name).getDeclaredConstructor().newInstance()。而 barcode-scanning
# 依赖的 firebase-components 16.1.0 不带 consumer keep 规则，所以收缩会把这几个无参
# 构造裁掉，扫码页起不来（release logcat 原文）：
#   NoSuchMethodException: com.google.mlkit.common.internal.CommonComponentRegistrar.<init> []
#   NoSuchMethodException: com.google.mlkit.vision.barcode.internal.BarcodeRegistrar.<init> []
#   NoSuchMethodException: com.google.mlkit.vision.common.internal.VisionCommonRegistrar.<init> []
#   MethodChannel#dev.steenbakker.mobile_scanner/scanner/method: Failed to handle method call
-keep class com.google.mlkit.** { *; }
-keepclassmembers class com.google.mlkit.common.internal.CommonComponentRegistrar {
    <init>();
}
-keepclassmembers class com.google.mlkit.vision.barcode.internal.BarcodeRegistrar {
    <init>();
}
-keepclassmembers class com.google.mlkit.vision.common.internal.VisionCommonRegistrar {
    <init>();
}

# 组件注册表本身也靠反射读 META-INF/services 装配，缺了它上面三条也白搭。
-keep class com.google.firebase.components.ComponentDiscovery { *; }
-keep class com.google.firebase.components.CycleDetector { *; }
