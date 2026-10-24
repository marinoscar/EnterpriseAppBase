package io.github.marinoscar.platform.android.core.pairing

import io.github.marinoscar.platform.android.core.auth.TokenStore
import io.github.marinoscar.platform.android.core.net.ApiClient
import io.github.marinoscar.platform.android.core.net.ApiError
import io.github.marinoscar.platform.android.core.net.ApiResult
import io.github.marinoscar.platform.android.core.util.PlatformLog
import java.time.Instant

/** Events of one pairing attempt, for the app's pairing screen. */
sealed interface PairingEvent {
    data class CodeReady(val grant: DeviceCodeGrant) : PairingEvent
    data class Progress(val progress: PollProgress) : PairingEvent
    data object Registering : PairingEvent
}

sealed interface PairingResult {
    /** Paired. [deviceId] is what the [PairingHook] registered, or null without a hook. */
    data class Paired(val deviceId: String?, val tokenExpiresAt: Instant?) : PairingResult
    data class Failed(val message: String, val canRetryRegistration: Boolean = false) : PairingResult
}

sealed interface UnpairResult {
    data object Done : UnpairResult

    /** The server could not be reached; [message] says why. The caller may forget locally anyway. */
    data class ServerUnreachable(val message: String) : UnpairResult
}

/**
 * The seam a native capability plugs into pairing (docs/specs/native-companion-architecture.md
 * §4): after the device flow stores the token, [register] tells the capability's server API about
 * this phone (EvoPath: `POST /api/health-sync/devices`) and returns the device id; [unregister]
 * removes it again. A plain TWA app passes no hook.
 */
interface PairingHook {
    /** Registers this installation with the stored token; returns the device id. */
    suspend fun register(installationId: String): ApiResult<String>

    /** Removes [deviceId] on the server (which may also revoke the token). */
    suspend fun unregister(deviceId: String): ApiResult<Unit>

    /** Called after the pairing is forgotten locally: cancel scheduled work, reset local state. */
    fun onForgotten() {}

    /** Called after a successful pairing: schedule work, start an initial run. */
    fun onPaired(deviceId: String) {}
}

/** Revokes a personal access token: `DELETE /api/pat/{id}`. */
fun interface TokenRevoker {
    suspend fun revoke(tokenId: String): ApiResult<Unit>
}

/** [TokenRevoker] over the platform's PAT route (docs/personal-access-tokens.md). */
class ApiTokenRevoker(private val api: ApiClient) : TokenRevoker {
    override suspend fun revoke(tokenId: String): ApiResult<Unit> {
        require(tokenId.matches(Regex("^[A-Za-z0-9-]{1,64}$"))) { "Invalid token id" }
        return when (val result = api.delete("/api/pat/$tokenId")) {
            is ApiResult.Success -> ApiResult.Success(Unit, result.httpStatus)
            is ApiResult.Failure -> result
        }
    }
}

/**
 * Pairing = the RFC 8628 device flow for a PAT (`clientInfo.tokenType: "pat"`), approved by the
 * user in a Custom Tab (never a WebView), then the optional [hook]'s registration.
 *
 * The token is stored, encrypted, as soon as it is collected, so a failed registration can be
 * retried without a new browser approval ([register]).
 */
class PairingManager(
    private val transport: DeviceFlowTransport,
    private val poller: DeviceFlowPoller,
    private val tokens: TokenStore,
    /** Client info for the device-code request. */
    private val clientInfo: () -> DeviceClientInfo,
    private val hook: PairingHook? = null,
    private val revoker: TokenRevoker? = null,
    private val clock: () -> Instant = Instant::now,
) {
    suspend fun pair(onEvent: (PairingEvent) -> Unit): PairingResult {
        PlatformLog.i(TAG, "Pairing started")
        val grant = when (val code = transport.requestCode(clientInfo())) {
            is ApiResult.Success -> code.value
            is ApiResult.Failure -> return failed("Could not start pairing: ${code.error.message}")
        }
        onEvent(PairingEvent.CodeReady(grant))

        return when (val polled = poller.poll(grant) { onEvent(PairingEvent.Progress(it)) }) {
            is PollResult.Approved -> {
                val expiresAt = polled.credential.expiryInstant(clock())
                tokens.setToken(polled.credential.accessToken, expiresAt, polled.credential.tokenId)
                tokens.setDeviceId(null)
                PlatformLog.i(TAG, "Pairing approved; token stored (expires ${expiresAt ?: "unknown"})")
                if (hook == null) {
                    PairingResult.Paired(null, expiresAt)
                } else {
                    onEvent(PairingEvent.Registering)
                    register()
                }
            }
            PollResult.Denied -> failed("Pairing was denied in the browser. Nothing was saved.")
            PollResult.Expired -> failed("The pairing code expired. Start again.")
            is PollResult.Failed -> failed(polled.message)
        }
    }

    private fun failed(message: String, canRetryRegistration: Boolean = false): PairingResult.Failed {
        PlatformLog.w(TAG, "Pairing failed: $message")
        return PairingResult.Failed(message, canRetryRegistration)
    }

    /** Registers this phone through the hook with the stored token (after pairing, or to retry). */
    suspend fun register(): PairingResult {
        if (!tokens.isPaired) return failed("Not signed in: pair again.")
        val hook = this.hook ?: return PairingResult.Paired(null, tokens.expiresAt)
        return when (val result = hook.register(tokens.installationId)) {
            is ApiResult.Success -> {
                PlatformLog.i(TAG, "Phone registered as device ${result.value}")
                tokens.setDeviceId(result.value)
                hook.onPaired(result.value)
                PairingResult.Paired(result.value, tokens.expiresAt)
            }
            is ApiResult.Failure -> {
                val error = result.error
                if (error.isUnauthorized) {
                    tokens.clear()
                    failed("The server refused the new token: pair again.")
                } else {
                    failed("Could not register this phone: ${error.message}", canRetryRegistration = true)
                }
            }
        }
    }

    /**
     * Unpairs on the server (the hook's device, else the token itself), then forgets the pairing
     * here. A server that already forgot it (401/404/409) counts as done.
     */
    suspend fun unpair(forgetLocallyOnFailure: Boolean = false): UnpairResult {
        if (tokens.isPaired) {
            val deviceId = tokens.deviceId
            val tokenId = tokens.tokenId
            val result: ApiResult<Unit>? = when {
                hook != null && deviceId != null -> hook.unregister(deviceId)
                revoker != null && tokenId != null -> revoker.revoke(tokenId)
                else -> null
            }
            if (result is ApiResult.Failure && !alreadyGone(result.error) && !forgetLocallyOnFailure) {
                return UnpairResult.ServerUnreachable(result.error.message)
            }
        }
        forgetLocally()
        return UnpairResult.Done
    }

    /** Forgets the pairing on this phone only (after `409 DEVICE_REVOKED`, or when the server is gone). */
    fun forgetLocally() {
        PlatformLog.i(TAG, "Pairing removed from this phone")
        tokens.clear()
        hook?.onForgotten()
    }

    private fun alreadyGone(error: ApiError): Boolean {
        val status = error.httpStatus
        return status == 401 || status == 404 || status == 409
    }

    private companion object {
        const val TAG = "Pairing"
    }
}
