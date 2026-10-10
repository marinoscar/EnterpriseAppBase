package io.github.marinoscar.platform.android.core.config

import android.content.Context
import android.content.SharedPreferences
import io.github.marinoscar.platform.android.core.PlatformIdentity

/**
 * The server this app talks to. A value saved by the user wins; otherwise the build-time default
 * (`-Papp.serverUrl=…` -> [PlatformIdentity.defaultServerUrl]) is used, and when both are empty
 * the app shows its first-run setup screen.
 *
 * Not secret, so it lives in plain SharedPreferences (`<storagePrefix>_config`); the token does
 * not (see TokenStore).
 */
class ServerConfig(
    private val prefs: SharedPreferences,
    private val buildDefault: String = PlatformIdentity.defaultServerUrl,
) {
    /** Canonical server origin, or null when nothing (valid) is configured. */
    val serverUrl: String?
        get() {
            val stored = prefs.getString(KEY_SERVER_URL, null)
            if (!stored.isNullOrBlank()) {
                (ServerUrls.normalize(stored) as? ServerUrlResult.Valid)?.let { return it.url }
            }
            return (ServerUrls.normalize(buildDefault) as? ServerUrlResult.Valid)?.url
        }

    val isConfigured: Boolean get() = serverUrl != null

    /** True when the user saved a URL (as opposed to running on the build default). */
    val isUserDefined: Boolean get() = !prefs.getString(KEY_SERVER_URL, null).isNullOrBlank()

    /** Validates and, when valid, persists [input]. Returns the validation result either way. */
    fun setServerUrl(input: String): ServerUrlResult {
        val result = ServerUrls.normalize(input)
        if (result is ServerUrlResult.Valid) {
            prefs.edit().putString(KEY_SERVER_URL, result.url).apply()
        }
        return result
    }

    /** Forgets the user's choice, falling back to the build default (if any). */
    fun clear() {
        prefs.edit().remove(KEY_SERVER_URL).apply()
    }

    companion object {
        val PREFS_NAME: String = PlatformIdentity.prefsName("config")
        const val KEY_SERVER_URL = "server_url"

        fun from(context: Context): ServerConfig =
            ServerConfig(context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE))
    }
}
