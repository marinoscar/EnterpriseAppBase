// =============================================================================
// :platform-core — the platform's Android library module (#746)
// =============================================================================
//
// Shipped as files inside @marinoscar/platform-infra (no Maven publishing). An
// app includes it from its settings.gradle.kts:
//
//     include(":platform-core")
//     project(":platform-core").projectDir =
//         file("../../node_modules/@marinoscar/platform-infra/android/platform-core")
//
// The app's root build.gradle.kts declares the plugin versions (`apply false`):
// com.android.library and com.android.application 8.13.2, Kotlin 2.2.21
// (org.jetbrains.kotlin.android and org.jetbrains.kotlin.plugin.serialization).
// The library pins its own dependencies below, so an app's version catalog
// needs no entry for it.
//
// Identity (product name, storage prefix, deep-link scheme, default server)
// comes from the app's packages/shared/identity.json through
// identity.gradle.kts, applied here and by the app module, into BuildConfig.
// =============================================================================

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

apply(from = file("identity.gradle.kts"))

@Suppress("UNCHECKED_CAST")
val platformIdentity = project.extensions.extraProperties.get("platformIdentity") as Map<String, String>

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "io.github.marinoscar.platform.android.core"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")

        buildConfigField("String", "PRODUCT_NAME", quoted(platformIdentity.getValue("productName")))
        // Prefix of SharedPreferences files and other on-device names. Never change it for a
        // shipped app: phones would lose the server address and the pairing.
        buildConfigField("String", "STORAGE_PREFIX", quoted(platformIdentity.getValue("storagePrefix")))
        buildConfigField("String", "DEEP_LINK_SCHEME", quoted(platformIdentity.getValue("deepLinkScheme")))
        buildConfigField("String", "DEFAULT_SERVER_URL", quoted(platformIdentity.getValue("defaultServerUrl")))
        buildConfigField("String", "TWA_HOST", quoted(platformIdentity.getValue("twaHost")))
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // `api`: the app's launcher extends TwaLauncher (a LauncherActivity), and its code sees
    // ApiResult, OkHttp and kotlinx.serialization types in the public surface.
    api("com.google.androidbrowserhelper:androidbrowserhelper:2.6.2")
    api("com.squareup.okhttp3:okhttp:4.12.0")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.security:security-crypto:1.1.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
