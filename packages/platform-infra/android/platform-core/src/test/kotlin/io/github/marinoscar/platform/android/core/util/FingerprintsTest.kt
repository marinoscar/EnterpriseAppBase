package io.github.marinoscar.platform.android.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FingerprintsTest {
    private val canonical =
        "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD"

    @Test fun `formats bytes as upper-case colon-separated hex`() {
        assertEquals("00:0A:7F:80:FF", Fingerprints.format(byteArrayOf(0x00, 0x0a, 0x7f, 0x80.toByte(), 0xff.toByte())))
        assertEquals("", Fingerprints.format(ByteArray(0)))
    }

    @Test fun `sha256 matches the assetlinks format`() {
        // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assertEquals(canonical, Fingerprints.sha256("abc".toByteArray()))
        assertTrue(Fingerprints.isCanonical(canonical))
    }

    @Test fun `normalises bare hex and lower-case colon forms`() {
        assertEquals(canonical, Fingerprints.normalize("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"))
        assertEquals(canonical, Fingerprints.normalize("  " + canonical.lowercase() + "\n"))
        assertEquals(canonical, Fingerprints.normalize(canonical))
    }

    @Test fun `refuses anything that is not 32 bytes of hex`() {
        assertNull(Fingerprints.normalize(null))
        assertNull(Fingerprints.normalize(""))
        assertNull(Fingerprints.normalize("AB:CD"))
        assertNull(Fingerprints.normalize(canonical.replace(':', '-')))
        assertNull(Fingerprints.normalize("zz" + canonical.substring(2)))
        assertFalse(Fingerprints.isCanonical(canonical.lowercase()))
    }
}
