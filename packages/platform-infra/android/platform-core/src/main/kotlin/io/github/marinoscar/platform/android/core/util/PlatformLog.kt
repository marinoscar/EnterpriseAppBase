package io.github.marinoscar.platform.android.core.util

import android.util.Log

/**
 * The module's one logging seam. Lines carry a tag and a short message only: never a token, a
 * request or response body, a query string or a header. An app may replace [sink] (for example
 * to keep a ring buffer for its diagnostics screen); the default writes to logcat.
 */
object PlatformLog {
    enum class Level { INFO, WARN }

    @Volatile
    var sink: (level: Level, tag: String, message: String, error: Throwable?) -> Unit = { level, tag, message, error ->
        runCatching {
            when (level) {
                Level.INFO -> Log.i(tag, message)
                Level.WARN -> if (error != null) Log.w(tag, message, error) else Log.w(tag, message)
            }
        }
    }

    fun i(tag: String, message: String) = sink(Level.INFO, tag, message, null)

    fun w(tag: String, message: String, error: Throwable? = null) = sink(Level.WARN, tag, message, error)
}
