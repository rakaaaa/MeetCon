package com.meetcon.shell.ui

/**
 * MeetPlus brand palette for the Android shell.
 * Fills are dark enough for white labels. Text colors clear their surfaces.
 * The same hex values are applied in the WebView via styles.css.
 */
internal object MeetPlusPalette {
    const val LIGHT_PRIMARY = 0xFF4E45E4
    const val LIGHT_PRIMARY_END = 0xFF6258EE
    const val LIGHT_BACKGROUND = 0xFFF4F2FA
    const val LIGHT_SURFACE = 0xFFFFFBFF
    const val LIGHT_TEXT = 0xFF1B1A22
    const val LIGHT_MUTED = 0xFF5C5870
    const val DARK_PRIMARY = 0xFF564EF0
    const val DARK_PRIMARY_END = 0xFF645CF0
    const val DARK_BACKGROUND = 0xFF12111A
    const val DARK_SURFACE = 0xFF1C1B26
    const val DARK_TEXT = 0xFFF4F2FB
    const val DARK_MUTED = 0xFFC8C4D8
    const val WHITE = 0xFFFFFFFF
}

internal fun contrastRatio(foreground: Long, background: Long): Double {
    fun luminance(color: Long): Double {
        fun channel(shift: Int): Double {
            val value = ((color shr shift) and 0xFF).toDouble() / 255.0
            return if (value <= 0.04045) value / 12.92 else Math.pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }
    val lighter = maxOf(luminance(foreground), luminance(background))
    val darker = minOf(luminance(foreground), luminance(background))
    return (lighter + 0.05) / (darker + 0.05)
}
