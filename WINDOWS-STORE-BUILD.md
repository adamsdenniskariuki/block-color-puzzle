# Building the Microsoft Store bundle manually

Sortile is submitted to Microsoft Store as a Microsoft Edge Hosted App generated
from the deployed PWA. The Store package does not contain a separate copy of the
game: it launches the production site in an installed app window.

This guide records the process that produced the accepted
`Sortile_1.0.2.0_Store.msixbundle`.

## Store identity

Use the existing Partner Center product. Do not create a second app identity.

| Field | Value |
| --- | --- |
| Store ID | `9N0LK87KQ0G4` |
| Package identity name | `Favor.Sortile-ColourBlockPuzzle` |
| Publisher | `CN=57DB65E9-045A-4FDC-A2CF-67FFF362102F` |
| Publisher display name | `Favor` |
| Display name | `Sortile - Colour Block Puzzle` |
| Start URL | `https://adamsdenniskariuki.github.io/block-color-puzzle/` |

The display name must use the ASCII hyphen shown above. Partner Center rejected
the earlier package whose display name contained an em dash.

## Prerequisites

1. Install Microsoft Edge.
2. Install the Windows 10 or 11 SDK, including:
   - MakeAppx
   - SignTool
   - Windows App Certification Kit
3. Use a current Chromium-based browser to run PWABuilder.
4. Ensure the production PWA and manifest are publicly reachable.
5. Reserve the app name and identity in Partner Center before generating the
   Store package.

The SDK tools are normally below:

```powershell
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
```

## 1. Prepare and deploy the web app

Work from the standalone repository:

```powershell
Set-Location Q:\inno\game\block-color-puzzle
npm install
npm run test:all
```

Before deploying any changed runtime asset, increment the cache name at the top
of `sw.js`:

```js
const CACHE = 'bcp-vN';
```

Commit and push to `main` using the personal GitHub authentication recipe in
`AGENTS.md`. Wait for GitHub Pages to finish, then verify the live app and its
manifest:

```powershell
Invoke-WebRequest `
  https://adamsdenniskariuki.github.io/block-color-puzzle/ `
  -UseBasicParsing

Invoke-WebRequest `
  https://adamsdenniskariuki.github.io/block-color-puzzle/manifest.webmanifest `
  -UseBasicParsing
```

Open the live URL in a fresh browser session and confirm the latest cache build
is running before packaging it.

## 2. Generate the Edge Hosted App package

1. Open [PWABuilder](https://www.pwabuilder.com/).
2. Enter the production URL:
   `https://adamsdenniskariuki.github.io/block-color-puzzle/`
3. Allow PWABuilder to analyze the manifest and service worker.
4. Select **Package for stores** and then **Windows**.
5. Choose the **Microsoft Edge Hosted App** package.
6. Enter the existing Partner Center identity values from the table above.
7. Set the package version to a four-part version greater than the last
   submission. The accepted first release was `1.0.2.0`; a later package must
   therefore use `1.0.3.0` or higher.
8. Confirm the display name is exactly
   `Sortile - Colour Block Puzzle`.
9. Generate and download the Windows package.

PWABuilder may download a ZIP containing the bundle, manifest, assets, and
testing files. Extract it to a versioned working folder outside the repository,
for example:

```powershell
$version = '1.0.3.0'
$out = "Q:\inno\game\block-color-puzzle\dist\windows-store\$version"
New-Item -ItemType Directory -Force $out
Expand-Archive "$env:USERPROFILE\Downloads\Sortile*.zip" $out
Get-ChildItem $out -Recurse
```

The upload artifact must be the generated `.msixbundle`, not the ZIP that
contains it.

## 3. Inspect the generated manifest

Before uploading, extract or unpack the generated package and confirm:

- `Identity Name` is `Favor.Sortile-ColourBlockPuzzle`.
- `Publisher` exactly matches the Partner Center publisher certificate value.
- `Version` is the new four-part version.
- `DisplayName` uses an ASCII hyphen, not an em dash.
- The hosted app points to the production Sortile URL.
- The package architecture and bundle contents are present.

Use MakeAppx when the package must be unpacked for inspection:

```powershell
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
$makeAppx = Join-Path $sdk.FullName 'x64\makeappx.exe'

& $makeAppx unbundle `
  /p "$out\Sortile_1.0.3.0_Store.msixbundle" `
  /d "$out\unbundled" `
  /o
```

If PWABuilder produced architecture-specific `.msix` packages instead of a
bundle, bundle them with:

```powershell
& $makeAppx bundle `
  /d "$out\packages" `
  /p "$out\Sortile_1.0.3.0_Store.msixbundle" `
  /bv 1.0.3.0 `
  /o
```

Do not manually alter files inside a generated package unless rebuilding and
signing the complete package. Any modification invalidates its signature.

## 4. Validate with WACK

Run the Windows App Certification Kit against the final `.msixbundle`.

1. Open **Windows App Certification Kit** from the Start menu.
2. Select **Validate Store App**.
3. Choose the generated `Sortile_<version>_Store.msixbundle`.
4. Run all applicable tests.
5. Save the report beside the bundle.
6. Resolve every failure before uploading.

The accepted `1.0.2.0` bundle passed WACK.

For a command-line installation of the package before running WACK, use a local
test-signing certificate only. Partner Center signs the final Store-delivered
package; do not upload private signing keys or certificates to this repository.

## 5. Upload to Partner Center

1. Open Sortile in Partner Center.
2. Start a new product update.
3. Open **Packages**.
4. Upload the new `.msixbundle`.
5. Wait for Partner Center to finish validation.
6. Confirm the version and identity are correct.
7. Complete the remaining submission sections.

The Edge Hosted App package declares `runFullTrust`. Use this capability
explanation when Partner Center asks for justification:

> Sortile is packaged as a Microsoft Edge Hosted App. The runFullTrust
> capability is required by the generated hosted-app package so Windows can
> launch Microsoft Edge to run the installed web application. Sortile does not
> use this capability to access files, processes, registry data, or other system
> resources.

Review the complete submission before selecting **Submit for certification**.

## Release checklist

- [ ] Runtime changes are complete.
- [ ] Every new test was mutation-verified.
- [ ] `CACHE` in `sw.js` was incremented for changed shipped assets.
- [ ] `npm run test:all` passes.
- [ ] Changes are deployed to GitHub Pages.
- [ ] The live PWA and manifest return successfully.
- [ ] The live app visibly runs the intended release.
- [ ] PWABuilder uses the existing Partner Center identity.
- [ ] Package version is greater than the previous Store version.
- [ ] Display name contains the ASCII hyphen.
- [ ] Final artifact is a `.msixbundle`.
- [ ] Manifest identity, publisher, version, and URL were inspected.
- [ ] WACK passes.
- [ ] Partner Center validates the uploaded package.
- [ ] `runFullTrust` justification is supplied.
- [ ] Submission is reviewed before certification.

## Common failures

### Partner Center rejects the display name

Use `Sortile - Colour Block Puzzle`. Do not use the typographic em dash from
marketing prose in package identity fields.

### Partner Center says the version already exists

Regenerate the package with a larger four-part version. Store versions cannot
be reused, even for a failed or deleted upload.

### The installed app still shows old code

The package launches the hosted PWA, so this is usually a service-worker cache
problem rather than a package problem. Increment `CACHE` in `sw.js`, deploy,
wait for GitHub Pages, and reload the installed app.

### The package identity does not match

Generate the package again using the exact identity and publisher values from
Partner Center. Do not create a new product to work around the mismatch.

### The bundle changes after validation

Run WACK against the exact `.msixbundle` that will be uploaded. Rebuilds and
manual edits require validation again.
