@echo off
echo ==============================================
echo      GlobGram Android App Build Setup
echo ==============================================
echo.

echo Step 1: Getting app fingerprint...
call get-fingerprint.bat

echo.
echo Step 2: Make sure to update assetlinks.json with the fingerprint above
echo.
echo Step 3: Deploy your website with the updated assetlinks.json
echo.
echo Step 4: Building Android app...
echo.

cd app

echo Building debug version...
call gradlew assembleDebug
if %errorlevel% neq 0 (
    echo Debug build failed!
    pause
    exit /b 1
)

echo.
echo Building release version...
call gradlew assembleRelease
if %errorlevel% neq 0 (
    echo Release build failed!
    pause
    exit /b 1
)

echo.
echo ==============================================
echo            Build Complete!
echo ==============================================
echo.
echo Debug APK: app\build\outputs\apk\debug\app-debug.apk
echo Release APK: app\build\outputs\apk\release\app-release.apk
echo.
echo Install debug APK on your device to test TWA functionality.
echo For production, use the release APK and ensure Digital Asset Links are properly configured.
echo.
pause
