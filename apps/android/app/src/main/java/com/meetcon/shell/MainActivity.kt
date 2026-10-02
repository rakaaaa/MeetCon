package com.meetcon.shell

import android.annotation.SuppressLint
import android.animation.ValueAnimator
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.weight
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.meetcon.shell.ui.MeetConTheme
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private var savedWebViewState: Bundle? = null
    private var pendingNavigation by mutableStateOf<String?>(null)

    var currentWebView: WebView? = null
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        savedWebViewState = savedInstanceState?.getBundle(WEBVIEW_STATE_KEY)
        pendingNavigation = intentDestination(intent)
            ?: BuildConfig.MEETCON_WEB_URL.takeIf { savedWebViewState == null }

        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            WebViewCompat.startSafeBrowsing(this) { }
        }

        setContent {
            MeetConTheme {
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
        currentWebView?.onResume()
    }

    override fun onPause() {
        currentWebView?.onPause()
        CookieManager.getInstance().flush()
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
            currentWebView?.apply {
                stopLoading()
                loadUrl("about:blank")
                clearHistory()
                removeAllViews()
                destroy()
            }
            currentWebView = null
        }
        super.onDestroy()
    }

    @Composable
    private fun MeetConShell() {
        val context = LocalContext.current
        var webView by remember { mutableStateOf<WebView?>(null) }
        var pageState by rememberSaveable { mutableStateOf(PageState.LOADING) }
        var loadProgress by rememberSaveable { mutableIntStateOf(0) }
        var fatalMessage by rememberSaveable { mutableStateOf<String?>(null) }
        var connectionMessage by rememberSaveable {
            mutableStateOf<ConnectionMessage?>(null)
        }
        var priorConnectivity by remember { mutableStateOf<Boolean?>(null) }

        fun notifyWebsite(isOnline: Boolean) {
            webView?.evaluateJavascript(nativeShellScript(isOnline), null)
        }

        DisposableEffect(context) {
            val observer = ValidatedConnectivityObserver(context) { isOnline ->
                val previous = priorConnectivity
                priorConnectivity = isOnline
                connectionMessage = when {
                    !isOnline -> ConnectionMessage.OFFLINE
                    previous == false -> ConnectionMessage.BACK_ONLINE
                    else -> null
                }
                notifyWebsite(isOnline)
            }
            onDispose { observer.close() }
        }

        LaunchedEffect(connectionMessage) {
            if (connectionMessage == ConnectionMessage.BACK_ONLINE) {
                delay(BACK_ONLINE_DURATION_MS)
                if (connectionMessage == ConnectionMessage.BACK_ONLINE) {
                    connectionMessage = null
                }
            }
        }

        LaunchedEffect(pendingNavigation, webView) {
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
                    .windowInsetsPadding(WindowInsets.safeDrawing),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                ) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { viewContext ->
                            createSecureWebView(
                                context = viewContext,
                                onStarted = {
                                    pageState = PageState.LOADING
                                    fatalMessage = null
                                },
                                onReady = {
                                    pageState = PageState.READY
                                    notifyWebsite(priorConnectivity != false)
                                },
                                onProgress = { loadProgress = it },
                                onFatalError = { message ->
                                    pageState = PageState.ERROR
                                    fatalMessage = message
                                },
                            ).also { created ->
                                webView = created
                                currentWebView = created
                                val restored = savedWebViewState?.let(created::restoreState)
                                savedWebViewState = null
                                if (restored == null && pendingNavigation == null) {
                                    pendingNavigation = BuildConfig.MEETCON_WEB_URL
                                }
                            }
                        },
                    )

                    if (pageState == PageState.LOADING) {
                        LoadingSurface(loadProgress)
                    }

                    fatalMessage?.let { message ->
                        FatalErrorSurface(message) {
                            fatalMessage = null
                            pageState = PageState.LOADING
                            webView?.reload()
                        }
                    }
                }

                connectionMessage?.let { message ->
                    ConnectionBar(message)
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createSecureWebView(
        context: Context,
        onStarted: () -> Unit,
        onReady: () -> Unit,
        onProgress: (Int) -> Unit,
        onFatalError: (String) -> Unit,
    ): WebView = WebView(context).apply {
        setBackgroundColor(Color.TRANSPARENT)
        isFocusable = true
        isFocusableInTouchMode = true

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
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

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)

        webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                onProgress(newProgress)
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
                view.evaluateJavascript(
                    nativeShellScript(isValidatedNetworkAvailable()),
                    null,
                )
                onReady()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    onFatalError(error.description?.toString().orEmpty())
                }
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse,
            ) {
                if (request.isForMainFrame && errorResponse.statusCode >= 500) {
                    onFatalError("Server error ${errorResponse.statusCode}")
                }
            }

            override fun onReceivedSslError(
                view: WebView,
                handler: SslErrorHandler,
                error: SslError,
            ) {
                handler.cancel()
                onFatalError("A secure connection could not be established.")
            }
        }
    }

    private fun openExternalHttps(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            })
        } catch (_: ActivityNotFoundException) {
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

    private fun isValidatedNetworkAvailable(): Boolean {
        val manager = getSystemService(ConnectivityManager::class.java)
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
        return capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    }

    private fun nativeShellScript(isOnline: Boolean): String {
        val browserEvent = if (isOnline) "online" else "offline"
        val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
        return """
            (() => {
              document.documentElement.dataset.meetconNativeShell = 'android';
              document.documentElement.dataset.meetconReducedMotion = '$reducedMotion';
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
        Surface(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
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
        Surface(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
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
        Snackbar(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            containerColor = when (message) {
                ConnectionMessage.OFFLINE -> MaterialTheme.colorScheme.errorContainer
                ConnectionMessage.BACK_ONLINE -> MaterialTheme.colorScheme.primaryContainer
            },
            contentColor = when (message) {
                ConnectionMessage.OFFLINE -> MaterialTheme.colorScheme.onErrorContainer
                ConnectionMessage.BACK_ONLINE -> MaterialTheme.colorScheme.onPrimaryContainer
            },
        ) {
            Text(
                text = when (message) {
                    ConnectionMessage.OFFLINE -> stringResource(R.string.no_internet)
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
        BACK_ONLINE,
    }

    companion object {
        private const val WEBVIEW_STATE_KEY = "meetcon.webview.state"
        private const val BACK_ONLINE_DURATION_MS = 2_500L
    }
}

private class ValidatedConnectivityObserver(
    context: Context,
    private val onChanged: (Boolean) -> Unit,
) : AutoCloseable {
    private val manager =
        context.applicationContext.getSystemService(ConnectivityManager::class.java)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastValue: Boolean? = null

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = publishCurrentState()
        override fun onLost(network: Network) = publishCurrentState()

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) = publishCurrentState()
    }

    init {
        manager.registerDefaultNetworkCallback(callback)
        publishCurrentState()
    }

    private fun publishCurrentState() {
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
        val isValidated =
            capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        mainHandler.post {
            if (lastValue != isValidated) {
                lastValue = isValidated
                onChanged(isValidated)
            }
        }
    }

    override fun close() {
        runCatching { manager.unregisterNetworkCallback(callback) }
        mainHandler.removeCallbacksAndMessages(null)
    }
}
