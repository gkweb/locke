#!/usr/bin/env bash
#
# Build a signed + notarized macOS .dmg of Locke for private distribution.
#
# Prerequisites (one-time):
#   1. A "Developer ID Application" certificate installed in your login keychain
#      (Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application).
#      Confirm it shows up:  security find-identity -v -p codesigning
#   2. An app-specific password for notarization, created at appleid.apple.com
#      (Sign-In & Security > App-Specific Passwords).
#
# Set these in your shell before running (do NOT commit real values):
#   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#   export APPLE_ID="you@example.com"
#   export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific password
#   export APPLE_TEAM_ID="TEAMID"
#
# Then:  ./apps/desktop/scripts/build-signed-mac.sh
#
# Tauri signs, notarizes, and staples automatically when these vars are present.
# The finished .dmg lands in:
#   apps/desktop/src-tauri/target/release/bundle/dmg/
set -euo pipefail

: "${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY (run: security find-identity -v -p codesigning)}"
: "${APPLE_ID:?set APPLE_ID (your Apple ID email)}"
: "${APPLE_PASSWORD:?set APPLE_PASSWORD (app-specific password from appleid.apple.com)}"
: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID (your 10-char Apple Developer Team ID)}"

# Repo root is two levels up from this script.
cd "$(dirname "$0")/../../.."

echo "Building signed + notarized .dmg as: $APPLE_SIGNING_IDENTITY"
pnpm tauri build --bundles dmg

echo
echo "Done. Artifact(s):"
ls -1 apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || true
