pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "android-app"
include(":app")

// The platform's Android library, shipped as files inside @marinoscar/platform-infra
// (no Maven publishing). The installed package wins; inside this monorepo, where the
// workspace may not be installed (CI's Android job runs no npm), the package source
// is the fallback.
include(":platform-core")
project(":platform-core").projectDir = listOf(
    "../../node_modules/@marinoscar/platform-infra/android/platform-core",
    "../../packages/platform-infra/android/platform-core",
).map { file(it) }.firstOrNull { it.resolve("build.gradle.kts").isFile }
    ?: throw GradleException(
        "platform-core not found: run `npm install` at the repository root " +
            "(node_modules/@marinoscar/platform-infra/android/platform-core).",
    )
