#!/bin/bash
#
# Build macOS app — notarized DMG + ZIP for direct distribution.
#
# Usage:
#   ./scripts/build-macos.sh              # Build without notarization (local/dev)
#   ./scripts/build-macos.sh --notarize   # Build + notarize (requires Apple credentials)
#
# For notarization, set these environment variables:
#   export APPLE_ID="your@email.com"
#   export APPLE_ID_PASSWORD="app-specific-password"
#   export APPLE_TEAM_ID="XXXXXXXXXX"
#
# Output: dist/IP Camera Viewer-*.dmg and dist/IP Camera Viewer-*.zip
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==> Installing dependencies..."
npm install

echo "==> Running tests..."
npm test

echo "==> Building macOS app (DMG + ZIP)..."

if [ "$1" = "--notarize" ]; then
  if [ -z "$APPLE_ID" ] || [ -z "$APPLE_ID_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
    echo "ERROR: Notarization requires APPLE_ID, APPLE_ID_PASSWORD, and APPLE_TEAM_ID."
    echo "       Generate an app-specific password at https://appleid.apple.com"
    exit 1
  fi
  echo "    Notarization enabled."
else
  echo "    Skipping notarization (pass --notarize to enable)."
fi

npx electron-builder --mac dmg zip

echo ""
echo "==> Build complete! Output files:"
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || echo "    (check dist/ directory)"
echo ""
echo "To install: open dist/IP Camera Viewer-*.dmg and drag to Applications."
