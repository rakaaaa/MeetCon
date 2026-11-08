package com.meetcon.shell

import android.webkit.JavascriptInterface

internal class RoomChromeBridge(
    private val onDark: (Boolean) -> Unit,
) {
    @JavascriptInterface
    fun setDark(dark: Boolean) {
        onDark(dark)
    }
}
