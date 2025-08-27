# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Trusted Web Activity specific rules
-keep class com.google.androidbrowserhelper.** { *; }
-keep class androidx.browser.** { *; }

# Keep web manifest and PWA functionality
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep native bridge classes for media permissions
-keep class android.webkit.** { *; }
-keep class org.chromium.** { *; }

# WebView debugging
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-dontwarn org.chromium.**
-dontwarn com.google.androidbrowserhelper.**

# General Android optimizations
-optimizations !code/simplification/cast,!field/*,!class/merging/*
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes SourceFile,LineNumberTable

# Remove logging in release builds
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}
