package com.enterpriseapp.android

import io.github.marinoscar.platform.android.core.config.ServerUrls
import org.junit.Assert.assertEquals
import org.junit.Test

/** The shell opens the web app at the platform's launch URL (what the web app's captureTwaLaunch reads). */
class LaunchUrlTest {
    @Test fun `the launch URL carries source, appVersion and appVersionCode`() {
        assertEquals(
            "https://app.example.com/?source=twa&appVersion=1.2.3&appVersionCode=42",
            ServerUrls.twaLaunchUrl("https://app.example.com", "1.2.3", 42),
        )
    }
}
