# Releasing a macOS beta

How to cut a signed + notarized `.dmg` of Locke and share it privately. macOS only.

## Why signing matters

A `.dmg` that isn't signed with a **Developer ID Application** certificate and
notarized by Apple will be blocked by Gatekeeper on other people's Macs
("Apple could not verify… is free of malware"). An *Apple Development* cert is
**not** enough — that one is only for running on your own registered devices.

## One-time setup

1. **Developer ID Application certificate**
   - Xcode → Settings → Accounts → select your team → *Manage Certificates…*
   - Click **+** → **Developer ID Application**. The private key stays in your
     login keychain automatically.
   - Verify:
     ```sh
     security find-identity -v -p codesigning
     ```
     You should see a line like
     `Developer ID Application: Your Name (TEAMID)`.

2. **App-specific password** (for notarization)
   - appleid.apple.com → Sign-In & Security → **App-Specific Passwords** → create one.

3. **Team ID** — the 10-character ID on your Apple Developer membership page.

## Build

The signing identity is set in `tauri.conf.json` (`bundle.macOS.signingIdentity`),
so you only need to export the notarization credentials (don't commit them):

```sh
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific password
export APPLE_TEAM_ID="TEAMID"
```

Then pick a target:

```sh
./apps/desktop/scripts/build-signed-mac.sh        # .dmg  (prettier, needs Finder permission — see below)
./apps/desktop/scripts/build-signed-mac.sh zip    # .zip  (no Finder permission needed — most reliable)
```

Tauri signs (hardened runtime + timestamp), uploads to Apple for notarization,
waits, and staples the ticket. First release build compiles Rust in release mode,
so it takes a few minutes.

Output:
- dmg → `…/target/release/bundle/dmg/Locke_<version>_aarch64.dmg`
- zip → `…/target/release/bundle/macos/Locke_<version>_aarch64.zip`

### The DMG target and Finder permission

The `.dmg` builder runs an AppleScript that asks **Finder** to lay out the disk-image
window. If the terminal running the build hasn't been granted permission to control
Finder, it fails with:

```
execution error: Not authorised to send Apple events to Finder. (-1743)
```

Fix: **System Settings → Privacy & Security → Automation →** find your terminal app
(e.g. **Warp**, Terminal, iTerm) and tick **Finder**. If your terminal isn't listed
or it still fails, reset and re-trigger the prompt:

```sh
tccutil reset AppleEvents
osascript -e 'tell application "Finder" to count windows'   # approve the prompt
```

Some terminals (notably **Warp**) won't surface the prompt reliably — in that case
use the **`zip` target**, which produces an equally Gatekeeper-friendly artifact
without touching Finder.

## Share

Send the `.dmg` or `.zip` directly (AirDrop, Drive, etc.). Recipients open/unzip it,
drag Locke to Applications, and launch — no Gatekeeper prompts, because it's notarized.

## Bumping the version

Update all three before building so they stay in sync:
- `apps/desktop/src-tauri/tauri.conf.json` → `version`
- `apps/desktop/package.json` → `version`
- `apps/desktop/src-tauri/Cargo.toml` → `version`

## Notes

- The build above produces an **Apple Silicon** (`aarch64`) `.dmg` on an
  Apple Silicon Mac. For Intel Macs, add the target:
  `rustup target add x86_64-apple-darwin` then build with
  `pnpm tauri build --bundles dmg --target x86_64-apple-darwin`
  (or `universal-apple-darwin` for a single fat binary).
- Verify a finished build with:
  `spctl -a -vvv -t install "<path to .app>"` → should say *accepted, source=Notarized Developer ID*.
