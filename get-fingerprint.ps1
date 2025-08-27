# PowerShell script to get app fingerprint for Digital Asset Links
Write-Host "Getting app fingerprint for Digital Asset Links..." -ForegroundColor Green
Write-Host ""

# Find Java installation
$javaHome = $env:JAVA_HOME
if (-not $javaHome) {
    # Try to find Java in common locations
    $possiblePaths = @(
        "${env:ProgramFiles}\Java",
        "${env:ProgramFiles(x86)}\Java",
        "${env:ProgramData}\Oracle\Java",
        "${env:LOCALAPPDATA}\Programs\Java"
    )
    
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $jdkFolders = Get-ChildItem $path -Directory | Where-Object { $_.Name -like "*jdk*" } | Sort-Object Name -Descending
            if ($jdkFolders) {
                $javaHome = $jdkFolders[0].FullName
                break
            }
        }
    }
}

if (-not $javaHome) {
    Write-Host "Error: Java JDK not found. Please install Java JDK and set JAVA_HOME environment variable." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$keytoolPath = Join-Path $javaHome "bin\keytool.exe"
if (-not (Test-Path $keytoolPath)) {
    Write-Host "Error: keytool not found at $keytoolPath" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if keystore exists
if (-not (Test-Path "my-release-key.JKS")) {
    Write-Host "Error: my-release-key.JKS not found in current directory." -ForegroundColor Red
    Write-Host "Please run this script from the project root directory." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Getting SHA256 fingerprint from keystore..." -ForegroundColor Yellow
Write-Host ""

try {
    $output = & $keytoolPath -list -v -keystore "my-release-key.JKS" -alias "Tayden1990" -storepass "4522815" -keypass "4522815" 2>&1
    $sha256Line = $output | Where-Object { $_ -match "SHA256:" }
    
    if ($sha256Line) {
        Write-Host "SHA256 Fingerprint found:" -ForegroundColor Green
        Write-Host $sha256Line -ForegroundColor Cyan
        
        # Extract just the fingerprint part
        $fingerprint = ($sha256Line -split "SHA256:\s*")[1].Trim()
        Write-Host ""
        Write-Host "Copy this fingerprint:" -ForegroundColor Yellow
        Write-Host $fingerprint -ForegroundColor White -BackgroundColor DarkBlue
        
        # Update assetlinks.json automatically
        $assetlinksPath = "public\.well-known\assetlinks.json"
        if (Test-Path $assetlinksPath) {
            $content = Get-Content $assetlinksPath -Raw
            $updatedContent = $content -replace "YOUR_APP_FINGERPRINT_HERE", $fingerprint
            Set-Content $assetlinksPath $updatedContent
            Write-Host ""
            Write-Host "✅ Updated assetlinks.json automatically!" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "⚠️  assetlinks.json not found. Please update it manually." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Error: SHA256 fingerprint not found in keystore output." -ForegroundColor Red
        Write-Host "Raw output:" -ForegroundColor Gray
        Write-Host $output -ForegroundColor Gray
    }
} catch {
    Write-Host "Error running keytool: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "1. Commit and push the updated assetlinks.json to GitHub" -ForegroundColor White
Write-Host "2. GitHub Actions will automatically deploy your website" -ForegroundColor White
Write-Host "3. GitHub Actions will automatically build your Android app" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
