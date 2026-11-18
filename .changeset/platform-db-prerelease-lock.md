---
"@marinoscar/platform-db": patch
---

`platform.lock` and `manifest.json` accept semantic versions with a prerelease or build suffix (`0.1.0-next.1`), so `platform db sync` at a prerelease package version writes a lock `parseLock` reads back. `compareVersions` orders versions by semver precedence (a prerelease is below its release, numeric identifiers compare numerically), and `nextPlatformVersion` gives a prerelease package the release it leads to. Adds `SEMVER_PATTERN`.
