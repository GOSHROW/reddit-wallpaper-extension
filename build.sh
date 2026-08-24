#!/usr/bin/env bash
#
# Packages the extension for both stores.
#
#   ./build.sh
#
# Produces dist/reddit-wallpaper-chrome-<version>.zip  (manifest_version 3)
#          dist/reddit-wallpaper-firefox-<version>.zip (manifest_version 2)
#
# Why this exists:
#   - The Firefox build needs manifest_firefox.json renamed to manifest.json.
#     Doing that by hand means editing the repo before every Firefox release and
#     remembering to undo it.
#   - resources/screenshot*.png are ~13MB combined. They are README assets, not
#     runtime assets, so they must not ship to users.
#   - The two manifests must carry the same version. This checks rather than trusts.

set -euo pipefail

cd "$(dirname "$0")"

DIST="dist"

read_version() {
  # Avoids a jq dependency.
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1
}

VERSION="$(read_version manifest.json)"
VERSION_FF="$(read_version manifest_firefox.json)"

if [[ -z "$VERSION" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

if [[ "$VERSION" != "$VERSION_FF" ]]; then
  echo "error: version mismatch -- manifest.json is $VERSION, manifest_firefox.json is $VERSION_FF" >&2
  exit 1
fi

# Runtime files only. Screenshots and docs are deliberately absent.
PAYLOAD=(
  newtab.html
  newtab.js
  resources/styles.css
  resources/icon16.png
  resources/icon48.png
  resources/icon128.png
  LICENSE
)

for file in "${PAYLOAD[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "error: missing payload file: $file" >&2
    exit 1
  fi
done

rm -rf "$DIST"
mkdir -p "$DIST"

package() {
  local target="$1" manifest_src="$2"
  local stage="$DIST/stage-$target"
  local zip_path="$DIST/reddit-wallpaper-$target-$VERSION.zip"

  mkdir -p "$stage/resources"
  for file in "${PAYLOAD[@]}"; do
    mkdir -p "$stage/$(dirname "$file")"
    cp "$file" "$stage/$file"
  done
  cp "$manifest_src" "$stage/manifest.json"

  (cd "$stage" && zip -qr "../$(basename "$zip_path")" .)
  rm -rf "$stage"

  local size
  size="$(du -h "$zip_path" | cut -f1 | tr -d ' ')"
  echo "  $zip_path ($size)"
}

echo "Packaging v$VERSION"
package chrome manifest.json
package firefox manifest_firefox.json
echo "Done."
