#!/usr/bin/env bash
#
# Build a signed + notarized macOS app of Locke for private distribution.
#
#   ./apps/desktop/scripts/build-signed-mac.sh        # -> .dmg  (needs Finder Automation permission)
#   ./apps/desktop/scripts/build-signed-mac.sh zip    # -> .zip  (no Finder permission needed)
#
# Signing identity:   tauri.conf.json (bundle.macOS.signingIdentity) — `tauri build`
#                     signs with a hardened runtime + secure timestamp.
# Notarization:       this script submits the artifact to Apple, staples the ticket,
#                     then verifies the result. Credentials come from a `notarytool`
#                     keychain profile, so no secrets live in your shell/env/history.
#
# One-time setup:
#   1. A "Developer ID Application" certificate in your login keychain
#      (Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application).
#   2. An app-specific password from appleid.apple.com (Sign-In & Security).
#   3. Store a notarization profile named "locke" (prompts for the app-specific password):
#        xcrun notarytool store-credentials locke \
#          --apple-id "you@example.com" --team-id GJSS9SJU8D
#   4. For the .dmg target only: grant your terminal permission to control Finder
#      (System Settings > Privacy & Security > Automation). The .zip target does not.
#
# The first run prompts for your app-specific password (hidden) and stores it in
# a keychain profile; later runs are silent. Override defaults with env vars:
#   NOTARY_PROFILE=<name>  APPLE_ID=you@example.com  APPLE_TEAM_ID=GJSS9SJU8D
set -euo pipefail

NOTARY_PROFILE="${NOTARY_PROFILE:-locke}"
APPLE_ID="${APPLE_ID:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-GJSS9SJU8D}"
MODE="${1:-dmg}"

# Repo root is three levels up from this script (apps/desktop/scripts).
cd "$(dirname "$0")/../../.."

# Cargo workspace target dir lives at the repo root (`target/`), so bundles land
# under target/release/bundle. `pnpm tauri build` stages the locke-mcp sidecar via
# its `beforeBuildCommand` before bundling.
BUNDLE_DIR="target/release/bundle"
VER="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' apps/desktop/package.json | head -1)"

# --- helpers ---------------------------------------------------------------

# ensure_profile — make sure a notarytool keychain profile exists. If not, create
# it interactively (prompts for the app-specific password, hidden) so first-time
# setup needs no separate command. Later runs find the profile and skip this.
ensure_profile() {
  if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    return
  fi

  echo "No notarization profile \"$NOTARY_PROFILE\" yet — setting it up (one time)."
  if [ -z "$APPLE_ID" ]; then
    read -r -p "Apple ID email: " APPLE_ID
  fi
  echo "Get an app-specific password from appleid.apple.com → Sign-In & Security."
  # store-credentials prompts for the password itself (input hidden) and validates
  # it against Apple before saving to the keychain.
  xcrun notarytool store-credentials "$NOTARY_PROFILE" \
    --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID"
}

# notarize <artifact> — submit to Apple and block until the verdict is in.
notarize() {
  echo "Submitting $1 to Apple for notarization (this can take a few minutes)…"
  xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" --wait
}

# assert_notarized <artifact> <spctl-type> — fail loudly unless the artifact is
# stapled AND Gatekeeper reports a Notarized Developer ID.
assert_notarized() {
  local artifact="$1" type="$2"
  echo "Verifying $artifact …"
  xcrun stapler validate "$artifact"

  local assess
  if [ "$type" = "open" ]; then
    assess="$(spctl -a -t open --context context:primary-signature -vvv "$artifact" 2>&1)"
  else
    assess="$(spctl -a -t "$type" -vvv "$artifact" 2>&1)"
  fi
  echo "$assess"
  if ! grep -q "source=Notarized Developer ID" <<<"$assess"; then
    echo "error: $artifact is NOT notarized (Gatekeeper would block it)." >&2
    exit 1
  fi
  echo "OK: notarized + stapled."
}

# --- build -----------------------------------------------------------------

ensure_profile

case "$MODE" in
  dmg)
    echo "Building signed .dmg (identity from tauri.conf.json)…"
    pnpm tauri build --bundles dmg

    DMG="$BUNDLE_DIR/dmg/Locke_${VER}_aarch64.dmg"
    [ -f "$DMG" ] || { echo "error: expected artifact not found: $DMG" >&2; exit 1; }

    notarize "$DMG"
    xcrun stapler staple "$DMG"
    assert_notarized "$DMG" open

    echo; echo "Done. Artifact:"; echo "  $DMG"
    ;;

  zip)
    echo "Building signed .app, then notarizing + zipping (no Finder needed)…"
    pnpm tauri build --bundles app

    APP="$BUNDLE_DIR/macos/Locke.app"
    [ -d "$APP" ] || { echo "error: expected artifact not found: $APP" >&2; exit 1; }

    # Notarize the .app via a throwaway zip (you can't staple a zip, only the .app).
    TMP="$(mktemp -d)"
    /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$TMP/Locke.zip"
    notarize "$TMP/Locke.zip"
    xcrun stapler staple "$APP"
    rm -rf "$TMP"

    assert_notarized "$APP" exec

    # Final distributable zip, made from the now-stapled .app.
    OUT="$BUNDLE_DIR/macos/Locke_${VER}_aarch64.zip"
    rm -f "$OUT"
    /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT"

    echo; echo "Done. Artifact:"; echo "  $OUT"
    ;;

  *)
    echo "usage: $0 [dmg|zip]" >&2
    exit 2
    ;;
esac
