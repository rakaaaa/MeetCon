package com.meetcon.shell

import android.net.Uri
import java.util.Locale

enum class NavigationTarget {
    INTERNAL,
    EXTERNAL_HTTPS,
    REJECT,
}

object UrlPolicy {
    private val debugCleartextHosts = setOf("localhost", "127.0.0.1", "10.0.2.2")

    fun classify(
        candidateUrl: String,
        configuredUrl: String = BuildConfig.MEETCON_WEB_URL,
        debugBuild: Boolean = BuildConfig.DEBUG,
    ): NavigationTarget {
        val candidate = candidateUrl.toSafeWebUri() ?: return NavigationTarget.REJECT
        val configured = configuredUrl.toSafeWebUri() ?: return NavigationTarget.REJECT

        if (!candidate.isAllowedScheme(debugBuild) || !configured.isAllowedScheme(debugBuild)) {
            return NavigationTarget.REJECT
        }

        if (candidate.sameOriginAs(configured)) {
            return NavigationTarget.INTERNAL
        }

        return if (candidate.scheme.equals("https", ignoreCase = true)) {
            NavigationTarget.EXTERNAL_HTTPS
        } else {
            NavigationTarget.REJECT
        }
    }

    fun deepLinkDestination(
        incoming: Uri?,
        configuredUrl: String = BuildConfig.MEETCON_WEB_URL,
        appLinkHost: String = BuildConfig.MEETCON_APP_LINK_HOST,
    ): String? {
        if (
            incoming == null ||
            !incoming.scheme.equals("https", ignoreCase = true) ||
            !incoming.host.equals(appLinkHost, ignoreCase = true) ||
            incoming.userInfo != null
        ) {
            return null
        }

        val path = incoming.encodedPath.orEmpty()
        if (path != "/join" && !path.startsWith("/join/")) return null

        val base = configuredUrl.toSafeWebUri() ?: return null
        return base.buildUpon()
            .encodedPath(path)
            .encodedQuery(incoming.encodedQuery)
            .encodedFragment(incoming.encodedFragment)
            .build()
            .toString()
            .takeIf { classify(it, configuredUrl) == NavigationTarget.INTERNAL }
    }

    private fun String.toSafeWebUri(): Uri? = runCatching { Uri.parse(this) }
        .getOrNull()
        ?.takeIf {
            it.isHierarchical &&
                !it.host.isNullOrBlank() &&
                it.userInfo == null &&
                (it.scheme.equals("https", true) || it.scheme.equals("http", true))
        }

    private fun Uri.isAllowedScheme(debugBuild: Boolean): Boolean {
        if (scheme.equals("https", ignoreCase = true)) return true
        return debugBuild &&
            scheme.equals("http", ignoreCase = true) &&
            host?.lowercase(Locale.US) in debugCleartextHosts
    }

    private fun Uri.sameOriginAs(other: Uri): Boolean =
        scheme.equals(other.scheme, ignoreCase = true) &&
            host.equals(other.host, ignoreCase = true) &&
            effectivePort() == other.effectivePort()

    private fun Uri.effectivePort(): Int = when {
        port != -1 -> port
        scheme.equals("https", ignoreCase = true) -> 443
        else -> 80
    }
}
