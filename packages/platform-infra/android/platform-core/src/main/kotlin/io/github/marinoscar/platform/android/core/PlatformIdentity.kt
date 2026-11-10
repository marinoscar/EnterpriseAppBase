package io.github.marinoscar.platform.android.core

/**
 * The product identity this build was made with, generated into [BuildConfig] from the app's
 * `packages/shared/identity.json` (and its `android` block) by `identity.gradle.kts`.
 *
 * User-facing text names the product through [productName], never through a literal, and every
 * on-device file name starts with [storagePrefix], so a renamed fork needs no code change here.
 */
object PlatformIdentity {
    /** Display name, e.g. in "Pair with <name>". */
    const val productName: String = BuildConfig.PRODUCT_NAME

    /**
     * Prefix of SharedPreferences files and other on-device names. Never change it for a shipped
     * app: installed phones would lose the server address and the pairing.
     */
    const val storagePrefix: String = BuildConfig.STORAGE_PREFIX

    /** Custom scheme of the app's deep links (`<scheme>://<host>`). */
    const val deepLinkScheme: String = BuildConfig.DEEP_LINK_SCHEME

    /** The server the build defaults to (`-Papp.serverUrl`), or empty: the setup screen asks. */
    const val defaultServerUrl: String = BuildConfig.DEFAULT_SERVER_URL

    /** The host the launcher's https intent-filter claims (`invalid.example` without a server URL). */
    const val twaHost: String = BuildConfig.TWA_HOST

    /** [productName] without spaces or punctuation (user agent, log tags): `Some Name` -> `SomeName`. */
    val compactName: String get() = compact(productName)

    /** A deep link on this app's scheme: `deepLink("open")` -> `<scheme>://open`. */
    fun deepLink(host: String): String = "$deepLinkScheme://$host"

    /** The name of one of this app's SharedPreferences files: `<storagePrefix>_<name>`. */
    fun prefsName(name: String): String = "${storagePrefix}_$name"

    fun compact(name: String): String = name.filter { it.isLetterOrDigit() && it.code < 128 }.ifEmpty { "App" }
}
