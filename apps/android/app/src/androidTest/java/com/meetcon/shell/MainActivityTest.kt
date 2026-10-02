package com.meetcon.shell

import android.Manifest
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    @Test
    fun launchCreatesHardenedWebViewWithoutSensitivePermissions() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val webView = activity.currentWebView
                assertNotNull(webView)
                assertFalse(webView!!.settings.allowFileAccess)
                assertFalse(webView.settings.allowContentAccess)
                assertTrue(webView.settings.javaScriptEnabled)
                assertTrue(webView.settings.domStorageEnabled)

                val permissions = activity.packageManager
                    .getPackageInfo(activity.packageName, 0x00001000)
                    .requestedPermissions
                    .orEmpty()
                    .toSet()
                assertEquals(
                    setOf(
                        Manifest.permission.INTERNET,
                        Manifest.permission.ACCESS_NETWORK_STATE,
                    ),
                    permissions,
                )
            }
        }
    }

    @Test
    fun urlPolicyKeepsOnlyConfiguredOriginInside() {
        val origin = "https://meetcon.example.com:30098"

        assertEquals(
            NavigationTarget.INTERNAL,
            UrlPolicy.classify("$origin/join/secret?source=qr", origin, false),
        )
        assertEquals(
            NavigationTarget.INTERNAL,
            UrlPolicy.classify("$origin/app", origin, false),
        )
        assertEquals(
            NavigationTarget.EXTERNAL_HTTPS,
            UrlPolicy.classify("https://help.example.org/article", origin, false),
        )
        assertEquals(
            NavigationTarget.REJECT,
            UrlPolicy.classify("javascript:alert(1)", origin, false),
        )
        assertEquals(
            NavigationTarget.REJECT,
            UrlPolicy.classify("http://meetcon.example.com/join/secret", origin, false),
        )
    }
}
