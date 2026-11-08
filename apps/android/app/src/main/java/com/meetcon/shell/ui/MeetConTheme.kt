package com.meetcon.shell.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(MeetPlusPalette.LIGHT_PRIMARY),
    onPrimary = Color(MeetPlusPalette.WHITE),
    primaryContainer = Color(0xFFE4E0FF),
    onPrimaryContainer = Color(0xFF1E1678),
    secondary = Color(0xFF0F7490),
    onSecondary = Color(MeetPlusPalette.WHITE),
    secondaryContainer = Color(0xFFD7F6FA),
    onSecondaryContainer = Color(0xFF063844),
    tertiary = Color(0xFFC2413A),
    onTertiary = Color(MeetPlusPalette.WHITE),
    tertiaryContainer = Color(0xFFFFE8E4),
    onTertiaryContainer = Color(0xFF5C1A16),
    background = Color(MeetPlusPalette.LIGHT_BACKGROUND),
    onBackground = Color(MeetPlusPalette.LIGHT_TEXT),
    surface = Color(MeetPlusPalette.LIGHT_SURFACE),
    onSurface = Color(MeetPlusPalette.LIGHT_TEXT),
    surfaceVariant = Color(0xFFEEEDF6),
    onSurfaceVariant = Color(MeetPlusPalette.LIGHT_MUTED),
    outline = Color(0xFF7C7890),
    error = Color(0xFFBA1A1A),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val DarkColors = darkColorScheme(
    primary = Color(MeetPlusPalette.DARK_PRIMARY),
    onPrimary = Color(MeetPlusPalette.WHITE),
    primaryContainer = Color(0xFF2E2978),
    onPrimaryContainer = Color(0xFFE4E0FF),
    secondary = Color(0xFF8AD4E4),
    onSecondary = Color(0xFF003640),
    secondaryContainer = Color(0xFF0E4C5C),
    onSecondaryContainer = Color(0xFFD7F6FA),
    tertiary = Color(0xFFFFB4A8),
    onTertiary = Color(0xFF5C1A16),
    tertiaryContainer = Color(0xFF7A3028),
    onTertiaryContainer = Color(0xFFFFE8E4),
    background = Color(MeetPlusPalette.DARK_BACKGROUND),
    onBackground = Color(MeetPlusPalette.DARK_TEXT),
    surface = Color(MeetPlusPalette.DARK_SURFACE),
    onSurface = Color(MeetPlusPalette.DARK_TEXT),
    surfaceVariant = Color(0xFF262536),
    onSurfaceVariant = Color(MeetPlusPalette.DARK_MUTED),
    outline = Color(0xFF938FA6),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
)

@Composable
fun MeetConTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
