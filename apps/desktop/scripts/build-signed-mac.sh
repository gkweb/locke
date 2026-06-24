#!/usr/bin/env bash
#
# Build a signed + notarized macOS app of Locke for private distribution.
#
#   ./apps/desktop/scripts/build-signed-mac.sh        # -> .dmg  (needs Finder Automation permission)
#   ./apps/desktop/scripts/build-signed-mac.sh zip    # -> .zip  (no Finder permission needed)
#
# The signing identity lives in tauri.conf.json (bundle.macOS.signingIdentity),
# so only the notarization credentials need to be set in your shell before
# running (do NOT commit real values):
#   export APPLE_ID="you@example.com"
#   export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific password
#   export APPLE_TEAM_ID="TEAMID"
#
# Tauri signs, notarizes, and staples automatically when these vars are present.
#
# Prerequisites (one-time):
#   - A "Developer ID Application" certificate installed in your login keychain
#     (Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application).
#   - An app-specific password from appleid.apple.com (Sign-In & Security).
#   - For the .dmg target only: grant your terminal app permission to control
#     Finder (System Settings > Privacy & Security > Automation). The .zip target
#     does not need this.
set -euo pipefail

: "${APPLE_ID:?set APPLE_ID (your Apple ID email)}"
: "${APPLE_PASSWORD:?set APPLE_PASSWORD (app-specific password from appleid.apple.com)}"
: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID (your 10-char Apple Developer Team ID)}"

MODE="${1:-dmg}"

# Repo root is three levels up from this script (apps/desktop/scripts).
cd "$(dirname "$0")/../../.."

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle"

case "$MODE" in
  dmg)
    echo "Building signed + notarized .dmg (identity from tauri.conf.json)"
    pnpm tauri build --bundles dmg
    echo; echo "Done. Artifact(s):"
    ls -1 "$BUNDLE_DIR"/dmg/*.dmg 2>/dev/null || true
    ;;
  zip)
    echo "Building signed + notarized .app, then zipping (no Finder needed)"
    pnpm tauri build --bundles app
    APP="$BUNDLE_DIR/macos/Locke.app"
    VER="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' apps/desktop/package.json | head -1)"
    OUT="$BUNDLE_DIR/macos/Locke_${VER}_aarch64.zip"
    rm -f "$OUT"
    # ditto preserves the notarization ticket stapled to the .app.
    /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT"
    echo; echo "Done. Artifact:"
    echo "  $OUT"
    ;;
  *)
    echo "usage: $0 [dmg|zip]" >&2
    exit 2
    ;;
esac
