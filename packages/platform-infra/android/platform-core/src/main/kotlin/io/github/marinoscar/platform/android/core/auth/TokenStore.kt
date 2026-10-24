@file:Suppress("DEPRECATION") // security-crypto 1.1.0 deprecates EncryptedSharedPreferences/MasterKey without a replacement.

package io.github.marinoscar.platform.android.core.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.github.marinoscar.platform.android.core.PlatformIdentity
import io.github.marinoscar.platform.android.core.util.PlatformLog
import java.time.Instant
import java.util.UUID

/**
 * Pairing credentials for this installation. Tokens live only here, in encrypted storage.
 *
 * - [token]: the personal access token (`pat_…`) obtained through the device flow. Never logged.
 * - [tokenId]: the token's id, used to revoke it (`DELETE /api/pat/{id}`) when unpairing.
 * - [expiresAt]: when the server says the token expires (the app re-pairs after that).
 * - [deviceId]: the id a native capability's server-side device registry returned, if any.
 * - [installationId]: random UUID generated once per install; survives [clear] so re-pairing
 *   updates the same device row instead of creating a new one.
 */
interface TokenStore {
    val token: String?
    val tokenId: String?
    val expiresAt: Instant?
    val deviceId: String?
    val installationId: String

    val isPaired: Boolean get() = !token.isNullOrEmpty()

    fun setToken(token: String, expiresAt: Instant?, tokenId: String? = null)
    fun setDeviceId(deviceId: String?)

    /** Forgets token, token id, expiry and device id. Keeps [installationId]. */
    fun clear()
}

/** [TokenStore] over any [SharedPreferences]; production passes an EncryptedSharedPreferences. */
open class SharedPrefsTokenStore(private val prefs: SharedPreferences) : TokenStore {
    override val token: String? get() = prefs.getString(KEY_TOKEN, null)

    override val tokenId: String? get() = prefs.getString(KEY_TOKEN_ID, null)

    override val expiresAt: Instant?
        get() = prefs.getString(KEY_EXPIRES_AT, null)?.let { runCatching { Instant.parse(it) }.getOrNull() }

    override val deviceId: String? get() = prefs.getString(KEY_DEVICE_ID, null)

    override val installationId: String
        @Synchronized get() {
            prefs.getString(KEY_INSTALLATION_ID, null)?.let { return it }
            val generated = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_INSTALLATION_ID, generated).commit()
            return generated
        }

    override fun setToken(token: String, expiresAt: Instant?, tokenId: String?) {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .apply { if (expiresAt != null) putString(KEY_EXPIRES_AT, expiresAt.toString()) else remove(KEY_EXPIRES_AT) }
            .apply { if (tokenId != null) putString(KEY_TOKEN_ID, tokenId) else remove(KEY_TOKEN_ID) }
            .commit()
    }

    override fun setDeviceId(deviceId: String?) {
        prefs.edit().apply { if (deviceId != null) putString(KEY_DEVICE_ID, deviceId) else remove(KEY_DEVICE_ID) }.commit()
    }

    override fun clear() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_TOKEN_ID).remove(KEY_EXPIRES_AT).remove(KEY_DEVICE_ID).commit()
    }

    companion object {
        const val KEY_TOKEN = "token"
        const val KEY_TOKEN_ID = "token_id"
        const val KEY_EXPIRES_AT = "expires_at"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_INSTALLATION_ID = "installation_id"
    }
}

/**
 * Keystore-backed (AES-256 GCM) store in `<storagePrefix>_secure`. The app excludes its shared
 * preferences from backup and device transfer (the reference shell's backup rules do).
 */
class EncryptedTokenStore private constructor(prefs: SharedPreferences) : SharedPrefsTokenStore(prefs) {
    companion object {
        private const val TAG = "TokenStore"
        val PREFS_NAME: String = PlatformIdentity.prefsName("secure")

        fun create(context: Context): TokenStore {
            val app = context.applicationContext
            return try {
                EncryptedTokenStore(open(app))
            } catch (e: Exception) {
                // A restored or corrupted keyset cannot be decrypted; start over (the user re-pairs).
                PlatformLog.w(TAG, "Encrypted prefs unreadable; resetting pairing state", e)
                app.deleteSharedPreferences(PREFS_NAME)
                EncryptedTokenStore(open(app))
            }
        }

        private fun open(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }
}
