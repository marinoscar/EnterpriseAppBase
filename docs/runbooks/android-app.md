# Runbook: Install, Trust and Pair the Android App

> **Applies to:** the reference shell `apps/android` and every app built on `:platform-core` · **Design:** [native-companion-architecture.md](../specs/native-companion-architecture.md) · **Releases:** [android-release.md](android-release.md) · **Admin UI:** Admin, Settings, Android app (`/admin/settings/android`)

The Android app is the web app in a Trusted Web Activity (TWA), plus whatever native capability the product adds. This runbook gets it onto a phone, makes the server trust it (no URL bar), pairs a native capability, and covers what goes wrong. Commands use the reference CLI name `appctl`; a fork uses its own.

## 1. Before you start

- A deployed server reachable over **https** (a TWA and Digital Asset Links work only over https).
- Object storage configured on the server (Admin, Settings, Storage): the server stores hosted APKs there. Without it an upload answers `503 STORAGE_NOT_CONFIGURED`.
- An administrator account with `system_settings:write` to trust the app and publish releases.
- A phone running Android 8.0 (API 26) or newer, with Chrome or another TWA-capable browser, signed in to the server in that browser.
- A published release (see [android-release.md](android-release.md)), or a debug APK from the `Android` workflow's artifact for a quick test.

## 2. Install the APK

1. On the phone, open the server in the browser and sign in. An administrator finds each release under Admin, Settings, Android app, Releases, with a **Download <version>** button (a signed same-origin link valid for 10 minutes); inside an older app the web app's update banner offers the same button.
2. Download the APK and open it. Android asks to allow installs from the browser the first time; allow it for that browser only.
3. An update installs over the previous version only when its `versionCode` is higher and it is signed with the same key. A different key means uninstalling the old app first (and losing its local state).

## 3. First run

1. Open the app. With no server built in (`-Papp.serverUrl` unset), it shows the setup screen: enter the server address (`https://app.example.com`, no path). The address must be https; the screen says why it refuses anything else.
2. The app opens the web app at `<server>/?source=twa&appVersion=<versionName>&appVersionCode=<versionCode>`. The web app now knows it runs inside the app and which build it is.
3. A URL bar at the top means the server does not trust this build yet: do section 4.

To change the server later, clear the app's storage (Android Settings, Apps, the app, Storage, Clear storage), which also forgets any pairing.

## 4. Trust the build on the server

The browser hides its URL bar only when `https://<server>/.well-known/assetlinks.json` lists the app's package name and the SHA-256 fingerprint of its signing certificate.

1. Find the pair:
   - the release you published: Admin, Settings, Android app, Releases (each row shows the package and the signing fingerprint);
   - a device a native capability paired: the **Reported by paired devices** list on the same page;
   - from the keystore: `appctl android keystore show`;
   - from an APK: `apksigner verify --print-certs <apk>` (the `SHA-256 digest` line).
2. In Admin, Settings, Android app, **Trusted apps**: choose **Trust** next to a reported pair, or enter the package name and SHA-256 fingerprint by hand (with or without colons, any case) and choose **Trust**. At most 10 pairs.
3. Check: `curl -s https://<server>/.well-known/assetlinks.json` lists the pair.
4. Close the app completely and reopen it. The browser caches verification; a newly trusted key can take a few minutes, and a previously failed verification is remembered until the browser re-checks (clearing the browser's data forces it).

Publishing with `appctl android publish --trust` (or the upload form's **Trust a new signing key**) adds the pair in the same step, and making a release current trusts its pair too. While the trusted list is not empty, an upload signed with an untrusted pair is refused (`409 RELEASE_UNTRUSTED_APP`) unless it asks to trust it.

## 5. Pair a native capability

The plain shell needs no pairing: the web app uses the browser's session. A native capability (EvoPath's Health sync, MemoriaHub's media sync) pairs once:

1. On the capability's native screen choose **Pair** (or **Connect**). The app shows a code and opens the activation page in a Custom Tab, which shares the browser's sign-in.
2. Check that the code on the page matches, then approve. The app receives a personal access token, stores it encrypted on the phone, and registers the device with the capability's API.
3. The device appears on the web (the capability's devices page) and on the Access Tokens page as a token named after the phone.

Re-pairing reuses the same device row. Unpairing revokes the token on the server and forgets it on the phone.

## 6. Notifications

- **Web Push inside the app.** The browser delegates the web app's notifications to the Android app only when the APK was built with the server's host (`appctl android build` passes the logged-in server; or `-Papp.serverUrl=https://<server>`). Allow notifications when the web app asks; on Android 13+ the system dialog appears.
- **The `android_app` channel.** Subscriptions made inside the app are tagged `android_app` on the server. An event that declares the channel reaches them; when it also resolves `push`, the user gets one notification, not two.
- **Test.** Admin, Settings, Android app, **Send me a test notification** sends to your own `android_app` subscriptions and reports the result per subscription.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A URL bar stays at the top | The (package, fingerprint) pair is not in `assetlinks.json`, or the browser cached a failed check | Section 4; then close and reopen the app, or clear the browser's data |
| `assetlinks.json` is empty or 404 | No pair trusted, or the nginx snippet is missing | Trust a pair; check `infra/nginx/app.d/locations/android-app.conf` includes `platform/android-app.conf` and run `npm run platform:infra:sync` |
| The setup screen refuses the address | Not https, has a path, query or user info, or a bare host name | Enter the origin only, `https://host[:port]` |
| "App not installed" on update | Lower or equal `versionCode`, or a different signing key | Publish a higher `versionCode`; for a new key uninstall first |
| Download link answers 410 | The 10-minute link expired | Choose Download again |
| Download link answers 404 `DOWNLOAD_LINK_INVALID` | The release was deleted, or the link was altered | Download from the admin page again |
| No update banner in the app | The release is not current, or the app's `versionCode` is not lower | Make the release current; check `GET /api/android-app/releases/latest` |
| Pairing: "issued a … instead of an access token" | The server does not honour `clientInfo.tokenType: "pat"` | Update the server |
| The app asks to pair again | The token expired (`DEVICE_PAT_EXPIRY_DAYS`, default 90) or was revoked (`401`) | Pair again |
| The app forgot its pairing | The server answered `409 DEVICE_REVOKED`: the device was unpaired from the web | Pair again if intended |
| Web Push notifications show as Chrome's, not the app's | The APK was built without a server URL (its https filter names `invalid.example`) | Rebuild with `--server-url` / `-Papp.serverUrl` |

The Doctor (Admin, Doctor) runs `android.assetlinks` (warns when a paired device reports an untrusted pair) and `android.releases` (warns when devices are paired but no release is current, and counts the devices on an older build); see [doctor.md](doctor.md).

## 8. Summary checklist

- [ ] Storage configured; a release published and current.
- [ ] The release's (package, fingerprint) trusted; `/.well-known/assetlinks.json` lists it.
- [ ] The app opens full screen at the server.
- [ ] A native capability paired, if the product has one.
- [ ] Notifications allowed inside the app; the test notification arrives.

## See also

- [android-release.md](android-release.md): build, sign, publish, roll back.
- [native-companion-architecture.md](../specs/native-companion-architecture.md): the five coordination channels and their failure modes.
- [DEVICE-AUTH.md](../DEVICE-AUTH.md), [personal-access-tokens.md](../personal-access-tokens.md), [storage-configuration.md](storage-configuration.md), [vapid-keys.md](vapid-keys.md).
