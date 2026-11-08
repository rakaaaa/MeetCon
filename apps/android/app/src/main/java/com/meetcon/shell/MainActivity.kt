package com.meetcon.shell

import android.annotation.SuppressLint
import android.animation.ValueAnimator
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.meetcon.shell.ui.MeetConTheme
import com.meetcon.shell.ui.MeetPlusPalette
import kotlinx.coroutines.delay
import java.util.Locale

class MainActivity : ComponentActivity() {
    private var savedWebViewState: Bundle? = null
    private var pendingNavigation by mutableStateOf<String?>(null)
    private var blockedPermissionMessage by mutableStateOf<String?>(null)
    private var appInForeground = false
    private var chromeDark by mutableStateOf(false)
    private var safeTop = 0f
    private var safeRight = 0f
    private var safeBottom = 0f
    private var safeLeft = 0f

    var currentWebView: WebView? = null
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        savedWebViewState = savedInstanceState?.getBundle(WEBVIEW_STATE_KEY)
        pendingNavigation = intentDestination(intent)
            ?: BuildConfig.MEETCON_WEB_URL.takeIf { savedWebViewState == null }
        refreshInstallPermissions()

        chromeDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        applySystemBars(chromeDark)
        runCatching { WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG) }
        @Suppress("DEPRECATION")
        runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
                WebViewCompat.startSafeBrowsing(this) { }
            }
        }

        setContent {
            MeetConTheme(darkTheme = chromeDark) {
                MeetConShell()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intentDestination(intent)?.let { pendingNavigation = it }
    }

    override fun onResume() {
        super.onResume()
        appInForeground = true
        refreshInstallPermissions()
        currentWebView?.onResume()
    }

    override fun onPause() {
        appInForeground = false
        currentWebView?.onPause()
        runCatching { CookieManager.getInstance().flush() }
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        currentWebView?.let { webView ->
            val state = Bundle()
            webView.saveState(state)
            outState.putBundle(WEBVIEW_STATE_KEY, state)
        }
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        if (isFinishing) {
            currentWebView?.let(::releaseWebView)
        }
        super.onDestroy()
    }

    @Composable
    private fun MeetConShell() {
        val context = LocalContext.current
        var webView by remember { mutableStateOf<WebView?>(null) }
        var webViewGeneration by remember { mutableIntStateOf(0) }
        var allowWebView by remember { mutableStateOf(true) }
        var rendererStrikes by remember { mutableIntStateOf(0) }
        var pageState by rememberSaveable { mutableStateOf(PageState.LOADING) }
        var loadProgress by rememberSaveable { mutableIntStateOf(0) }
        var fatalMessage by rememberSaveable { mutableStateOf<String?>(null) }
        var errorIsConnectivity by remember { mutableStateOf(false) }
        var holdFatal by remember { mutableStateOf(false) }
        var resumeUrl by remember { mutableStateOf(BuildConfig.MEETCON_WEB_URL) }
        var connectionMessage by rememberSaveable {
            mutableStateOf<ConnectionMessage?>(null)
        }
        var priorNetwork by remember { mutableStateOf<NetworkStatus?>(null) }

        fun notifyWebsite(isOnline: Boolean) {
            webView?.evaluateJavascript(nativeShellScript(isOnline), null)
        }

        fun reportFatal(message: String, connectivity: Boolean) {
            pageState = PageState.ERROR
            fatalMessage = message
            errorIsConnectivity = connectivity
        }

        fun retryLoad() {
            if (blockedPermissionMessage != null) {
                refreshInstallPermissions()
                blockedPermissionMessage?.let { showToast(it, "permission", force = true) }
                return
            }
            val recovering = holdFatal
            holdFatal = false
            fatalMessage = null
            errorIsConnectivity = false
            rendererStrikes = 0
            allowWebView = true
            pageState = PageState.LOADING
            val view = webView
            when {
                view == null -> {
                    if (pendingNavigation == null) pendingNavigation = resumeUrl
                    webViewGeneration++
                }
                recovering -> view.loadUrl(resumeUrl)
                else -> view.reload()
            }
        }

        DisposableEffect(context) {
            val observer = ConnectivityObserver(
                context,
                onChanged = { status ->
                    val previous = priorNetwork
                    priorNetwork = status
                    connectionMessage = when {
                        status == NetworkStatus.OFFLINE -> ConnectionMessage.OFFLINE
                        status == NetworkStatus.CAPTIVE -> ConnectionMessage.CAPTIVE
                        previous == NetworkStatus.OFFLINE || previous == NetworkStatus.CAPTIVE ->
                            ConnectionMessage.BACK_ONLINE
                        else -> null
                    }
                    if (blockedPermissionMessage == null) {
                        when (status) {
                            NetworkStatus.OFFLINE ->
                                showToast(getString(R.string.no_internet_toast), "offline")
                            NetworkStatus.CAPTIVE ->
                                showToast(getString(R.string.wifi_sign_in), "captive")
                            NetworkStatus.ONLINE -> Unit
                        }
                    }
                    val cameBack = status == NetworkStatus.ONLINE &&
                        (previous == NetworkStatus.OFFLINE || previous == NetworkStatus.CAPTIVE)
                    if (
                        cameBack &&
                        errorIsConnectivity &&
                        !holdFatal &&
                        blockedPermissionMessage == null
                    ) {
                        errorIsConnectivity = false
                        fatalMessage = null
                        pageState = PageState.LOADING
                        val view = webView
                        if (view == null) {
                            allowWebView = true
                            if (pendingNavigation == null) pendingNavigation = resumeUrl
                            webViewGeneration++
                        } else {
                            view.reload()
                        }
                    }
                    notifyWebsite(status == NetworkStatus.ONLINE)
                },
                onAccessDenied = { refreshInstallPermissions(forceNetworkLabel = true) },
            )
            onDispose { observer.close() }
        }

        LaunchedEffect(blockedPermissionMessage) {
            blockedPermissionMessage?.let { showToast(it, "permission") }
        }

        LaunchedEffect(connectionMessage) {
            if (connectionMessage == ConnectionMessage.BACK_ONLINE) {
                delay(BACK_ONLINE_DURATION_MS)
                if (connectionMessage == ConnectionMessage.BACK_ONLINE) {
                    connectionMessage = null
                }
            }
        }

        val density = LocalDensity.current
        val layoutDirection = LocalLayoutDirection.current
        val bars = WindowInsets.systemBars.union(WindowInsets.displayCutout)
        val topPx = bars.getTop(density)
        val bottomPx = bars.getBottom(density)
        val leftPx = bars.getLeft(density, layoutDirection)
        val rightPx = bars.getRight(density, layoutDirection)
        val imePx = WindowInsets.ime.getBottom(density)
        LaunchedEffect(topPx, bottomPx, leftPx, rightPx, imePx, webView) {
            val scale = density.density
            safeTop = topPx / scale
            safeBottom = if (imePx > 0) 0f else bottomPx / scale
            safeLeft = leftPx / scale
            safeRight = rightPx / scale
            webView?.evaluateJavascript(safeAreaScript(), null)
        }

        LaunchedEffect(pendingNavigation, webView, holdFatal, blockedPermissionMessage) {
            if (holdFatal || blockedPermissionMessage != null) return@LaunchedEffect
            val destination = pendingNavigation
            val view = webView
            if (destination != null && view != null) {
                view.loadUrl(destination)
                pendingNavigation = null
            }
        }

        BackHandler {
            val view = webView
            if (view?.canGoBack() == true) {
                view.goBack()
            } else {
                finish()
            }
        }

        Scaffold(
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
        ) { scaffoldPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(scaffoldPadding)
                    .imePadding(),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                ) {
                    if (allowWebView) {
                        key(webViewGeneration) {
                        AndroidView(
                            modifier = Modifier.fillMaxSize(),
                            factory = { viewContext ->
                                val created = tryCreateSecureWebView(
                                    context = viewContext,
                                    onStarted = {
                                        if (!holdFatal) {
                                            pageState = PageState.LOADING
                                            fatalMessage = null
                                            errorIsConnectivity = false
                                        }
                                    },
                                    onReady = {
                                        if (!holdFatal) {
                                            pageState = PageState.READY
                                            errorIsConnectivity = false
                                        }
                                        notifyWebsite(
                                            currentNetworkStatus() == NetworkStatus.ONLINE,
                                        )
                                    },
                                    onResolvedUrl = { url -> resumeUrl = url },
                                    onProgress = { loadProgress = it },
                                    onFatalError = { message, connectivity ->
                                        reportFatal(message, connectivity)
                                    },
                                    onRendererGone = {
                                        holdFatal = true
                                        reportFatal(getString(R.string.webview_crashed), false)
                                        showToast(
                                            getString(R.string.webview_crashed),
                                            "webview-crashed",
                                            force = true,
                                        )
                                        webView = null
                                        currentWebView = null
                                        if (rendererStrikes >= 1) {
                                            allowWebView = false
                                        } else {
                                            rendererStrikes++
                                            webViewGeneration++
                                        }
                                    },
                                )
                                if (created == null) {
                                    val message = getString(R.string.webview_unavailable)
                                    reportFatal(message, false)
                                    showToast(message, "webview")
                                    webView = null
                                    currentWebView = null
                                    View(viewContext)
                                } else {
                                    webView = created
                                    currentWebView = created
                                    val restored = savedWebViewState?.let(created::restoreState)
                                    savedWebViewState = null
                                    if (
                                        !holdFatal &&
                                        restored == null &&
                                        pendingNavigation == null
                                    ) {
                                        pendingNavigation = BuildConfig.MEETCON_WEB_URL
                                    }
                                    created
                                }
                            },
                            onRelease = { released ->
                                (released as? WebView)?.let(::releaseWebView)
                            },
                        )
                        }
                    }

                    val blockingMessage = blockedPermissionMessage ?: fatalMessage
                    if (pageState == PageState.LOADING && blockingMessage == null) {
                        LoadingSurface(loadProgress)
                    }

                    blockingMessage?.let { message ->
                        FatalErrorSurface(message, onRetry = ::retryLoad)
                    }
                }

                connectionMessage?.let { message ->
                    Box(Modifier.navigationBarsPadding()) {
                        ConnectionBar(message)
                    }
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun createSecureWebView(
        context: Context,
        onStarted: () -> Unit,
        onReady: () -> Unit,
        onResolvedUrl: (String) -> Unit,
        onProgress: (Int) -> Unit,
        onFatalError: (String, Boolean) -> Unit,
        onRendererGone: () -> Unit,
    ): WebView = WebView(context).apply {
        setBackgroundColor(shellBackground(chromeDark))
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
            WebViewCompat.addDocumentStartJavaScript(
                this,
                """
                document.documentElement.dataset.meetconNativeShell='android';
                document.documentElement.dataset.meetconReducedMotion='$reducedMotion';
                """.trimIndent(),
                setOf("*"),
            )
        }
        isFocusable = true
        isFocusableInTouchMode = true

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setGeolocationEnabled(false)
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(settings, true)
        }

        runCatching {
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        }

        addJavascriptInterface(
            RoomHapticsBridge(
                isInForeground = { appInForeground },
                play = { kind ->
                    runOnUiThread {
                        if (appInForeground) playRoomHaptic(this@MainActivity, kind)
                    }
                },
            ),
            "MeetPlusNative",
        )
        addJavascriptInterface(
            RoomChromeBridge { dark ->
                runOnUiThread {
                    if (isDestroyed || chromeDark == dark) return@runOnUiThread
                    chromeDark = dark
                    applySystemBars(dark)
                    setBackgroundColor(shellBackground(dark))
                }
            },
            "MeetPlusChrome",
        )

        webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                onProgress(newProgress)
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val labels = request.resources.map { webPermissionLabel(context, it) }.distinct()
                request.deny()
                if (labels.isEmpty()) return
                val message = if (labels.size == 1) {
                    getString(R.string.web_permission_missing_one, labels[0])
                } else {
                    getString(R.string.web_permission_missing_many, labels.joinToString())
                }
                showToast(message, "web-permission:${labels.joinToString()}")
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback,
            ) {
                callback.invoke(origin, false, false)
                showToast(
                    getString(
                        R.string.web_permission_missing_one,
                        getString(R.string.permission_location_name),
                    ),
                    "web-permission:location",
                )
            }
        }

        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (!request.isForMainFrame) return false
                return handleNavigation(request.url)
            }

            @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
            @Deprecated("Used on Android versions that do not provide WebResourceRequest.")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                handleNavigation(Uri.parse(url))

            private fun handleNavigation(uri: Uri): Boolean =
                when (UrlPolicy.classify(uri.toString())) {
                    NavigationTarget.INTERNAL -> false
                    NavigationTarget.EXTERNAL_HTTPS -> {
                        openExternalHttps(uri)
                        true
                    }

                    NavigationTarget.REJECT -> true
                }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                onStarted()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!url.isNullOrBlank() && url != "about:blank") {
                    onResolvedUrl(url)
                }
                view.evaluateJavascript(
                    nativeShellScript(currentNetworkStatus() == NetworkStatus.ONLINE),
                    null,
                )
                onReady()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (!request.isForMainFrame) return
                val status = currentNetworkStatus()
                val connectivity = isConnectivityFailure(error.errorCode, error.description)
                val message = userFacingLoadError(
                    errorCode = error.errorCode,
                    description = error.description,
                    networkStatus = status,
                    offlineMessage = getString(R.string.no_internet_toast),
                    captiveMessage = getString(R.string.wifi_sign_in),
                    genericMessage = getString(R.string.load_failed_message),
                )
                if (connectivity) {
                    val key = if (status == NetworkStatus.CAPTIVE) "captive" else "offline"
                    showToast(message, key)
                }
                onFatalError(message, connectivity)
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse,
            ) {
                if (request.isForMainFrame && errorResponse.statusCode >= 500) {
                    onFatalError(getString(R.string.server_error, errorResponse.statusCode), false)
                }
            }

            override fun onReceivedSslError(
                view: WebView,
                handler: SslErrorHandler,
                error: SslError,
            ) {
                handler.cancel()
                onFatalError(getString(R.string.secure_connection_failed), false)
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail,
            ): Boolean {
                onRendererGone()
                return true
            }
        }
    }

    private fun tryCreateSecureWebView(
        context: Context,
        onStarted: () -> Unit,
        onReady: () -> Unit,
        onResolvedUrl: (String) -> Unit,
        onProgress: (Int) -> Unit,
        onFatalError: (String, Boolean) -> Unit,
        onRendererGone: () -> Unit,
    ): WebView? = runCatching {
        if (WebViewCompat.getCurrentWebViewPackage(context) == null) {
            null
        } else {
            createSecureWebView(
                context = context,
                onStarted = onStarted,
                onReady = onReady,
                onResolvedUrl = onResolvedUrl,
                onProgress = onProgress,
                onFatalError = onFatalError,
                onRendererGone = onRendererGone,
            )
        }
    }.getOrNull()

    private fun releaseWebView(webView: WebView) {
        if (currentWebView === webView) currentWebView = null
        runCatching {
            webView.stopLoading()
            webView.removeJavascriptInterface("MeetPlusNative")
            webView.removeJavascriptInterface("MeetPlusChrome")
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.removeAllViews()
            webView.destroy()
        }
    }

    private fun openExternalHttps(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            })
        } catch (_: ActivityNotFoundException) {
            showToast(getString(R.string.external_link_failed), force = true)
            currentWebView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('meetcon:external-link-error'))",
                null,
            )
        }
    }

    private fun intentDestination(intent: Intent?): String? =
        intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data?.let {
            UrlPolicy.deepLinkDestination(it)
        }

    private fun refreshInstallPermissions(forceNetworkLabel: Boolean = false) {
        val labels = missingInstallPermissionLabels(this).toMutableList()
        if (forceNetworkLabel) {
            val network = getString(R.string.permission_network_state_name)
            if (network !in labels) labels += network
        }
        blockedPermissionMessage = installPermissionMessage(this, labels)
    }

    private fun currentNetworkStatus(): NetworkStatus {
        val manager = getSystemService(ConnectivityManager::class.java) ?: return NetworkStatus.OFFLINE
        return runCatching {
            manager.getNetworkCapabilities(manager.activeNetwork).toNetworkStatus()
        }.getOrDefault(NetworkStatus.OFFLINE)
    }

    private fun showToast(message: String, dedupeKey: String? = null, force: Boolean = false) {
        if (message.isBlank() || isDestroyed) return
        val now = SystemClock.elapsedRealtime()
        if (
            !force &&
            dedupeKey != null &&
            dedupeKey == lastToastKey &&
            now - lastToastAt < TOAST_DEDUPE_MS
        ) {
            return
        }
        lastToastKey = dedupeKey
        lastToastAt = now
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun applySystemBars(dark: Boolean) {
        val scrim = shellBackground(dark)
        enableEdgeToEdge(
            statusBarStyle = if (dark) SystemBarStyle.dark(scrim) else SystemBarStyle.light(scrim, scrim),
            navigationBarStyle = if (dark) SystemBarStyle.dark(scrim) else SystemBarStyle.light(scrim, scrim),
        )
    }

    private fun shellBackground(dark: Boolean): Int =
        (if (dark) MeetPlusPalette.DARK_BACKGROUND else MeetPlusPalette.LIGHT_BACKGROUND).toInt()

    private fun safeAreaScript(): String {
        fun px(value: Float) = String.format(Locale.US, "%.2fpx", value)
        return """
            document.documentElement.style.setProperty('--safe-top','${px(safeTop)}');
            document.documentElement.style.setProperty('--safe-right','${px(safeRight)}');
            document.documentElement.style.setProperty('--safe-bottom','${px(safeBottom)}');
            document.documentElement.style.setProperty('--safe-left','${px(safeLeft)}');
        """.trimIndent()
    }

    private fun nativeShellScript(isOnline: Boolean): String {
        val browserEvent = if (isOnline) "online" else "offline"
        val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
        return """
            (() => {
              document.documentElement.dataset.meetconNativeShell = 'android';
              document.documentElement.dataset.meetconReducedMotion = '$reducedMotion';
              ${safeAreaScript()}
              const syncChrome = () => {
                const theme = document.documentElement.dataset.theme;
                if (theme !== 'dark' && theme !== 'light') return;
                if (window.MeetPlusChrome) window.MeetPlusChrome.setDark(theme === 'dark');
              };
              if (!window.__MEETCON_CHROME_BOUND__) {
                window.__MEETCON_CHROME_BOUND__ = true;
                new MutationObserver(syncChrome).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
              }
              syncChrome();
              let style = document.getElementById('meetcon-native-shell-style');
              if (!style) {
                style = document.createElement('style');
                style.id = 'meetcon-native-shell-style';
                style.textContent = '[data-meetcon-connectivity-banner],[data-meetcon-offline-bar],#meetcon-offline-bar,.network-bar{display:none!important}';
                document.head.appendChild(style);
              }
              window.__MEETCON_NATIVE_SHELL__ = Object.freeze({ platform: 'android', reducedMotion: $reducedMotion });
              window.dispatchEvent(new Event('$browserEvent'));
              window.dispatchEvent(new CustomEvent('meetcon:native-connectivity', { detail: { online: $isOnline } }));
              if ($isOnline) window.dispatchEvent(new Event('meetcon:resync'));
            })();
        """.trimIndent()
    }

    @Composable
    private fun LoadingSurface(progress: Int) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    if (ValueAnimator.areAnimatorsEnabled()) {
                        CircularProgressIndicator()
                    }
                    Spacer(Modifier.height(20.dp))
                    Text(
                        text = stringResource(R.string.loading_meetcon),
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.loading_description),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (progress in 1..99) {
                    LinearProgressIndicator(
                        progress = { progress / 100f },
                        modifier = Modifier
                            .fillMaxWidth()
                            .align(Alignment.TopCenter),
                    )
                }
            }
        }
    }

    @Composable
    private fun FatalErrorSurface(message: String, onRetry: () -> Unit) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        text = stringResource(R.string.load_failed_title),
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = message.ifBlank {
                            stringResource(R.string.load_failed_message)
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(24.dp))
                    Button(onClick = onRetry) {
                        Text(stringResource(R.string.retry))
                    }
                }
            }
        }
    }

    @Composable
    private fun ConnectionBar(message: ConnectionMessage) {
        val isProblem = message != ConnectionMessage.BACK_ONLINE
        Snackbar(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            containerColor = if (isProblem) {
                MaterialTheme.colorScheme.errorContainer
            } else {
                MaterialTheme.colorScheme.primaryContainer
            },
            contentColor = if (isProblem) {
                MaterialTheme.colorScheme.onErrorContainer
            } else {
                MaterialTheme.colorScheme.onPrimaryContainer
            },
        ) {
            Text(
                text = when (message) {
                    ConnectionMessage.OFFLINE -> stringResource(R.string.no_internet)
                    ConnectionMessage.CAPTIVE -> stringResource(R.string.wifi_sign_in_short)
                    ConnectionMessage.BACK_ONLINE -> stringResource(R.string.back_online)
                },
            )
        }
    }

    private enum class PageState {
        LOADING,
        READY,
        ERROR,
    }

    private enum class ConnectionMessage {
        OFFLINE,
        CAPTIVE,
        BACK_ONLINE,
    }

    companion object {
        private const val WEBVIEW_STATE_KEY = "meetcon.webview.state"
        private const val BACK_ONLINE_DURATION_MS = 2_500L
        private const val TOAST_DEDUPE_MS = 15_000L
        private var lastToastKey: String? = null
        private var lastToastAt = 0L
    }
}

private class ConnectivityObserver(
    context: Context,
    private val onChanged: (NetworkStatus) -> Unit,
    private val onAccessDenied: () -> Unit,
) : AutoCloseable {
    private val manager =
        context.applicationContext.getSystemService(ConnectivityManager::class.java)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastValue: NetworkStatus? = null

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = publishCurrentState()
        override fun onLost(network: Network) = publishCurrentState()

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) = publishCurrentState()
    }

    init {
        val registered = runCatching { manager.registerDefaultNetworkCallback(callback) }
        if (registered.isFailure) {
            val denied = registered.exceptionOrNull() is SecurityException
            mainHandler.post {
                if (denied) onAccessDenied()
                dispatch(NetworkStatus.OFFLINE)
            }
        } else {
            publishCurrentState()
        }
    }

    private fun publishCurrentState() {
        val status = runCatching {
            manager.getNetworkCapabilities(manager.activeNetwork).toNetworkStatus()
        }.getOrDefault(NetworkStatus.OFFLINE)
        mainHandler.post { dispatch(status) }
    }

    private fun dispatch(status: NetworkStatus) {
        if (lastValue == status) return
        lastValue = status
        onChanged(status)
    }

    override fun close() {
        runCatching { manager.unregisterNetworkCallback(callback) }
        mainHandler.removeCallbacksAndMessages(null)
    }
}
