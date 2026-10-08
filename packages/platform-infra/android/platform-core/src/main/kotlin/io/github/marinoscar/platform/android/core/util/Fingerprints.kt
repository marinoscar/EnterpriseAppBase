package io.github.marinoscar.platform.android.core.util

import java.security.MessageDigest

/**
 * SHA-256 certificate fingerprints in the form Digital Asset Links and the server use:
 * 32 upper-case hex pairs joined by `:` (`AB:01:…`). Mirrors `normalizeSha256Fingerprint` of
 * `@marinoscar/platform-contract/android-app`, so the app, the CLI and the server agree.
 */
object Fingerprints {
    private val CANONICAL = Regex("^([0-9A-F]{2}:){31}[0-9A-F]{2}$")
    private val BARE = Regex("^[0-9A-F]{64}$")

    /** `[0xab, 0x01]` -> `AB:01`. */
    fun format(digest: ByteArray): String = digest.joinToString(":") { "%02X".format(it.toInt() and 0xFF) }

    /** SHA-256 of a DER-encoded certificate, formatted like `keytool` and assetlinks.json. */
    fun sha256(certificate: ByteArray): String = format(MessageDigest.getInstance("SHA-256").digest(certificate))

    /**
     * Normalises a fingerprint in either accepted form, 64 bare hex digits or 32 colon-separated
     * pairs, in any case, to the canonical form; null for anything else. The same two forms
     * `normalizeSha256Fingerprint` accepts on the server.
     */
    fun normalize(input: String?): String? {
        val trimmed = input?.trim()?.uppercase() ?: return null
        return when {
            BARE.matches(trimmed) -> trimmed.chunked(2).joinToString(":")
            CANONICAL.matches(trimmed) -> trimmed
            else -> null
        }
    }

    /** True for the canonical form only. */
    fun isCanonical(value: String?): Boolean = value != null && CANONICAL.matches(value)
}
