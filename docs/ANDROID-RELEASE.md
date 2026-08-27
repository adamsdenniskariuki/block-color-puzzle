# Setting up and releasing Sortile for Android

Sortile's Android app is a Trusted Web Activity (TWA): a small signed Android
wrapper that opens the production PWA fullscreen. The game remains a single
web codebase shared by the website, Microsoft Store hosted app, and Android.

This guide records the intended project layout, setup flow, release procedure,
and the lessons learned while preparing the Android version.

## Product identity

| Field | Value |
| --- | --- |
| Brand | Made by Favor |
| Production origin | `https://sortile.madebyfavor.com` |
| Android package name | `com.madebyfavor.sortile` |
| App name | `Sortile` |
| Wrapper type | Trusted Web Activity |
| Generator | Bubblewrap |
| Java baseline | Microsoft Build of OpenJDK 17 |

The Android package name is permanent after publishing. Confirm it before the
first Play Console upload.

## Repository layout

Keep the PWA and Android wrapper in the same repository:

```text
block-color-puzzle/
|-- index.html
|-- game.js
|-- styles.css
|-- manifest.webmanifest
|-- sw.js
|-- .well-known/
|   `-- assetlinks.json
|-- android/
|   |-- twa-manifest.json
|   |-- app/
|   |-- gradle/
|   `-- build.gradle
|-- dist/
|   |-- android/
|   |   `-- sortile-release.aab
|   `-- windows-store/
`-- docs/
    |-- ANDROID-RELEASE.md
    `-- WINDOWS-STORE-BUILD.md
```

The root remains the source of truth. `android/` contains only the generated
TWA wrapper and Android-specific configuration. Do not duplicate game logic or
web assets inside the wrapper.

Generated release bundles, local Android SDK paths, keystores, and signing
properties are ignored by Git.

## Prerequisites

1. Microsoft Build of OpenJDK 17.
2. Node.js and npm.
3. Android Studio or the Android command-line SDK.
4. Bubblewrap CLI.
5. A Google Play Console developer account.
6. A custom HTTPS origin controlled by the publisher.

Verify Java:

```powershell
java -version
javac -version
keytool -help
```

All commands should resolve in a newly opened terminal. The installed version
for the first setup was Microsoft OpenJDK `17.0.20.1`.

Install Bubblewrap:

```powershell
npm install --global @bubblewrap/cli
bubblewrap --version
```

Bubblewrap may offer to download or configure Android SDK components on first
use. Prefer its supported versions rather than substituting newer Java or
Gradle versions without a reason.

## 1. Prepare the custom-domain PWA

The GitHub Pages custom domain is:

`sortile.madebyfavor.com`

Cloudflare DNS uses:

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | `sortile` | `adamsdenniskariuki.github.io` | DNS only |

GitHub Pages must have the same custom domain configured and **Enforce HTTPS**
enabled. DNS-only mode lets GitHub directly validate the CNAME and provision
its certificate. Cloudflare proxying is unnecessary for this static site and
can obscure GitHub's ownership and TLS checks.

Verify:

```powershell
Invoke-WebRequest https://sortile.madebyfavor.com/ -UseBasicParsing
Invoke-WebRequest `
  https://sortile.madebyfavor.com/manifest.webmanifest `
  -UseBasicParsing
```

Before generating the TWA, update `manifest.webmanifest` for the root custom
origin:

```json
{
  "id": "/index.html",
  "start_url": "/index.html",
  "scope": "/"
}
```

The old GitHub project-site identity,
`/block-color-puzzle/index.html`, is wrong for the root custom domain.

Changing the manifest is a shipped runtime change. Increment both:

- `BUILD_ID` in `game.js`
- `CACHE` in `sw.js`

They must be identical. Compare against `origin/main` before selecting the next
number; another agent or checkout may already have advanced it.

Run all tests, mutation-verify any new test, deploy to `main`, and verify the
new manifest from the production domain before continuing.

## 2. Generate the Bubblewrap project

Create the wrapper under `android/`:

```powershell
Set-Location Q:\inno\game\block-color-puzzle
New-Item -ItemType Directory -Force android
Set-Location android

bubblewrap init `
  --manifest https://sortile.madebyfavor.com/manifest.webmanifest
```

Use these values when prompted:

| Prompt | Value |
| --- | --- |
| Domain | `sortile.madebyfavor.com` |
| URL path | `/index.html` |
| Application name | `Sortile` |
| Short name | `Sortile` |
| Package ID | `com.madebyfavor.sortile` |
| Display mode | `standalone` |
| Orientation | `any` |
| Theme/background colours | Values from `manifest.webmanifest` |

Review `android/twa-manifest.json` after generation. In particular, verify the
host, launch URL, package ID, app name, icon URLs, and version fields.

Do not accept a fallback WebView package. The target is a verified TWA using
Chrome or another compatible browser.

## 3. Create and protect the signing key

The upload key is the long-lived identity for Android releases. Losing it makes
future updates difficult; exposing it lets someone sign malicious builds.

Create the key outside the repository:

```powershell
$keyDir = Join-Path $env:USERPROFILE '.sortile-signing'
New-Item -ItemType Directory -Force $keyDir

keytool -genkeypair `
  -alias sortile-upload `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000 `
  -keystore "$keyDir\sortile-upload.jks"
```

Use a unique password stored in a password manager. Back up the keystore in a
second secure location. Never commit:

- `.jks` or `.keystore` files
- keystore or key passwords
- `key.properties`
- Play Console service-account credentials

The generated Android project may request the keystore path and alias during
`bubblewrap build`. Use the external path above.

## 4. Obtain the SHA-256 certificate fingerprint

Digital Asset Links binds the web origin to the Android package and signing
certificate:

```powershell
keytool -list -v `
  -keystore "$env:USERPROFILE\.sortile-signing\sortile-upload.jks" `
  -alias sortile-upload
```

Copy the `SHA256` fingerprint exactly. Do not invent or publish a placeholder.

If Play App Signing is enabled, Google signs production installs with an app
signing certificate that may differ from the local upload key. After creating
the Play Console app, obtain the **App signing key certificate** SHA-256 from:

**Setup -> App integrity -> App signing**

Publish every certificate that can legitimately sign an installed build:

- local/upload certificate for direct testing, when applicable
- Google Play app-signing certificate for Store installs

## 5. Publish Digital Asset Links

Create `.well-known/assetlinks.json` at the repository root:

```json
[
  {
    "relation": [
      "delegate_permission/common.handle_all_urls"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "com.madebyfavor.sortile",
      "sha256_cert_fingerprints": [
        "REPLACE_WITH_REAL_SHA256_FINGERPRINT"
      ]
    }
  }
]
```

Replace the placeholder before deployment. The required production URL is:

`https://sortile.madebyfavor.com/.well-known/assetlinks.json`

It must:

- return HTTP 200
- return the JSON without authentication
- avoid cross-origin redirects
- contain the exact package name
- contain the certificate used to sign the installed app

Verify after deployment:

```powershell
$links = Invoke-WebRequest `
  https://sortile.madebyfavor.com/.well-known/assetlinks.json `
  -UseBasicParsing
$links.StatusCode
$links.Headers.'Content-Type'
$links.Content
```

## 6. Build Android packages

From `android/`:

```powershell
bubblewrap update
bubblewrap build
```

Bubblewrap normally produces:

- an `.apk` for local installation/testing
- an `.aab` Android App Bundle for Google Play

Copy release artifacts to `dist/android/` for local retention, but do not
commit them:

```powershell
New-Item -ItemType Directory -Force ..\dist\android
Copy-Item .\app-release-bundle.aab `
  ..\dist\android\sortile-release.aab
```

Exact generated filenames can vary by Bubblewrap version. Inspect the output
rather than assuming a path.

## 7. Test the TWA

Install the release APK on a physical Android device with Chrome:

```powershell
adb install -r .\app-release-signed.apk
```

Confirm:

- Sortile opens without browser chrome.
- The URL remains on `sortile.madebyfavor.com`.
- Offline startup works after one successful online launch.
- Daily, Levels, settings, sound, haptics, and persistence work.
- Back navigation and external links behave correctly.
- The TWA does not show a browser toolbar. A toolbar usually means Digital
  Asset Links verification failed.
- Closing and reopening preserves the active mode and board.

Test on the Play-distributed build again after adding the Play app-signing
fingerprint to `assetlinks.json`.

## 8. Create the Play Console app

1. Create a new app named **Sortile**.
2. Use package name `com.madebyfavor.sortile`.
3. Enable Play App Signing.
4. Upload the release `.aab`.
5. Add the Play app-signing SHA-256 fingerprint to `assetlinks.json`.
6. Complete:
   - Store listing and screenshots
   - App access declaration
   - Ads declaration
   - Content rating
   - Target audience
   - Data safety
   - Privacy policy
7. Use an internal testing track first.
8. Complete any closed-testing requirement shown for the account before
   requesting production access.

Sortile has no account, advertising, or analytics and stores game data locally.
Answer Play Console forms from the actual shipped behavior; do not infer that a
TWA automatically collects browser or Google data on the developer's behalf.

## Updating the Android app

Most game changes need only a web deployment:

1. Change the shared PWA.
2. Mutation-verify new tests.
3. Increment matching `BUILD_ID` and `CACHE`.
4. Push `main`.
5. Verify GitHub Pages and the custom domain.

A new `.aab` is needed only for Android-wrapper changes such as:

- package metadata
- Android version code/name
- icons or splash configuration embedded in the wrapper
- permissions
- launch behavior
- target SDK/build tooling

The hosted PWA model lets gameplay and UI fixes reach Android, Windows Store,
and web users without rebuilding each native wrapper.

## Release checklist

- [ ] `sortile.madebyfavor.com` resolves and enforces HTTPS.
- [ ] Manifest identity, start URL, and scope use the custom-domain root.
- [ ] `BUILD_ID` and `CACHE` match and were advanced together.
- [ ] All tests pass and every new test was mutation-verified.
- [ ] Production manifest and service worker show the intended build.
- [ ] Bubblewrap package ID is `com.madebyfavor.sortile`.
- [ ] Keystore is outside the repository and backed up securely.
- [ ] Local signing SHA-256 was recorded.
- [ ] Play app-signing SHA-256 was added after Play Console setup.
- [ ] `assetlinks.json` is live and returns HTTP 200.
- [ ] The installed app opens as a verified TWA without browser chrome.
- [ ] Offline, persistence, Daily, Levels, and device controls were tested.
- [ ] Release `.aab` was uploaded to an internal testing track.
- [ ] Play Console policy and testing requirements are complete.

## Learnings and traps

### A project-site manifest ID does not fit a root custom domain

The original site lived below `/block-color-puzzle/`, so its manifest used
`/block-color-puzzle/index.html`. The custom domain serves Sortile at `/`; keep
the manifest identity, start URL, and scope aligned with that root.

### Digital Asset Links must be at the origin root

Google checks `/.well-known/assetlinks.json`. A GitHub project site cannot
publish at the `adamsdenniskariuki.github.io` origin root from a subpath
repository. `sortile.madebyfavor.com` solves that by making this repository the
root of its own origin.

### Keep Cloudflare DNS-only while GitHub owns hosting and TLS

The grey-cloud CNAME exposes the real GitHub Pages target for domain validation
and certificate issuance. Cloudflare proxying adds another cache and TLS layer
without meaningful benefit for this static application.

### Use JDK 17, not the newest JDK by default

JDK 17 is the conservative LTS baseline supported by Android Gradle tooling and
Bubblewrap-generated projects. Newer JDKs provide no feature benefit to this
wrapper and can be rejected by pinned Gradle or Android plugin versions.

### Reopen the terminal after installing Java

The JDK installer updated `PATH`, but already-running shells could not find
`java`, `javac`, or `keytool`. A new terminal picked up the environment.

### Treat package name and signing keys as permanent identity

`com.madebyfavor.sortile` and the app-signing certificate determine update and
origin verification. Choose them once, protect the key, and never publish a
placeholder fingerprint.

### Play signing introduces a second certificate

The locally generated upload key is not necessarily the certificate on Play
Store installs. Add Google's app-signing SHA-256 fingerprint to
`assetlinks.json` before testing the Play-distributed build.
