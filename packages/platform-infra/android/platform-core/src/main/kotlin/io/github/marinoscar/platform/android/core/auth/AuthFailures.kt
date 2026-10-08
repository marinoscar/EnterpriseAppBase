package io.github.marinoscar.platform.android.core.auth

import io.github.marinoscar.platform.android.core.net.ApiError

/** What an authenticated call's failure means for the pairing. */
enum class AuthFailure {
    /** Not an authentication problem (network, 5xx, validation…): retry later. */
    NONE,

    /** `401`: the token was refused. Stop background work and ask the user to pair again. */
    REPAIR_REQUIRED,

    /** `409 DEVICE_REVOKED`: the server unpaired this device. Forget the pairing here. */
    FORGET_PAIRING,
}

/**
 * The two security rules every native capability follows, in one place:
 * a `401` stops work and asks to re-pair; `409 DEVICE_REVOKED` forgets the pairing.
 */
object AuthFailures {
    fun classify(error: ApiError): AuthFailure = when {
        error.isDeviceRevoked -> AuthFailure.FORGET_PAIRING
        error.isUnauthorized -> AuthFailure.REPAIR_REQUIRED
        else -> AuthFailure.NONE
    }
}
