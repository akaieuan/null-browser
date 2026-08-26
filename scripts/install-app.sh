#!/bin/sh
# Build the release bundle, install it to /Applications, and delete the
# build-output copy. Spotlight indexes .app bundles anywhere on disk, so
# leaving one in target/ makes Launchpad and the Apps view show two Nulls.
# /Applications is the only copy that should exist after this runs.
set -e
cd "$(dirname "$0")/.."

command -v cargo >/dev/null 2>&1 || . "$HOME/.cargo/env"

npm run tauri build

BUNDLE="src-tauri/target/release/bundle/macos/Null.app"
rm -rf /Applications/Null.app
ditto "$BUNDLE" /Applications/Null.app
rm -rf "$BUNDLE"
open /Applications/Null.app
