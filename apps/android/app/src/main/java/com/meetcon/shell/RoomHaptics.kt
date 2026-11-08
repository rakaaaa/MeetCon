package com.meetcon.shell

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.webkit.JavascriptInterface

internal fun roomHapticPattern(kind: String): LongArray? = when (kind) {
    "start" -> longArrayOf(0, 45, 70, 90)
    "stop" -> longArrayOf(0, 28, 55, 28, 55, 150)
    "question" -> longArrayOf(0, 32)
    else -> null
}

internal fun playRoomHaptic(context: Context, kind: String) {
    val pattern = roomHapticPattern(kind) ?: return
    if (!hapticsAllowed(context)) return
    val vibrator = systemVibrator(context) ?: return
    vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
}

@Suppress("DEPRECATION")
private fun hapticsAllowed(context: Context): Boolean =
    runCatching {
        Settings.System.getInt(context.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) == 1
    }.getOrDefault(true)

private fun systemVibrator(context: Context): Vibrator? {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Vibrator::class.java)
    }
    return vibrator?.takeIf { it.hasVibrator() }
}

internal class RoomHapticsBridge(
    private val isInForeground: () -> Boolean,
    private val play: (String) -> Unit,
) {
    @JavascriptInterface
    fun vibrate(kind: String) {
        if (!isInForeground() || roomHapticPattern(kind) == null) return
        play(kind)
    }
}
