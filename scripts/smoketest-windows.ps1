# Builds web, packages desktop (Nativefier), and generates Android TWA locally on Windows
# Requirements: Node 20+, Git, Java 17 (Temurin), Android SDK (optional for signing), npx/Nativefier

param(
  [string]$AppUrl,
  [string]$JavaHome,
  [string]$AndroidSdk
)

$ErrorActionPreference = "Stop"

# --- helpers ---------------------------------------------------------------
function Resolve-JavaHome {
  param([string]$Hint)
  if ($Hint -and (Test-Path $Hint)) { return $Hint }
  if ($env:JAVA_HOME -and (Test-Path $env:JAVA_HOME)) { return $env:JAVA_HOME }
  $candidates = @(
    "$Env:ProgramFiles\\Eclipse Adoptium",
    "$Env:ProgramFiles\\Microsoft\\jdk",
    "$Env:ProgramFiles\\Zulu",
    "$Env:ProgramFiles\\Java",
    "$Env:ProgramFiles(x86)\\Java"
  ) | Where-Object { Test-Path $_ }
  foreach ($base in $candidates) {
    Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'jdk-?17' -or $_.Name -match '17' } |
      Sort-Object Name -Descending |
      ForEach-Object {
        $j = $_.FullName
        if (Test-Path (Join-Path $j 'bin\java.exe')) { return $j }
      }
  }
  return $null
}

function Resolve-AndroidSdkRoot {
  param([string]$Hint)
  if ($Hint -and (Test-Path $Hint)) { return $Hint }
  if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) { return $env:ANDROID_SDK_ROOT }
  if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) { return $env:ANDROID_HOME }
  $cands = @(
    "$Env:LOCALAPPDATA\\Android\\Sdk",
    "$Env:ProgramFiles\\Android\\Sdk",
    "C:\\Android\\Sdk",
    "C:\\Android"
  )
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  return $null
}

function Find-SdkManager {
  param([string]$SdkRoot)
  $latest = (Join-Path $SdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat')
  if (Test-Path $latest) { return $latest }
  $latest2 = (Join-Path $SdkRoot 'cmdline-tools\latest-2\bin\sdkmanager.bat')
  if (Test-Path $latest2) {
    Write-Warning "Found sdkmanager under 'cmdline-tools\\latest-2'. Please rename that folder to 'latest' (expected path). Proceeding for now."
    return $latest2
  }
  return $null
}

function Test-LegacySdkManager {
  param([string]$SdkManagerPath)
  if (-not $SdkManagerPath) { return $true }
  # The legacy sdkmanager lives under tools\bin and often can't read modern repository XML (v4)
  if ($SdkManagerPath -match [regex]::Escape('tools\bin\sdkmanager.bat')) { return $true }
  return $false
}

function Install-AndroidPackages {
  param([string]$SdkRoot)
  $sdkm = Find-SdkManager -SdkRoot $SdkRoot
  if (-not $sdkm) {
    Write-Warning "sdkmanager not found under '$SdkRoot'. Install 'Android SDK Command-line Tools' via Android Studio, then re-run."
    return $false
  }
  if (Test-LegacySdkManager -SdkManagerPath $sdkm) {
    Write-Warning "Found legacy sdkmanager at '$sdkm'. Please install modern 'Android SDK Command-line Tools (latest)' so sdkmanager can fetch packages."
    return $false
  }
  # Clean up any stray platform-tools backups that confuse sdkmanager with "inconsistent location" warnings
  try {
    # Prefer moving OUTSIDE the SDK root so sdkmanager doesn't see them at all
    $sdkParent = Split-Path -Path $SdkRoot -Parent
    $externalBackup = Join-Path $sdkParent ((Split-Path -Leaf $SdkRoot) + '-backups')
    if (-not (Test-Path $externalBackup)) { New-Item -ItemType Directory -Path $externalBackup -ErrorAction SilentlyContinue | Out-Null }

    Get-ChildItem -Path $SdkRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'platform-tools.bak-*' -or $_.Name -like 'platform-tools.removed-*' -or ($_.Name -like 'platform-tools*' -and $_.Name -ne 'platform-tools') } |
      ForEach-Object {
        $dest = Join-Path $externalBackup $_.Name
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue }
        Move-Item -Path $_.FullName -Destination $externalBackup -Force -ErrorAction SilentlyContinue
      }
  } catch { Write-Verbose ("Cleanup of platform-tools backups failed: " + $_) }
  Write-Host "Installing required Android SDK packages via sdkmanager..."
  # Try latest stable first, then fallback
  $pkgs = @(
    'platform-tools',
    'platforms;android-36',
    'build-tools;36.0.0',
    'platforms;android-35',
    'build-tools;35.0.0',
    'platforms;android-34',
    'build-tools;34.0.0'
  )
  foreach ($p in $pkgs) {
    try {
      "y`r`n" | & $sdkm $p
    } catch {
      Write-Warning ("sdkmanager failed for package '$p': " + $_)
    }
  }
  try { "y`r`n" | & $sdkm --licenses } catch {}
  return $true
}

function Get-BubblewrapCommand {
  # Returns an object with Path and UseNpx
  $cmd = $null
  $useNpx = $false
  try {
    $gc = Get-Command bubblewrap -ErrorAction SilentlyContinue
    if ($gc) { $cmd = $gc.Path }
  } catch {}
  if (-not $cmd) {
    try {
      $npmBin = (npm bin -g 2>$null)
      if ($npmBin) {
        $cand = Join-Path $npmBin.Trim() 'bubblewrap.cmd'
        if (Test-Path $cand) { $cmd = $cand }
      }
    } catch {}
  }
  # If we found a PowerShell wrapper, try prefer the .cmd next to it or in npm bin so STDIN piping works
  if ($cmd -and $cmd.ToLower().EndsWith('.ps1')) {
    try {
      $psDir = Split-Path -Parent $cmd
      $peerCmd = Join-Path $psDir 'bubblewrap.cmd'
      if (Test-Path $peerCmd) { $cmd = $peerCmd }
    } catch {}
    if ($cmd -and $cmd.ToLower().EndsWith('.ps1')) {
      # Last resort, use npx
      try {
        $gc = Get-Command npx -ErrorAction SilentlyContinue
        if ($gc) { $useNpx = $true }
      } catch {}
    }
  }
  if (-not $cmd) {
    try {
      $gc = Get-Command npx -ErrorAction SilentlyContinue
      if ($gc) { $cmd = $gc.Path; $useNpx = $true }
    } catch {}
  }
  return [PSCustomObject]@{ Path = $cmd; UseNpx = $useNpx }
}

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

# Resolve toolchains (prefer params, then env, then autodetect)
$resolvedJava = Resolve-JavaHome -Hint $JavaHome
if ($resolvedJava) {
  $tmpJava = [string]$resolvedJava
  if ($tmpJava) { $env:JAVA_HOME = $tmpJava.Trim() }
}
$resolvedSdk = Resolve-AndroidSdkRoot -Hint $AndroidSdk
if ($resolvedSdk) {
  $tmpSdk = [string]$resolvedSdk
  if ($tmpSdk) { $env:ANDROID_SDK_ROOT = $tmpSdk.Trim() }
}
Write-Host ("JAVA_HOME=" + ($(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { '<not found>' })))
Write-Host ("ANDROID_SDK_ROOT=" + ($(if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { '<not found>' })))
Write-Host ("ANDROID_HOME=" + ($(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { '<not set>' })))

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
${bwrapInfo} = Get-BubblewrapCommand
if (-not $bwrapInfo.Path) { Write-Warning "Bubblewrap CLI not found even after install. Skipping TWA."; $skipAllTwa = $true }

$twadir = Join-Path (Get-Location) "twa"
New-Item -ItemType Directory -Force -Path $twadir | Out-Null
Push-Location $twadir

# Prepare config (UTF-8 without BOM)
$bubbleCfgDir = Join-Path $env:USERPROFILE ".bubblewrap"
New-Item -ItemType Directory -Force -Path $bubbleCfgDir | Out-Null
$cfgPath = Join-Path $bubbleCfgDir "config.json"
$sdkPath = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { $env:ANDROID_HOME }
$javaCfg = if ($env:JAVA_HOME) { ([string]$env:JAVA_HOME).Trim() } else { '' }
$sdkCfg = if ($sdkPath) { ([string]$sdkPath).Trim() } else { '' }
$cfg = @{ jdkPath = $javaCfg; androidSdkPath = $sdkCfg } | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($cfgPath, $cfg, $utf8NoBom)
Write-Host "Bubblewrap config:"; Get-Content $cfgPath

# Extra diagnostics to show effective paths seen by Bubblewrap and environment
Write-Host "Diagnostics:"
Write-Host ("  Config file: " + $cfgPath)
Write-Host ("  bubblewrap binary: " + $bwrapInfo.Path + " (UseNpx=" + $bwrapInfo.UseNpx + ")")
Write-Host ("  Effective sdkCfg (androidSdkPath): " + ($(if ($sdkCfg) { $sdkCfg } else { '<empty>' })))
Write-Host ("  JAVA_HOME: " + ($(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { '<unset>' })))
Write-Host ("  ANDROID_SDK_ROOT: " + ($(if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { '<unset>' })))
Write-Host ("  ANDROID_HOME: " + ($(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { '<unset>' })))
try {
  $adbOnPath = (Get-Command adb.exe -ErrorAction SilentlyContinue)
  if ($adbOnPath) { Write-Host ("  adb on PATH: " + $adbOnPath.Source) } else { Write-Host "  adb on PATH: <not found>" }
} catch { Write-Host "  adb on PATH: <error checking>" }

# Validate SDK before doing anything interactive
$skipTwa = $false
if (-not $sdkCfg) {
  $skipTwa = $true
  Write-Warning "ANDROID_SDK_ROOT/ANDROID_HOME not set. Skipping TWA generation."
} else {
  $hasPlatformToolsDir = Test-Path (Join-Path $sdkCfg 'platform-tools')
  $hasPlatformToolsExe = Test-Path (Join-Path $sdkCfg 'platform-tools\adb.exe')
  $buildToolsRoot = Join-Path $sdkCfg 'build-tools'
  $hasBuildToolsDir = Test-Path $buildToolsRoot
  $hasBuildToolsVer = $false
  $hasAapt2 = $false
  $hasApkSigner = $false
  if ($hasBuildToolsDir) {
    try {
      $btVers = Get-ChildItem $buildToolsRoot -Directory -ErrorAction SilentlyContinue
      if ($btVers -and $btVers.Count -gt 0) { $hasBuildToolsVer = $true }
      foreach ($v in $btVers) {
        if (-not $hasAapt2 -and (Test-Path (Join-Path $v.FullName 'aapt2.exe'))) { $hasAapt2 = $true }
        if (-not $hasApkSigner -and (Test-Path (Join-Path $v.FullName 'apksigner.bat'))) { $hasApkSigner = $true }
        if ($hasAapt2 -and $hasApkSigner) { break }
      }
    } catch {}
  }
  $hasPlatformAndroid = (
    (Test-Path (Join-Path $sdkCfg 'platforms\android-36\android.jar')) -or
    (Test-Path (Join-Path $sdkCfg 'platforms\android-35\android.jar')) -or
    (Test-Path (Join-Path $sdkCfg 'platforms\android-34\android.jar'))
  )

  # Print a concise pre-check summary
  Write-Host "SDK pre-check:"
  Write-Host ("  sdkCfg: " + $sdkCfg)
  $sdkManagerPath = Find-SdkManager -SdkRoot $sdkCfg
  Write-Host ("  sdkmanager: " + ($(if ($sdkManagerPath) { $sdkManagerPath } else { '<not found under cmdline-tools\\latest>' })))
  Write-Host ("  platform-tools dir: " + $hasPlatformToolsDir + "; adb.exe: " + $hasPlatformToolsExe)
  Write-Host ("  build-tools dir: " + $hasBuildToolsDir + "; versions present: " + $hasBuildToolsVer + "; aapt2: " + $hasAapt2 + "; apksigner: " + $hasApkSigner)
  Write-Host ("  platforms (34/35/36) present: " + $hasPlatformAndroid)

  if (-not ($hasPlatformToolsDir -and $hasPlatformToolsExe -and $hasBuildToolsDir -and $hasBuildToolsVer -and $hasPlatformAndroid)) {
    Write-Warning "Android SDK at '$sdkCfg' looks incomplete. Attempting to install with sdkmanager (platform-tools, platforms;android-34, build-tools;34.0.0)..."
    if (Install-AndroidPackages -SdkRoot $sdkCfg) {
      # Re-check after install
      $hasPlatformToolsDir = Test-Path (Join-Path $sdkCfg 'platform-tools')
      $hasPlatformToolsExe = Test-Path (Join-Path $sdkCfg 'platform-tools\adb.exe')
      $hasBuildToolsDir = Test-Path $buildToolsRoot
      $hasBuildToolsVer = $false
      $hasAapt2 = $false
      $hasApkSigner = $false
      if ($hasBuildToolsDir) {
        try {
          $btVers = Get-ChildItem $buildToolsRoot -Directory -ErrorAction SilentlyContinue
          if ($btVers -and $btVers.Count -gt 0) { $hasBuildToolsVer = $true }
          foreach ($v in $btVers) {
            if (-not $hasAapt2 -and (Test-Path (Join-Path $v.FullName 'aapt2.exe'))) { $hasAapt2 = $true }
            if (-not $hasApkSigner -and (Test-Path (Join-Path $v.FullName 'apksigner.bat'))) { $hasApkSigner = $true }
            if ($hasAapt2 -and $hasApkSigner) { break }
          }
        } catch {}
      }
      $hasPlatformAndroid = (
    (Test-Path (Join-Path $sdkCfg 'platforms\android-36\android.jar')) -or
    (Test-Path (Join-Path $sdkCfg 'platforms\android-35\android.jar')) -or
    (Test-Path (Join-Path $sdkCfg 'platforms\android-34\android.jar'))
      )
    }
    if (-not ($hasPlatformToolsDir -and $hasPlatformToolsExe -and $hasBuildToolsDir -and $hasBuildToolsVer -and $hasPlatformAndroid)) {
      $skipTwa = $true
  Write-Warning "SDK still incomplete. Skipping TWA. Install: platform-tools, platforms;android-34 or 35, build-tools;34.0.0 or 35.0.0 (with aapt2/apksigner)."
  Write-Warning "SDK still incomplete. Skipping TWA. Install: platform-tools, platforms;android-36/35/34, build-tools;36.0.0/35.0.0/34.0.0 (with aapt2/apksigner)."
    }
  }
}

if (-not $skipTwa -and -not $skipAllTwa) {
  $doctorOk = $true
  try {
    Write-Host ("Running bubblewrap doctor (config=" + $cfgPath + "; androidSdkPath=" + $sdkCfg + ")...")
    if ($bwrapInfo.UseNpx) { & $bwrapInfo.Path bubblewrap doctor } else { & $bwrapInfo.Path doctor }
    Write-Host ("bubblewrap doctor exit code: " + $LASTEXITCODE)
    if ($LASTEXITCODE -ne 0) { $doctorOk = $false }
  } catch { $doctorOk = $false; Write-Warning ("bubblewrap doctor reported issues: " + $_) }
  if (-not $doctorOk) {
    Write-Warning "bubblewrap doctor failed. Trying to auto-fix SDK and update config..."
    # Try updating config path explicitly and (re)install packages, then retry doctor
    try {
      if ($bwrapInfo.UseNpx) { & $bwrapInfo.Path bubblewrap updateConfig --androidSdkPath "$sdkCfg" } else { & $bwrapInfo.Path updateConfig --androidSdkPath "$sdkCfg" }
    } catch {}
    try { Install-AndroidPackages -SdkRoot $sdkCfg | Out-Null } catch {}
    try {
      Write-Host ("Re-running bubblewrap doctor after fixes (androidSdkPath=" + $sdkCfg + ")...")
      if ($bwrapInfo.UseNpx) { & $bwrapInfo.Path bubblewrap doctor } else { & $bwrapInfo.Path doctor }
      Write-Host ("bubblewrap doctor (retry) exit code: " + $LASTEXITCODE)
      if ($LASTEXITCODE -ne 0) { $doctorOk = $false } else { $doctorOk = $true }
    } catch { $doctorOk = $false }
  }

  if ($doctorOk) {
    # Manifest URL must be HTTP(S)
    if (-not $owner -or -not $repo) {
      try {
        $remote = git config --get remote.origin.url 2>$null
        if ($remote -and $remote -match '[:/]([^/]+)/([^/]+?)(\.git)?$') { $owner = $Matches[1]; $repo = $Matches[2] }
      } catch {}
      if (-not $owner) { $owner = 'tayden1990' }
      if (-not $repo) { $repo = Split-Path -Leaf (Get-Location) }
    }
    $manifestUrl = "https://raw.githubusercontent.com/$owner/$repo/main/public/manifest.webmanifest"

    # Derive domain and path from APP_URL and feed them to init
    try { $appUri = [System.Uri]$AppUrl } catch { $appUri = $null }
    $domain = if ($appUri) { $appUri.Host } else { "$owner.github.io" }
    $path = if ($appUri) { $appUri.AbsolutePath } else { "/$repo/" }
    if (-not $path.StartsWith('/')) { $path = '/' + $path }
    if (-not $path.EndsWith('/')) { $path = $path + '/' }
    # Debug the derived values
    Write-Host "DEBUG: APP_URL=$AppUrl, domain=$domain, path=$path"
    
    # Create a corrected local manifest file for Bubblewrap
    $localManifest = Join-Path (Get-Location) "temp-manifest.webmanifest"
    try {
      $originalManifest = Get-Content "public/manifest.webmanifest" -Raw -ErrorAction Stop
      $correctedManifest = $originalManifest -replace '"start_url"\s*:\s*"[^"]*"', ('"start_url": "' + $path + '"') -replace '"scope"\s*:\s*"[^"]*"', ('"scope": "' + $path + '"') -replace '"id"\s*:\s*"[^"]*"', ('"id": "' + $path + '"')
      Set-Content -Path $localManifest -Value $correctedManifest -Encoding UTF8
      Write-Host "Created corrected local manifest at: $localManifest"
    } catch {
      Write-Host "Failed to create local manifest, using remote: $manifestUrl"
      $localManifest = $manifestUrl
    }
    
    Write-Host "Initializing bubblewrap from manifest: $localManifest"
  $answers = "${domain}`r`n${path}`r`n" + ("`r`n" * 40)
  # Use npx when only a PowerShell wrapper is present to ensure STDIN answers are read correctly
  $useNpxForInit = $bwrapInfo.UseNpx -or ($bwrapInfo.Path -and $bwrapInfo.Path.ToLower().EndsWith('.ps1'))
  if ($useNpxForInit) {
      # Use npx to run bubblewrap init with proper syntax
      $answers | npx @bubblewrap/cli init --manifest "$localManifest" --directory . --skipPwaValidation
    } else {
      $answers | & $bwrapInfo.Path init --manifest "$localManifest" --directory . --skipPwaValidation
    }

    if (Test-Path "twa-manifest.json") {
      (Get-Content "twa-manifest.json") -replace '"start_url"\s*:\s*"\."?,?', '"start_url": ' + '"' + $AppUrl + '"' | Set-Content "twa-manifest.json" -Encoding UTF8
      Write-Host "Building APK (unsigned)..."
      try {
        $btRoot = Join-Path $sdkCfg 'build-tools'
        $latestBt = (Get-ChildItem $btRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
        if ($latestBt) { $env:Path = "$latestBt;$env:Path" }
        $pt = Join-Path $sdkCfg 'platform-tools'
        if (Test-Path $pt) { $env:Path = "$pt;$env:Path" }
      } catch {}
      if ($bwrapInfo.UseNpx) {
        & $bwrapInfo.Path bubblewrap build --skipSigning
      } else {
        & $bwrapInfo.Path build --skipSigning
      }

      # Optional: sign the APK if keystore env vars are present
      $ksB64 = $env:ANDROID_KEYSTORE_BASE64
      $ksAlias = $env:ANDROID_KEY_ALIAS
      $ksPass = $env:ANDROID_KEY_PASSWORD
      $storePass = $env:ANDROID_STORE_PASSWORD
      try {
        $unsignedApk = Get-ChildItem -Recurse -Filter *-unsigned.apk -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $unsignedApk) { $unsignedApk = Get-ChildItem -Recurse -Filter *.apk -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'release' } | Select-Object -First 1 }
      } catch { $unsignedApk = $null }
      if ($unsignedApk) { Write-Host ("Unsigned APK: " + $unsignedApk.FullName) }

      if ($ksB64 -and $ksAlias -and $ksPass -and $storePass -and $unsignedApk) {
        $apksigner = Join-Path $latestBt 'apksigner.bat'
        if (-not (Test-Path $apksigner)) { $apksigner = 'apksigner' }
        $keystorePath = Join-Path (Get-Location) 'release-keystore.jks'
        try {
          [IO.File]::WriteAllBytes($keystorePath, [Convert]::FromBase64String($ksB64))
          $signedApk = Join-Path $unsignedApk.Directory.FullName ($unsignedApk.BaseName -replace '-unsigned$','') + '-signed.apk'
          Write-Host "Signing APK..."
          & $apksigner sign --ks "$keystorePath" --ks-key-alias "$ksAlias" --ks-pass "pass:$storePass" --key-pass "pass:$ksPass" --out "$signedApk" "$($unsignedApk.FullName)"
          if ($LASTEXITCODE -eq 0 -and (Test-Path $signedApk)) {
            Write-Host ("Signed APK: " + $signedApk)
            try { & $apksigner verify --print-certs "$signedApk" } catch {}
          } else {
            Write-Warning "APK signing failed. Verify keystore and passwords."
          }
        } catch {
          Write-Warning ("Failed to decode keystore or sign APK: " + $_)
        }
      } else {
        if (-not $ksB64) { Write-Host "Tip: Set ANDROID_KEYSTORE_BASE64 to your base64-encoded .jks to auto-sign." }
        if (-not $ksAlias) { Write-Host "Tip: Set ANDROID_KEY_ALIAS to your key alias." }
        if (-not $ksPass) { Write-Host "Tip: Set ANDROID_KEY_PASSWORD to your key password." }
        if (-not $storePass) { Write-Host "Tip: Set ANDROID_STORE_PASSWORD to your keystore password." }
      }
    } else {
      Write-Warning "twa-manifest.json not created by bubblewrap init; retrying init via npx to pass non-interactive answers..."
      try {
        $answers = "${domain}`r`n${path}`r`n" + ("`r`n" * 40)
        $gc = Get-Command npx -ErrorAction SilentlyContinue
        if ($gc) {
          $answers | & $gc.Source -y @bubblewrap/cli init --manifest "$manifestUrl" --directory . --skipPwaValidation
        }
      } catch {}
      if (Test-Path "twa-manifest.json") {
        (Get-Content "twa-manifest.json") -replace '"start_url"\s*:\s*"\."?,?', '"start_url": ' + '"' + $AppUrl + '"' | Set-Content "twa-manifest.json" -Encoding UTF8
        Write-Host "Building APK (unsigned)..."
        try {
          $btRoot = Join-Path $sdkCfg 'build-tools'
          $latestBt = (Get-ChildItem $btRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
          if ($latestBt) { $env:Path = "$latestBt;$env:Path" }
          $pt = Join-Path $sdkCfg 'platform-tools'
          if (Test-Path $pt) { $env:Path = "$pt;$env:Path" }
        } catch {}
        if ($bwrapInfo.UseNpx) {
          & $bwrapInfo.Path bubblewrap build --skipSigning
        } else {
          & $bwrapInfo.Path build --skipSigning
        }
      } else {
        Write-Warning "twa-manifest.json still missing after retry; please answer prompts as: Domain=$domain, URL path=$path"
      }
    }
  } else {
    Write-Warning "bubblewrap doctor still failing after attempted fixes. Skipping TWA generation."
  }
}

Write-Host "Done. Outputs:"
Pop-Location | Out-Null
Get-ChildItem . -Recurse -Force | Where-Object { $_.FullName -match 'dist-desktop|twa\\build' } | Select-Object FullName, Length | Format-Table -AutoSize
