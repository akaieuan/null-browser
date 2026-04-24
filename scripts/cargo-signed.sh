#!/bin/bash
# Transparent cargo wrapper used by `tauri dev` on macOS. Intercepts
# `cargo run`, builds, codesigns the binary with the stable `null-dev`
# self-signed cert, then launches. The stable designated requirement
# means macOS Keychain ACLs survive rebuilds — no re-prompting on every
# Rust change. Pass-through on Linux/Windows and for any non-`run`
# subcommand.

set -euo pipefail

CERT="null-dev"
BUNDLE_ID="sh.null.browser"

if [[ "${1:-}" != "run" ]] || [[ "$(uname -s)" != "Darwin" ]]; then
    exec cargo "$@"
fi

if ! security find-certificate -c "$CERT" >/dev/null 2>&1; then
    echo "note: run ./scripts/setup-dev-signing.sh once to stop keychain re-prompts on rebuild" >&2
    exec cargo "$@"
fi

shift

cargo_args=()
bin_args=()
past_sep=false
for arg in "$@"; do
    if $past_sep; then
        bin_args+=("$arg")
    elif [[ "$arg" == "--" ]]; then
        past_sep=true
    else
        cargo_args+=("$arg")
    fi
done

cargo build "${cargo_args[@]}"

BIN="target/debug/null"
codesign -s "$CERT" --force --identifier "$BUNDLE_ID" \
    -r="identifier \"$BUNDLE_ID\" and certificate leaf[subject.CN] = \"$CERT\"" \
    "$BIN" >/dev/null

exec "$BIN" "${bin_args[@]}"
