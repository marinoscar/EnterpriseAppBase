// Plugin versions for the whole build, :app and :platform-core alike (AGP and Kotlin
// pinned as the platform's Android module expects: see its build.gradle.kts).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
