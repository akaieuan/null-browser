#!/bin/bash
# One-time setup: create a self-signed code-signing cert and import it into
# the macOS login keychain. This lets dev builds of null be signed with a
# stable identity, so Keychain ACLs for stored provider keys survive
# rebuilds instead of re-prompting on every `cargo build`.
#
# Idempotent. Safe to re-run.

set -euo pipefail

CERT_NAME="null-dev"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "this script is macOS-only — other platforms don't need it"
    exit 0
fi

if security find-certificate -c "$CERT_NAME" >/dev/null 2>&1; then
    echo "cert '$CERT_NAME' already in login keychain, nothing to do"
    exit 0
fi

command -v openssl >/dev/null || { echo "openssl not found"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/req.conf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ext

[dn]
CN = ${CERT_NAME}

[v3_ext]
basicConstraints = CA:false
keyUsage = digitalSignature
extendedKeyUsage = codeSigning
EOF

openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$TMP/key.pem" \
    -out "$TMP/cert.pem" \
    -config "$TMP/req.conf" \
    -days 3650 >/dev/null 2>&1

openssl pkcs12 -export -legacy \
    -inkey "$TMP/key.pem" \
    -in "$TMP/cert.pem" \
    -out "$TMP/bundle.p12" \
    -name "$CERT_NAME" \
    -passout pass: >/dev/null 2>&1

KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
security import "$TMP/bundle.p12" \
    -k "$KEYCHAIN" \
    -T /usr/bin/codesign \
    -P "" \
    >/dev/null

echo "created '$CERT_NAME' and imported into login keychain"
echo "first dev run will prompt once for keychain access — choose 'Always Allow'"
echo "after that, rebuilds won't re-prompt"
