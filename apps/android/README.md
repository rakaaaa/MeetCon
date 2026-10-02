# MeetCon Android shell

This directory is a standalone Android project. It wraps the MeetCon website in
a hardened Kotlin/Jetpack Compose Material 3 shell; the website remains the
source of all product UI and business behavior.

## Requirements

- Android Studio with Android SDK 36 and build tools installed
- JDK 17 (Android Studio's bundled JDK is supported)
- An Android 8.0/API 26 or newer device or emulator

Open `apps/android` directly in Android Studio, allow Gradle sync to complete,
and run the `app` configuration.

## Web and App Link configuration

Release builds default to `https://meetcon.example.com`. Supply real values as
Gradle project properties (include `:30098` when production uses that port):

```text
./gradlew assembleRelease \
  -PmeetconWebUrl=https://meetcon.example.com:30098 \
  -PmeetconAppLinkHost=meetcon.example.com
```

`meetconWebUrl` must be the exact origin that is allowed to navigate inside the
full-screen WebView (no browser chrome or address bar). Other HTTPS links open
in the user's browser; HTTP and non-web schemes are rejected. `meetconAppLinkHost`
is the verified production host accepted for `/join` App Links (hostname only,
without port). Host
`https://<meetconAppLinkHost>/.well-known/assetlinks.json` with this
application ID and the release signing certificate SHA-256 fingerprint to make
Android verification succeed.

Debug builds use `http://10.0.2.2:5173` by default. Override it when needed:

```text
gradlew.bat installDebug -PmeetconDebugWebUrl=http://localhost:5173
```

Only debug builds trust cleartext `localhost`, `127.0.0.1`, and `10.0.2.2`.
Release builds require HTTPS.

## Signing

Release artifacts are unsigned by design. Keep signing credentials outside the
repository and configure an Android Studio signing configuration, a private
Gradle init script, or CI-injected `signingConfig`. Never commit keystores,
passwords, or `key.properties`. Use the same release certificate fingerprint
in the production `assetlinks.json`.

## Commands

From this directory:

```text
gradlew.bat assembleDebug
gradlew.bat lintDebug
gradlew.bat connectedDebugAndroidTest
gradlew.bat bundleRelease -PmeetconWebUrl=https://your-host.example
```

The instrumentation test requires a running API 26+ emulator/device. It checks
launch, hardened WebView settings, declared permissions, and URL policy.

## Shell behavior

- Cookies and DOM storage preserve the website session; third-party cookies
  are disabled.
- JavaScript is enabled for the React application. File/content access,
  mixed content, geolocation, popup windows, and production WebView debugging
  are disabled.
- Android back navigates WebView history before closing the activity.
- Validated connectivity is observed through `ConnectivityManager`; no polling
  or location/camera permission is used.
- A native offline/back-online bar reserves bottom space. The shell adds
  `data-meetcon-native-shell="android"` and hides web elements marked
  `data-meetcon-connectivity-banner`, `data-meetcon-offline-bar`, or
  `#meetcon-offline-bar` to prevent duplicate connectivity UI.
- Reconnection dispatches browser `online` and `meetcon:resync` events. The
  website can also listen for `meetcon:native-connectivity`.
- WebView state/history are saved across activity recreation, and incoming
  verified `/join` links are routed to the configured MeetCon origin.

The app intentionally declares only `INTERNET` and `ACCESS_NETWORK_STATE`.
