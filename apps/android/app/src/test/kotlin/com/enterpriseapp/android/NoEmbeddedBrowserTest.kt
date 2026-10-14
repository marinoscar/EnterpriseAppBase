package com.enterpriseapp.android

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The shell never embeds a browser: the web app runs in the user's browser through the Trusted
 * Web Activity, and there is no JavaScript bridge (a bridge turns XSS into native code
 * execution). See docs/specs/native-companion-architecture.md.
 */
class NoEmbeddedBrowserTest {
    private val forbidden = listOf("WebView", "android.webkit", "JavascriptInterface")

    @Test fun `app sources and resources name no embedded browser API`() {
        // Unit tests run with the module directory (apps/android/app) as the working directory.
        val main = File("src/main")
        assertTrue("src/main not found from ${File(".").absolutePath}", main.isDirectory)
        val offenders = main.walkTopDown()
            .filter { it.isFile && it.extension in setOf("kt", "java", "xml") }
            .flatMap { file -> forbidden.filter { file.readText().contains(it) }.map { "${file.path}: $it" } }
            .toList()
        assertTrue("Embedded browser API found:\n" + offenders.joinToString("\n"), offenders.isEmpty())
    }
}
