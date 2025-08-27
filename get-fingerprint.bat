@echo off
echo Getting app fingerprint for Digital Asset Links...
echo.

REM Check if keytool is available
where keytool >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: keytool not found. Please ensure Java JDK is installed and added to PATH.
    pause
    exit /b 1
)

REM Check if keystore exists
if not exist "my-release-key.JKS" (
    echo Error: my-release-key.JKS not found in current directory.
    echo Please run this script from the project root directory.
    pause
    exit /b 1
)

echo Getting SHA256 fingerprint from keystore...
echo.

keytool -list -v -keystore my-release-key.JKS -alias Tayden1990 -storepass 4522815 -keypass 4522815 | findstr SHA256

echo.
echo Copy the SHA256 fingerprint (the part after "SHA256:") and replace
echo "YOUR_APP_FINGERPRINT_HERE" in public/.well-known/assetlinks.json
echo.
echo After updating assetlinks.json, deploy your website and then build the Android app.
echo.
pause
