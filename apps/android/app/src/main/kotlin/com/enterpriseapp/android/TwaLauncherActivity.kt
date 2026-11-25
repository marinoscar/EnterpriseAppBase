package com.enterpriseapp.android

import io.github.marinoscar.platform.android.core.twa.TwaLauncher

/**
 * The launcher: everything comes from the platform's [TwaLauncher] (launch URL with
 * `?source=twa&appVersion=…&appVersionCode=…`, incoming https links on the server's host, the
 * setup screen while no server is configured). A native capability overrides `onAppOpen()` for
 * its debounced "app opened" work.
 */
class TwaLauncherActivity : TwaLauncher() {
    override fun setupActivity() = SetupActivity::class.java
}
