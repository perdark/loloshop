# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# --- Play quality: R8 enabled (متطلبات جودة Google Play) ---
# @capacitor/android ships consumer rules that keep Plugin subclasses, and the
# default proguard-android.txt keeps @JavascriptInterface members. These are
# belt-and-braces: plugin classes are resolved BY NAME at runtime from
# assets/capacitor.plugins.json, so reflection is invisible to R8.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class * extends com.getcapacitor.BridgeActivity { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
# Keep line numbers so Play Console crash reports stay readable after minifying.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
