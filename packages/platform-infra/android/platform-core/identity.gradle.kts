// =============================================================================
// The Android build's product identity (@marinoscar/platform-infra, #746)
// =============================================================================
//
// Applied by `:platform-core` and by the app module:
//
//     apply(from = project(":platform-core").file("identity.gradle.kts"))
//
// One source of truth: the app's `packages/shared/identity.json` (two levels
// above the Gradle root, `apps/android`; `-Papp.identityJson=<path>` overrides
// the location), plus its optional `android` block. The derivation is exactly
// `androidIdentity()` of `@marinoscar/platform-contract/android-app`, which the
// CLI and the API use, so every layer names the app the same way:
//
//   token          = the repository name (after the `/` of `repoSlug`),
//                    lower-cased to letters and digits; `app` when that is
//                    empty, prefixed `app` when it starts with a digit
//   applicationId  = com.<token>.android
//   storagePrefix  = <token>          (on-device file names: NEVER change it
//                                      for a shipped app, phones lose the
//                                      server address and the pairing)
//   deepLinkScheme = the repository name lower-cased to scheme characters
//                    (`app`-prefixed when it starts with a digit), plus
//                    `-android`
//   apkStem        = slugify(productName) + `-android`
//
// Each of the four can be pinned in identity.json's `android` block (a fork
// adopting an existing app copies its shipped values there), and
// applicationId, productName and deepLinkScheme also by `-Papp.<key>`.
//
// The result is stored as the extra property `platformIdentity` (a
// Map<String, String>) for the applying build script; nothing here applies a
// plugin or touches the android {} block.
// =============================================================================

import groovy.json.JsonSlurper
import java.net.URI
import java.util.Properties

fun stringProp(name: String): String? = (project.findProperty(name) as String?)?.trim()?.takeIf { it.isNotEmpty() }

val identityPath: String = stringProp("app.identityJson") ?: "../../packages/shared/identity.json"
val identityFile: File = project.rootProject.file(identityPath)
check(identityFile.isFile) {
    "Product identity not found at ${identityFile.path} (packages/shared/identity.json, or -Papp.identityJson=<path>)."
}

@Suppress("UNCHECKED_CAST")
val identityJson = JsonSlurper().parse(identityFile) as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
val androidBlock: Map<String, Any?> = (identityJson["android"] as? Map<String, Any?>) ?: emptyMap()

fun identityValue(key: String): String =
    (identityJson[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        ?: throw GradleException("${identityFile.name}: \"$key\" is missing or empty.")

fun androidOverride(key: String): String? = (androidBlock[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }

val productName: String = stringProp("app.productName") ?: identityValue("productName")
val repoSlug: String = identityValue("repoSlug")
val repoName: String = repoSlug.substringAfter('/').ifEmpty { repoSlug }

val identityToken: String = repoName.lowercase().replace(Regex("[^a-z0-9]"), "").ifEmpty { "app" }
    .let { if (it.first().isDigit()) "app$it" else it }

val applicationId: String = stringProp("app.applicationId") ?: androidOverride("applicationId") ?: "com.$identityToken.android"
val storagePrefix: String = androidOverride("storagePrefix") ?: identityToken
val deepLinkScheme: String = stringProp("app.deepLinkScheme") ?: androidOverride("deepLinkScheme")
    ?: (
        repoName.lowercase().replace(Regex("[^a-z0-9+.-]"), "").trimStart('+', '.', '-').ifEmpty { "app" }
            // A URI scheme starts with a letter, so a digit-led name is prefixed like the token.
            .let { if (it.first().isDigit()) "app$it" else it } + "-android"
        )
val apkStem: String = androidOverride("apkStem")
    ?: (identityValue("productName").lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "app" } + "-android")

check(Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$").matches(applicationId)) {
    "applicationId \"$applicationId\" is not a valid Android application id."
}
check(Regex("^[a-z][a-z0-9+.-]*$").matches(deepLinkScheme)) { "deepLinkScheme \"$deepLinkScheme\" is not a valid URI scheme." }
check(Regex("^[a-zA-Z0-9_]+$").matches(storagePrefix)) { "storagePrefix \"$storagePrefix\" may hold letters, digits and _ only." }

/** `#rrggbb` (identity.json) to `#FFRRGGBB` (an Android colour resource). */
fun argb(key: String, fallback: String): String {
    val hex = (identityJson[key] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: fallback
    if (!Regex("^#[0-9a-fA-F]{6}$").matches(hex)) throw GradleException("identity.json \"$key\" (\"$hex\") is not #rrggbb.")
    return "#FF" + hex.substring(1).uppercase()
}

// Version: apps/android/version.properties (committed; `<cli> android version`
// bumps it), overridable per build with -Papp.versionName / -Papp.versionCode.
val versionProps = Properties().apply {
    val file = project.rootProject.file("version.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}
fun versionProp(key: String): String? = versionProps.getProperty(key)?.trim()?.ifEmpty { null }
val versionName: String = stringProp("app.versionName") ?: versionProp("versionName") ?: "0.1.0"
val versionCode: String = (stringProp("app.versionCode") ?: versionProp("versionCode") ?: "1")
    .takeIf { code -> code.toIntOrNull()?.let { it in 1..2_100_000_000 } == true }
    ?: throw GradleException("versionCode must be a whole number from 1 to 2100000000 (version.properties or -Papp.versionCode).")

// Not blank-filtered on purpose: an empty server URL means "show the setup screen".
val defaultServerUrl: String = (project.findProperty("app.serverUrl") as String?)?.trim().orEmpty()

// The host the launcher's https intent-filter claims (manifest placeholder `twaHost`).
// Chrome delegates a site's Web Push to the app only when the app has a VIEW +
// BROWSABLE activity for that site's URLs, so the filter must name the server's
// host, known only from app.serverUrl at build time.
val unsetTwaHost = "invalid.example"
val twaHost: String = defaultServerUrl.takeIf { it.isNotEmpty() }
    ?.let { url -> runCatching { URI(if ("://" in url) url else "https://$url").host }.getOrNull() }
    ?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
    ?: unsetTwaHost

project.extensions.extraProperties.set(
    "platformIdentity",
    mapOf(
        "productName" to productName,
        "applicationId" to applicationId,
        "storagePrefix" to storagePrefix,
        "deepLinkScheme" to deepLinkScheme,
        "apkStem" to apkStem,
        "themeColor" to argb("themeColor", "#1976d2"),
        "backgroundColor" to argb("backgroundColor", "#ffffff"),
        "versionName" to versionName,
        "versionCode" to versionCode,
        "defaultServerUrl" to defaultServerUrl,
        "twaHost" to twaHost,
        "twaHostUnset" to (twaHost == unsetTwaHost).toString(),
    ),
)
