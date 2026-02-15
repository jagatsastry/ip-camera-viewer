#!/bin/bash
#
# Build Mac App Store (MAS) package.
#
# Prerequisites:
#   1. Apple Developer account ($99/year) — https://developer.apple.com
#   2. Provisioning profile: Download from App Store Connect → Certificates,
#      Identifiers & Profiles. Save as "embedded.provisionprofile" in project root.
#   3. Signing identity: Install your "3rd Party Mac Developer" certificate
#      in Keychain Access (downloaded from Apple Developer portal).
#
# Usage:
#   ./scripts/build-mas.sh
#
# Output: dist/IP Camera Viewer-*.pkg (upload via Transporter or xcrun altool)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check for provisioning profile
if [ ! -f "embedded.provisionprofile" ]; then
  echo "ERROR: embedded.provisionprofile not found in project root."
  echo ""
  echo "To get one:"
  echo "  1. Go to https://developer.apple.com → Certificates, Identifiers & Profiles"
  echo "  2. Create an App ID: com.jagatsastry.ip-camera-viewer"
  echo "  3. Create a Mac App Store provisioning profile for that App ID"
  echo "  4. Download and save as: embedded.provisionprofile"
  exit 1
fi

echo "==> Installing dependencies..."
npm install

echo "==> Running tests..."
npm test

echo "==> Building Mac App Store package..."
npx electron-builder --mac mas

echo ""
echo "==> MAS build complete! Output files:"
ls -lh dist/*.pkg 2>/dev/null || echo "    (check dist/ directory)"
echo ""
echo "Upload to App Store Connect using Transporter or:"
echo "  xcrun altool --upload-app -f dist/*.pkg --type macos"
