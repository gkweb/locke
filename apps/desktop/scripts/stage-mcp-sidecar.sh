#!/usr/bin/env bash
#
# Build `locke-mcp` and stage it as a Tauri `externalBin` sidecar.
#
#   stage-mcp-sidecar.sh [debug|release]   (default: debug)
#
# Tauri's `externalBin` expects the binary named with the Rust host target triple
# (e.g. locke-mcp-aarch64-apple-darwin) at `src-tauri/binaries/`. `tauri build`
# then copies it into the app bundle and signs it alongside the main binary, so it
# passes notarization. This runs from `beforeDevCommand`/`beforeBuildCommand` and
# in the signed-mac release script, so the sidecar always exists before the app's
# `generate_context!` resolves it at compile time.
set -euo pipefail

# Repo root is three levels up from this script (apps/desktop/scripts).
cd "$(dirname "$0")/../../.."

PROFILE="${1:-debug}"
TRIPLE="$(rustc -Vv | sed -n 's/host: //p')"
DEST="apps/desktop/src-tauri/binaries"
mkdir -p "$DEST"

if [ "$PROFILE" = "release" ]; then
  cargo build --release -p locke-mcp
  SRC="target/release/locke-mcp"
else
  cargo build -p locke-mcp
  SRC="target/debug/locke-mcp"
fi

cp "$SRC" "$DEST/locke-mcp-$TRIPLE"
chmod +x "$DEST/locke-mcp-$TRIPLE"
echo "staged $DEST/locke-mcp-$TRIPLE ($PROFILE)"
