# Runbook: Release a New Android APK

> **Applies to:** `apps/android` and the CLI's `android` group (`@marinoscar/platform-cli/android`) · **Design:** [native-companion-architecture.md §2.7](../specs/native-companion-architecture.md#27-lifecycle-and-releases) · **Install and trust:** [android-app.md](android-app.md)

A release is an APK built from `apps/android`, signed with the app's release key, uploaded to the server and made current. Phones learn of it through the web app's update banner (and a native capability's update check). Every path below runs the same stages: bump the version, build and sign, upload, make current. Commands use the reference CLI name `appctl`.

## 1. Prerequisites

- The repository checkout (the CLI finds `apps/android` by searching upward; `APPCTL_REPO_ROOT` overrides).
- JDK 17 or newer, and the Android SDK (platform 36, build-tools 36.0.0). `appctl android doctor` checks both; `appctl android doctor --fix` installs the SDK pieces (it never installs a JDK) and `--fix --dry-run` only prints the plan.
- Object storage configured on the server, and an administrator login with `system_settings:write`.

## 2. Log in the CLI

```bash
appctl login --server https://app.example.com
```

The device flow stores a token in `~/.appctl/`; a personal access token works too. `android publish`, `release` and `releases` use it.

## 3. Signing keystore

The release key is the app's identity forever: installed phones accept an update only when it is signed with the same key, and Digital Asset Links trust is bound to its fingerprint.

```bash
appctl android keystore init            # RSA 4096, 100 years, under ~/.appctl/android/
appctl android keystore import <file>   # or bring an existing one (EvoPath, MemoriaHub)
appctl android keystore show            # prints the SHA-256 fingerprint
```

The keystore lives in `~/.appctl/android/release.jks` and its passwords in `~/.appctl/android/signing.json` (mode 600), outside every checkout; `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD` can supply the passwords instead. Back both up somewhere safe. Never commit them (`apps/android/.gitignore` refuses `*.jks`, `*.keystore`, `keystore.properties`).

## 4. Versioning rules

- `apps/android/version.properties` holds `versionName` (x.y.z) and `versionCode` (a whole number from 1).
- `versionCode` must strictly increase for every published APK: Android refuses to install a lower code over a higher one, and the server refuses a duplicate (`409 RELEASE_VERSION_EXISTS`) and a current release that is not newer (`409 RELEASE_VERSION_NOT_NEWER`, unless `--force`).
- `appctl android version` shows it; `--bump patch|minor|major` or `--set x.y.z` change `versionName` and increment `versionCode`; `--code <n>` sets the code explicitly.

## 5. Release from the command line

### 5.1 One shot

```bash
appctl android release --bump patch --notes "Faster start-up"
```

Bumps the version, builds and signs (tied to the logged-in server unless `--server-url`), uploads with progress, makes it current, then commits `version.properties` only after the upload succeeded (`--no-commit` skips the commit; `--require-up-to-date` refuses a checkout behind its upstream).

### 5.2 Step by step

```bash
appctl android version --bump patch
appctl android build                        # dist/android/<apkStem>-<version>.apk + metadata JSON
appctl android publish dist/android/<file>.apk --notes "…"   # --no-current, --force, --trust
```

`publish` refuses (`409 RELEASE_UNTRUSTED_APP`) when the server already trusts other apps and not this (package, signing key) pair; add `--trust` for a new app or a rotated key, after checking the fingerprint.

## 6. Release from the terminal menu

Run `appctl` in a terminal and open **Android**: it shows the local version, the server's current release and the login, and runs doctor, bump, build, publish, release and make current with the same checks. Every remote action asks for confirmation naming the version, the code and the server; a rollback to a lower `versionCode` carries an extra warning.

## 7. Release during a deploy

The optional deploy step publishes the APK after the deploy's `verify` stage, when the local version is newer than the server's current release:

```bash
APPCTL_DEPLOY_ANDROID=1 appctl deploy update
```

Without the variable the step is skipped. It needs the keystore and the toolchain on the deploying machine.

## 8. Release from the web admin page

Admin, Settings, Android app, **Upload a release**: choose the signed APK, add notes, keep **Make current** checked, and tick **Trust a new signing key** for a new app or a rotated key. The server reads the package name, version and signing certificate from the APK itself (at most 150 MiB), streams it to object storage under `android-releases/`, and lists it under Releases.

## 9. CI

`.github/workflows/android.yml` runs on changes to `apps/android/**`, `packages/platform-infra/android/**` and `packages/shared/identity.json`: the JVM unit tests and a **debug** APK, uploaded as the `<apkStem>-debug` artifact. It needs no secret and publishes nothing.

Signed release builds in CI are an owner step. `appctl android keystore secrets` prints the four values to store as repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). A release job maps them to a job-level `env` and gates each step with `if: env.ANDROID_KEYSTORE_BASE64 != ''`, because the `secrets` context is not available in `if:`; the job then skips cleanly in a fork without them. The build reads `ANDROID_KEYSTORE_FILE` (the decoded keystore), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`; without all four the release APK is unsigned.

## 10. Verify

```bash
appctl android releases                       # the new release is current
curl -s https://<server>/.well-known/assetlinks.json   # lists its package and fingerprint
```

On a phone with the previous version, open the app: the update banner offers the new version; install it over the old one.

## 11. Roll back

Make an older release current:

```bash
appctl android releases                 # find the id
appctl android releases current <id>
```

or choose **Make current** on its row in Admin, Settings, Android app. Phones that already installed the newer build keep it (Android refuses a downgrade); the rollback stops new installs and update offers. To ship a fix, publish a new, higher `versionCode`. Deleting a release removes its APK from storage; the current release cannot be deleted (`409 RELEASE_IS_CURRENT`).

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `409 RELEASE_VERSION_EXISTS` | That `versionCode` is already published | `appctl android version --bump patch`, rebuild |
| `409 RELEASE_VERSION_NOT_NEWER` | The current release has a higher code | Bump, or `--force` to make an older one current on purpose |
| `409 RELEASE_UNTRUSTED_APP` | The APK's (package, key) pair is not trusted and others are | Check the fingerprint, then `--trust` |
| `409 RELEASE_CURRENT_CONFLICT` | Two "make current" calls raced | Retry; one release is current |
| `400 RELEASE_NOT_AN_APK` or `413 RELEASE_TOO_LARGE` | Not a signed APK, or over 150 MiB | Upload the signed release APK |
| `503 STORAGE_NOT_CONFIGURED` | No object storage | Configure it in Admin, Settings, Storage |
| `android doctor` reports no JDK | No JDK 17+ on `PATH` or `JAVA_HOME` | Install one (Temurin 17 or 21) |
| The release APK is unsigned | The signing variables were not all set | `appctl android keystore show`; for CI, all four secrets |
| Upload stalls behind nginx | The upload location is missing | Check `infra/nginx/platform/android-app.conf` is included and synced |

## 13. Summary checklist

- [ ] `appctl android doctor` passes; the keystore is backed up.
- [ ] `versionCode` bumped; the release built, uploaded and current.
- [ ] Its fingerprint is in `assetlinks.json`.
- [ ] A phone with the previous version sees and installs the update.

## See also

- [android-app.md](android-app.md): install, trust, pair, troubleshooting on the phone.
- [The CLI group's README](../../packages/platform-cli/src/android/README.md) and [the API slice's README](../../packages/platform-api/src/android-app/README.md).
- [storage-configuration.md](storage-configuration.md), [deploy-to-vps.md](deploy-to-vps.md).
