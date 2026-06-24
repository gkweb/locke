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

Export the credentials (don't commit them), then run the script:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific password
export APPLE_TEAM_ID="TEAMID"

./apps/desktop/scripts/build-signed-mac.sh
```

Tauri signs (hardened runtime + timestamp), uploads to Apple for notarization,
waits, and staples the ticket. First release build compiles Rust in release mode,
so it takes a few minutes.

Output: `apps/desktop/src-tauri/target/release/bundle/dmg/Locke_<version>_aarch64.dmg`

## Share

Send the `.dmg` directly (AirDrop, Drive, etc.). Recipients open it, drag Locke
to Applications, and launch — no Gatekeeper prompts, because it's notarized.

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
