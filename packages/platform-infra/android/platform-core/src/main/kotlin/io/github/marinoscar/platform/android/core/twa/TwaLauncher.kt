package io.github.marinoscar.platform.android.core.twa

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.google.androidbrowserhelper.trusted.LauncherActivity
import io.github.marinoscar.platform.android.core.config.ServerConfig
import io.github.marinoscar.platform.android.core.config.ServerUrls
import io.github.marinoscar.platform.android.core.util.AppInfo

/**
 * The launcher every platform Android app extends: opens the web app in a Trusted Web Activity
 * at `${server}/?source=twa&appVersion=…&appVersionCode=…` ([ServerUrls.twaLaunchUrl]), or, for
 * an https link on the server's host (the manifest's VIEW filter, which also lets the browser
 * delegate the web app's notifications), at that link with the same parameters. When no server
 * is configured yet it starts [setupActivity] instead.
 *
 * The manifest's `DEFAULT_URL` is only a placeholder; the real URL comes from [serverUrl], so one
 * APK works against any deployment (the server publishes `assetlinks.json` for it).
 *
 * There is deliberately no WebView and no JavaScript interface anywhere in the platform: the web
 * app runs in the user's browser, and the two sides coordinate only through the launch URL, deep
 * links, the server and Digital Asset Links (docs/specs/native-companion-architecture.md).
 *
 * ```kotlin
 * class LauncherActivity : TwaLauncher() {
 *     override fun setupActivity() = SetupActivity::class.java
 * }
 * ```
 */
abstract class TwaLauncher : LauncherActivity() {
    private val resolvedServerUrl: String? by lazy { serverUrl() }

    /** The configured server origin, or null to show [setupActivity]. Defaults to [ServerConfig]. */
    protected open fun serverUrl(): String? = ServerConfig.from(this).serverUrl

    /** The first-run screen that asks for the server address. */
    protected abstract fun setupActivity(): Class<out Activity>

    /**
     * Called once per cold start while a server is configured, before the browser opens: the
     * place for a native capability's debounced "app opened" work (EvoPath: a Health Connect sync
     * and the update check). Keep it short and asynchronous.
     */
    protected open fun onAppOpen() {}

    override fun shouldLaunchImmediately(): Boolean = resolvedServerUrl != null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // super.onCreate may already have finished (e.g. a duplicate launcher instance).
        if (resolvedServerUrl == null && !isFinishing) {
            startActivity(Intent(this, setupActivity()))
            finish()
            return
        }
        if (savedInstanceState == null) onAppOpen()
    }

    override fun getLaunchingUrl(): Uri {
        val server = resolvedServerUrl ?: return super.getLaunchingUrl()
        val app = AppInfo.read(this)
        // An https link on the server's host (the launcher's VIEW filter) opens at that page;
        // the launcher icon, or a link to any other host, opens the start URL.
        val incoming = intent?.data?.toString()
        return Uri.parse(ServerUrls.twaLaunchUrlFor(server, incoming, app.versionName, app.versionCode))
    }
}
