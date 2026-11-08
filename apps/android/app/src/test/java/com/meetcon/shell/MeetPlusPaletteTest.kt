package com.meetcon.shell

import com.meetcon.shell.ui.MeetPlusPalette
import com.meetcon.shell.ui.contrastRatio
import org.junit.Assert.assertTrue
import org.junit.Test

class MeetPlusPaletteTest {
    @Test
    fun brandFillsKeepWhiteLabelsReadable() {
        assertTrue(contrastRatio(MeetPlusPalette.WHITE, MeetPlusPalette.LIGHT_PRIMARY) >= 4.5)
        assertTrue(contrastRatio(MeetPlusPalette.WHITE, MeetPlusPalette.LIGHT_PRIMARY_END) >= 4.5)
        assertTrue(contrastRatio(MeetPlusPalette.WHITE, MeetPlusPalette.DARK_PRIMARY) >= 4.5)
        assertTrue(contrastRatio(MeetPlusPalette.WHITE, MeetPlusPalette.DARK_PRIMARY_END) >= 4.5)
    }

    @Test
    fun textAndMutedCopyClearTheirSurfaces() {
        assertTrue(contrastRatio(MeetPlusPalette.LIGHT_TEXT, MeetPlusPalette.LIGHT_BACKGROUND) >= 7)
        assertTrue(contrastRatio(MeetPlusPalette.LIGHT_MUTED, MeetPlusPalette.LIGHT_SURFACE) >= 4.5)
        assertTrue(contrastRatio(MeetPlusPalette.DARK_TEXT, MeetPlusPalette.DARK_BACKGROUND) >= 7)
        assertTrue(contrastRatio(MeetPlusPalette.DARK_MUTED, MeetPlusPalette.DARK_SURFACE) >= 4.5)
    }
}
