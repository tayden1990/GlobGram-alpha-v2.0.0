#!/usr/bin/env bash
# Build web, package desktop, and generate Android TWA locally (WSL/Linux)
set -euo pipefail
APP_URL=${1:-"https://${GITHUB_REPOSITORY_OWNER}.github.io/${GITHUB_REPOSITORY#*/}/"}

echo "Using APP_URL=$APP_URL"

if [ -f package.json ]; then
  npm ci
  REPO_NAME=$(basename "$PWD") npm run build
fi

npm i -g nativefier >/dev/null 2>&1 || true
mkdir -p dist-desktop
nativefier "$APP_URL" --name "GlobGram" --internal-urls ".*" --disable-dev-tools --single-instance --out dist-desktop
ls -la dist-desktop

npm i -g @bubblewrap/cli >/dev/null 2>&1 || true
mkdir -p twa && cd twa
printf '{"jdkPath":"%s","androidSdkPath":"%s"}\n' "${JAVA_HOME:-}" "${ANDROID_SDK_ROOT:-$ANDROID_HOME}" > "$HOME/.bubblewrap/config.json"
MANIFEST_URL="https://raw.githubusercontent.com/${GITHUB_REPOSITORY:-tayden1990/GlobGram-alpha-v2.0.0}/main/public/manifest.webmanifest"
# Feed many newlines to accept defaults
yes "" | bubblewrap init --manifest="$MANIFEST_URL" --directory . --skipPwaValidation
# Force start_url
sed -i "s#\"start_url\": \".\"#\"start_url\": \"$APP_URL\"#" twa-manifest.json || true
bubblewrap build

find ../ -maxdepth 2 -type f -path "*dist-desktop*/*" -o -path "*twa/build/*" -print
