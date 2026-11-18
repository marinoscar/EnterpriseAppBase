# @marinoscar/platform-cli/android

The Android companion's CLI (issue #746, PP-9.4), merged from EvoPath's and MemoriaHub's `apps/cli/src/android/` and `commands/android.ts`: the `android` command group (doctor, keystore, version, build, publish, release, releases), the optional deploy step that publishes the APK after a deploy, and the TUI's Android screen. It depends on `core` and `engine` of this package (`packages/platform-slices.json`) and on `@marinoscar/platform-contract/android-app` (the identity derivation).

## Purpose and scope

Building and shipping the Android app is a developer-machine job: a JDK, the Android SDK, a release keystore that is the app's identity forever, a version that only goes up, and an upload to the server the app is tied to. The group does each step and checks the next one is possible before starting it.

| Command | What it does |
|---|---|
| `android doctor [--fix [--dry-run]] [--json]` | Checks the checkout, `version.properties`, the JDK, the Android SDK (cmdline-tools, platform, build-tools, licences), the keystore and its fingerprint, the server. `--fix` prints the plan (MemoriaHub) and installs the SDK pieces (EvoPath); `--dry-run` executes nothing. Never installs a JDK, never creates a keystore |
| `android keystore init|import <file>|show|secrets` | Creates (RSA 4096, 100 years) or imports the release keystore under `~/.<cli>/android/`, prints its SHA-256, prints the four CI secrets |
| `android version [--bump patch|minor|major] [--set x.y.z] [--code n]` | Shows or changes `apps/android/version.properties` (versionCode always increases) |
| `android build [--server-url] [--debug] [--require-up-to-date]` | Builds and signs the APK into `dist/android/` with a metadata JSON (SHA-256, signing fingerprint, git SHA) |
| `android publish [apk] [--notes] [--trust] [--no-current] [--force]` | Uploads to `POST /api/admin/android-app/releases` with the stored login (a PAT works), with upload progress |
| `android release [--bump part] [--notes]` | Bump, build, publish, then commit `version.properties` only after the upload succeeded |
| `android releases [current <id>]` | Lists the server's releases; makes one current (a rollback included) |

Not here: the server routes (`@marinoscar/platform-api/android-app`), the Kotlin module (`@marinoscar/platform-infra/android/platform-core`), Play Store publishing (both apps sideload hosted APKs).

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`; import it by its subpath:

```ts
import { androidCommand, androidDeployStep, androidTuiScreen } from '@marinoscar/platform-cli/android';
```

No peer beyond the package's (`react` for the TUI screen). On the machine that builds: JDK 17+ (`android doctor` says which), the Android SDK (`android doctor --fix` installs it under `~/.<cli>/android-sdk` when `ANDROID_HOME` is not set), and the repository checkout with `apps/android`.

## Quick start

The reference app ([`apps/cli/src/app.ts`](../../../../apps/cli/src/app.ts)):

```ts
export const APP_CLI_OPTIONS: CreateCliOptions = {
  identity: CLI_IDENTITY,
  version: CLI_VERSION,
  extraCommands: [androidCommand({ identity: ANDROID_IDENTITY_SOURCE })],
  tuiScreens: [androidTuiScreen],
  deploySteps: [androidDeployStep({ pipeline: 'install' }), androidDeployStep({ pipeline: 'update' })],
};
```

Then, from the checkout: `appctl android doctor`, `appctl android keystore init`, `appctl login --server https://<server>`, `appctl android release --bump patch`.

## Configuration

| Option | Of | Default | Meaning |
|---|---|---|---|
| `identity` | `androidCommand` | none | The product identity used outside a checkout (`ANDROID_IDENTITY_SOURCE` of `@app/shared`); inside one, `packages/shared/identity.json` wins |
| `pipeline` | `androidDeployStep` | `update` | Which pipeline the step joins (after `verify`); register twice for both |
| `release` | `androidDeployStep` | `{}` | `{ bump?, notes? }` for the published release |

Environment (prefixed with the CLI's env prefix, `APPCTL_` in the reference app): `<PREFIX>REPO_ROOT` (the repository instead of searching upward), `<PREFIX>GRADLE_ARGS` (appended to every Gradle run), `<PREFIX>DEPLOY_ANDROID=1` (opts a deploy into the step). The keystore passwords come from `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_PASSWORD` (the names Gradle and CI use) or a prompt, and are stored only in `~/.<cli>/android/signing.json` (mode 600), never in the repository.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `androidCommand` | registry | `androidCommand(options?: AndroidCommandOptions): CliCommandRegistration` | Add the `android` group to an app's CLI (`extraCommands` or `registerCliCommand`) | experimental | [example](../../../../apps/cli/src/app.ts) |
| `androidDeployStep` | registry | `androidDeployStep(options?: AndroidDeployStepOptions): DeployStepRegistration` | Publish the APK after a deploy (`deploySteps` or `registerDeployStep`) | experimental | [example](../../../../apps/cli/src/app.ts) |

Supporting exports (experimental): `androidTuiScreen` (the TUI registration, `tuiScreens` or `registerTuiScreen`), `deployAndroidEnvVar`, `readAndroidIdentity`, `configureAndroidIdentity`, `IDENTITY_JSON_PATH`, and the types `AndroidCommandOptions`, `AndroidDeployStepOptions`, `DeployAndroidOptions`, `BumpPart`, `AndroidIdentity`, `AndroidIdentitySource`. The building blocks (Gradle, Java, SDK, keystore, metadata, publish, release-status) are internal to the slice.

## Data

None in a database. Files: `apps/android/version.properties` (committed), `dist/android/<apkStem>-<versionName>.apk` and its `.json` metadata, `~/.<cli>/android/release.jks` and `signing.json` (mode 600, outside every repository), `~/.<cli>/android-sdk/` (when the CLI installed the SDK).

## Permissions and settings

`android publish`, `release`, `releases` and the deploy step need a login (or a PAT) holding `system_settings:write` on the server (`system_settings:read` for `releases`). The deploy step checks it before building and skips with the fix when missing.

## UI

The TUI's **Android app** screen (`androidTuiScreen`, order 65): a status panel (local version, keystore, login, the server's current release) over doctor, bump, build, publish, release and the releases list with make-current. Every action calls the function the command calls.

## Infra

None. The CI workflow (`.github/workflows/android.yml`) builds debug APKs without the CLI and without secrets.

## Observability

None beyond the command output: progress on stderr, results on stdout (`--json` where offered).

## Security notes

- **The keystore is the app's identity.** `keystore init` refuses to replace a configured keystore; `doctor --fix` never creates one; losing it means installed apps can never be updated. `keystore secrets` prints the passwords on purpose (for the CI secrets) behind a warning.
- **Passwords never reach a command line:** keytool and apksigner read them from the environment (`-storepass:env`), and they are stored only in `signing.json` (mode 600).
- **The JDK is never installed by the CLI** (no `sudo`): the plan prints the command instead. Stricter than MemoriaHub, which ran `apt-get` through sudo.
- `publish --trust` adds a new signing key to the server's trusted list; without it the server refuses an untrusted pair once the list is non-empty.

## Conformance suite

None. The slice's tests (`src/android/*.test.ts`, ported from EvoPath's and MemoriaHub's suites) cover Gradle, Java, the SDK, the keystore, versions, metadata, publish, release, release status, the doctor, the fix plan, the deploy step, the TUI model and the registrations, with mocked `exec` and `fetch`.

## Upgrade notes

New in #746. From EvoPath's `evopathcli android`: identical commands; `-Pevopath.*` Gradle properties become `-Papp.*`; the keystore stays under `~/.<cli>/android/` (move EvoPath's `~/.evopathcli/android/` if the CLI name changes); the deploy step is opted into with `<PREFIX>DEPLOY_ANDROID=1` instead of `--with-android`. From MemoriaHub's: `identity.properties` is replaced by the `android` block of `identity.json` (copy `applicationId`, `deepLinkScheme`, `storagePrefix`, `apkStem` verbatim); `doctor --fix` prints the same plan but never runs `apt-get`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No apps/android checkout found` | Run from inside the repository, or set `<PREFIX>REPO_ROOT` |
| `doctor` fails on the JDK | Install JDK 17+ (the printed hint), set `JAVA_HOME` |
| `doctor` fails on the SDK | `android doctor --fix` (or `--fix --dry-run` to see the plan) |
| `publish` answers `RELEASE_UNTRUSTED_APP` | The server trusts another signing key; trust this one on the admin page or `publish --trust` |
| `publish` answers `RELEASE_VERSION_NOT_NEWER` | `android version --bump patch`, rebuild |
| The deploy step skipped | Set `<PREFIX>DEPLOY_ANDROID=1`; the logged line names any other gap (domain, login, toolchain) |

## Links

- [Package README](../../README.md), [API slice](../../../platform-api/src/android-app/README.md)
- [Native companion architecture spec](../../../../docs/specs/native-companion-architecture.md)
- Runbooks: [Android app](../../../../docs/runbooks/android-app.md), [Android release](../../../../docs/runbooks/android-release.md)
