package com.meetcon.shell

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.NetworkCapabilities
import android.os.Build
import android.webkit.PermissionRequest
import android.webkit.WebViewClient
import androidx.core.content.ContextCompat
import java.util.Locale

internal enum class NetworkStatus {
    ONLINE,
    OFFLINE,
    CAPTIVE,
}

/**
 * Classifies a network without requiring [NetworkCapabilities.NET_CAPABILITY_VALIDATED].
 * Validation uses a system probe that some carriers, captive-portal networks, and
 * regional firewalls block, which would otherwise mark a working connection offline.
 */
internal fun classifyNetwork(
    hasInternet: Boolean,
    captivePortal: Boolean,
    suspended: Boolean,
): NetworkStatus = when {
    !hasInternet || suspended -> NetworkStatus.OFFLINE
    captivePortal -> NetworkStatus.CAPTIVE
    else -> NetworkStatus.ONLINE
}

internal fun NetworkCapabilities?.toNetworkStatus(): NetworkStatus {
    if (this == null) return NetworkStatus.OFFLINE
    val suspended = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
        !hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED)
    return classifyNetwork(
        hasInternet = hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
        captivePortal = hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),
        suspended = suspended,
    )
}

internal fun missingInstallPermissionLabels(context: Context): List<String> {
    val required = listOf(
        Manifest.permission.INTERNET to context.getString(R.string.permission_internet_name),
        Manifest.permission.ACCESS_NETWORK_STATE to
            context.getString(R.string.permission_network_state_name),
    )
    return required.mapNotNull { (permission, label) ->
        label.takeIf {
            ContextCompat.checkSelfPermission(context, permission) !=
                PackageManager.PERMISSION_GRANTED
        }
    }
}

internal fun installPermissionMessage(context: Context, labels: List<String>): String? =
    when (labels.size) {
        0 -> null
        1 -> context.getString(R.string.permission_missing_one, labels[0])
        else -> context.getString(R.string.permission_missing_many, labels.joinToString())
    }

internal fun webPermissionLabel(context: Context, resource: String): String = when (resource) {
    PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
        context.getString(R.string.permission_microphone_name)
    PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
        context.getString(R.string.permission_camera_name)
    PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID ->
        context.getString(R.string.permission_media_name)
    PermissionRequest.RESOURCE_MIDI_SYSEX ->
        context.getString(R.string.permission_midi_name)
    else -> context.getString(R.string.permission_generic_name)
}

internal fun isConnectivityFailure(errorCode: Int, description: CharSequence?): Boolean {
    if (
        errorCode == WebViewClient.ERROR_HOST_LOOKUP ||
        errorCode == WebViewClient.ERROR_CONNECT ||
        errorCode == WebViewClient.ERROR_IO ||
        errorCode == WebViewClient.ERROR_TIMEOUT
    ) {
        return true
    }
    val text = description?.toString()?.lowercase(Locale.US).orEmpty()
    return text.contains("err_internet_disconnected") ||
        text.contains("err_name_not_resolved") ||
        text.contains("err_address_unreachable") ||
        text.contains("err_network_changed") ||
        text.contains("err_connection_aborted") ||
        text.contains("err_connection_reset") ||
        text.contains("err_connection_refused") ||
        text.contains("err_network_access_denied") ||
        text.contains("err_timed_out")
}

internal fun userFacingLoadError(
    errorCode: Int,
    description: CharSequence?,
    networkStatus: NetworkStatus,
    offlineMessage: String,
    captiveMessage: String,
    genericMessage: String,
): String {
    if (isConnectivityFailure(errorCode, description)) {
        return if (networkStatus == NetworkStatus.CAPTIVE) captiveMessage else offlineMessage
    }
    val text = description?.toString()?.trim().orEmpty()
    if (text.isEmpty() || text.startsWith("net::", ignoreCase = true)) return genericMessage
    return text
}
