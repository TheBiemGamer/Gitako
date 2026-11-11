#!/usr/bin/env bash
# Package dist/ (without source maps) as a zip and a signed CRX3.
#
# usage: scripts/pack-crx.sh <key.pem> [out-dir]
#
# The key decides the extension ID, so keep using the same one. If the file
# does not exist yet, a new RSA key is generated there (mode 600). Never commit
# it. Chrome/Chromium is taken from $CHROME, else the newest Playwright build.
set -euo pipefail

key=${1:?usage: scripts/pack-crx.sh <key.pem> [out-dir]}
out=${2:-/tmp}
name=gitako-forgejo
repo=$(cd "$(dirname "$0")/.." && pwd)

if [ -z "${CHROME:-}" ]; then
  CHROME=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)
fi
[ -x "${CHROME:-}" ] || { echo "Chromium not found; set CHROME" >&2; exit 1; }
[ -f "$repo/dist/manifest.json" ] || { echo "dist/ is missing; run yarn build" >&2; exit 1; }

if [ ! -f "$key" ]; then
  mkdir -p "$(dirname "$key")"
  (umask 077 && openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$key" 2>/dev/null)
  echo "Generated new key: $key"
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

# copy dist/ without *.map and zip it
python3 - "$repo/dist" "$stage/$name" "$out/$name.zip" <<'PY'
import os, shutil, sys, zipfile
src, dst, zip_path = sys.argv[1:]
shutil.copytree(src, dst, ignore=shutil.ignore_patterns('*.map'))
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(dst):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, dst))
PY

"$CHROME" --headless=new --no-sandbox --disable-gpu \
  --user-data-dir="$stage/profile" \
  --pack-extension="$stage/$name" --pack-extension-key="$key" >/dev/null 2>&1 || true
[ -f "$stage/$name.crx" ] || { echo "packing failed" >&2; exit 1; }
mv "$stage/$name.crx" "$out/$name.crx"

# extension ID: first 128 bits of sha256(public key DER), hex digits mapped to a-p
id=$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | sha256sum | cut -c1-32 | tr 0-9a-f a-p)
echo "zip: $out/$name.zip"
echo "crx: $out/$name.crx ($(stat -c %s "$out/$name.crx") bytes)"
echo "extension ID: $id"
