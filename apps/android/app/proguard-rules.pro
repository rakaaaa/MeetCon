# AndroidX consumer rules are supplied by the libraries themselves.
-keepclassmembers class com.meetcon.shell.RoomHapticsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class com.meetcon.shell.RoomChromeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
