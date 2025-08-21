# Builds web, packages desktop (Nativefier), and generates Android TWA locally on Windows
# Requirements: Node 20+, Git, Java 17 (Temurin), Android SDK (optional for signing), npx/Nativefier

param(
  [string]$AppUrl
)

$ErrorActionPreference = "Stop"

# Derive a sensible default APP_URL if not provided
if (-not $AppUrl -or $AppUrl.Trim() -eq "https://.github.io//") {
  $owner = $env:GITHUB_REPOSITORY_OWNER
  $repo = ($env:GITHUB_REPOSITORY -split '/')[-1]
  if (-not $owner -or -not $repo) {
    try {
      $remote = git config --get remote.origin.url 2>$null
      if ($remote) {
        if ($remote -match '[:/]([^/]+)/([^/]+?)(\.git)?$') { $owner = $Matches[1]; $repo = $Matches[2] }
      }
    } catch {}
  }
  if (-not $owner) { $owner = 'tayden1990' }
  if (-not $repo) { $repo = Split-Path -Leaf (Get-Location) }
  $AppUrl = "https://$owner.github.io/$repo/"
}

Write-Host "Using APP_URL=$AppUrl"

# 1) Web build
if (Test-Path package.json) {
  Write-Host "Installing deps..."
  npm ci
  Write-Host "Building..."
  $env:REPO_NAME = (Split-Path -Leaf (Get-Location))
  npm run build
} else {
  Write-Warning "No package.json found; skipping web build"
}

# 2) Desktop (Nativefier)
Write-Host "Installing nativefier..."
npm i -g nativefier | Out-Null

$distDesktop = Join-Path (Get-Location) "dist-desktop"
New-Item -ItemType Directory -Force -Path $distDesktop | Out-Null

Write-Host "Building desktop app..."
& nativefier "$AppUrl" --name "GlobGram" --internal-urls ".*" --disable-dev-tools --single-instance --out "dist-desktop"

# If Nativefier ignored --out, move built folder(s)
Get-ChildItem -Directory | Where-Object { $_.Name -like 'GlobGram-*x64' -or $_.Name -like 'GlobGram-*arm64' } | ForEach-Object {
  $target = Join-Path $distDesktop $_.Name
  if (-not (Test-Path $target)) { Move-Item $_.FullName $target }
}

Write-Host "Desktop outputs:"
Get-ChildItem "$distDesktop" -Force -ErrorAction SilentlyContinue

# 3) Android TWA using Bubblewrap (no signing)
Write-Host "Ensuring bubblewrap..."
npm i -g @bubblewrap/cli | Out-Null


$twadir = Join-Path (Get-Location) "twa"
New-Item -ItemType Directory -Force -Path $twadir | Out-Null
Set-Location $twadir

# Preseed config if JAVA_HOME/ANDROID_SDK_ROOT present (write JSON without BOM)
$bubbleCfgDir = Join-Path $env:USERPROFILE ".bubblewrap"
New-Item -ItemType Directory -Force -Path $bubbleCfgDir | Out-Null
$cfgPath = Join-Path $bubbleCfgDir "config.json"
$cfg = @{ jdkPath = $env:JAVA_HOME; androidSdkPath = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { $env:ANDROID_HOME } } | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($cfgPath, $cfg, $utf8NoBom)

# Use local manifest to avoid network issues
$manifestPath = (Resolve-Path (Join-Path (Split-Path (Get-Location) -Parent) 'public\manifest.webmanifest')).Path
Write-Host "Initializing bubblewrap from local manifest: $manifestPath"
$nl = [System.Environment]::NewLine
($nl * 30) | bubblewrap init --manifest="$manifestPath" --directory . --skipPwaValidation

if (Test-Path "twa-manifest.json") {
  # Force start_url to APP_URL if needed
  (Get-Content "twa-manifest.json") -replace '"start_url"\s*:\s*"\.",?', '"start_url": ' + '"' + $AppUrl + '"' | Set-Content "twa-manifest.json" -Encoding UTF8
} else {
  Write-Warning "twa-manifest.json not created by bubblewrap init; check previous output."
}

if ($env:ANDROID_SDK_ROOT -or $env:ANDROID_HOME) {
  Write-Host "Building APK (unsigned)..."
  bubblewrap build
} else {
  Write-Warning "ANDROID_SDK_ROOT/ANDROID_HOME not set. Skipping APK build. TWA project generated in $twadir."
}

Write-Host "Done. Outputs:"
Pop-Location | Out-Null
Get-ChildItem . -Recurse -Force | Where-Object { $_.FullName -match 'dist-desktop|twa\\build' } | Select-Object FullName, Length | Format-Table -AutoSize
