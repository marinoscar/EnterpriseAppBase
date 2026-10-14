package io.github.marinoscar.platform.android.core.auth

import io.github.marinoscar.platform.android.core.net.ApiClient
import io.github.marinoscar.platform.android.core.net.ApiError
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthFailuresTest {
    @Test fun `a 401 asks to re-pair`() {
        assertEquals(AuthFailure.REPAIR_REQUIRED, AuthFailures.classify(ApiClient.parseError(401, """{"code":"UNAUTHORIZED"}""")))
    }

    @Test fun `409 DEVICE_REVOKED forgets the pairing`() {
        val error = ApiClient.parseError(409, """{"code":"CONFLICT","message":"Unpaired","details":{"reason":"DEVICE_REVOKED"}}""")
        assertEquals(AuthFailure.FORGET_PAIRING, AuthFailures.classify(error))
    }

    @Test fun `other failures leave the pairing alone`() {
        assertEquals(AuthFailure.NONE, AuthFailures.classify(ApiClient.parseError(409, """{"details":{"reason":"OTHER"}}""")))
        assertEquals(AuthFailure.NONE, AuthFailures.classify(ApiClient.parseError(503, "<html>")))
        assertEquals(AuthFailure.NONE, AuthFailures.classify(ApiError(ApiError.Kind.NETWORK, message = "offline")))
    }
}
