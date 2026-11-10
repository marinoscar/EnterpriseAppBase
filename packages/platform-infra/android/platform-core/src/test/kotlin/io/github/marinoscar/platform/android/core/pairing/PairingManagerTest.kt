package io.github.marinoscar.platform.android.core.pairing

import io.github.marinoscar.platform.android.core.auth.SharedPrefsTokenStore
import io.github.marinoscar.platform.android.core.net.ApiError
import io.github.marinoscar.platform.android.core.net.ApiResult
import io.github.marinoscar.platform.android.core.testing.FakeSharedPreferences
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class PairingManagerTest {
    private val credential = DeviceCredential(accessToken = "pat_x", credentialType = "pat", tokenId = "tok-1", expiresAt = "2027-01-01T00:00:00Z")

    private class Transport(private val token: ApiResult<DeviceCredential>) : DeviceFlowTransport {
        var requested: DeviceClientInfo? = null
        override suspend fun requestCode(clientInfo: DeviceClientInfo): ApiResult<DeviceCodeGrant> {
            requested = clientInfo
            return ApiResult.Success(
                DeviceCodeGrant("d", "ABCD-1234", "https://e/activate", null, expiresIn = 900, interval = 1),
                200,
            )
        }
        override suspend fun pollToken(deviceCode: String): ApiResult<DeviceCredential> = token
    }

    private class Hook(private val result: ApiResult<String>) : PairingHook {
        val unregistered = mutableListOf<String>()
        var forgotten = false
        var paired: String? = null
        override suspend fun register(installationId: String): ApiResult<String> = result
        override suspend fun unregister(deviceId: String): ApiResult<Unit> {
            unregistered += deviceId
            return ApiResult.Success(Unit, 204)
        }
        override fun onForgotten() { forgotten = true }
        override fun onPaired(deviceId: String) { paired = deviceId }
    }

    private fun manager(
        transport: Transport,
        hook: PairingHook? = null,
        revoker: TokenRevoker? = null,
    ): Pair<SharedPrefsTokenStore, PairingManager> {
        val tokens = SharedPrefsTokenStore(FakeSharedPreferences())
        return tokens to PairingManager(
            transport = transport,
            poller = DeviceFlowPoller(transport, sleep = {}),
            tokens = tokens,
            clientInfo = { DeviceClientInfo("Pixel", "App-Android/1.0") },
            hook = hook,
            revoker = revoker,
            clock = { Instant.parse("2026-10-01T00:00:00Z") },
        )
    }

    @Test fun `a plain TWA app pairs with the token alone and asks for a PAT`() = runBlocking {
        val transport = Transport(ApiResult.Success(credential, 200))
        val (tokens, pairing) = manager(transport)
        val events = mutableListOf<PairingEvent>()
        val result = pairing.pair { events += it }
        assertEquals(PairingResult.Paired(null, Instant.parse("2027-01-01T00:00:00Z")), result)
        assertEquals("pat", transport.requested?.tokenType)
        assertTrue(events.first() is PairingEvent.CodeReady)
        assertEquals("pat_x", tokens.token)
        assertEquals("tok-1", tokens.tokenId)
    }

    @Test fun `a hook registers the device after the token is stored`() = runBlocking {
        val hook = Hook(ApiResult.Success("dev-9", 201))
        val (tokens, pairing) = manager(Transport(ApiResult.Success(credential, 200)), hook)
        val result = pairing.pair {}
        assertEquals("dev-9", (result as PairingResult.Paired).deviceId)
        assertEquals("dev-9", tokens.deviceId)
        assertEquals("dev-9", hook.paired)
    }

    @Test fun `a 401 from the hook clears the new token`() = runBlocking {
        val refused = ApiResult.Failure(ApiError(ApiError.Kind.HTTP, 401, "UNAUTHORIZED", "no"))
        val (tokens, pairing) = manager(Transport(ApiResult.Success(credential, 200)), Hook(refused))
        val result = pairing.pair {}
        assertFalse((result as PairingResult.Failed).canRetryRegistration)
        assertFalse(tokens.isPaired)
    }

    @Test fun `a failed registration keeps the token for a retry`() = runBlocking {
        val down = ApiResult.Failure(ApiError(ApiError.Kind.HTTP, 503, "ERROR", "down"))
        val (tokens, pairing) = manager(Transport(ApiResult.Success(credential, 200)), Hook(down))
        val result = pairing.pair {}
        assertTrue((result as PairingResult.Failed).canRetryRegistration)
        assertTrue(tokens.isPaired)
    }

    @Test fun `a denied approval saves nothing`() = runBlocking {
        val denied = ApiResult.Failure(ApiError(ApiError.Kind.HTTP, 400, "BAD_REQUEST", "x", oauthError = "access_denied"))
        val (tokens, pairing) = manager(Transport(denied))
        assertTrue(pairing.pair {} is PairingResult.Failed)
        assertFalse(tokens.isPaired)
    }

    @Test fun `unpairing revokes the token without a hook and forgets it`() = runBlocking {
        val revoked = mutableListOf<String>()
        val revoker = TokenRevoker { id -> revoked += id; ApiResult.Success(Unit, 204) }
        val (tokens, pairing) = manager(Transport(ApiResult.Success(credential, 200)), revoker = revoker)
        pairing.pair {}
        assertEquals(UnpairResult.Done, pairing.unpair())
        assertEquals(listOf("tok-1"), revoked)
        assertFalse(tokens.isPaired)
        assertNull(tokens.tokenId)
    }

    @Test fun `unpairing through a hook unregisters the device`() = runBlocking {
        val hook = Hook(ApiResult.Success("dev-9", 201))
        val (tokens, pairing) = manager(Transport(ApiResult.Success(credential, 200)), hook)
        pairing.pair {}
        assertEquals(UnpairResult.Done, pairing.unpair())
        assertEquals(listOf("dev-9"), hook.unregistered)
        assertTrue(hook.forgotten)
        assertFalse(tokens.isPaired)
    }

    @Test fun `an unreachable server keeps the pairing unless told to forget`() = runBlocking {
        val offline = TokenRevoker { ApiResult.Failure(ApiError(ApiError.Kind.NETWORK, message = "offline")) }
        val (tokens, pairing) = manager(Transport(ApiResult.Success(credential, 200)), revoker = offline)
        pairing.pair {}
        assertTrue(pairing.unpair() is UnpairResult.ServerUnreachable)
        assertTrue(tokens.isPaired)
        assertEquals(UnpairResult.Done, pairing.unpair(forgetLocallyOnFailure = true))
        assertFalse(tokens.isPaired)
    }

    @Test fun `a server that already forgot the token counts as unpaired`() = runBlocking {
        val gone = TokenRevoker { ApiResult.Failure(ApiError(ApiError.Kind.HTTP, 404, "NOT_FOUND", "gone")) }
        val (tokens, pairing) = manager(Transport(ApiResult.Success(credential, 200)), revoker = gone)
        pairing.pair {}
        assertEquals(UnpairResult.Done, pairing.unpair())
        assertFalse(tokens.isPaired)
    }
}
