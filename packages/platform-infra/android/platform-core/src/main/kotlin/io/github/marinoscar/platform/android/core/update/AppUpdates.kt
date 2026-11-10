package io.github.marinoscar.platform.android.core.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import io.github.marinoscar.platform.android.core.net.ApiResult
import io.github.marinoscar.platform.android.core.util.PlatformLog

/** Android glue for [UpdateChecker]: the browser download of a newer release. */
object AppUpdates {
    private const val TAG = "Update"

    /**
     * Gets a signed download link (`POST /api/android-app/releases/:id/download-link`) and opens
     * it in the browser, which downloads the APK and hands it to the system installer. The link
     * is accepted only on the server's own origin. Returns an error message, or null when the
     * browser opened.
     */
    suspend fun download(
        context: Context,
        server: String?,
        backend: ReleaseBackend,
        store: UpdateStore,
        update: AvailableUpdate,
    ): String? {
        if (server == null) return "No server is configured."
        val link = when (val result = backend.downloadLink(update.releaseId)) {
            is ApiResult.Success -> result.value
            is ApiResult.Failure -> {
                PlatformLog.w(TAG, "Download link failed: ${result.error.message}")
                if (result.error.httpStatus == 404) {
                    // The release was replaced or deleted: look again on the next open.
                    store.lastCheckAt = null
                    store.available = null
                    return "This release is no longer offered. Reopen the app to check again."
                }
                return "Could not get the download link: ${result.error.message}"
            }
        }
        val url = UpdatePolicy.downloadUrl(server, link.url) ?: return "The server returned an unexpected download link."
        return try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            PlatformLog.i(TAG, "Opened the download of ${update.versionName} (${update.versionCode})")
            null
        } catch (e: ActivityNotFoundException) {
            "No browser is installed to download the update."
        }
    }
}
