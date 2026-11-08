package com.meetcon.shell

import android.webkit.WebViewClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceStatusTest {
    @Test
    fun connectivityFailuresIncludeLookupTimeoutAndDisconnectText() {
        assertTrue(isConnectivityFailure(WebViewClient.ERROR_HOST_LOOKUP, null))
        assertTrue(isConnectivityFailure(WebViewClient.ERROR_CONNECT, null))
        assertTrue(isConnectivityFailure(WebViewClient.ERROR_TIMEOUT, null))
        assertTrue(isConnectivityFailure(WebViewClient.ERROR_IO, null))
        assertTrue(
            isConnectivityFailure(WebViewClient.ERROR_UNKNOWN, "net::ERR_INTERNET_DISCONNECTED"),
        )
        assertFalse(isConnectivityFailure(WebViewClient.ERROR_BAD_URL, "bad url"))
        assertFalse(isConnectivityFailure(WebViewClient.ERROR_UNKNOWN, "Something else"))
    }

    @Test
    fun roomHapticsUseDistinctPatternsForScheduleChanges() {
        val start = roomHapticPattern("start")
        val stop = roomHapticPattern("stop")
        val question = roomHapticPattern("question")
        assertNotNull(start)
        assertNotNull(stop)
        assertNotNull(question)
        assertTrue(start!!.sum() > question!!.sum())
        assertTrue(stop!!.sum() > start.sum())
        assertNull(roomHapticPattern("answer"))
        assertNull(roomHapticPattern(""))
    }

    @Test
    fun networkClassificationTreatsCaptiveAndSuspendedLinksAsUnavailable() {
        assertEquals(NetworkStatus.ONLINE, classifyNetwork(hasInternet = true, captivePortal = false, suspended = false))
        assertEquals(NetworkStatus.OFFLINE, classifyNetwork(hasInternet = false, captivePortal = false, suspended = false))
        assertEquals(NetworkStatus.OFFLINE, classifyNetwork(hasInternet = true, captivePortal = false, suspended = true))
        assertEquals(NetworkStatus.CAPTIVE, classifyNetwork(hasInternet = true, captivePortal = true, suspended = false))
        assertEquals(NetworkStatus.OFFLINE, classifyNetwork(hasInternet = false, captivePortal = true, suspended = true))
    }

    @Test
    fun loadErrorsPreferPlainLanguageOverChromiumCodes() {
        assertEquals(
            "offline",
            userFacingLoadError(
                errorCode = WebViewClient.ERROR_CONNECT,
                description = "net::ERR_CONNECTION_REFUSED",
                networkStatus = NetworkStatus.OFFLINE,
                offlineMessage = "offline",
                captiveMessage = "captive",
                genericMessage = "generic",
            ),
        )
        assertEquals(
            "captive",
            userFacingLoadError(
                errorCode = WebViewClient.ERROR_HOST_LOOKUP,
                description = "net::ERR_NAME_NOT_RESOLVED",
                networkStatus = NetworkStatus.CAPTIVE,
                offlineMessage = "offline",
                captiveMessage = "captive",
                genericMessage = "generic",
            ),
        )
        assertEquals(
            "generic",
            userFacingLoadError(
                errorCode = WebViewClient.ERROR_UNKNOWN,
                description = "net::ERR_BLOCKED_BY_RESPONSE",
                networkStatus = NetworkStatus.ONLINE,
                offlineMessage = "offline",
                captiveMessage = "captive",
                genericMessage = "generic",
            ),
        )
        assertEquals(
            "Page moved",
            userFacingLoadError(
                errorCode = WebViewClient.ERROR_REDIRECT_LOOP,
                description = "Page moved",
                networkStatus = NetworkStatus.ONLINE,
                offlineMessage = "offline",
                captiveMessage = "captive",
                genericMessage = "generic",
            ),
        )
    }
}
