package io.github.marinoscar.platform.android.core.pairing

import android.content.Context
import android.os.Build
import io.github.marinoscar.platform.android.core.PlatformIdentity
import io.github.marinoscar.platform.android.core.util.AppInfo
import java.util.Locale

/** What the phone tells the server about itself when it asks for a device code. */
object DeviceInfo {
    private const val MAX = 100

    /**
     * `"Samsung SM-S918B"` (the manufacturer is not repeated when the model already starts with
     * it), plus ` · <suffix>` when the capability names itself (EvoPath: `Health sync`).
     */
    fun deviceName(manufacturer: String?, model: String?, suffix: String? = null): String {
        val maker = manufacturer?.trim().orEmpty().replaceFirstChar { it.titlecase(Locale.ROOT) }
        val mdl = model?.trim().orEmpty()
        val base = when {
            mdl.isEmpty() -> maker
            maker.isEmpty() || mdl.lowercase(Locale.ROOT).startsWith(maker.lowercase(Locale.ROOT)) -> mdl
            else -> "$maker $mdl"
        }.ifEmpty { "Android phone" }
        val named = suffix?.trim()?.takeIf { it.isNotEmpty() }?.let { "$base · $it" } ?: base
        return named.take(MAX)
    }

    /** `<CompactProductName>-Android/<versionName>`. */
    fun userAgent(versionName: String, productName: String = PlatformIdentity.productName): String =
        "${PlatformIdentity.compact(productName)}-Android/$versionName"

    fun clientInfo(context: Context, nameSuffix: String? = null): DeviceClientInfo = DeviceClientInfo(
        deviceName = deviceName(Build.MANUFACTURER, Build.MODEL, nameSuffix),
        userAgent = userAgent(AppInfo.read(context).versionName),
        tokenType = "pat",
    )
}
