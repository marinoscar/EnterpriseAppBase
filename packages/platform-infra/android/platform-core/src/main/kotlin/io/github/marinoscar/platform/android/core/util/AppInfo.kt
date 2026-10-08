package io.github.marinoscar.platform.android.core.util

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build

/** Identity of this installed build, as reported to the server (launch URL, pairing, diagnostics). */
data class AppInfo(
    val packageName: String,
    val versionName: String,
    val versionCode: Long,
    /** SHA-256 of the signing certificate as `AA:BB:…` (upper case), or null when unavailable. */
    val signingSha256: String?,
) {
    companion object {
        /** Reads the installed package (the app's own versionName/versionCode, not the library's). */
        fun read(context: Context): AppInfo {
            val pm = context.packageManager
            val info = runCatching { packageInfo(pm, context.packageName, 0) }.getOrNull()
            return AppInfo(
                packageName = context.packageName,
                versionName = info?.versionName.orEmpty().ifEmpty { "0" },
                versionCode = info?.let(::versionCode) ?: 0L,
                signingSha256 = signingSha256(context),
            )
        }

        /**
         * Fingerprint of the current signing certificate: GET_SIGNING_CERTIFICATES on API 28+
         * (handles key rotation: the current signer is last in the history), GET_SIGNATURES below.
         */
        fun signingSha256(context: Context): String? = runCatching {
            val pm = context.packageManager
            val signatures: Array<Signature>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val signingInfo = packageInfo(pm, context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
                    ?: return@runCatching null
                if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners else signingInfo.signingCertificateHistory
            } else {
                @Suppress("DEPRECATION")
                packageInfo(pm, context.packageName, PackageManager.GET_SIGNATURES).signatures
            }
            signatures?.lastOrNull()?.toByteArray()?.let(Fingerprints::sha256)
        }.getOrNull()

        private fun versionCode(info: PackageInfo): Long =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toLong()
            }

        private fun packageInfo(pm: PackageManager, pkg: String, flags: Int): PackageInfo =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(flags.toLong()))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(pkg, flags)
            }
    }
}
