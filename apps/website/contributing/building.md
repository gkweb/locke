# Building & releasing

## Local builds

```bash
pnpm install
pnpm tauri dev                            # launch the app (frameless window)
pnpm --filter @locke/desktop build        # typecheck + build the frontend
pnpm -r typecheck                         # typecheck all packages
cd apps/desktop/src-tauri && cargo test   # git + checks unit tests against real temp repos
```

See [Installation](/guide/installation) for prerequisites (Node 22, pnpm 10, a Rust toolchain, and the Tauri v2 platform deps).

## Version bumps

The version lives in **three** files and they must stay in sync. Update all three before building a release:

- `apps/desktop/src-tauri/tauri.conf.json` → `version`
- `apps/desktop/package.json` → `version`
- `apps/desktop/src-tauri/Cargo.toml` → `version`

The current version is **2.2.3**.

## macOS release builds

Signed + notarized macOS builds are produced by the runbook in `apps/desktop/RELEASING.md`. The short version:

```bash
./apps/desktop/scripts/build-signed-mac.sh        # .dmg
./apps/desktop/scripts/build-signed-mac.sh zip     # .zip (no Finder permission needed — most reliable)
```

Key points from the runbook:

- You need a **Developer ID Application** certificate (an *Apple Development* cert is **not** enough — Gatekeeper will block it on other Macs).
- Notarization credentials are stored once in a `locke` keychain profile; the build script prompts for your Apple ID + app-specific password the first time and then runs silently. Nothing lives in your shell env or history.
- The signing identity comes from `tauri.conf.json` (`bundle.macOS.signingIdentity`), so the build needs no environment variables.
- The script signs (hardened runtime + timestamp), submits to Apple, staples, and **verifies** notarization — failing loudly if the artifact isn't actually notarized, so an un-notarized build can't slip out.

Output artifacts:

- `…/target/release/bundle/dmg/Locke_<version>_aarch64.dmg`
- `…/target/release/bundle/macos/Locke_<version>_aarch64.zip`

For Intel Macs, add the target (`rustup target add x86_64-apple-darwin`) and build with `--target x86_64-apple-darwin` (or `universal-apple-darwin` for a fat binary).

::: tip DMG vs zip
The `.dmg` builder runs an AppleScript that needs permission to control Finder. If your terminal can't get that permission (notably Warp), use the **`zip`** target — it's equally Gatekeeper-friendly and touches no Finder automation.
:::

Refer to `apps/desktop/RELEASING.md` for the full, authoritative procedure including troubleshooting.
