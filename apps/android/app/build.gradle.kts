// The reference Android shell: a Trusted Web Activity around the web app, built on the
// platform's :platform-core, with no native capability. A product adds one as its own
// Kotlin module (docs/specs/native-companion-architecture.md §4).

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Product identity: packages/shared/identity.json (and its `android` block) is the single
// source of truth. Nothing in apps/android spells the product name: the label,
// applicationId, deep-link scheme and brand colours all come from here.
apply(from = project(":platform-core").file("identity.gradle.kts"))

@Suppress("UNCHECKED_CAST")
val identity = project.extensions.extraProperties.get("platformIdentity") as Map<String, String>

/** Kotlin package of the sources; identity-neutral on purpose (never renamed by a fork). */
val codeNamespace = "com.enterpriseapp.android"

if (identity.getValue("twaHostUnset") == "true") {
    logger.warn(
        "${project.path}: no usable app.serverUrl; the launcher's https intent-filter names ${identity.getValue("twaHost")}, " +
            "so the browser will not delegate the web app's notifications to this build. " +
            "Pass -Papp.serverUrl=https://<server> to enable notification delegation.",
    )
}

// Release signing comes only from the environment (CI secrets, or the CLI's keystore
// config). When any variable is missing the release build is produced unsigned.
val signingStoreFile: String? = System.getenv("ANDROID_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }
val signingStorePassword: String? = System.getenv("ANDROID_KEYSTORE_PASSWORD")?.takeIf { it.isNotEmpty() }
val signingKeyAlias: String? = System.getenv("ANDROID_KEY_ALIAS")?.takeIf { it.isNotBlank() }
val signingKeyPassword: String? = System.getenv("ANDROID_KEY_PASSWORD")?.takeIf { it.isNotEmpty() }
val hasReleaseSigning = signingStoreFile != null && file(signingStoreFile).exists() &&
    signingStorePassword != null && signingKeyAlias != null && signingKeyPassword != null

android {
    namespace = codeNamespace
    compileSdk = 36

    defaultConfig {
        applicationId = identity.getValue("applicationId")
        minSdk = 26
        targetSdk = 36
        versionCode = identity.getValue("versionCode").toInt()
        versionName = identity.getValue("versionName")

        resValue("string", "app_name", identity.getValue("productName"))
        resValue("color", "brand_primary", identity.getValue("themeColor"))
        resValue("color", "brand_background", identity.getValue("backgroundColor"))
        resValue("color", "ic_launcher_background", identity.getValue("themeColor"))
        manifestPlaceholders["deepLinkScheme"] = identity.getValue("deepLinkScheme")
        manifestPlaceholders["twaHost"] = identity.getValue("twaHost")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                // Outer vals have distinct names: inside this block `keyAlias` would mean this.keyAlias.
                storeFile = file(signingStoreFile!!)
                storePassword = signingStorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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

if (!hasReleaseSigning) {
    gradle.taskGraph.whenReady {
        if (allTasks.any { it.name.contains("Release") && it.name.startsWith("assemble") }) {
            logger.warn(
                "${project.path}: ANDROID_KEYSTORE_FILE/ANDROID_KEYSTORE_PASSWORD/ANDROID_KEY_ALIAS/ANDROID_KEY_PASSWORD " +
                    "not all set; the release APK will be unsigned.",
            )
        }
    }
}

dependencies {
    implementation(project(":platform-core"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidbrowserhelper)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
}
